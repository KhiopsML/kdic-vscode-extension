/**
 * Lexical context of the cursor, used to decide which completions to offer.
 *
 * Free of any VS Code dependency: functions take the text before the cursor.
 */
import { METADATA_PATTERN, maskQuoted, stripLineComments } from './kdic-syntax';

/** A complete metadata tag at the start of a string. */
const METADATA_AT_START = new RegExp(`^${METADATA_PATTERN}`);

/**
 * Analyzes the text of the current line before the cursor.
 *
 *  - `inComment`: an unquoted `//` precedes the cursor.
 *  - `inDerivation`: an unquoted assignment `=` precedes the cursor. The `=` of a
 *    metadata tag (`<key=value>`) and any `=` inside quotes do not count.
 *
 * Doubled quote characters are escapes, and a quote still open at the cursor
 * hides everything after it.
 */
export function analyzeCompletionPrefix(prefix: string): { inComment: boolean; inDerivation: boolean } {
  let quote: '"' | '`' | undefined;
  let metadataEquals = -1; // offset of the `=` of the last metadata tag
  let inDerivation = false;

  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (quote) {
      if (ch !== quote) { continue; }
      if (prefix[i + 1] === quote) { i++; } // escaped quote
      else { quote = undefined; }
    } else if (ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '/' && prefix[i + 1] === '/') {
      return { inComment: true, inDerivation };
    } else if (ch === '<') {
      const tag = METADATA_AT_START.exec(prefix.slice(i));
      const equals = tag?.[0].indexOf('=') ?? -1;
      metadataEquals = equals === -1 ? -1 : i + equals;
    } else if (ch === '=' && i !== metadataEquals) {
      inDerivation = true;
    }
  }
  return { inComment: false, inDerivation };
}

/** Whether the cursor, which follows `textBeforeCursor`, is inside a dictionary's `{ … }`. */
export function isInsideDictionaryBlock(textBeforeCursor: string): boolean {
  const code = maskQuoted(stripLineComments(textBeforeCursor), true);
  let depth = 0;
  for (const ch of code) {
    if (ch === '{') { depth++; }
    else if (ch === '}') { depth = Math.max(0, depth - 1); }
  }
  return depth > 0;
}

/** Whether the cursor is right after `Entity(` or `Table(`, where a dictionary name is expected. */
export function isAfterRelationalTypeParens(linePrefix: string): boolean {
  return /\b(?:Entity|Table)\s*\(\s*$/.test(linePrefix);
}
