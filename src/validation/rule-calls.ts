import { isNameToken, tokenName, type KdicToken } from '../kdic-lexer';
import { isConcreteType, parameterTypeAt, type RuleMaps } from '../rule-maps';
import { Severity, type DiagnosticCollector } from './diagnostics';
import type { Declaration, Dictionary, Structure } from './structure';

/** Deeper nesting is left unchecked, which keeps the recursion bounded on generated files. */
const MAX_NESTING = 100;

/** An argument of a rule call, by what it is. */
type Argument =
  | { kind: 'variable'; token: KdicToken }
  | { kind: 'constant'; token: KdicToken }
  | { kind: 'call'; call: RuleCall }
  // Anything else, such as the scope operator in `.name`: left to Khiops.
  | { kind: 'other' };

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
 * Parses the argument that starts at `start`, up to the `,` or `)` that ends it, whose index is `next`.
 * Returns undefined when the call is not closed before the end of the statement.
 */
function parseArgument(
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

/** Everything the checks of one dictionary share. */
interface CallContext {
  /** Variable name → declared type, for every declaration of the dictionary. */
  variables: Map<string, string>;
  rules: RuleMaps;
  out: DiagnosticCollector;
}

/** A constant must have the type the rule expects; only `Numerical` and `Categorical` have constants. */
function checkConstant(token: KdicToken, ruleName: string, expected: string, position: number, { out }: CallContext): void {
  const actual = constantType(token);
  if (!actual || actual === expected || !['Numerical', 'Categorical'].includes(expected)) { return; }
  const text = token.text.length > 40 ? `${token.text.slice(0, 39)}…` : token.text;
  out.atToken(token, `Constant ${text} is '${actual}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
}

/** A variable of the current dictionary, plain or between backquotes, must be declared and have the expected type. */
function checkVariable(token: KdicToken, ruleName: string, expected: string, position: number, { variables, out }: CallContext): void {
  const name = tokenName(token);
  const actual = variables.get(name);
  if (actual === undefined) {
    out.atToken(token, `'${name}' is not declared in this dictionary.`, Severity.Warning);
  } else if (actual !== expected) {
    out.atToken(token, `'${name}' is '${actual}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
  }
}

/** The result of a nested call must be a type the enclosing rule accepts at that position. */
function checkNestedResult(nested: RuleCall, ruleName: string, expected: string, position: number, { rules, out }: CallContext): void {
  const returnType = rules.returnTypes.get(nested.rule.text);
  if (!returnType || returnType === 'any' || returnType.split('|').includes(expected)) { return; }
  out.atToken(nested.rule,
    `'${nested.rule.text}' returns '${returnType}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
}

/**
 * Checks a call and, through its arguments, the calls nested in it. `current` tells whether its operands
 * are in the scope of the dictionary being checked: those of a table or entity rule after the first one
 * are in the secondary table, and everything inside them is too. A constant or a nested result has the
 * same type in any scope, so those are checked anyway.
 *
 * Parameters are known by position only when the rule is registered and the call has all of them:
 * some rules also exist with fewer, so other calls get no type checks of their own.
 */
function checkCall(call: RuleCall, current: boolean, context: CallContext): void {
  const ruleName = call.rule.text;
  const registered = context.rules.paramTypes.get(ruleName);
  const paramTypes = registered && call.args.length >= registered.filter(type => type !== '...').length ? registered : undefined;
  const isRelational = ['Table', 'Entity', 'Block(Table)', 'Block(Entity)'].includes(paramTypes?.[0] ?? '');

  call.args.forEach((arg, position) => {
    const expected = (paramTypes && parameterTypeAt(paramTypes, position)) ?? 'any';
    const documentedScope = context.rules.paramScopes.get(ruleName)?.[position];
    const scope = documentedScope ?? (isRelational && position > 0 ? 'unknown' : 'current');
    const argumentIsCurrent = current && paramTypes !== undefined && scope === 'current';
    const checked = expected !== 'any' && !expected.startsWith('Block(');

    if (arg.kind === 'call') {
      if (checked && isConcreteType(expected)) { checkNestedResult(arg.call, ruleName, expected, position, context); }
      checkCall(arg.call, argumentIsCurrent, context);
    } else if (arg.kind === 'constant' && checked) {
      checkConstant(arg.token, ruleName, expected, position, context);
    } else if (arg.kind === 'variable' && checked && argumentIsCurrent) {
      checkVariable(arg.token, ruleName, expected, position, context);
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

/** Checks every derivation of a dictionary: `= rule(…)`, with the rules nested in it. */
function checkDictionaryCalls(dictionary: Dictionary, tokens: readonly KdicToken[], rules: RuleMaps, out: DiagnosticCollector): void {
  const variables = new Map(dictionary.declarations.map(declaration => [declaration.nameText, declaration.type.text]));
  const context: CallContext = { variables, rules, out };
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
    checkCall(call, true, context);
  }
}

/**
 * Type checks on the rule calls of every dictionary: the rule's return type against the variable it
 * is assigned to, and its arguments (variables, constants and the results of nested calls) against
 * its parameters. Calls that are not closed yet, as while typing, are not checked.
 */
export function checkRuleCalls(structure: Structure, tokens: readonly KdicToken[], rules: RuleMaps, out: DiagnosticCollector): void {
  for (const dictionary of structure.dictionaries) { checkDictionaryCalls(dictionary, tokens, rules, out); }
}
