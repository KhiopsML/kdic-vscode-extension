import { isNameToken, tokenName, type KdicToken } from '../kdic-lexer';
import { isConcreteType, parameterTypeAt, type RuleMaps } from '../rule-maps';
import { Severity, type DiagnosticCollector } from './diagnostics';
import type { Declaration, Dictionary, Structure } from './structure';

/** Deeper nesting is left unchecked, which keeps the recursion bounded on generated files. */
const MAX_NESTING = 100;

/** An argument of a rule call, by what it is. */
type Argument =
  | VariableArgument
  | CallArgument
  | { kind: 'constant'; token: KdicToken }
  | UpperArgument
  // Anything else: left to Khiops.
  | { kind: 'other' };

interface VariableArgument { kind: 'variable'; token: KdicToken }
interface CallArgument { kind: 'call'; call: RuleCall }

/** A variable or call written with the scope operator: `.name`, `..name`, `.rule(…)`. Each dot goes one scope up. */
interface UpperArgument {
  kind: 'upper';
  dots: KdicToken[];
  argument: VariableArgument | CallArgument;
}

/** A call `rule(argument, …)` and its arguments. */
interface RuleCall {
  rule: KdicToken;
  args: Argument[];
  /** Index of the closing `)`. */
  closeIndex: number;
}

const isSymbol = (token: KdicToken | undefined, text: string): boolean => token?.kind === 'symbol' && token.text === text;

/** Whether the token ends a statement, so that a call still open before it is not a call being written. */
const endsStatement = (token: KdicToken): boolean => token.kind === 'symbol' && [';', '{', '}'].includes(token.text);

/** The type of a constant, or undefined for another token (an unclosed string is reported elsewhere). */
function constantType(token: KdicToken): string | undefined {
  if (token.kind === 'string') { return token.closed === false ? undefined : 'Categorical'; }
  return token.kind === 'number' || token.kind === 'missing' ? 'Numerical' : undefined;
}

/** Classifies the tokens `[start, end)` of an argument that is not a call. */
function parseLeaf(tokens: readonly KdicToken[], start: number, end: number): Argument {
  const token = tokens[start];
  if (end - start !== 1) { return { kind: 'other' }; }
  if (isNameToken(token)) { return { kind: 'variable', token }; }
  return constantType(token) ? { kind: 'constant', token } : { kind: 'other' };
}

/**
 * Parses the operand that starts at `start`, up to the `,` or `)` that ends it, whose index is `next`.
 * Returns undefined when the call is not closed before the end of the statement.
 */
function parseOperand(
  tokens: readonly KdicToken[], start: number, limit: number, depth: number,
): { argument: Argument; next: number } | undefined {
  if (tokens[start]?.kind === 'identifier' && isSymbol(tokens[start + 1], '(')) {
    const call = parseCall(tokens, start, limit, depth + 1);
    if (!call) { return undefined; }
    const next = call.closeIndex + 1;
    if (isSymbol(tokens[next], ',') || isSymbol(tokens[next], ')')) { return { argument: { kind: 'call', call }, next }; }
  }

  // Not a call: skip to the separator, over any parentheses of its own.
  let nesting = 0;
  for (let index = start; index < limit; index++) {
    const token = tokens[index];
    if (endsStatement(token)) { return undefined; }
    if (isSymbol(token, '(')) { nesting++; }
    else if (isSymbol(token, ')') && nesting > 0) { nesting--; }
    else if (isSymbol(token, ')') || (isSymbol(token, ',') && nesting === 0)) {
      return { argument: parseLeaf(tokens, start, index), next: index };
    }
  }
  return undefined;
}

/** Parses an argument: an operand, possibly behind the dots of the scope operator. */
function parseArgument(
  tokens: readonly KdicToken[], start: number, limit: number, depth: number,
): { argument: Argument; next: number } | undefined {
  let dots = 0;
  while (isSymbol(tokens[start + dots], '.')) { dots++; }
  const parsed = parseOperand(tokens, start + dots, limit, depth);
  if (!parsed || dots === 0) { return parsed; }

  const { argument } = parsed;
  if (argument.kind !== 'variable' && argument.kind !== 'call') { return { argument: { kind: 'other' }, next: parsed.next }; }
  return { argument: { kind: 'upper', dots: tokens.slice(start, start + dots), argument }, next: parsed.next };
}

/** Parses the call whose name is at `index`, followed by `(`. Returns undefined when it is not closed. */
function parseCall(tokens: readonly KdicToken[], index: number, limit: number, depth = 0): RuleCall | undefined {
  if (depth > MAX_NESTING) { return undefined; }
  const args: Argument[] = [];
  let cursor = index + 2;
  if (isSymbol(tokens[cursor], ')')) { return { rule: tokens[index], args, closeIndex: cursor }; }
  while (cursor < limit) {
    const parsed = parseArgument(tokens, cursor, limit, depth);
    if (!parsed) { return undefined; }
    args.push(parsed.argument);
    if (isSymbol(tokens[parsed.next], ')')) { return { rule: tokens[index], args, closeIndex: parsed.next }; }
    cursor = parsed.next + 1;
  }
  return undefined;
}

