/** Finds the metadata tags (`<key>`, `<key=value>`) of a document and reports the malformed ones. */
import type { KdicToken } from '../kdic-lexer';
import type { DiagnosticCollector } from './diagnostics';

/** A well-formed metadata tag: `<key>`, `<key=number>` or `<key="string">`. */
export interface MetadataTag {
  /** Indices, in the significant-token list, of the tag's `<` and of its last token. */
  first: number;
  last: number;
  key: KdicToken;
  /** The value, absent for `<key>`. */
  value?: KdicToken;
}

/** Where the metadata tags (`<key>`, `<key=value>`) of a document are. */
export interface MetadataInfo {
  /** Indices, in the significant-token list, of the tokens that belong to a tag. */
  tokenIndices: Set<number>;
  /** Source offsets of each tag, from `<` to its last token. */
  ranges: Array<{ start: number; end: number }>;
  /** Lines touched by a tag. */
  lines: Set<number>;
  /** The tags that are well-formed; malformed ones are reported by `scanMetadata` and left out. */
  tags: MetadataTag[];
  /** The same tags by the index of their `<`. */
  tagByStart: Map<number, MetadataTag>;
}

/** Tokens that can never be part of a tag: they end a malformed one. */
const TAG_TERMINATORS = ['>', '<', ';', '{', '}'];

/**
 * Locates every metadata tag and reports malformed ones.
 * A valid tag is `<key>`, `<key=number>` or `<key="string">`.
 */
export function scanMetadata(tokens: readonly KdicToken[], out: DiagnosticCollector): MetadataInfo {
  const info: MetadataInfo = { tokenIndices: new Set(), ranges: [], lines: new Set(), tags: [], tagByStart: new Map() };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== 'symbol') { continue; }
    if (token.text === '>') {
      out.at(token.start, 1, "Unmatched '>' in metadata.");
      continue;
    }
    if (token.text !== '<') { continue; }

    // The tag runs until `>`, a token that cannot belong to a tag, or an unclosed quote.
    let end = index + 1;
    while (end < tokens.length) {
      const current = tokens[end];
      if (current.kind === 'symbol' && TAG_TERMINATORS.includes(current.text)) { break; }
      if (current.closed === false) { end++; break; }
      end++;
    }
    const closed = tokens[end]?.text === '>';
    const content = tokens.slice(index + 1, end);
    const validKey = content[0]?.kind === 'identifier';
    const validValue = content.length === 1 || (
      content.length === 3 && content[1].text === '='
      && (content[2].kind === 'number' || (content[2].kind === 'string' && content[2].closed))
    );
    if (!closed || !validKey || !validValue) {
      out.at(token.start, 1, 'Invalid or unclosed metadata.');
    } else {
      const tag = { first: index, last: end, key: content[0], value: content[2] };
      info.tags.push(tag);
      info.tagByStart.set(index, tag);
    }

    const last = closed ? end : end - 1;
    const endOffset = tokens[Math.max(index, last)].end;
    info.ranges.push({ start: token.start, end: endOffset });
    for (let line = out.lineOf(token.start); line <= out.lineOf(endOffset); line++) { info.lines.add(line); }
    for (let cursor = index; cursor <= last; cursor++) { info.tokenIndices.add(cursor); }
    index = last;
  }
  return info;
}

/** The tags written right after the token at `index`: those of a declaration follow its `;`. */
export function tagsAfter(metadata: MetadataInfo, index: number): MetadataTag[] {
  const found: MetadataTag[] = [];
  for (let tag = metadata.tagByStart.get(index + 1); tag; tag = metadata.tagByStart.get(tag.last + 1)) { found.push(tag); }
  return found;
}
