/**
 * The variables that can be proposed for an operand being typed in a rule call.
 *
 * Free of any VS Code dependency: functions take the text of the document and an offset.
 */
import { partialOperand } from './completion-context';
import type { RuleMaps } from './rule-maps';
import { operandSiteAt } from './validation/operand-site';
import { scanDocument } from './validation/scan-document';
import type { BlockTail, Declaration } from './validation/structure';

export interface OperandVariables {
  /** The variables that the operand can name, in the order of their declaration. */
  variables: Declaration[];
  /** The variable blocks that it can name as a whole, in the order of their declaration. */
  blocks: BlockTail[];
  /** The type the rule expects there, `any` when it is not known. */
  expected: string;
  /** How a message calls the dictionary that declares them. */
  label: string;
}

/**
 * The variables for the operand at `offset`, which is where the name typed so far ends: those of the
 * dictionary the rule resolves it in, as the validator does. Undefined when the position does not start
 * an operand of a call in a derivation, or its scope is not known, as for a rule that is not registered.
 * The whole text is read: callers keep it to a size where that is quick.
 */
export function operandVariablesAt(text: string, offset: number, rules: RuleMaps): OperandVariables | undefined {
  const partial = partialOperand(text.slice(Math.max(0, offset - 400), offset));
  const { tokens, structure } = scanDocument(text);

  const site = operandSiteAt(structure, tokens, rules, offset - partial.length, partial.dots);
  if (!site?.scope) { return undefined; }
  return {
    variables: [...site.scope.variables.values()].filter(declaration => declaration !== site.defined),
    blocks: [...site.scope.blocks.values()].filter(block => block !== site.defined),
    expected: site.expected,
    label: site.scope.label,
  };
}
