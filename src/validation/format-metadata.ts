import { formatDocumentationUrl, isValidFormat } from '../date-time-formats';
import type { KdicToken } from '../kdic-lexer';
import { FORMAT_METADATA_KEYS } from '../kdic-syntax';
import type { DiagnosticCollector } from './diagnostics';
import { tagsAfter, type MetadataInfo, type MetadataTag } from './metadata';
import type { Declaration } from './structure';

/** The type each format key belongs to: `DateFormat` → `Date`. */
const FORMAT_KEY_TYPES = new Map(Object.entries(FORMAT_METADATA_KEYS).map(([type, key]) => [key, type]));

/**
 * Reports a format key (`DateFormat`, `TimeFormat`, …) that is put on a variable of another type,
 * given a non-string value, or given a string that is not one of the formats of its type.
 * Khiops rejects all three and does not load the dictionary.
 */
function checkFormatTag(declaration: Declaration, tag: MetadataTag, out: DiagnosticCollector): void {
  const key = tag.key.text;
  const expectedType = FORMAT_KEY_TYPES.get(key);
  if (!expectedType) { return; }

  if (declaration.type.text !== expectedType) {
    out.atToken(tag.key, `Meta-data '${key}' only applies to '${expectedType}' variables, not '${declaration.type.text}'.`);
    return;
  }
  if (tag.value?.kind !== 'string') {
    out.atToken(tag.value ?? tag.key, `Meta-data '${key}' needs a string value, as in <${key}="…">.`);
    return;
  }

  const format = tag.value.text.slice(1, -1).replace(/""/g, '"');
  if (!isValidFormat(expectedType, format)) {
    out.atToken(tag.value, `Invalid ${expectedType} format '${format}' in meta-data '${key}'. `
      + `Valid formats: ${formatDocumentationUrl(expectedType)}`);
  }
}

/**
 * Checks the format metadata of every variable. The tags of a variable are those that follow
 * the `;` ending its declaration, up to the next token that is not part of a tag.
 */
export function checkFormatMetadata(
  declarations: readonly Declaration[],
  tokens: readonly KdicToken[],
  metadata: MetadataInfo,
  out: DiagnosticCollector,
): void {
  for (const declaration of declarations) {
    if (declaration.endIndex === undefined || tokens[declaration.endIndex]?.text !== ';') { continue; }
    for (const tag of tagsAfter(metadata, declaration.endIndex)) { checkFormatTag(declaration, tag, out); }
  }
}
