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

/**
 * Tokenizes KDIC text without discarding comments or source offsets.
 * Quoted tokens never span lines: a quote left open ends at the line break.
 */
export function tokenizeKdic(text: string): KdicToken[] {
  const tokens: KdicToken[] = [];
  // Sticky patterns, matched at the current position only.
  const identifierPattern = /[A-Za-z_][A-Za-z0-9_]*/y;
  const numberPattern = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
  const missingPattern = /#Missing/y;
  let i = 0;
  while (i < text.length) {
    const start = i;
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }

    // Comment: `// ...` or a `#` line that is not #Missing.
    if ((ch === '/' && text[i + 1] === '/') || (ch === '#' && !text.startsWith('#Missing', i))) {
      i += ch === '#' ? 1 : 2;
      while (i < text.length && text[i] !== '\n') { i++; }
      tokens.push({ kind: 'comment', start, end: i, text: text.slice(start, i) });
      continue;
    }

    // String or backtick identifier; a doubled quote is an escaped quote.
    if (ch === '"' || ch === '`') {
      i++;
      let closed = false;
      while (i < text.length && text[i] !== '\n') {
        if (text[i] === ch) {
          if (text[i + 1] === ch) { i += 2; continue; }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      tokens.push({ kind: ch === '"' ? 'string' : 'quotedIdentifier', start, end: i, text: text.slice(start, i), closed });
      continue;
    }

    // #Missing, identifier or number; anything else is a one-character symbol.
    missingPattern.lastIndex = i;
    identifierPattern.lastIndex = i;
    numberPattern.lastIndex = i;
    const missing = missingPattern.exec(text);
    const identifier = identifierPattern.exec(text);
    const number = numberPattern.exec(text);
    const match = missing ?? identifier ?? number;
    if (match) {
      i += match[0].length;
      tokens.push({ kind: missing ? 'missing' : identifier ? 'identifier' : 'number', start, end: i, text: match[0] });
    } else {
      i++;
      tokens.push({ kind: 'symbol', start, end: i, text: ch });
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
