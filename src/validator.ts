/**
 * Built-in KDIC validation.
 *
 * Free of any VS Code dependency, so it runs both inside the extension and in
 * the standalone smoke-test CLI. Validation is structural and best-effort;
 * the native Khiops parser stays authoritative for complete semantics.
 *
 * The work is split in focused checks (see `validation/`), run in this order. This list is the one place that
 * describes the pipeline: keep it up to date when a check is added, moved or removed.
 *  1. delimiters      — unclosed, unmatched or wrongly nested `() [] {}`                 (delimiters.ts)
 *  2. metadata        — locates the `<key>` and `<key=value>` tags, reports malformed ones (metadata.ts)
 *  3. structure       — one token walk: dictionaries (header, `Root`), declarations (`[key]`, in a variable
 *                       block or not) and variable blocks (members, tail); reports a missing `;`, an invalid
 *                       name, a word after a name and a statement that does not start with a type (structure.ts)
 *  4. format metadata — `DateFormat` and co. on a variable of another type, without a string, or with an
 *                       unknown format                                                     (format-metadata.ts)
 *  5. variable blocks — `VarKey` of each member (present, integer 1 to 10⁹ or non-empty string, one kind,
 *                       unique) and the default value of the block                         (variable-blocks.ts)
 *  6. constants       — numerical and categorical constants in derivations                (constants.ts)
 *  7. dictionaries    — name lengths, names used twice (variables and blocks), spaces at the end of names,
 *                       dictionaries declared twice, key fields, `Table(X)`/`Entity(X)` targets (dictionaries.ts)
 *  8. relations       — multi-table schema: root key, root as a component, key lengths along native
 *                       relations, external entities                                       (relations.ts)
 *  9. rule calls      — each derivation parsed into a tree of calls: return types and argument types
 *                       (variables, constants, nested calls), each operand checked in the dictionary it is
 *                       resolved in; for the rules that build instances, the target names after `:` (declared,
 *                       typed, as many as the operands) and the rules Khiops rejects as an operand (rule-calls.ts)
 * 10. line grammar    — line by line: variable-block members and closing, content after `;`, unknown lines
 *                       (warning)                                                          (line-grammar.ts)
 */
import { tokenizeKdic } from './kdic-lexer';
import { extractDictionaryNames, stripLineComments } from './kdic-syntax';
import type { RuleMaps } from './rule-maps';
import { checkConstants } from './validation/constants';
import { checkDelimiters } from './validation/delimiters';
import { DiagnosticCollector, type KdicDiagnostic, type KdicDocument } from './validation/diagnostics';
import { checkDictionaries } from './validation/dictionaries';
import { checkFormatMetadata } from './validation/format-metadata';
import { checkLineGrammar } from './validation/line-grammar';
import { scanMetadata } from './validation/metadata';
import { checkRelations } from './validation/relations';
import { checkRuleCalls } from './validation/rule-calls';
import { scanStructure } from './validation/structure';
import { checkVariableBlocks } from './validation/variable-blocks';

export { Severity } from './validation/diagnostics';
export type { KdicDiagnostic, KdicDocument } from './validation/diagnostics';

/**
 * Validates a KDIC document and returns its diagnostics.
 *
 * @param document   any object satisfying `KdicDocument`
 * @param rules      derivation-rule lookup tables, from `buildRuleMaps()`
 * @param cursorLine line being edited, if any: its unfinished declaration is not reported
 */
export function validate(document: KdicDocument, rules: RuleMaps, cursorLine?: number): KdicDiagnostic[] {
  const out = new DiagnosticCollector(document);
  const text = document.getText();
  const allTokens = tokenizeKdic(text);
  const tokens = allTokens.filter(token => token.kind !== 'comment');

  checkDelimiters(allTokens, out);
  const metadata = scanMetadata(tokens, out);
  const structure = scanStructure(tokens, metadata, out, cursorLine);
  const declarations = structure.dictionaries.flatMap(dictionary => dictionary.declarations);
  checkFormatMetadata(declarations, tokens, metadata, out);
  checkVariableBlocks(structure, tokens, metadata, out);
  checkConstants(declarations, tokens, metadata, out);

  const headerLines = checkDictionaries(structure, tokens, extractDictionaryNames(text), out);
  checkRelations(structure, out);
  checkRuleCalls(structure, tokens, rules, out);
  checkLineGrammar(stripLineComments(text), metadata, structure, headerLines, out);
  return out.diagnostics;
}
