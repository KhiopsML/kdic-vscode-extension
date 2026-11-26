/** Type checks of the rule calls of derivations: return types against variables, arguments against parameters. */
import { tokenName, type KdicToken } from '../kdic-lexer';
import { isConcreteType, parameterTypeAt, type RuleMaps } from '../rule-maps';
import { constantType, isSymbol, parseCall, type Argument, type RuleCall, type UpperArgument } from './call-tree';
import {
  ancestorOf, createScopeContext, describeArgument, describeCall, dictionaryScope, mappedOutputScope,
  targetDictionaryScope, type CallDescription, type Scope, type ScopeContext,
} from './call-scopes';
import { Severity, type DiagnosticCollector } from './diagnostics';
import type { Declaration, Dictionary, Structure } from './structure';

/** Everything the checks of the calls of a file share. */
interface CallContext extends ScopeContext {
  out: DiagnosticCollector;
}

/** What is known of the argument being checked: the rule that takes it, and the type expected there. */
interface Slot {
  ruleName: string;
  position: number;
  /** The expected type, or `any` where the argument is not checked. */
  expected: string;
}

/** The return type of `rule` when it cannot be `expected`; undefined when it can, or when the rule is not known. */
function mismatchedReturnType(rules: RuleMaps, rule: string, expected: string): string | undefined {
  const returnType = rules.returnTypes.get(rule);
  return returnType && returnType !== 'any' && !returnType.split('|').includes(expected) ? returnType : undefined;
}

/** A constant must have the type the rule expects; only `Numerical` and `Categorical` have constants. */
function checkConstant(token: KdicToken, { ruleName, expected, position }: Slot, { out }: CallContext): void {
  const actual = constantType(token);
  if (!actual || actual === expected || !['Numerical', 'Categorical'].includes(expected)) { return; }
  const text = token.text.length > 40 ? `${token.text.slice(0, 39)}…` : token.text;
  out.atToken(token, `Constant ${text} is '${actual}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
}

/**
 * A variable of the scope, plain or between backquotes, must be declared and have the expected type.
 * Nothing is checked where the signature has no type (`any`) or takes a block.
 */
function checkVariable(token: KdicToken, { ruleName, expected, position }: Slot, scope: Scope, { out }: CallContext): void {
  if (expected === 'any' || expected.startsWith('Block(')) { return; }
  const name = tokenName(token);
  const actual = scope.variables.get(name)?.type.text;
  if (actual === undefined) {
    out.atToken(token, `'${name}' is not declared in ${scope.label}.`, Severity.Warning);
  } else if (actual !== expected) {
    out.atToken(token, `'${name}' is '${actual}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
  }
}

