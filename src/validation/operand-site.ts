import type { KdicToken } from '../kdic-lexer';
import type { RuleMaps } from '../rule-maps';
import { ancestorOf, createScopeContext, describeArgument, describeCall, dictionaryScope, type Scope } from './call-scopes';
import { isSymbol, parseCall, type Argument, type RuleCall } from './call-tree';
import type { BlockTail, Declaration, Structure } from './structure';

/** What is known of an operand being typed. */
export interface OperandSite {
  /** The type the rule expects there, `any` when it is not known. */
  expected: string;
  /** Where the variables the operand can name are declared, when that is known. */
  scope: Scope | undefined;
  /** The variable or block whose derivation is being written, which that derivation cannot use. */
  defined?: Declaration | BlockTail;
}

/** The call that an argument leaves open, with the number of dots it is written behind. */
function openCallOf(argument: Argument | undefined): { call: RuleCall; dots: number } | undefined {
  if (argument?.kind === 'call' && argument.call.open) { return { call: argument.call, dots: 0 }; }
  if (argument?.kind === 'upper' && argument.argument.kind === 'call' && argument.argument.call.open) {
    return { call: argument.argument.call, dots: argument.dots.length };
  }
  return undefined;
}

/** Index of the `=` that starts the derivation the tokens before `limit` end in, if they are in one. */
function derivationStart(tokens: readonly KdicToken[], from: number, limit: number): number | undefined {
  for (let index = limit - 1; index > from; index--) {
    const token = tokens[index];
    if (isSymbol(token, '=')) { return index; }
    if (isSymbol(token, ';') || isSymbol(token, '{') || isSymbol(token, '}')) { return undefined; }
  }
  return undefined;
}

/**
 * Where the operand that starts at `operandStart` stands: the type the rule expects there and the scope
 * its variables are in, with `dots` dots of the scope operator in front of it. Undefined unless it starts
 * an operand, right after a `(` or a `,`, of a call in the derivation of a variable. The call is read up
 * to the operand, whether or not it is closed after it.
 */
export function operandSiteAt(
  structure: Structure, tokens: readonly KdicToken[], rules: RuleMaps, operandStart: number, dots: number,
): OperandSite | undefined {
  const limit = tokens.findIndex(token => token.end > operandStart);
  // A token that straddles the operand start, such as a string the cursor is in, makes it no operand.
  if (limit !== -1 && tokens[limit].start < operandStart) { return undefined; }
  const before = limit === -1 ? tokens : tokens.slice(0, limit);
  const last = before[before.length - 1];
  if (!isSymbol(last, '(') && !isSymbol(last, ',')) { return undefined; }

  const dictionary = structure.dictionaries.find(candidate =>
    candidate.openIndex < before.length && candidate.closeIndex >= before.length);
  const equalsIndex = dictionary && derivationStart(before, dictionary.openIndex, before.length);
  if (!dictionary || equalsIndex === undefined) { return undefined; }
  if (before[equalsIndex + 1]?.kind !== 'identifier' || !isSymbol(before[equalsIndex + 2], '(')) { return undefined; }
  const root = parseCall(before, equalsIndex + 1, before.length, true);
  if (!root?.open) { return undefined; }

  const context = createScopeContext(structure, rules);
  const top = dictionaryScope(dictionary, context);
  const defined = dictionary.declarations.find(declaration => declaration.equalsIndex === equalsIndex)
    ?? dictionary.blocks.find(block => block.equalsIndex === equalsIndex);

  // Go down the calls left open, each argument telling the scope of what is written in it.
  let call = root;
  let scope: Scope | undefined = top;
  let anchor: Scope | undefined = top;
  for (;;) {
    const description = describeCall(call, scope, anchor, context);
    const open = openCallOf(call.args[call.args.length - 1]);
    const argument = describeArgument(call, description, open ? call.args.length - 1 : call.args.length, scope, anchor, context);

    if (!open) {
      const upper = dots === 0 ? argument.scope : ancestorOf(argument.anchor, dots);
      return { expected: argument.expected, scope: upper === 'beyond' ? undefined : upper, defined };
    }
    const moved = open.dots === 0 ? argument.scope : ancestorOf(argument.anchor, open.dots);
    scope = moved === 'beyond' ? undefined : moved;
    anchor = argument.anchor;
    call = open.call;
  }
}
