import { tokenName } from '../kdic-lexer';
import { parameterTypeAt, type RuleMaps } from '../rule-maps';
import type { Argument, RuleCall } from './call-tree';
import type { BlockTail, Declaration, Dictionary, Structure } from './structure';

/** The variables an operand can name, with how a message calls the dictionary that declares them. */
export interface Scope {
  /** The dictionary that declares the variables. */
  dictionary: Dictionary;
  variables: ReadonlyMap<string, Declaration>;
  /** The variable blocks, which an operand can name as a whole. */
  blocks: ReadonlyMap<string, BlockTail>;
  label: string;
  /** The scope the table rule was evaluated in: the one that a dot in front of an operand goes to. */
  parent?: Scope;
}

/** What resolving the scope of an operand needs to know about the file. */
export interface ScopeContext {
  rules: RuleMaps;
  /** The dictionaries of the file, by name. */
  dictionaries: ReadonlyMap<string, readonly Dictionary[]>;
  names: Map<Dictionary, Pick<Scope, 'variables' | 'blocks'>>;
}

export function createScopeContext(structure: Structure, rules: RuleMaps): ScopeContext {
  const dictionaries = new Map<string, Dictionary[]>();
  for (const dictionary of structure.dictionaries) {
    const name = dictionary.header.name;
    if (name) { dictionaries.set(tokenName(name), [...(dictionaries.get(tokenName(name)) ?? []), dictionary]); }
  }
  return { rules, dictionaries, names: new Map() };
}

/** The scope of a dictionary's names: its variables and blocks by name (a name declared twice keeps its last declaration). */
function scopeOf(dictionary: Dictionary, label: string, context: ScopeContext, parent?: Scope): Scope {
  let names = context.names.get(dictionary);
  if (!names) {
    names = {
      variables: new Map(dictionary.declarations.map(declaration => [declaration.nameText, declaration])),
      blocks: new Map(dictionary.blocks.map(block => [block.nameText, block])),
    };
    context.names.set(dictionary, names);
  }
  return { ...names, dictionary, label, parent };
}

/** The scope of the operands written in a dictionary, outside any table rule. */
export function dictionaryScope(dictionary: Dictionary, context: ScopeContext): Scope {
  return scopeOf(dictionary, 'this dictionary', context);
}

/** The scope `levels` above `scope`: undefined when `scope` is not known, `'beyond'` when there are not that many. */
export function ancestorOf(scope: Scope | undefined, levels: number): Scope | undefined | 'beyond' {
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
function secondaryScope(call: RuleCall, scope: Scope | undefined, anchor: Scope | undefined, context: ScopeContext): Scope | undefined {
  const target = firstOperandDeclaration(call.args[0], scope, anchor)?.relationTarget;
  const candidates = target && context.dictionaries.get(tokenName(target));
  if (!target || !scope || candidates?.length !== 1) { return undefined; }
  return scopeOf(candidates[0], `dictionary '${tokenName(target)}'`, context, scope);
}

/** Whether the call has as many arguments as the registered parameters (at least that many, for a rule ending with `...`). */
function hasRegisteredArguments(call: RuleCall, paramTypes: readonly string[]): boolean {
  const fixed = paramTypes.filter(type => type !== '...').length;
  return paramTypes.includes('...') ? call.args.length >= fixed : call.args.length === fixed;
}

/** What is known of a call: the parameters it can be matched with by position, and its secondary scope. */
export interface CallDescription {
  paramTypes: readonly string[] | undefined;
  isRelational: boolean;
  secondary: Scope | undefined;
}

/**
 * Describes a call, evaluated in `scope`, whose operands are written in `anchor` (the scope the dots of
 * the scope operator are counted from). Its parameters are known by position only when the rule is
 * registered and the call has the arguments it describes: a rule may also exist in another form.
 * A call still being typed has no final number of arguments: it only has to have no more than registered.
 */
export function describeCall(
  call: RuleCall, scope: Scope | undefined, anchor: Scope | undefined, context: ScopeContext,
): CallDescription {
  const registered = context.rules.paramTypes.get(call.rule.text);
  const matches = registered !== undefined && (call.open
    ? registered.includes('...') || call.args.length <= registered.filter(type => type !== '...').length
    : hasRegisteredArguments(call, registered));
  const paramTypes = matches ? registered : undefined;
  const isRelational = ['Table', 'Entity', 'Block(Table)', 'Block(Entity)'].includes(paramTypes?.[0] ?? '');
  return { paramTypes, isRelational, secondary: paramTypes && isRelational ? secondaryScope(call, scope, anchor, context) : undefined };
}

/** What a call says of the argument at a position: the type it expects there, and the scope it is written in. */
export interface ArgumentDescription {
  /** The expected type, `any` where it is not known. */
  expected: string;
  scope: Scope | undefined;
  /** The scope the operand is written in, from which its dots are counted. */
  anchor: Scope | undefined;
}

/**
 * Describes the argument at `position` of a described call. Operands of a table or entity rule are in the
 * same scope or, for those documented as secondary, in the dictionary of its first operand's table, and
 * everything inside such an operand is too.
 */
export function describeArgument(
  call: RuleCall, description: CallDescription, position: number,
  scope: Scope | undefined, anchor: Scope | undefined, context: ScopeContext,
): ArgumentDescription {
  const { paramTypes, isRelational, secondary } = description;
  const expected = (paramTypes && parameterTypeAt(paramTypes, position)) ?? 'any';
  const documented = context.rules.paramScopes.get(call.rule.text)?.[position];
  const kind = documented ?? (isRelational && position > 0 ? 'unknown' : 'current');
  const argumentScope = paramTypes === undefined ? undefined : kind === 'current' ? scope : kind === 'secondary' ? secondary : undefined;
  return { expected, scope: argumentScope, anchor: kind === 'secondary' ? secondary : argumentScope && anchor };
}
