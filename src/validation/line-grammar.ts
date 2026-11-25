import { tokenizeKdic } from '../kdic-lexer';
import {
  IDENTIFIER_PATTERN as IDENTIFIER, METADATA_PATTERN as METADATA, TYPE_ALTERNATION,
  blankRanges, maskQuoted,
} from '../kdic-syntax';
import { Severity, type DiagnosticCollector } from './diagnostics';
import type { MetadataInfo } from './metadata';
import type { Structure } from './structure';

// ─────────────────────────── Line patterns ──────────────────────────────────
// Each pattern is matched against one trimmed, comment-free line. Keep them
// focused: one construct per pattern.

/** A line made only of metadata tags. */
const METADATA_ONLY = new RegExp(`^(?:${METADATA} *)+$`);

/** Start of a variable declaration: `[Unused] Type[(…)] `. */
const DECLARATION_START = new RegExp(`^(Unused\\s+)?(${TYPE_ALTERNATION})(\\([^)]*\\))?\\s+`);

/** `[Root] Dictionary Name [(keys)] [<metadata>…] [{]`. */
const DICTIONARY_HEADER = new RegExp(
  `^(?:Root\\s+)?Dictionary\\s+${IDENTIFIER}(?:\\s*\\([^)]*\\))?(?:\\s*${METADATA}\\s*)*(?:\\s*\\{)?\\s*$`,
);

/** A complete member of a variable block: `Type name [[key]] ; <metadata>…`. Group 1 is the type. */
const VARIABLE_BLOCK_MEMBER = new RegExp(
  `^(?:Unused\\s+)?(Numerical|Categorical|Table)(?:\\([^)]*\\))?\\s+${IDENTIFIER}`
  + `(?:\\s*\\[[^\\]]*\\])?(?:\\s*=\\s*[^;]+)?\\s*;(?:\\s*${METADATA})*\\s*$`,
);

/** The line closing a variable block: `} Name [= rule] ; <metadata>…`, blanks allowed before the `;`. */
const VARIABLE_BLOCK_CLOSE = new RegExp(`^}\\s+${IDENTIFIER}(?:\\s*=.*)?\\s*;\\s*(?:${METADATA}\\s*)*$`);

/** Metadata tags (and whitespace) allowed right after a `;`. */
const TAGS_AFTER_SEMICOLON = new RegExp(`^(?:\\s*${METADATA})*\\s*`);

/** Lines that are valid outside any dictionary. */
const OUTSIDE_DICTIONARY: readonly RegExp[] = [
  /^#Khiops\b/,
  DICTIONARY_HEADER,
  METADATA_ONLY,
  /^\([^)]*\)\s*(?:\{)?\s*$/, // key list on its own line
  /^\{$/,
  /^\};?$/,
];

/** Lines that are valid inside a dictionary. */
const INSIDE_DICTIONARY: readonly RegExp[] = [
  /^\{$/,
  /^\}\s+\S/,
  /^\};?$/,
  METADATA_ONLY,
  DECLARATION_START,
];

/**
 * Whether a one-line dictionary is well formed: `Dictionary D { Type x; … };`,
 * with a recognizable header and recognizable declarations.
 */
function isInlineDictionary(line: string): boolean {
  const tokens = tokenizeKdic(line).filter(token => token.kind !== 'comment');
  const open = tokens.findIndex(token => token.kind === 'symbol' && token.text === '{');
  if (open < 0 || !OUTSIDE_DICTIONARY.some(pattern => pattern.test(line.slice(0, tokens[open].end).trim()))) {
    return false;
  }

  // Split the body into `;`-terminated statements, each of which must look like a declaration.
  let statementStart = tokens[open].end;
  let groupDepth = 0;
  let inMetadata = false;
  for (let index = open + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== 'symbol') { continue; }
    if (token.text === '<' && groupDepth === 0) { inMetadata = true; }
    else if (token.text === '>' && inMetadata) { inMetadata = false; statementStart = token.end; }
    else if (inMetadata) { continue; }
    else if (token.text === '(' || token.text === '[') { groupDepth++; }
    else if (token.text === ')' || token.text === ']') { groupDepth--; }
    else if (groupDepth === 0 && (token.text === ';' || token.text === '}')) {
      const statement = line.slice(statementStart, token.end).trim();
      if (token.text === '}') {
        // The closing brace must be `};` and the last thing on the line.
        return statement === '}' && tokens[index + 1]?.text === ';' && index + 2 === tokens.length;
      }
      if (!INSIDE_DICTIONARY.some(pattern => pattern.test(statement))) { return false; }
      statementStart = token.end;
    }
  }
  return false;
}

