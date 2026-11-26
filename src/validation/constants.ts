/** Check of the constants written in derivations. */
import type { KdicToken } from '../kdic-lexer';
import type { DiagnosticCollector } from './diagnostics';
import type { MetadataInfo } from './metadata';
import type { Declaration } from './structure';

/** Tokens that may follow a numerical constant inside a derivation. */
const AFTER_NUMBER = [',', ')', ']', ':'];

/**
 * Checks the constants written in derivations (`= …`): categorical constants
 * must be closed, and numerical constants must stand alone, with no stray
 * sign before them or token glued after them.
 */
export function checkConstants(
  declarations: readonly Declaration[],
  tokens: readonly KdicToken[],
  metadata: MetadataInfo,
  out: DiagnosticCollector,
): void {
  for (const declaration of declarations) {
    if (declaration.equalsIndex === undefined || declaration.endIndex === undefined) { continue; }
    for (let index = declaration.equalsIndex + 1; index < declaration.endIndex; index++) {
      if (metadata.tokenIndices.has(index)) { continue; }
      const token = tokens[index];
      if (token.kind === 'string' && token.closed === false) {
        out.atToken(token, 'Unclosed categorical constant.');
      } else if (token.kind === 'number' || token.kind === 'missing') {
        const previous = tokens[index - 1];
        const next = tokens[index + 1];
        const signedTwice = previous?.kind === 'symbol' && (previous.text === '+' || previous.text === '-');
        const glued = next !== undefined && index + 1 < declaration.endIndex && !AFTER_NUMBER.includes(next.text);
        if (signedTwice || glued) { out.atToken(token, 'Invalid numerical constant.'); }
      }
    }
  }
}
