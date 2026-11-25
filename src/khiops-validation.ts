/**
 * Turning the text printed by the native Khiops parser into editor locations.
 *
 * Free of any VS Code dependency.
 */
import { isNameToken, tokenName, tokenizeKdic, type KdicToken } from './kdic-lexer';
import { KdicTextDocument } from './kdic-text-document';
import { DERIVATION_RULES } from './derivation-rules';
import { buildRuleMaps } from './rule-maps';
import { isSymbol } from './validation/call-tree';
import { DiagnosticCollector } from './validation/diagnostics';
import { scanMetadata } from './validation/metadata';
import { operandSiteAt } from './validation/operand-site';
import { scanStructure, type Declaration, type Dictionary, type Structure } from './validation/structure';

const RULES = buildRuleMaps(DERIVATION_RULES);

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

/*
 * Khiops prints names decoded: no backquotes, a doubled backquote written once, and
 * spaces or colons left as they are. They are compared as such with the decoded names
 * of the document, and delimited by the fixed words around them.
 */
/** `Variable v not found (in dictionary D)` — v is used in a derivation but declared nowhere in D. */
const VARIABLE_NOT_FOUND = /\bVariable (.+) not found \(in dictionary (.+)\)$/i;
/** `Dictionary D : Variable v : …` — an error about the declaration of v. */
const DECLARED_VARIABLE = /\bDictionary (.+?) : Variable (.+?) : /i;

/** The tokens of a document (comments dropped) and the dictionaries they form. */
interface ScannedDocument {
  document: KdicTextDocument;
  tokens: KdicToken[];
  structure: Structure;
}

function scanDocument(text: string): ScannedDocument {
  const document = new KdicTextDocument(text);
  const ignored = new DiagnosticCollector(document); // only the structure is of interest here
  const tokens = tokenizeKdic(text).filter(token => token.kind !== 'comment');
  return { document, tokens, structure: scanStructure(tokens, scanMetadata(tokens, ignored), ignored, undefined) };
}

/** The declarations of every dictionary called `dictionaryName`, in document order. */
function declarationsOf(scan: ScannedDocument, dictionaryName: string): Declaration[] {
  return scan.structure.dictionaries
    .filter(dictionary => dictionary.header.name && tokenName(dictionary.header.name) === dictionaryName)
    .flatMap(dictionary => dictionary.declarations);
}

/** Finds the lines of a document by what an error message names; scans the document at most once. */
class ErrorLocator {
  private scanned: ScannedDocument | undefined;
  /** How many errors were already placed for each `dictionary/variable` reference. */
  private readonly placedReferences = new Map<string, number>();

  constructor(private readonly text: string) {}

  private get scan(): ScannedDocument {
    return this.scanned ??= scanDocument(this.text);
  }

  /** The line declaring `variableName` in `dictionaryName`; undefined unless exactly one declaration matches. */
  declarationLine(dictionaryName: string, variableName: string): number | undefined {
    const matches = declarationsOf(this.scan, dictionaryName).filter(declaration => declaration.nameText === variableName);
    return matches.length === 1 ? this.lineOf(matches[0].start) : undefined;
  }

  /**
   * The line of the next unreported use of `variableName` that Khiops looks up in `dictionaryName`: a use
   * in one of its derivations, or in another dictionary's where a table rule's operand is that table's.
   * Khiops reports every use, in document order, so the n-th error belongs to the n-th use.
   */
  nextReferenceLine(dictionaryName: string, variableName: string): number | undefined {
    const uses = this.scan.structure.dictionaries.flatMap(dictionary =>
      dictionary.declarations.flatMap(declaration => this.usesOf(declaration, variableName))
        .filter(index => this.lookedUpIn(dictionary, index) === dictionaryName));

    const key = `${dictionaryName}/${variableName}`;
    const placed = this.placedReferences.get(key) ?? 0;
    this.placedReferences.set(key, placed + 1);
    const use = uses[placed] ?? uses[0];
    return use === undefined ? undefined : this.lineOf(this.scan.tokens[use]);
  }

  /** The indices of the tokens in a declaration's derivation that read the variable `variableName`. */
  private usesOf({ equalsIndex, endIndex }: Declaration, variableName: string): number[] {
    if (equalsIndex === undefined || endIndex === undefined) { return []; }
    const { tokens } = this.scan;
    const uses: number[] = [];
    for (let index = equalsIndex + 1; index < endIndex; index++) {
      if (isNameToken(tokens[index]) && tokenName(tokens[index]) === variableName
        && !isSymbol(tokens[index + 1], '(')) { // `name(` calls a rule rather than reading a variable
        uses.push(index);
      }
    }
    return uses;
  }

  /**
   * The name of the dictionary Khiops looks up the operand at token `index` in: the one its rule resolves it
   * in (with the dots of the scope operator in front of it), else the dictionary it is written in.
   */
  private lookedUpIn(dictionary: Dictionary, index: number): string | undefined {
    const { tokens, structure } = this.scan;
    let start = index;
    while (isSymbol(tokens[start - 1], '.')) { start--; }
    const scope = operandSiteAt(structure, tokens, RULES, tokens[start].start, index - start)?.scope;
    const name = (scope?.dictionary ?? dictionary).header.name;
    return name && tokenName(name);
  }

  private lineOf(token: KdicToken): number {
    return this.scan.document.positionAt(token.start).line;
  }
}

/**
 * Locates an error that carries no line number but names its dictionary and
 * variable: at the variable's declaration, or, when the variable is missing, at its use.
 */
function locateByName(message: string, locator: ErrorLocator): number | undefined {
  const missing = VARIABLE_NOT_FOUND.exec(message);
  if (missing) { return locator.nextReferenceLine(missing[2], missing[1]); }

  const declared = DECLARED_VARIABLE.exec(message);
  return declared ? locator.declarationLine(declared[1], declared[2]) : undefined;
}

/**
 * Extracts the errors from Khiops output and places each one on a line of the
 * dictionary file: the line Khiops reports, else the declaration or use the
 * message names, else the first line.
 */
export function parseKhiopsErrorLocations(output: string, documentText: string): KhiopsErrorLocation[] {
  const locations: KhiopsErrorLocation[] = [];
  const locator = new ErrorLocator(documentText);
  for (const outputLine of output.split(/\r?\n/)) {
    const withLine = ERROR_WITH_LINE.exec(outputLine);
    if (withLine) {
      locations.push({ line: Math.max(0, Number.parseInt(withLine[1], 10) - 1), message: withLine[2].trim() });
      continue;
    }

    const message = ERROR.exec(outputLine)?.[1].trim();
    if (!message || SUMMARY.test(message)) { continue; }
    locations.push({ line: locateByName(message, locator) ?? 0, message });
  }
  return locations;
}