// ─────────────────────────── Line-by-line check ─────────────────────────────

/** One source line with the views the checks need. */
interface Line {
  index: number;
  raw: string;
  /** Without comments, untrimmed. */
  stripped: string;
  /** Leading whitespace, in characters: `effective` starts at this column. */
  indentation: number;
  /** Without comments, trimmed. */
  effective: string;
  /** `effective` with quoted text blanked, so delimiters can be searched safely. */
  effectiveCode: string;
  /** `stripped` with quoted text blanked. */
  code: string;
  /** `stripped` with metadata tags blanked. */
  withoutMetadata: string;
  /** Brace depth before the line. */
  depthBefore: number;
}

/**
 * Line-oriented checks, run once per line while tracking brace, parenthesis
 * and bracket depth:
 *  - variable blocks (`{ … } Name;`): same member types, no individual derivation, named closing;
 *  - content other than metadata or comments after a `;`;
 *  - lines that match no known construct (warning).
 *
 * Continuation lines of a multi-line statement are never flagged as unknown.
 */
class LineGrammarChecker {
  private readonly strippedLines: string[];
  private readonly codeLines: string[];
  private readonly withoutMetadataLines: string[];

  private depth = 0;
  private parenDepth = 0;
  private bracketDepth = 0;
  private previousEndsWithAssign = false;
  private inVariableBlock = false;
  private variableBlockType: string | undefined;

  constructor(
    strippedText: string,
    private readonly metadata: MetadataInfo,
    private readonly structure: Structure,
    private readonly headerLines: ReadonlySet<number>,
    private readonly out: DiagnosticCollector,
  ) {
    this.strippedLines = strippedText.split(/\r?\n/);
    this.codeLines = maskQuoted(strippedText, true).split(/\r?\n/);
    this.withoutMetadataLines = blankRanges(strippedText, metadata.ranges).split(/\r?\n/);
  }

  run(): void {
    for (let index = 0; index < this.out.document.lineCount; index++) {
      const raw = this.out.document.lineAt(index).text;
      if (raw.trimStart().startsWith('//')) { continue; }
      this.checkLine(this.describeLine(index, raw));
    }
  }

  private describeLine(index: number, raw: string): Line {
    const stripped = this.strippedLines[index] ?? '';
    const code = this.codeLines[index] ?? '';
    const effective = stripped.trim();
    const indentation = stripped.length - stripped.trimStart().length;
    const effectiveCode = code.slice(indentation, indentation + effective.length);

    const depthBefore = this.depth;
    for (const ch of effectiveCode) {
      if (ch === '{') { this.depth++; }
      else if (ch === '}') { this.depth = Math.max(0, this.depth - 1); }
    }
    return {
      index, raw, stripped, indentation, effective, effectiveCode, code, depthBefore,
      withoutMetadata: this.withoutMetadataLines[index] ?? '',
    };
  }

  private checkLine(line: Line): void {
    this.checkVariableBlock(line);
    if (this.depth === 0) {
      this.parenDepth = 0;
      this.bracketDepth = 0;
      this.previousEndsWithAssign = false;
    }
    this.checkTrailingContent(line);
    if (!this.isContinuation(line) && !this.isRecognized(line)) {
      this.out.atLine(line.index, line.indentation, line.stripped.trimEnd().length,
        'Line does not match kdic grammar. Use // for non-kdic content.', Severity.Warning);
    }
    this.trackContinuation(line);
  }

