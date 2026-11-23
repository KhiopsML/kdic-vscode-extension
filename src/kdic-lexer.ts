export type KdicTokenKind = 'identifier' | 'quotedIdentifier' | 'string' | 'number' | 'missing' | 'symbol' | 'comment';

export interface KdicToken {
  kind: KdicTokenKind;
  start: number;
  end: number;
  text: string;
  closed?: boolean;
}

/**
 * Tokenizes KDIC text without discarding comments or source offsets.
 * Quoted tokens record whether they close before the end of their line.
 */
export function tokenizeKdic(text: string): KdicToken[] {
  const tokens: KdicToken[] = [];
  const identifierPattern = /[A-Za-z_][A-Za-z0-9_]*/y;
  const numberPattern = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
  const missingPattern = /#Missing/y;
  let i = 0;
  while (i < text.length) {
    const start = i;
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }

    if ((ch === '/' && text[i + 1] === '/') || (ch === '#' && !text.startsWith('#Missing', i))) {
      i += ch === '#' ? 1 : 2;
      while (i < text.length && text[i] !== '\n') { i++; }
      tokens.push({ kind: 'comment', start, end: i, text: text.slice(start, i) });
      continue;
    }

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
