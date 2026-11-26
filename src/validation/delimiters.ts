/** Check of the brackets: `()`, `[]` and `{}` must be closed, matched and nested. */
import type { KdicToken } from '../kdic-lexer';
import type { DiagnosticCollector } from './diagnostics';

const OPENER_OF: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * Reports unclosed, unmatched and wrongly nested `()`, `[]` and `{}`.
 * Quoted text and comments are already separate tokens, so they cannot interfere.
 */
export function checkDelimiters(tokens: readonly KdicToken[], out: DiagnosticCollector): void {
  const open: KdicToken[] = [];
  for (const token of tokens) {
    if (token.kind !== 'symbol') { continue; }
    if (token.text === '(' || token.text === '[' || token.text === '{') {
      open.push(token);
      continue;
    }
    const opener = OPENER_OF[token.text];
    if (!opener) { continue; }

    // A closer first discards, and reports, the unclosed openers nested inside the one it matches.
    while (open.length > 0 && open[open.length - 1].text !== opener) {
      const unclosed = open.pop()!;
      out.atToken(unclosed, `Unclosed '${unclosed.text}' before '${token.text}'.`);
    }
    if (open.length === 0) {
      out.atToken(token, token.text === '}'
        ? "Unmatched '}' outside a dictionary or variable block."
        : `Unmatched '${token.text}'.`);
    } else {
      open.pop();
    }
  }
  for (const token of open) {
    out.atToken(token, token.text === '{'
      ? "Unclosed '{' in dictionary or variable block."
      : `Unclosed '${token.text}'.`);
  }
}