  /** Variable blocks: `{` opens one inside a dictionary, `} Name;` closes it. */
  private checkVariableBlock(line: Line): void {
    const { effective, effectiveCode, depthBefore, index, indentation } = line;
    if (depthBefore === 1 && effective === '{') {
      this.inVariableBlock = true;
      this.variableBlockType = undefined;
    } else if (this.inVariableBlock && depthBefore === 2 && effective.startsWith('}')) {
      if (!VARIABLE_BLOCK_CLOSE.test(effective)) {
        const col = line.raw.indexOf('}');
        this.out.atLine(index, col, col + 1, "Variable block must have a name and ';' after its closing brace.");
      }
      this.inVariableBlock = false;
      this.variableBlockType = undefined;
    } else if (this.inVariableBlock && depthBefore === 2 && effective.length > 0) {
      const member = VARIABLE_BLOCK_MEMBER.exec(effective);
      if (member) {
        const memberCode = effectiveCode.slice(0, effectiveCode.indexOf(';') + 1);
        if (memberCode.includes('=')) {
          const col = indentation + effective.indexOf('=');
          this.out.atLine(index, col, col + 1, 'Variable block members cannot be derived individually.');
        }
        if (this.variableBlockType === undefined) {
          this.variableBlockType = member[1];
        } else if (member[1] !== this.variableBlockType) {
          const col = indentation + effective.indexOf(member[1]);
          this.out.atLine(index, col, col + member[1].length, 'Variable block members must all have the same type.');
        }
      } else if (DECLARATION_START.test(effective)) {
        const type = DECLARATION_START.exec(effective)![2];
        const col = indentation + effective.indexOf(type);
        this.out.atLine(index, col, col + type.length, 'Variable block members must be Numerical, Categorical, or Table.');
      }
    }
  }

  /** After a `;`, only metadata tags and comments may follow. */
  private checkTrailingContent(line: Line): void {
    const semicolon = line.code.lastIndexOf(';');
    if (semicolon === -1) { return; }
    const afterSemicolon = line.withoutMetadata.slice(semicolon + 1);
    const tagsLength = TAGS_AFTER_SEMICOLON.exec(afterSemicolon)![0].length;
    const remainder = afterSemicolon.slice(tagsLength);
    if (remainder.trim().length === 0) { return; }
    const gap = remainder.length - remainder.trimStart().length;
    this.out.atLine(line.index, semicolon + 1 + tagsLength + gap, line.stripped.trimEnd().length,
      "Only metadata (<key>, <key=value>, <key=\"value\">) and // comments are allowed after ';'.");
  }

  /** Whether the line continues a statement started on a previous line. */
  private isContinuation(line: Line): boolean {
    return line.effective.length === 0 || this.parenDepth !== 0 || this.bracketDepth !== 0 || this.previousEndsWithAssign;
  }

  /** Whether the line matches a known construct, or is covered by one found, or reported, by the token scan. */
  private isRecognized(line: Line): boolean {
    const { effective, index, depthBefore } = line;
    const patterns = depthBefore > 0 ? INSIDE_DICTIONARY : OUTSIDE_DICTIONARY;
    if (patterns.some(pattern => pattern.test(effective))) { return true; }

    // A line that only holds metadata is fine; so is code once its metadata is removed.
    if (this.metadata.lines.has(index)) {
      const withoutMetadata = line.withoutMetadata.trim();
      if (withoutMetadata === '' || patterns.some(pattern => pattern.test(withoutMetadata))) { return true; }
    }
    return this.structure.declarationLines.has(index)
      || this.structure.rejectedLines.has(index)
      || this.headerLines.has(index)
      || (effective === ';' && this.structure.terminatorLines.has(index))
      || (depthBefore === 0 && isInlineDictionary(effective));
  }

  /** Carries parenthesis, bracket and trailing-`=` state over to the next line. */
  private trackContinuation(line: Line): void {
    if (line.depthBefore > 0) {
      let netParens = 0;
      let netBrackets = 0;
      for (const ch of line.effectiveCode) {
        if (ch === '(') { netParens++; }
        else if (ch === ')') { netParens--; }
        else if (ch === '[') { netBrackets++; }
        else if (ch === ']') { netBrackets--; }
      }
      this.parenDepth = Math.max(0, this.parenDepth + netParens);
      this.bracketDepth = Math.max(0, this.bracketDepth + netBrackets);
    }
    this.previousEndsWithAssign = line.depthBefore > 0 && line.effective.trimEnd().endsWith('=');
  }
}

/** Runs the line-oriented checks over the whole comment-free text. */
export function checkLineGrammar(
  strippedText: string,
  metadata: MetadataInfo,
  structure: Structure,
  headerLines: ReadonlySet<number>,
  out: DiagnosticCollector,
): void {
  new LineGrammarChecker(strippedText, metadata, structure, headerLines, out).run();
}