/** The variables an operand can name, with how a message calls the dictionary that declares them. */
interface Scope {
  variables: ReadonlyMap<string, Declaration>;
  label: string;
  /** The scope the table rule was evaluated in: the one that a dot in front of an operand goes to. */
  parent?: Scope;
}

/** Everything the checks of the calls of a file share. */
interface CallContext {
  rules: RuleMaps;
  out: DiagnosticCollector;
  /** The dictionaries of the file, by name. */
  dictionaries: ReadonlyMap<string, readonly Dictionary[]>;
  variableMaps: Map<Dictionary, ReadonlyMap<string, Declaration>>;
}

/** A constant must have the type the rule expects; only `Numerical` and `Categorical` have constants. */
function checkConstant(token: KdicToken, { ruleName, expected, position }: Slot, { out }: CallContext): void {
  const actual = constantType(token);
  if (!actual || actual === expected || !['Numerical', 'Categorical'].includes(expected)) { return; }
  const text = token.text.length > 40 ? `${token.text.slice(0, 39)}…` : token.text;
  out.atToken(token, `Constant ${text} is '${actual}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
}

/** A variable of the scope, plain or between backquotes, must be declared and have the expected type. */
function checkVariable(token: KdicToken, { ruleName, expected, position }: Slot, scope: Scope, { out }: CallContext): void {
  const name = tokenName(token);
  const actual = scope.variables.get(name)?.type.text;
  if (actual === undefined) {
    out.atToken(token, `'${name}' is not declared in ${scope.label}.`, Severity.Warning);
  } else if (actual !== expected) {
    out.atToken(token, `'${name}' is '${actual}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
  }
}