/** The result of a nested call must be a type the enclosing rule accepts at that position (when it expects a plain type). */
function checkNestedResult(nested: RuleCall, { ruleName, expected, position }: Slot, { rules, out }: CallContext): void {
  if (rules.unverifiedRules.has(nested.rule.text)) { return; }
  const returnType = isConcreteType(expected) ? mismatchedReturnType(rules, nested.rule.text, expected) : undefined;
  if (returnType) {
    out.atToken(nested.rule,
      `'${nested.rule.text}' returns '${returnType}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
  }
}

/** An argument behind the scope operator: its variable or call is resolved as many scopes up as it has dots. */
function checkUpperArgument(arg: UpperArgument, slot: Slot, anchor: Scope | undefined, context: CallContext): void {
  const found = ancestorOf(anchor, arg.dots.length);
  if (found === 'beyond') {
    const [first] = arg.dots;
    const last = arg.dots[arg.dots.length - 1];
    context.out.at(first.start, last.end - first.start,
      `Scope operator '${arg.dots.map(dot => dot.text).join('')}' goes beyond the depth of the calling rules.`);
  }
  const upper = found === 'beyond' ? undefined : found;

  if (arg.argument.kind === 'variable') {
    if (upper) { checkVariable(arg.argument.token, slot, upper, context); }
    return;
  }
  checkNestedPlacement(arg.argument.call, slot.ruleName, context);
  checkNestedResult(arg.argument.call, slot, context);
  checkCall(arg.argument.call, upper, anchor, context);
}

/** Reports a nested rule form that Khiops rejects at this operand site. */
function checkNestedPlacement(nested: RuleCall, parentRule: string, context: CallContext): void {
  if (context.rules.disallowAsOperand.has(nested.rule.text)) {
    context.out.atToken(nested.rule,
      `'${nested.rule.text}' cannot be used as an operand of '${parentRule}'.`);
  }
}

/**
 * Checks a call and, through its arguments, the calls nested in it. `scope` is where its operands are
 * resolved, when known, and `anchor` the scope they are written in, from which the dots of the scope
 * operator are counted: it differs from `scope` inside a call that has itself been moved up by dots.
 * A constant or a nested result has the same type in any scope, so those are checked anyway.
 * The calls that the registered signatures do not describe get no type checks of their own.
 */
function checkCall(call: RuleCall, scope: Scope | undefined, anchor: Scope | undefined, context: CallContext): void {
  if (context.rules.unverifiedRules.has(call.rule.text)) { return; }
  const description = describeCall(call, scope, anchor, context);

  call.args.forEach((arg, position) => {
    const argument = describeArgument(call, description, position, scope, anchor, context);
    const slot: Slot = { ruleName: call.rule.text, position, expected: argument.expected };

    if (arg.kind === 'upper') {
      checkUpperArgument(arg, slot, argument.anchor, context);
    } else if (arg.kind === 'call') {
      checkNestedPlacement(arg.call, call.rule.text, context);
      checkNestedResult(arg.call, slot, context);
      checkCall(arg.call, argument.scope, argument.anchor, context);
    } else if (arg.kind === 'constant') {
      checkConstant(arg.token, slot, context);
    } else if (arg.kind === 'variable' && argument.scope) {
      checkVariable(arg.token, slot, argument.scope, context);
    }
  });
}

/** The declared type of `Type name = rule(…)` must be one the rule can return. */
function checkReturnType(declaration: Declaration, call: RuleCall, { rules, out }: CallContext): void {
  const returnType = mismatchedReturnType(rules, call.rule.text, declaration.type.text);
  if (returnType) {
    out.atToken(declaration.type,
      `'${call.rule.text}' returns '${returnType}' but variable is declared as '${declaration.type.text}'.`);
  }
}

/** The type a mapped source operand has, when it is a plain variable type (Khiops compares those exactly). */
function argumentType(
  argument: Argument, scope: Scope | undefined, anchor: Scope | undefined, context: CallContext,
): string | undefined {
  if (argument.kind === 'variable') { return scope?.variables.get(tokenName(argument.token))?.type.text; }
  if (argument.kind === 'constant') { return constantType(argument.token); }
  if (argument.kind === 'call') {
    const type = context.rules.returnTypes.get(argument.call.rule.text);
    return type?.split('|').every(isConcreteType) ? type : undefined;
  }
  if (argument.kind === 'upper') {
    const upper = ancestorOf(anchor, argument.dots.length);
    return upper && upper !== 'beyond' ? argumentType(argument.argument, upper, anchor, context) : undefined;
  }
  return undefined;
}

/** What the checks of the target names of a call need: where its operands and its names are resolved. */
interface MappingSite {
  call: RuleCall;
  scope: Scope;
  target: Scope;
  description: CallDescription;
}

/** There must be as many target names as mapped source operands, or as many as the signature lists. */
function checkOutputCount(call: RuleCall, separator: KdicToken, { rules, out }: CallContext): void {
  const names = call.outputNames?.length ?? 0;
  const from = rules.mappedInputsFrom.get(call.rule.text);
  const listed = rules.outputTypes.get(call.rule.text) ?? [];
  if (from !== undefined) {
    const operands = Math.max(0, call.args.length - from);
    if (names !== operands) { out.atToken(separator, `'${call.rule.text}' has ${names} output names for ${operands} mapped source operands.`); }
  } else if (!listed.includes('...') && names !== listed.length) {
    out.atToken(separator, `'${call.rule.text}' requires ${listed.length} output names but has ${names}.`);
  }
}

/** The type of the source operand mapped to the target name at `position`, for a rule that maps them in order. */
function mappedSourceType({ call, scope, description }: MappingSite, position: number, context: CallContext): string | undefined {
  const from = context.rules.mappedInputsFrom.get(call.rule.text);
  const source = from === undefined ? undefined : call.args[from + position];
  if (from === undefined || !source) { return undefined; }
  const operand = describeArgument(call, description, from + position, scope, scope, context);
  return argumentType(source, operand.scope, operand.anchor, context);
}

/**
 * A target name must be declared where the rule resolves it and, when the rule types its outputs, have that
 * type; when it does not (`any`), it must have the type of the source operand mapped to it.
 */
function checkOutputName(site: MappingSite, token: KdicToken, position: number, context: CallContext): void {
  const { call } = site;
  const name = tokenName(token);
  const dictionary = mappedOutputScope(call, position, site.target, context);
  if (!dictionary) { return; }
  const variable = dictionary.variables.get(name);
  if (!variable) {
    context.out.atToken(token, `'${name}' is not declared in ${dictionary.label}.`);
    return;
  }

  const actual = variable.type.text;
  const required = parameterTypeAt(context.rules.outputTypes.get(call.rule.text) ?? [], position);
  if (required && required !== 'any') {
    if (!required.split('|').includes(actual)) {
      context.out.atToken(token, `'${name}' is '${actual}' but '${call.rule.text}' requires '${required}' for output ${position + 1}.`);
    }
    return;
  }
  const sourceType = mappedSourceType(site, position, context);
  if (sourceType && !sourceType.split('|').includes(actual)) {
    context.out.atToken(token, `'${call.rule.text}' maps a '${sourceType}' value to '${name}' of type '${actual}'.`);
  }
}

/** Checks the target names after the `:` of a call against the target dictionary of the variable it defines. */
function checkOutputNames(declaration: Declaration | undefined, call: RuleCall, scope: Scope, context: CallContext): void {
  const target = declaration && targetDictionaryScope(declaration, context, scope);
  if (!target || !call.outputSeparator) { return; }
  checkOutputCount(call, call.outputSeparator, context);
  const site: MappingSite = { call, scope, target, description: describeCall(call, scope, scope, context) };
  call.outputNames?.forEach((token, position) => checkOutputName(site, token, position, context));
}

/** Checks every derivation of a dictionary: `= rule(…)`, with the rules nested in it. */
function checkDictionaryCalls(dictionary: Dictionary, tokens: readonly KdicToken[], context: CallContext): void {
  const scope = dictionaryScope(dictionary, context);
  // Only a derivation written right after the variable's name has a return type to compare with.
  const derived = new Map(dictionary.declarations
    .filter(declaration => declaration.equalsIndex === declaration.nameIndex + 1)
    .map(declaration => [declaration.equalsIndex, declaration]));

  for (let index = dictionary.openIndex + 1; index < dictionary.closeIndex; index++) {
    if (!isSymbol(tokens[index], '=')) { continue; }
    if (tokens[index + 1]?.kind !== 'identifier' || !isSymbol(tokens[index + 2], '(')) { continue; }
    const call = parseCall(tokens, index + 1, dictionary.closeIndex, { outputRules: context.rules.outputTypes });
    if (!call) { continue; }

    if (context.rules.unverifiedRules.has(call.rule.text)) { continue; }
    const declaration = derived.get(index);
    if (declaration) { checkReturnType(declaration, call, context); }
    checkOutputNames(declaration, call, scope, context);
    checkCall(call, scope, scope, context);
  }
}

/**
 * Type checks on the rule calls of every dictionary: the rule's return type against the variable it
 * is assigned to, and its arguments (variables, constants and the results of nested calls) against
 * its parameters. Calls that are not closed yet, as while typing, are not checked.
 */
export function checkRuleCalls(structure: Structure, tokens: readonly KdicToken[], rules: RuleMaps, out: DiagnosticCollector): void {
  const context: CallContext = { ...createScopeContext(structure, rules), out };
  for (const dictionary of structure.dictionaries) { checkDictionaryCalls(dictionary, tokens, context); }
}
