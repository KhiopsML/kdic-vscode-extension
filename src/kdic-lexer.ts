/**
 * The KDIC tokenizer: turns text into tokens that keep their source offsets, comments and quote state, so
 * that a check is never fooled by a string or a comment.
 *
 * Free of any VS Code dependency.
 */
import { decodeIdentifier } from './kdic-syntax';

export type KdicTokenKind =
  | 'identifier'        // plain name or keyword: Dictionary, Numerical, my_var
  | 'quotedIdentifier'  // `backtick name`
  | 'string'            // "double-quoted constant"
  | 'number'
  | 'missing'           // #Missing
  | 'symbol'            // any other single character: { } ( ) [ ] < > = ; , :
  | 'comment';          // // line comment, or a # line (e.g. #Khiops 11.0)

export interface KdicToken {
  kind: KdicTokenKind;
  /** Offset of the first character in the source text. */
  start: number;
  /** Offset just after the last character. */
  end: number;
  text: string;
  /** For strings and quoted identifiers: whether the closing quote was found before the end of the line. */
  closed?: boolean;
}

/** Tokens made of letters and digits, tried in this order at each position (`#Missing` before any other `#`). */
const WORD_PATTERNS: ReadonlyArray<readonly [KdicTokenKind, RegExp]> = [
  ['missing', /#Missing/y],
  ['identifier', /[A-Za-z_][A-Za-z0-9_]*/y],
  ['number', /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y],
];

/** Whether a comment starts at `index`: `// ...`, or a `#` line that is not `#Missing`. */
function startsComment(text: string, index: number): boolean {
  return (text[index] === '/' && text[index + 1] === '/') || (text[index] === '#' && !text.startsWith('#Missing', index));
}

/** The offset of the line break that ends the line holding `index`, or the end of the text. */
function lineEnd(text: string, index: number): number {
  const end = text.indexOf('\n', index);
  return end === -1 ? text.length : end;
}

/**
 * Reads the string or backtick identifier whose opening quote is at `start`: where it ends and whether its
 * closing quote was found. A doubled quote is an escaped quote; a quote left open ends at the line break.
 */
function readQuoted(text: string, start: number): { end: number; closed: boolean } {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length && text[index] !== '\n') {
    if (text[index] !== quote) { index++; }
    else if (text[index + 1] === quote) { index += 2; }
    else { return { end: index + 1, closed: true }; }
  }
  return { end: index, closed: false };
}

/** The `#Missing`, identifier or number that starts at `index`, if there is one. */
function readWord(text: string, index: number): { kind: KdicTokenKind; text: string } | undefined {
  for (const [kind, pattern] of WORD_PATTERNS) {
    pattern.lastIndex = index; // sticky: the pattern only matches at this position
    const match = pattern.exec(text);
    if (match) { return { kind, text: match[0] }; }
  }
  return undefined;
}

/**
 * Tokenizes KDIC text without discarding comments or source offsets.
 * Quoted tokens never span lines: a quote left open ends at the line break.
 */
export function tokenizeKdic(text: string): KdicToken[] {
  const tokens: KdicToken[] = [];
  let index = 0;
  while (index < text.length) {
    const start = index;
    const char = text[index];
    if (/\s/.test(char)) { index++; continue; }

    if (startsComment(text, index)) {
      index = lineEnd(text, index);
      tokens.push({ kind: 'comment', start, end: index, text: text.slice(start, index) });
    } else if (char === '"' || char === '`') {
      const { end, closed } = readQuoted(text, index);
      index = end;
      tokens.push({ kind: char === '"' ? 'string' : 'quotedIdentifier', start, end, text: text.slice(start, end), closed });
    } else {
      // Anything that is neither a comment, a quoted token nor a word is a one-character symbol.
      const word = readWord(text, index);
      index += word?.text.length ?? 1;
      tokens.push({ kind: word?.kind ?? 'symbol', start, end: index, text: word?.text ?? char });
    }
  }
  return tokens;
}

/** Whether the token can name a dictionary or variable: a plain identifier or a closed backtick identifier. */
export function isNameToken(token: KdicToken | undefined): token is KdicToken {
  return token?.kind === 'identifier' || (token?.kind === 'quotedIdentifier' && token.closed === true);
}

/** The name a name token denotes (backticks removed); other tokens keep their raw text. */
export function tokenName(token: KdicToken): string {
  return token.kind === 'quotedIdentifier' && token.closed ? decodeIdentifier(token.text) : token.text;
}
