/**
 * Where the operands of a rule call are resolved: in the dictionary of the call, or, for a rule that names
 * tables, in the dictionary of the table an operand names (the first one, or the one its `operandScopes` say);
 * each dot of the scope operator goes one scope up. The target names after the `:` of a rule that builds
 * instances are resolved in the target dictionary of the variable being declared. Shared by the rule-call
 * checks and the completion of operands, so both resolve a name the same way.
 */
import { tokenName } from '../kdic-lexer';
import { parameterTypeAt, type RuleMaps } from '../rule-maps';
import type { Argument, RuleCall } from './call-tree';
import { dictionariesByName, type BlockTail, type Declaration, type Dictionary, type Structure } from './structure';

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
  return { rules, dictionaries: dictionariesByName(structure), names: new Map() };
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

/** The target dictionary of an instance-building declaration, when its name resolves exactly once. */
export function targetDictionaryScope(
  declaration: Declaration | undefined, context: ScopeContext, parent?: Scope,
): Scope | undefined {
  const target = declaration?.relationTarget;
  const candidates = target && context.dictionaries.get(tokenName(target));
  if (!target || candidates?.length !== 1) { return undefined; }
  const name = tokenName(target);
  return scopeOf(candidates[0], `target dictionary '${name}'`, context, parent);
}

/**
 * The dictionary in which the target name at `position` of a call is resolved: the target dictionary, or, for a
 * name nested in a relation mapped earlier in the same call (`BuildGraph`), the dictionary of that relation.
 */
export function mappedOutputScope(call: RuleCall, position: number, target: Scope, context: ScopeContext): Scope | undefined {
  const relationOutput = context.rules.outputScopes.get(call.rule.text)?.[position]?.relationOutput;
  if (relationOutput === undefined) { return target; }
  const relationName = call.outputNames?.[relationOutput];
  const relation = relationName && target.variables.get(tokenName(relationName));
  return relation ? targetDictionaryScope(relation, context, target) : undefined;
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
function tableOperandDeclaration(
  argument: Argument | undefined, scope: Scope | undefined, anchor: Scope | undefined,
): Declaration | undefined {
  if (argument?.kind === 'variable') { return scope?.variables.get(tokenName(argument.token)); }
  if (argument?.kind !== 'upper' || argument.argument.kind !== 'variable') { return undefined; }
  const upper = ancestorOf(anchor, argument.dots.length);
  return upper && upper !== 'beyond' ? upper.variables.get(tokenName(argument.argument.token)) : undefined;
}

/**
 * The scope of an operand evaluated in the dictionary referenced by one of the call's table arguments.
 * Unknown when that argument is not a declared relation variable or its target is not declared exactly once.
 */
function tableArgumentScope(
  call: RuleCall, tableArgument: number, scope: Scope | undefined, anchor: Scope | undefined, context: ScopeContext,
): Scope | undefined {
  const target = tableOperandDeclaration(call.args[tableArgument], scope, anchor)?.relationTarget;
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
  tableScopes: ReadonlyMap<number, Scope | undefined>;
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
  const tableArguments = new Set<number>();
  if (isRelational) { tableArguments.add(0); }
  for (const operandScope of context.rules.paramScopes.get(call.rule.text) ?? []) {
    if (typeof operandScope === 'object') { tableArguments.add(operandScope.tableArgument); }
  }
  const tableScopes = new Map([...tableArguments].map(index =>
    [index, tableArgumentScope(call, index, scope, anchor, context)] as const));
  return { paramTypes, isRelational, tableScopes };
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
  const { paramTypes, isRelational, tableScopes } = description;
  const expected = (paramTypes && parameterTypeAt(paramTypes, position)) ?? 'any';
  const parameterScopes = context.rules.paramScopes.get(call.rule.text);
  const varargs = paramTypes?.indexOf('...') ?? -1;
  const documented = parameterScopes?.[position]
    ?? (varargs >= 0 && position >= varargs ? parameterScopes?.[varargs] : undefined);
  const kind = documented ?? (isRelational && position > 0 ? 'unknown' : 'current');
  const tableArgument = kind === 'secondary' ? 0 : typeof kind === 'object' ? kind.tableArgument : undefined;
  const argumentScope = paramTypes === undefined ? undefined
    : tableArgument === undefined ? kind === 'current' ? scope : undefined
      : tableScopes.get(tableArgument);
  return { expected, scope: argumentScope, anchor: tableArgument === undefined ? argumentScope && anchor : argumentScope };
}
