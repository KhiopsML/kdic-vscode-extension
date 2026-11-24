/**
 * Built-in KDIC validation.
 *
 * Free of any VS Code dependency, so it runs both inside the extension and in
 * the standalone smoke-test CLI. Validation is structural and best-effort;
 * the native Khiops parser stays authoritative for complete semantics.
 *
 * The work is split in focused checks (see `validation/`), run in this order:
 *  1. delimiters      — unbalanced `() [] {}`                              (delimiters.ts)
 *  2. metadata        — `<key=value>` tags                                  (metadata.ts)
 *  3. structure       — dictionaries and declarations, missing `;`, names   (structure.ts)
 *  4. format metadata — `DateFormat` and co. on the wrong type, or a bad value (format-metadata.ts)
 *  5. constants       — numerical and categorical constants in derivations  (constants.ts)
 *  6. dictionaries    — keys, relation targets, rule return/argument types  (dictionaries.ts)
 *  7. line grammar    — variable blocks, trailing content, unknown lines    (line-grammar.ts)
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
import { scanStructure } from './validation/structure';

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
  checkConstants(declarations, tokens, metadata, out);

  const headerLines = checkDictionaries(structure, tokens, extractDictionaryNames(text), rules, out);
  checkLineGrammar(stripLineComments(text), metadata, structure, headerLines, out);
  return out.diagnostics;
}
