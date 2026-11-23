/** Identifies comment and derivation context in a line prefix, ignoring quoted text and metadata assignments. */
export function analyzeCompletionPrefix(prefix: string): { inComment: boolean; inDerivation: boolean } {
  let quote: '"' | '`' | undefined;
  let metadataEquals = -1;
  let inDerivation = false;

  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (quote) {
      if (ch === quote) {
        if (prefix[i + 1] === quote) { i++; }
        else { quote = undefined; }
      }
    } else if (ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '/' && prefix[i + 1] === '/') {
      return { inComment: true, inDerivation };
    } else if (ch === '<') {
      const metadata = /^<[A-Za-z_][A-Za-z0-9_]*(?:=(?:"(?:[^"]|"")*"|[^"<>\s]*))?>/.exec(prefix.slice(i));
      const equals = metadata?.[0].indexOf('=') ?? -1;
      metadataEquals = equals === -1 ? -1 : i + equals;
    } else if (ch === '=' && i !== metadataEquals) {
      inDerivation = true;
    }
  }
  return { inComment: false, inDerivation };
}