/** The result of a nested call must be a type the enclosing rule accepts at that position. */
function checkNestedResult(nested: RuleCall, { ruleName, expected, position }: Slot, { rules, out }: CallContext): void {
  const returnType = rules.returnTypes.get(nested.rule.text);
  if (!returnType || returnType === 'any' || returnType.split('|').includes(expected)) { return; }
  out.atToken(nested.rule,
    `'${nested.rule.text}' returns '${returnType}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
}

/** The scope `levels` above `scope`: undefined when `scope` is not known, `'beyond'` when there are not that many. */
function ancestorOf(scope: Scope | undefined, levels: number): Scope | undefined | 'beyond' {
  let found = scope;
  for (let level = 0; level < levels && found; level++) {
    found = found.parent;
    if (!found) { return 'beyond'; }
  }
  return found;
}

/** The declaration of the variable that a table rule's first operand names, whether or not it has dots. */
function firstOperandDeclaration(first: Argument | undefined, scope: Scope | undefined, anchor: Scope | undefined): Declaration | undefined {
  if (first?.kind === 'variable') { return scope?.variables.get(tokenName(first.token)); }
  if (first?.kind !== 'upper' || first.argument.kind !== 'variable') { return undefined; }
  const upper = ancestorOf(anchor, first.dots.length);
  return upper && upper !== 'beyond' ? upper.variables.get(tokenName(first.argument.token)) : undefined;
}

/**
 * The scope of the operands of a table or entity rule that are in the secondary table: the dictionary the
 * first operand's `Table(X)` or `Entity(X)` points to. Unknown when the first operand is not a variable
 * of a known scope, or X is not declared exactly once in the file. A dot in front of an operand written
 * there goes back to `scope`, where the rule is evaluated.
 */
function secondaryScope(call: RuleCall, scope: Scope | undefined, anchor: Scope | undefined, context: CallContext): Scope | undefined {
  const target = firstOperandDeclaration(call.args[0], scope, anchor)?.relationTarget;
  const candidates = target && context.dictionaries.get(tokenName(target));
  if (!target || !scope || candidates?.length !== 1) { return undefined; }

  const [dictionary] = candidates;
  let variables = context.variableMaps.get(dictionary);
  if (!variables) {
    variables = variablesOf(dictionary);
    context.variableMaps.set(dictionary, variables);
  }
  return { variables, label: `dictionary '${tokenName(target)}'`, parent: scope };
}

/** What is known of the argument being checked: the rule that takes it, and the type expected there. */
interface Slot {
  ruleName: string;
  position: number;
  /** The expected type, or `any` where the argument is not checked. */
  expected: string;
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
  const checked = slot.expected !== 'any' && !slot.expected.startsWith('Block(');

  if (arg.argument.kind === 'variable') {
    if (checked && upper) { checkVariable(arg.argument.token, slot, upper, context); }
    return;
  }
  if (checked && isConcreteType(slot.expected)) { checkNestedResult(arg.argument.call, slot, context); }
  checkCall(arg.argument.call, upper, anchor, context);
}

/** Whether the call has as many arguments as the registered parameters (at least that many, for a rule ending with `...`). */
function hasRegisteredArguments(call: RuleCall, paramTypes: readonly string[]): boolean {
  const fixed = paramTypes.filter(type => type !== '...').length;
  return paramTypes.includes('...') ? call.args.length >= fixed : call.args.length === fixed;
}

/**
 * Checks a call and, through its arguments, the calls nested in it. `scope` is where its operands are
 * resolved, when known. Those of a table or entity rule are in the same scope or, for the operands
 * documented as secondary, in the dictionary of its first operand's table, and everything inside such an
 * operand is too. `anchor` is the scope the operand is written in, from which the dots of the scope
 * operator are counted: it differs from `scope` inside a call that has itself been moved up by dots.
 * A constant or a nested result has the same type in any scope, so those are checked anyway.
 *
 * Parameters are known by position only when the rule is registered and the call has the arguments it
 * describes: a rule may also exist in another form, so other calls get no type checks of their own.
 */
function checkCall(call: RuleCall, scope: Scope | undefined, anchor: Scope | undefined, context: CallContext): void {
  const ruleName = call.rule.text;
  const registered = context.rules.paramTypes.get(ruleName);
  const paramTypes = registered && hasRegisteredArguments(call, registered) ? registered : undefined;
  const isRelational = ['Table', 'Entity', 'Block(Table)', 'Block(Entity)'].includes(paramTypes?.[0] ?? '');
  const secondary = paramTypes && isRelational ? secondaryScope(call, scope, anchor, context) : undefined;

  call.args.forEach((arg, position) => {
    const expected = (paramTypes && parameterTypeAt(paramTypes, position)) ?? 'any';
    const documentedScope = context.rules.paramScopes.get(ruleName)?.[position];
    const kind = documentedScope ?? (isRelational && position > 0 ? 'unknown' : 'current');
    const slot: Slot = { ruleName, position, expected };
    const argumentScope = paramTypes === undefined ? undefined : kind === 'current' ? scope : kind === 'secondary' ? secondary : undefined;
    const argumentAnchor = kind === 'secondary' ? secondary : argumentScope && anchor;
    const checked = expected !== 'any' && !expected.startsWith('Block(');

    if (arg.kind === 'upper') {
      checkUpperArgument(arg, slot, argumentAnchor, context);
    } else if (arg.kind === 'call') {
      if (checked && isConcreteType(expected)) { checkNestedResult(arg.call, slot, context); }
      checkCall(arg.call, argumentScope, argumentAnchor, context);
    } else if (arg.kind === 'constant' && checked) {
      checkConstant(arg.token, slot, context);
    } else if (arg.kind === 'variable' && checked && argumentScope) {
      checkVariable(arg.token, slot, argumentScope, context);
    }
  });
}

/** The declared type of `Type name = rule(…)` must be one the rule can return. */
function checkReturnType(declaration: Declaration, call: RuleCall, { rules, out }: CallContext): void {
  const returnType = rules.returnTypes.get(call.rule.text);
  if (!returnType || returnType === 'any' || returnType.split('|').includes(declaration.type.text)) { return; }
  out.atToken(declaration.type,
    `'${call.rule.text}' returns '${returnType}' but variable is declared as '${declaration.type.text}'.`);
}

/** The variables a dictionary declares, by name (a name declared twice keeps its last declaration). */
function variablesOf(dictionary: Dictionary): Map<string, Declaration> {
  return new Map(dictionary.declarations.map(declaration => [declaration.nameText, declaration]));
}

/** Checks every derivation of a dictionary: `= rule(…)`, with the rules nested in it. */
function checkDictionaryCalls(dictionary: Dictionary, tokens: readonly KdicToken[], context: CallContext): void {
  const scope: Scope = { variables: variablesOf(dictionary), label: 'this dictionary' };
  // Only a derivation written right after the variable's name has a return type to compare with.
  const derived = new Map(dictionary.declarations
    .filter(declaration => declaration.equalsIndex === declaration.nameIndex + 1)
    .map(declaration => [declaration.equalsIndex, declaration]));

  for (let index = dictionary.openIndex + 1; index < dictionary.closeIndex; index++) {
    if (!isSymbol(tokens[index], '=')) { continue; }
    if (tokens[index + 1]?.kind !== 'identifier' || !isSymbol(tokens[index + 2], '(')) { continue; }
    const call = parseCall(tokens, index + 1, dictionary.closeIndex);
    if (!call) { continue; }

    const declaration = derived.get(index);
    if (declaration) { checkReturnType(declaration, call, context); }
    checkCall(call, scope, scope, context);
  }
}

/**
 * Type checks on the rule calls of every dictionary: the rule's return type against the variable it
 * is assigned to, and its arguments (variables, constants and the results of nested calls) against
 * its parameters. Calls that are not closed yet, as while typing, are not checked.
 */
export function checkRuleCalls(structure: Structure, tokens: readonly KdicToken[], rules: RuleMaps, out: DiagnosticCollector): void {
  const dictionaries = new Map<string, Dictionary[]>();
  for (const dictionary of structure.dictionaries) {
    const name = dictionary.header.name;
    if (name) { dictionaries.set(tokenName(name), [...(dictionaries.get(tokenName(name)) ?? []), dictionary]); }
  }
  const context: CallContext = { rules, out, dictionaries, variableMaps: new Map() };
  for (const dictionary of structure.dictionaries) { checkDictionaryCalls(dictionary, tokens, context); }
}
