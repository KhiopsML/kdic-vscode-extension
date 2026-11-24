import { isNameToken, tokenName, type KdicToken } from '../kdic-lexer';
import type { DiagnosticCollector } from './diagnostics';
import type { Dictionary, DictionaryHeader, Structure } from './structure';

const MAX_NAME_LENGTH = 128;

/** Everything the checks of one dictionary share. */
interface DictionaryScope {
  dictionary: Dictionary;
  header: DictionaryHeader;
}

/**
 * Semantic checks on each dictionary: name lengths, key fields and relation targets.
 *
 * Returns the lines taken by valid dictionary headers, which the line grammar
 * check must not flag.
 */
export function checkDictionaries(
  structure: Structure,
  tokens: readonly KdicToken[],
  knownDictionaries: ReadonlySet<string>,
  out: DiagnosticCollector,
): Set<number> {
  const headerLines = new Set<number>();
  for (const dictionary of structure.dictionaries) {
    const { header } = dictionary;
    const scope: DictionaryScope = { dictionary, header };

    checkNameLengths(scope, out);
    if (header.valid) {
      collectHeaderLines(scope, tokens[dictionary.openIndex], headerLines, out);
      checkKeys(scope, out);
    }
    checkRelationTargets(scope, knownDictionaries, out);
  }
  return headerLines;
}

function checkNameLengths({ dictionary, header }: DictionaryScope, out: DiagnosticCollector): void {
  for (const { name, nameText } of dictionary.declarations) {
    if (nameText.length > MAX_NAME_LENGTH) {
      out.atToken(name, `Variable name '${nameText}' exceeds the 128-character limit.`);
    }
  }
  if (isNameToken(header.name) && tokenName(header.name).length > MAX_NAME_LENGTH) {
    out.atToken(header.name, `Dictionary name '${tokenName(header.name)}' exceeds the 128-character limit.`);
  }
}

/** Records the lines of a valid header, up to the `{` line unless code follows the brace. */
function collectHeaderLines({ header }: DictionaryScope, brace: KdicToken, lines: Set<number>, out: DiagnosticCollector): void {
  const bracePosition = out.document.positionAt(brace.start);
  for (let line = out.lineOf(header.keyword!.start); line <= bracePosition.line; line++) {
    const afterBrace = out.document.lineAt(line).text.slice(bracePosition.character + 1);
    if (line !== bracePosition.line || !afterBrace.trim()) { lines.add(line); }
  }
}

/** Key fields must be declared in the dictionary, `Categorical`, and not derived. */
function checkKeys({ dictionary, header }: DictionaryScope, out: DiagnosticCollector): void {
  for (const key of header.keys) {
    const keyName = tokenName(key);
    const declaration = dictionary.declarations.find(candidate => candidate.nameText === keyName);
    if (!declaration) {
      out.atToken(key, `Key field '${keyName}' is not declared in this dictionary.`);
      continue;
    }
    if (declaration.type.text !== 'Categorical') {
      out.atToken(declaration.type,
        `Key field '${keyName}' must be 'Categorical' but is declared as '${declaration.type.text}'.`);
    }
    if (declaration.equalsIndex !== undefined) {
      out.atToken(declaration.type, `Key field '${keyName}' must not be derived from a rule.`);
    }
  }
}

/** `Table(X)` and `Entity(X)` must name a dictionary declared in the file. */
function checkRelationTargets(
  { dictionary }: DictionaryScope, knownDictionaries: ReadonlySet<string>, out: DiagnosticCollector,
): void {
  for (const { relationTarget } of dictionary.declarations) {
    if (!relationTarget || knownDictionaries.has(tokenName(relationTarget))) { continue; }
    out.atToken(relationTarget, `Dictionary '${tokenName(relationTarget)}' is not declared in this file.`);
  }
}
