/**
 * Lexical context of the cursor, used to decide which completions to offer.
 *
 * Free of any VS Code dependency: functions take the text before the cursor.
 */
import { METADATA_PATTERN, TYPE_ALTERNATION, maskQuoted, stripLineComments } from './kdic-syntax';
import { parameterTypeAt } from './rule-maps';

/** A complete metadata tag at the start of a string. */
const METADATA_AT_START = new RegExp(`^${METADATA_PATTERN}`);
/** A `<` followed by the start of a key, at the end of a string. */
const METADATA_KEY_AT_END = /<(?:[A-Za-z_][A-Za-z0-9_]*)?$/;
/** A `#` followed by letters, at the end of a string: the start of `#Missing`. */
const HASH_WORD_AT_END = /#[A-Za-z]*$/;
/**
 * The operand being typed, at the end of a string: the dots of the scope operator, then a name, a `#word`
 * or the start of a backquoted name. Dots right after a name, a quote or a number belong to it.
 */
const PARTIAL_OPERAND_AT_END = /(?<![A-Za-z0-9_"`)])(\.*)[ \t]*(`(?:[^`\n]|``)*|#?[A-Za-z_][A-Za-z0-9_]*)?$/;
/** Longest operand looked at, which keeps the search at the end of a long text cheap. */
const MAX_PARTIAL_OPERAND = 300;
/** The type that starts a declaration line, after an optional `Unused`. */
const DECLARATION_TYPE = new RegExp(`^\\s*(?:Unused\\s+)?(${TYPE_ALTERNATION})\\b`);

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

/**
 * Whether the cursor is on the key of a metadata tag being typed (`<`, `<Dat`).
 * A `<` in a comment or in quoted text does not start a tag.
 */
export function isInMetadataKey(linePrefix: string): boolean {
  return METADATA_KEY_AT_END.test(maskQuoted(stripLineComments(linePrefix), true));
}

/** The partly typed `#word` that ends the line prefix (`#`, `#Mis`), outside quotes and comments. */
export function hashWordBeforeCursor(linePrefix: string): string | undefined {
  return HASH_WORD_AT_END.exec(maskQuoted(stripLineComments(linePrefix), true))?.[0];
}

/** What a scan of derivation text learns about the rule calls still open at its end. */
interface CallScan {
  /** The rule calls whose `(` is not closed, innermost last, with the position of the argument being written. */
  calls: Array<{ rule: string | undefined; argument: number }>;
  inQuote: boolean;
  /** Whether the last significant character is `(` or `,`, which an operand follows. */
  atOperandStart: boolean;
}

/**
 * Walks the text once, tracking the open rule calls. Quotes and comments are skipped, and a quote
 * never spans lines. A statement end (`;`, `{`, `}`) closes every call.
 */
function scanCalls(text: string): CallScan {
  const calls: CallScan['calls'] = [];
  let quote: string | undefined;
  let word = '';
  let previousWord: string | undefined; // the identifier just before, when only blanks follow it
  let atOperandStart = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\n') { quote = undefined; }
      else if (ch === quote) { if (text[i + 1] === quote) { i++; } else { quote = undefined; } }
      continue;
    }
    if (/[A-Za-z0-9_]/.test(ch)) { word += ch; atOperandStart = false; continue; }
    if (word) { previousWord = word; word = ''; }
    if (/\s/.test(ch)) { continue; }

    if ((ch === '/' && text[i + 1] === '/') || (ch === '#' && !text.startsWith('#Missing', i))) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end - 1; // a comment: neither the open calls nor the operand position change
      continue;
    }
    if (ch === '(') { calls.push({ rule: previousWord, argument: 0 }); }
    else if (ch === ')') { calls.pop(); }
    else if (ch === ',') { if (calls.length > 0) { calls[calls.length - 1].argument++; } }
    else if (ch === ';' || ch === '{' || ch === '}') { calls.length = 0; }
    else if (ch === '"' || ch === '`') { quote = ch; }
    atOperandStart = ch === '(' || ch === ',';
    previousWord = undefined;
  }
  return { calls, inQuote: quote !== undefined, atOperandStart };
}

/** The operand being typed at the end of `prefix`: how much text it takes, its dots, and the name typed so far. */
export function partialOperand(prefix: string): { length: number; dots: number; word: string } {
  const match = PARTIAL_OPERAND_AT_END.exec(prefix.slice(-MAX_PARTIAL_OPERAND));
  return { length: match?.[0].length ?? 0, dots: match?.[1].length ?? 0, word: match?.[2] ?? '' };
}

/**
 * The type that the rule call enclosing the cursor expects for the operand about to be written,
 * or undefined when the cursor is not where an operand starts (right after `(` or `,`), is in
 * quoted text, or the rule is unknown. `paramTypes` is `RuleMaps.paramTypes`.
 */
export function expectedOperandType(
  textBeforeCursor: string,
  paramTypes: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  const { calls, inQuote, atOperandStart } = scanCalls(textBeforeCursor.slice(0, textBeforeCursor.length - partialOperand(textBeforeCursor).length));
  const call = calls[calls.length - 1];
  const types = call?.rule === undefined ? undefined : paramTypes.get(call.rule);
  return inQuote || !atOperandStart || !call || !types ? undefined : parameterTypeAt(types, call.argument);
}

/** The variable type that starts the line (`Date` in `Unused Date d ;`), if any. */
export function declaredTypeOnLine(linePrefix: string): string | undefined {
  return DECLARATION_TYPE.exec(linePrefix)?.[1];
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
