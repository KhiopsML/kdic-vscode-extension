import type { DerivationRule, OperandScope } from './derivation-rules';
import { isKdicType, TYPE_ALTERNATION } from './kdic-syntax';

/** Rule lookup tables the validator uses to type-check derivations. */
export interface RuleMaps {
  /** Rule name → expected type of each parameter (`any` = unchecked, a trailing `...` = varargs). */
  paramTypes: Map<string, string[]>;
  /** Rule name → return type (a `|`-separated union, or `any`). */
  returnTypes: Map<string, string>;
  /** Rule name → scope of each operand, for rules that document one. */
  paramScopes: Map<string, readonly OperandScope[]>;
}

/** A parameter written as `Type name` or `Block(Type) name`. */
const TYPED_PARAMETER = new RegExp(`^(?:Block\\((${TYPE_ALTERNATION})\\)|(${TYPE_ALTERNATION}))\\s+`);

/** Parses one signature parameter into its expected type: `Numerical`, `Block(Numerical)`, `...` or `any`. */
function parameterType(parameter: string): string {
  const text = parameter.trim();
  if (text === '...') { return '...'; }
  const match = TYPED_PARAMETER.exec(text);
  if (!match) { return 'any'; }
  return match[1] ? `Block(${match[1]})` : match[2];
}

/**
 * The type a rule expects at `position` (zero-based). A trailing `...` repeats the parameter before it,
 * but only for a rule whose parameters all have a concrete type: when one is `any` or a structure, the
 * signature does not say what the extra operands are (`DataGridDeployment`).
 */
export function parameterTypeAt(types: readonly string[], position: number): string | undefined {
  const varargs = types.indexOf('...');
  if (varargs === -1 || position < varargs) { return types[position]; }
  const concrete = types.every(type => type === '...' || (isKdicType(type) && type !== 'Structure'));
  return concrete && varargs > 0 ? types[varargs - 1] : undefined;
}

/** Builds the validator's lookup tables from rule definitions; call it once at startup. */
export function buildRuleMaps(
  rules: ReadonlyArray<Pick<DerivationRule, 'label' | 'returnType' | 'signature' | 'operandScopes'>>,
): RuleMaps {
  const maps: RuleMaps = { paramTypes: new Map(), returnTypes: new Map(), paramScopes: new Map() };
  for (const rule of rules) {
    maps.returnTypes.set(rule.label, rule.returnType);
    if (rule.operandScopes) { maps.paramScopes.set(rule.label, rule.operandScopes); }
    const parameters = rule.signature.match(/\((.+)\)/)?.[1] ?? '';
    maps.paramTypes.set(rule.label, parameters.split(',').map(parameterType));
  }
  return maps;
}
