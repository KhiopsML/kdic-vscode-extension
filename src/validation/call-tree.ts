/**
 * The parser of a rule call `rule(argument, …)` into a tree of arguments (variables, constants, nested
 * calls, operands behind the scope operator). It can also read a call left open, as at the cursor while typing.
 */
import { isNameToken, type KdicToken } from '../kdic-lexer';

/** Deeper nesting is left unchecked, which keeps the recursion bounded on generated files. */
const MAX_NESTING = 100;

/** An argument of a rule call, by what it is. */
export type Argument =
  | VariableArgument
  | CallArgument
  | { kind: 'constant'; token: KdicToken }
  | UpperArgument
  // Anything else: left to Khiops.
  | { kind: 'other' };

export interface VariableArgument { kind: 'variable'; token: KdicToken }
export interface CallArgument { kind: 'call'; call: RuleCall }

/** A variable or call written with the scope operator: `.name`, `..name`, `.rule(…)`. Each dot goes one scope up. */
export interface UpperArgument {
  kind: 'upper';
  dots: KdicToken[];
  argument: VariableArgument | CallArgument;
}

/** A call `rule(argument, …)` and its arguments. */
export interface RuleCall {
  rule: KdicToken;
  args: Argument[];
  /** Index of the closing `)`. */
  closeIndex: number;
  /** The call is not closed: its tokens end where the text being parsed does, as while typing. */
  open?: boolean;
}

export const isSymbol = (token: KdicToken | undefined, text: string): boolean => token?.kind === 'symbol' && token.text === text;

/** Whether the token ends a statement, so that a call still open before it is not a call being written. */
const endsStatement = (token: KdicToken): boolean => token.kind === 'symbol' && [';', '{', '}'].includes(token.text);

/** The type of a constant, or undefined for another token (an unclosed string is reported elsewhere). */
export function constantType(token: KdicToken): string | undefined {
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
  tokens: readonly KdicToken[], start: number, limit: number, allowOpen: boolean, depth: number,
): { argument: Argument; next: number } | undefined {
  if (tokens[start]?.kind === 'identifier' && isSymbol(tokens[start + 1], '(')) {
    const call = parseCall(tokens, start, limit, allowOpen, depth + 1);
    if (!call) { return undefined; }
    if (call.open) { return { argument: { kind: 'call', call }, next: limit }; }
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
  tokens: readonly KdicToken[], start: number, limit: number, allowOpen: boolean, depth: number,
): { argument: Argument; next: number } | undefined {
  let dots = 0;
  while (isSymbol(tokens[start + dots], '.')) { dots++; }
  const parsed = parseOperand(tokens, start + dots, limit, allowOpen, depth);
  if (!parsed || dots === 0) { return parsed; }

  const { argument } = parsed;
  if (argument.kind !== 'variable' && argument.kind !== 'call') { return { argument: { kind: 'other' }, next: parsed.next }; }
  return { argument: { kind: 'upper', dots: tokens.slice(start, start + dots), argument }, next: parsed.next };
}

/**
 * Parses the call whose name is at `index`, followed by `(`. Returns undefined when it is not closed,
 * unless `allowOpen` is set: a call that runs into `limit`, which must be the end of `tokens`, is then
 * returned as open, with the arguments written so far.
 */
export function parseCall(
  tokens: readonly KdicToken[], index: number, limit: number, allowOpen = false, depth = 0,
): RuleCall | undefined {
  if (depth > MAX_NESTING) { return undefined; }
  const args: Argument[] = [];
  let cursor = index + 2;
  if (isSymbol(tokens[cursor], ')')) { return { rule: tokens[index], args, closeIndex: cursor }; }
  while (cursor < limit) {
    const parsed = parseArgument(tokens, cursor, limit, allowOpen, depth);
    if (!parsed) { return undefined; }
    args.push(parsed.argument);
    if (isSymbol(tokens[parsed.next], ')')) { return { rule: tokens[index], args, closeIndex: parsed.next }; }
    cursor = parsed.next + 1;
  }
  return allowOpen ? { rule: tokens[index], args, closeIndex: limit, open: true } : undefined;
}
