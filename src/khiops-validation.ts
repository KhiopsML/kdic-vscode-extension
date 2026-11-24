/**
 * Turning the text printed by the native Khiops parser into editor locations.
 *
 * Free of any VS Code dependency.
 */
import { tokenName, tokenizeKdic } from './kdic-lexer';
import { decodeIdentifier, IDENTIFIER_PATTERN } from './kdic-syntax';
import { KdicTextDocument } from './kdic-text-document';
import { DiagnosticCollector } from './validation/diagnostics';
import { scanMetadata } from './validation/metadata';
import { scanStructure } from './validation/structure';

export interface KhiopsErrorLocation {
  /** Zero-based line of the error in the dictionary file. */
  line: number;
  message: string;
}

/** `error : … Line 7 : Missing ';'` — Khiops names the line itself. */
const ERROR_WITH_LINE = /error\s*:\s*.*?Line\s+(\d+)\s*:\s*(.+)$/;
/** Any other `error : message` line. */
const ERROR = /error\s*:\s*(.+)$/;
/** Summary lines that repeat errors already reported individually. */
const SUMMARY = /Errors detected during parsing|Read cancelled/i;

/**
 * Finds the line declaring `variableName` in dictionary `dictionaryName`.
 * Returns undefined unless exactly one declaration matches.
 */
function findDeclarationLine(text: string, dictionaryName: string, variableName: string): number | undefined {
  const document = new KdicTextDocument(text);
  const ignored = new DiagnosticCollector(document); // only the structure is of interest here
  const tokens = tokenizeKdic(text).filter(token => token.kind !== 'comment');
  const structure = scanStructure(tokens, scanMetadata(tokens, ignored), ignored, undefined);

  const matches = structure.dictionaries
    .filter(dictionary => dictionary.header.name && tokenName(dictionary.header.name) === dictionaryName)
    .flatMap(dictionary => dictionary.declarations)
    .filter(declaration => declaration.nameText === variableName);
  return matches.length === 1 ? document.positionAt(matches[0].start.start).line : undefined;
}

/**
 * Locates an error that carries no line number but names its dictionary and
 * variable (`Dictionary D : Variable v : …`) by finding that declaration.
 */
function locateByDeclaration(message: string, documentText: string): number | undefined {
  const dictionary = new RegExp(`\\bDictionary\\s+(${IDENTIFIER_PATTERN})`, 'i').exec(message);
  const variable = new RegExp(`\\bVariable\\s+(${IDENTIFIER_PATTERN})`, 'i').exec(message);
  if (!dictionary || !variable) { return undefined; }
  return findDeclarationLine(documentText, decodeIdentifier(dictionary[1]), decodeIdentifier(variable[1]));
}

/**
 * Extracts the errors from Khiops output and places each one on a line of the
 * dictionary file: the line Khiops reports, else the declaration the message
 * names, else the first line.
 */
export function parseKhiopsErrorLocations(output: string, documentText: string): KhiopsErrorLocation[] {
  const locations: KhiopsErrorLocation[] = [];
  for (const outputLine of output.split(/\r?\n/)) {
    const withLine = ERROR_WITH_LINE.exec(outputLine);
    if (withLine) {
      locations.push({ line: Math.max(0, Number.parseInt(withLine[1], 10) - 1), message: withLine[2].trim() });
      continue;
    }

    const message = ERROR.exec(outputLine)?.[1].trim();
    if (!message || SUMMARY.test(message)) { continue; }
    locations.push({ line: locateByDeclaration(message, documentText) ?? 0, message });
  }
  return locations;
}
