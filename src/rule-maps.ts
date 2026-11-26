/**
 * Lookup tables built from the derivation rules: what the parameters of each rule expect, what it returns,
 * where its operands are resolved and, for the rules that build instances, what their target names after `:`
 * are. The validator and the completion read them.
 *
 * Free of any VS Code dependency.
 */
import { DERIVATION_RULES, type DerivationRule, type OperandScope, type OutputScope } from './derivation-rules';
import { isKdicType, TYPE_ALTERNATION } from './kdic-syntax';

/** Rule lookup tables the validator uses to type-check derivations. */
export interface RuleMaps {
  /** Rule name → expected type of each parameter (`any` = unchecked, a trailing `...` = varargs). */
  paramTypes: Map<string, string[]>;
  /** Rule name → return type (a `|`-separated union, or `any`). */
  returnTypes: Map<string, string>;
  /** Rule name → scope of each operand, for rules that document one. */
  paramScopes: Map<string, readonly OperandScope[]>;
  /**
   * Rule name → expected type of each target name after `:`, for the rules whose signature has an output
   * section. The presence of the rule is what tells the parser that a `:` in its call starts target names.
   */
  outputTypes: Map<string, string[]>;
  /** Rule name → for an output nested in a relation mapped earlier (`BuildGraph`), the position of that relation. */
  outputScopes: Map<string, readonly (OutputScope | undefined)[]>;
  /** Rule name → position of the first source operand that is mapped to the first output name. */
  mappedInputsFrom: Map<string, number>;
  /** Rules that Khiops rejects as the operand of another rule. */
  disallowAsOperand: Set<string>;
  /** Rules documented for a Khiops that the reference binary does not have yet: their calls are left unchecked. */
  unverifiedRules: Set<string>;
}

/** A parameter written as `Type name` or `Block(Type) name`. */
const TYPED_PARAMETER = new RegExp(`^(?:Block\\((${TYPE_ALTERNATION})\\)|(${TYPE_ALTERNATION}))\\s+`);
/** A relation parameter, `Table(Dictionary) name` or `Entity(Dictionary) name`: its dictionary is only a placeholder. */
const RELATION_PARAMETER = /^(Table|Entity)\s*\([^()]*\)\s+/;

/** Splits `text` at each `separator` outside parentheses, so that `Table(Dictionary)` stays in one piece. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '(') { depth++; }
    else if (text[index] === ')') { depth--; }
    else if (text[index] === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** The comma-separated parameters of a signature section; empty when the section is. */
const parametersOf = (section: string): string[] =>
  splitTopLevel(section, ',').map(parameter => parameter.trim()).filter(Boolean);

/** The input parameters of a signature and, when it has a top-level `:`, the output ones after it. */
function signatureSections(signature: string): { inputs: string[]; outputs?: string[] } {
  const [inputs, outputs] = splitTopLevel(/\((.*)\)/.exec(signature)?.[1] ?? '', ':');
  return { inputs: parametersOf(inputs), outputs: outputs === undefined ? undefined : parametersOf(outputs) };
}

/** Parses one signature parameter into its expected type: `Numerical`, `Block(Numerical)`, `...` or `any`. */
function parameterType(parameter: string): string {
  const text = parameter.trim();
  if (text === '...') { return '...'; }
  const relation = RELATION_PARAMETER.exec(text);
  if (relation) { return relation[1]; }
  const match = TYPED_PARAMETER.exec(text);
  if (!match) { return 'any'; }
  return match[1] ? `Block(${match[1]})` : match[2];
}

/** Expands a signature parameter ending in `...` into a repeated type position. */
function parameterTypes(parameters: readonly string[]): string[] {
  return parameters.flatMap(parameter => {
    const text = parameter.trim();
    if (text === '...') { return ['...']; }
    if (!text.endsWith('...')) { return [parameterType(text)]; }
    return [parameterType(text.slice(0, -3)), '...'];
  });
}

/** Whether a parameter or return type is one of the concrete variable types (not `any`, a structure or a block). */
export function isConcreteType(type: string): boolean {
  return isKdicType(type) && type !== 'Structure';
}

/**
 * The type a rule expects at `position` (zero-based). A trailing `...` repeats the parameter before it,
 * but only for a rule whose parameters all have a concrete type: when one is `any` or a structure, the
 * signature does not say what the extra operands are (`DataGridDeployment`).
 */
export function parameterTypeAt(types: readonly string[], position: number): string | undefined {
  const varargs = types.indexOf('...');
  if (varargs === -1 || position < varargs) { return types[position]; }
  const concrete = types.every(type => type === '...' || isConcreteType(type));
  return concrete && varargs > 0 ? types[varargs - 1] : undefined;
}

/** Builds the lookup tables from rule definitions; `RULE_MAPS` below holds those of the built-in rules. */
export function buildRuleMaps(
  rules: ReadonlyArray<Pick<DerivationRule,
    'label' | 'returnType' | 'signature' | 'operandScopes' | 'mappedInputsFrom' | 'outputScopes'
    | 'disallowAsOperand' | 'semanticallyVerified'>>,
): RuleMaps {
  const maps: RuleMaps = {
    paramTypes: new Map(), returnTypes: new Map(), paramScopes: new Map(), outputTypes: new Map(),
    outputScopes: new Map(), mappedInputsFrom: new Map(), disallowAsOperand: new Set(), unverifiedRules: new Set(),
  };
  for (const rule of rules) {
    maps.returnTypes.set(rule.label, rule.returnType);
    if (rule.operandScopes) { maps.paramScopes.set(rule.label, rule.operandScopes); }
    if (rule.mappedInputsFrom !== undefined) { maps.mappedInputsFrom.set(rule.label, rule.mappedInputsFrom); }
    if (rule.outputScopes) { maps.outputScopes.set(rule.label, rule.outputScopes); }
    if (rule.disallowAsOperand) { maps.disallowAsOperand.add(rule.label); }
    if (rule.semanticallyVerified === false) { maps.unverifiedRules.add(rule.label); }
    const sections = signatureSections(rule.signature);
    maps.paramTypes.set(rule.label, parameterTypes(sections.inputs));
    if (sections.outputs) { maps.outputTypes.set(rule.label, parameterTypes(sections.outputs)); }
  }
  return maps;
}

/** The lookup tables of the built-in rules, shared by everything that reads derivations. */
export const RULE_MAPS = buildRuleMaps(DERIVATION_RULES);
