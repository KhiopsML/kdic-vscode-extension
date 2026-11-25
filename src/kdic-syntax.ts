/**
 * Low-level building blocks of the KDIC format, shared by the lexer, the
 * validator, the Khiops output parser and the completion provider.
 *
 * Everything here is free of any VS Code dependency.
 */

/**
 * Variable types. The order matters: when used in a regex alternation, longer
 * names must come first (`TimestampTZ` before `Timestamp`, `TextList` before `Text`).
 */
export const KDIC_TYPES = [
  'Categorical', 'Numerical', 'TextList', 'Text',
  'Date', 'TimestampTZ', 'Timestamp', 'Time',
  'Table', 'Entity', 'Structure',
] as const;

/** Regex alternation of all variable types, to embed in a larger pattern. */
export const TYPE_ALTERNATION = KDIC_TYPES.join('|');

/** Whether `text` names a variable type. */
export function isKdicType(text: string): boolean {
  return (KDIC_TYPES as readonly string[]).includes(text);
}

/** Regex source of an identifier: plain (`name`) or backtick-quoted, with `` `` `` as an escaped backtick. */
export const IDENTIFIER_PATTERN = '(?:`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)';

/** Regex source of one metadata tag: `<key>`, `<key=1.5>` or `<key="text">`. */
export const METADATA_PATTERN = '<[A-Za-z_][A-Za-z0-9_]*(?:=(?:"[^"]*(?:""[^"]*)*"|[^"<>\\s]*))?>';

/** The metadata key that gives the external format of each date or time type. Khiops accepts it on that type only. */
export const FORMAT_METADATA_KEYS: Readonly<Record<string, string>> = {
  Date: 'DateFormat',
  Time: 'TimeFormat',
  Timestamp: 'TimestampFormat',
  TimestampTZ: 'TimestampTZFormat',
};

/** Returns the name denoted by an identifier: backticks removed and `` `` `` unescaped. */
export function decodeIdentifier(raw: string): string {
  return raw.startsWith('`') ? raw.slice(1, -1).replace(/``/g, '`') : raw;
}

/** Writes a name as a dictionary file needs it: as it is when it is plain, else between backticks with each one doubled. */
export function encodeIdentifier(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name.replace(/`/g, '``')}\``;
}

type Range = { start: number; end: number };

/**
 * Replaces every character inside a string or backtick identifier (quotes
 * included) with a space, so that delimiters can be searched without being
 * fooled by quoted text. Line breaks are always kept and offsets never move.
 *
 * With `resetAtNewline`, a quote left open at the end of a line does not leak
 * into the next one (each line is masked independently, like the lexer does).
 */
export function maskQuoted(text: string, resetAtNewline: boolean): string {
  const quoted: Range[] = [];
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) { quoted.push({ start, end: i + 1 }); quote = ''; }
      else if (ch === '\n' && resetAtNewline) { quoted.push({ start, end: i }); quote = ''; }
    } else if (ch === '"' || ch === '`') {
      quote = ch;
      start = i;
    }
  }
  if (quote) { quoted.push({ start, end: text.length }); }
  return blankRanges(text, quoted);
}

/** Replaces the given ranges with spaces, keeping line breaks and offsets. */
export function blankRanges(text: string, ranges: readonly Range[]): string {
  let result = '';
  let copied = 0;
  for (const { start, end } of ranges) {
    result += text.slice(copied, start) + text.slice(start, end).replace(/[^\r\n]/g, ' ');
    copied = end;
  }
  return result + text.slice(copied);
}

/**
 * Replaces `// …` line comments with spaces, preserving character offsets.
 * A `//` inside a string or backtick identifier (`"//url"`, `` `a//b` ``) is not a comment.
 */
export function stripLineComments(text: string): string {
  return blankRanges(text, commentRanges(text));
}

/** Offsets of every `//` comment, from the marker to the end of its line. */
function commentRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') { quote = ''; }
    else if (quote) { if (ch === quote) { quote = ''; } }
    else if (ch === '"' || ch === '`') { quote = ch; }
    else if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      ranges.push({ start: i, end: end === -1 ? text.length : end });
      i = (end === -1 ? text.length : end) - 1;
    }
  }
  return ranges;
}

/** Names of all dictionaries declared in the text (`Dictionary X` and `Root Dictionary X`), ignoring comments. */
export function extractDictionaryNames(text: string): Set<string> {
  const names = new Set<string>();
  const code = stripLineComments(text);
  const declaration = new RegExp(`\\bDictionary\\s+(${IDENTIFIER_PATTERN})`, 'g');
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(code)) !== null) {
    names.add(decodeIdentifier(match[1]));
  }
  return names;
}
