/**
 * Shared kdic validation logic.
 *
 * This module is intentionally free of any VS Code dependency so it can be
 * used by both `extension.ts` (inside VS Code) and `scripts/smoke-test.js`
 * (standalone Node.js CLI).
 */
import { tokenizeKdic, type KdicToken } from './kdic-lexer';

// ─────────────────────────── Public interfaces ──────────────────────────────

/** Minimal document interface — satisfied by both vscode.TextDocument and the smoke-test mock. */
export interface KdicDocument {
  /** Returns the complete source text. */
  getText(): string;
  lineCount: number;
  /** Returns the text of a zero-based line without its line terminator. */
  lineAt(line: number): { text: string };
  /** Converts a source offset to a zero-based line and character position. */
  positionAt(offset: number): { line: number; character: number };
}

/** Diagnostic severity — mirrors vscode.DiagnosticSeverity values. */
export const enum Severity { Error = 0, Warning = 1 }

/** A plain diagnostic object with no VS Code dependency. */
export interface KdicDiagnostic {
  line: number;
  col: number;
  endCol: number;
  severity: Severity;
  message: string;
}

/** Maps a derivation rule name to its expected parameter types. */
export type ParamTypeMap = Map<string, string[]>;
/** Maps a derivation rule name to its return type. */
export type ReturnTypeMap = Map<string, string>;
export type OperandScope = 'current' | 'secondary' | 'unknown';
export type ParamScopeMap = Map<string, readonly OperandScope[]>;

// ─────────────────────────── Constants ──────────────────────────────────────

// Ordered so longer prefixes come first (TimestampTZ before Timestamp, etc.)
export const KDIC_TYPES = [
  'Categorical', 'Numerical', 'TextList', 'Text',
  'Date', 'TimestampTZ', 'Timestamp', 'Time',
  'Table', 'Entity', 'Structure',
] as const;

// ─────────────────────────── Helper functions ───────────────────────────────

/**
 * Replaces `// …` line comments with spaces, preserving character offsets.
 * Correctly skips `//` that appears inside backtick-quoted identifiers or
 * double-quoted string literals (e.g. `FREQ_//token` or "//url").
 */
export function stripLineComments(text: string): string {
  const out: string[] = [];
  let inBt = false, inDq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      inBt = false; inDq = false; out.push(ch);
    } else if (inBt) {
      if (ch === '`') { inBt = false; } out.push(ch);
    } else if (inDq) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { out.push('""'); i++; continue; }
        inDq = false;
      }
      out.push(ch);
    } else if (ch === '`') {
      inBt = true; out.push(ch);
    } else if (ch === '"') {
      inDq = true; out.push(ch);
    } else if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
      let j = i;
      while (j < text.length && text[j] !== '\n') { j++; }
      out.push(' '.repeat(j - i));
      i = j - 1;
    } else {
      out.push(ch);
    }
  }
  return out.join('');
}

/**
 * Extracts all dictionary names from comment-stripped text.
 * Handles both `Dictionary MyName` and `Root Dictionary MyName`.
 */
export function extractDictionaryNames(strippedText: string): Set<string> {
  const names = new Set<string>();
  const pattern = /\bDictionary\s+(`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(strippedText)) !== null) {
    const raw = match[1];
    const name = raw.startsWith('`') ? raw.slice(1, -1).replace(/``/g, '`') : raw;
    names.add(name);
  }
  return names;
}

/**
 * Builds parameter type, return type, and operand scope maps from rule definitions.
 *
 * Each rule must provide `label`, `returnType`, and `signature`.
 * This is called once at startup; the maps are then passed to `validate()`.
 */
export function buildTypeMaps(
  rules: ReadonlyArray<{ label: string; returnType: string; signature: string; operandScopes?: readonly OperandScope[] }>,
): { paramTypeMap: ParamTypeMap; returnTypeMap: ReturnTypeMap; paramScopeMap: ParamScopeMap } {
  const typeAlt = KDIC_TYPES.join('|');
  const typeRe = new RegExp('^(?:Block\\((' + typeAlt + ')\\)|(' + typeAlt + '))\\s+');
  const paramTypeMap: ParamTypeMap = new Map();
  const returnTypeMap: ReturnTypeMap = new Map();
  const paramScopeMap: ParamScopeMap = new Map();
  for (const fn of rules) {
    returnTypeMap.set(fn.label, fn.returnType);
    if (fn.operandScopes) { paramScopeMap.set(fn.label, fn.operandScopes); }
    const inner = fn.signature.match(/\((.+)\)/)?.[1] ?? '';
    const types = inner.split(',').map(part => {
      part = part.trim();
      if (part === '...') { return '...'; }
      const m = typeRe.exec(part);
      if (!m) { return 'any'; }
      // m[1] = inner type of Block(Type), m[2] = plain Type
      return m[1] ? `Block(${m[1]})` : m[2];
    });
    paramTypeMap.set(fn.label, types);
  }
  return { paramTypeMap, returnTypeMap, paramScopeMap };
}

/** Finds the first target outside strings and quoted identifiers, or -1 if absent. */
function findUnquotedChar(text: string, target: string): number {
  let inBt = false;
  let inDq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inBt) {
      if (ch === '`') { inBt = false; }
    } else if (inDq) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { i++; }
        else { inDq = false; }
      }
    } else if (ch === '`') {
      inBt = true;
    } else if (ch === '"') {
      inDq = true;
    } else if (ch === target) {
      return i;
    }
  }
  return -1;
}

// ─────────────────────────── Core validation ────────────────────────────────

/**
 * Validates a .kdic document and returns an array of plain diagnostics.
 *
 * @param document  — anything that satisfies the KdicDocument interface
 * @param paramTypeMap  — built by `buildTypeMaps()`
 * @param returnTypeMap — built by `buildTypeMaps()`
 * @param cursorLine — optional source line currently being edited
 * @param paramScopeMap — optional operand scopes built by `buildTypeMaps()`
 */
export function validate(
  document: KdicDocument,
  paramTypeMap: ParamTypeMap,
  returnTypeMap: ReturnTypeMap,
  cursorLine?: number,
  paramScopeMap?: ParamScopeMap,
): KdicDiagnostic[] {
  const diags: KdicDiagnostic[] = [];

  const tokens = tokenizeKdic(document.getText());
  const delimiterStack: KdicToken[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  /** Adds an error at the position of a delimiter token. */
  const reportDelimiter = (token: KdicToken, message: string): void => {
    const pos = document.positionAt(token.start);
    diags.push({ line: pos.line, col: pos.character, endCol: pos.character + 1, severity: Severity.Error, message });
  };
  for (const token of tokens) {
    if (token.kind !== 'symbol') { continue; }
    if (token.text === '(' || token.text === '[' || token.text === '{') {
      delimiterStack.push(token);
    } else if (pairs[token.text]) {
      while (delimiterStack.length > 0 && delimiterStack[delimiterStack.length - 1].text !== pairs[token.text]) {
        const unclosed = delimiterStack.pop()!;
        reportDelimiter(unclosed, `Unclosed '${unclosed.text}' before '${token.text}'.`);
      }
      if (delimiterStack.length === 0) {
        reportDelimiter(token, token.text === '}' ? "Unmatched '}' outside a dictionary or variable block." : `Unmatched '${token.text}'.`);
      } else {
        delimiterStack.pop();
      }
    }
  }
  for (const token of delimiterStack) {
    reportDelimiter(token, token.text === '{' ? "Unclosed '{' in dictionary or variable block." : `Unclosed '${token.text}'.`);
  }

  const significantTokens = tokens.filter(token => token.kind !== 'comment');
  const metadataIndices = new Set<number>();
  const metadataRanges: Array<{ start: number; end: number }> = [];
  const metadataLines = new Set<number>();
  for (let index = 0; index < significantTokens.length; index++) {
    const token = significantTokens[index];
    if (token.kind !== 'symbol') { continue; }
    if (token.text === '>') {
      reportDelimiter(token, "Unmatched '>' in metadata.");
      continue;
    }
    if (token.text !== '<') { continue; }

    let end = index + 1;
    while (end < significantTokens.length) {
      const current = significantTokens[end];
      if (current.kind === 'symbol' && ['>', '<', ';', '{', '}'].includes(current.text)) { break; }
      if (current.closed === false) { end++; break; }
      end++;
    }
    const closing = significantTokens[end]?.text === '>';
    const content = significantTokens.slice(index + 1, end);
    const validKey = content[0]?.kind === 'identifier';
    const validValue = content.length === 1 || (
      content.length === 3 && content[1].text === '='
      && (content[2].kind === 'number' || (content[2].kind === 'string' && content[2].closed))
    );
    if (!closing || !validKey || !validValue) {
      reportDelimiter(token, 'Invalid or unclosed metadata.');
    }
    const last = closing ? end : end - 1;
    const endOffset = significantTokens[Math.max(index, last)].end;
    metadataRanges.push({ start: token.start, end: endOffset });
    const startLine = document.positionAt(token.start).line;
    const endLine = document.positionAt(endOffset).line;
    for (let line = startLine; line <= endLine; line++) { metadataLines.add(line); }
    for (let cursor = index; cursor <= last; cursor++) { metadataIndices.add(cursor); }
    index = last;
  }
  let braceDepth = 0;
  let groupDepth = 0;
  let blockClosing = false;
  type Declaration = {
    start: KdicToken; nameIndex: number; type: KdicToken; name: KdicToken; derived: boolean;
    equalsIndex?: number; endIndex?: number;
  };
  let pendingDeclaration: Declaration | undefined;
  const declarations: Declaration[] = [];
  const declarationLines = new Set<number>();
  const dictionaryTerminatorLines = new Set<number>();
  const headerLines = new Set<number>();
  /** Finds the token index following a declaration's type, or -1 if no type is present. */
  const declarationNameIndex = (index: number): number => {
    let offset = index;
    if (significantTokens[offset]?.text === 'Unused') { offset++; }
    if (!KDIC_TYPES.some(type => type === significantTokens[offset]?.text)) { return -1; }
    offset++;
    if (significantTokens[offset]?.text === '(') {
      let depth = 1;
      offset++;
      while (offset < significantTokens.length && depth > 0) {
        if (significantTokens[offset].text === '(') { depth++; }
        else if (significantTokens[offset].text === ')') { depth--; }
        offset++;
      }
    }
    return offset;
  };
  /** Finalizes a pending declaration and reports a missing semicolon when appropriate. */
  const reportMissingDeclarationTerminator = (endIndex: number): void => {
    if (!pendingDeclaration) { return; }
    pendingDeclaration.endIndex = endIndex;
    const pos = document.positionAt(pendingDeclaration.start.start);
    if (pos.line < document.lineCount - 1 && pos.line !== cursorLine) {
      diags.push({
        line: pos.line, col: pos.character, endCol: document.lineAt(pos.line).text.trimEnd().length,
        severity: Severity.Error, message: "Missing ';' at end of variable declaration.",
      });
    }
    pendingDeclaration = undefined;
  };
  for (let index = 0; index < significantTokens.length; index++) {
    const token = significantTokens[index];
    if (metadataIndices.has(index)) { continue; }
    if (token.kind === 'symbol' && (token.text === '(' || token.text === '[')) { groupDepth++; continue; }
    if (token.kind === 'symbol' && (token.text === ')' || token.text === ']')) { groupDepth = Math.max(0, groupDepth - 1); continue; }
    if (token.kind === 'symbol' && token.text === '{') {
      braceDepth++;
      groupDepth = 0;
      continue;
    }
    if (token.kind === 'symbol' && token.text === '}') {
      if (pendingDeclaration) { reportMissingDeclarationTerminator(index); }
      if (braceDepth === 1) {
        const next = significantTokens[index + 1];
        if (next?.text !== ';') {
          reportDelimiter(token, "Missing ';' after closing brace of dictionary.");
        } else {
          dictionaryTerminatorLines.add(document.positionAt(next.start).line);
        }
      }
      blockClosing = braceDepth > 1;
      braceDepth = Math.max(0, braceDepth - 1);
      groupDepth = 0;
      continue;
    }
    if (groupDepth > 0 || braceDepth === 0) { continue; }
    if (pendingDeclaration && token.kind === 'symbol' && token.text === '=') {
      pendingDeclaration.derived = true;
      pendingDeclaration.equalsIndex = index;
    }
    if (token.kind === 'symbol' && token.text === ';') {
      if (pendingDeclaration) {
        pendingDeclaration.endIndex = index;
        const startLine = document.positionAt(pendingDeclaration.start.start).line;
        const endLine = document.positionAt(token.start).line;
        for (let line = startLine; line <= endLine; line++) { declarationLines.add(line); }
      }
      pendingDeclaration = undefined;
      blockClosing = false;
      continue;
    }
    if (blockClosing) { continue; }
    const nameIndex = declarationNameIndex(index);
    if (nameIndex < 0) { continue; }
    if (pendingDeclaration && index <= pendingDeclaration.nameIndex) { continue; }
    const previous = significantTokens[index - 1];
    if (previous?.text === '=' || previous?.text === 'Unused') { continue; }
    if (!pendingDeclaration && previous
      && (previous.kind === 'identifier' || previous.kind === 'quotedIdentifier')
      && document.positionAt(previous.start).line === document.positionAt(token.start).line) { continue; }
    const candidate = significantTokens[nameIndex];
    if (!candidate || !['identifier', 'quotedIdentifier'].includes(candidate.kind)) {
      const position = document.positionAt(candidate?.start ?? token.end);
      diags.push({
        line: position.line, col: position.character, endCol: position.character + (candidate?.text.length ?? 1),
        severity: Severity.Error, message: 'Invalid variable name.',
      });
      continue;
    }
    if (pendingDeclaration) {
      reportMissingDeclarationTerminator(index);
    }
    const type = significantTokens[index + (token.text === 'Unused' ? 1 : 0)];
    const name = significantTokens[nameIndex];
    pendingDeclaration = { start: token, nameIndex, type, name, derived: false };
    declarations.push(pendingDeclaration);
    const next = significantTokens[nameIndex + 1];
    const decodedName = name.kind === 'quotedIdentifier' && name.closed
      ? name.text.slice(1, -1).replace(/``/g, '`') : name.text;
    const invalidNextSymbol = next && next.start === name.end && next.kind === 'symbol'
      && ![';', '=', '[', '}'].includes(next.text);
    const invalidNextNumber = next && next.start === name.end && (next.kind === 'number' || next.kind === 'missing');
    const invalidNextName = next && (next.kind === 'identifier' || next.kind === 'quotedIdentifier')
      && next.text !== 'Unused' && !KDIC_TYPES.some(value => value === next.text);
    if (name.closed === false || decodedName.length === 0 || decodedName.trim() !== decodedName
      || invalidNextSymbol || invalidNextNumber || invalidNextName) {
      const pos = document.positionAt(name.start);
      diags.push({
        line: pos.line, col: pos.character, endCol: pos.character + name.text.length,
        severity: Severity.Error, message: 'Invalid variable name.',
      });
    }
  }
  reportMissingDeclarationTerminator(significantTokens.length);

  for (const declaration of declarations) {
    if (declaration.equalsIndex === undefined || declaration.endIndex === undefined) { continue; }
    for (let index = declaration.equalsIndex + 1; index < declaration.endIndex; index++) {
      if (metadataIndices.has(index)) { continue; }
      const token = significantTokens[index];
      let message: string | undefined;
      if (token.kind === 'string' && token.closed === false) {
        message = 'Unclosed categorical constant.';
      } else if (token.kind === 'number' || token.kind === 'missing') {
        const previous = significantTokens[index - 1];
        const next = significantTokens[index + 1];
        if ((previous?.kind === 'symbol' && (previous.text === '+' || previous.text === '-'))
          || (next && index + 1 < declaration.endIndex && ![',', ')', ']', ':'].includes(next.text))) {
          message = 'Invalid numerical constant.';
        }
      }
      if (message) {
        const pos = document.positionAt(token.start);
        diags.push({
          line: pos.line, col: pos.character, endCol: pos.character + token.text.length,
          severity: Severity.Error, message,
        });
      }
    }
  }

  // Strip line comments while preserving character offsets
  const text = stripLineComments(document.getText());

  // Collect all dictionary names declared in this file
  const knownDicts = extractDictionaryNames(text);

  const typeAlt = KDIC_TYPES.join('|');
  // Matches a variable declaration inside a block
  const varDeclRe = new RegExp(
    '(?:Unused\\s+)?(' + typeAlt + ')(?:\\([^)]*\\))?\\s+(`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)(?:\\s*\\[[^\\]]*\\])?\\s*(?:=(?:"(?:[^"]|"")*"|[^;"])*)?;',
    'g',
  );
  // Matches: = FunctionName(args with no nested parentheses)
  const callRe = /=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)/g;

  // ── Block-level pass ──────────────────────────────────────────────────────
  let i = 0;
  let headerCursor = 0;
  let declarationCursor = 0;
  while (i < text.length) {
    // Find opening brace, skipping quoted strings
    let braceOpen = -1;
    {
      let inBt = false, inDq = false;
      for (let k = i; k < text.length; k++) {
        const ch = text[k];
        if (inBt) { if (ch === '`') { inBt = false; } }
        else if (inDq) {
          if (ch === '"') {
            if (k + 1 < text.length && text[k + 1] === '"') { k++; }
            else { inDq = false; }
          }
        }
        else if (ch === '`') { inBt = true; }
        else if (ch === '"') { inDq = true; }
        else if (ch === '{') { braceOpen = k; break; }
      }
    }
    if (braceOpen === -1) { break; }

    // Find the matching closing brace, skipping quoted strings
    let depth = 1, j = braceOpen + 1;
    {
      let inBt = false, inDq = false;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (inBt) { if (ch === '`') { inBt = false; } }
        else if (inDq) {
          if (ch === '"') {
            if (j + 1 < text.length && text[j + 1] === '"') { j++; }
            else { inDq = false; }
          }
        }
        else if (ch === '`') { inBt = true; }
        else if (ch === '"') { inDq = true; }
        else if (ch === '{') { depth++; }
        else if (ch === '}') { depth--; }
        j++;
      }
    }

    const blockStart = braceOpen + 1;
    let blockEnd = j - 1;
    if (depth > 0) {
      blockEnd = text.length;
    }
    const blockText = text.slice(blockStart, blockEnd);

    // Collect variable types declared in this dictionary block
    const vars = new Map<string, string>();
    const relationRefs: Array<{ rawName: string; offset: number }> = [];
    varDeclRe.lastIndex = 0;
    let vm: RegExpExecArray | null;
    while ((vm = varDeclRe.exec(blockText)) !== null) {
      const raw = vm[2];
      const name = raw.startsWith('`') ? raw.slice(1, -1).replace(/``/g, '`') : raw;
      vars.set(name, vm[1]);
      const relationMatch = vm[0].match(
        /^(?:Unused\s+)?(?:Table|Entity)\s*\((`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)\)/,
      );
      if (relationMatch) {
        relationRefs.push({
          rawName: relationMatch[1],
          offset: vm.index + relationMatch[0].indexOf(relationMatch[1]),
        });
      }

      if (name.length > 128) {
        const nameOffset = vm[0].indexOf(raw);
        const pos = document.positionAt(blockStart + vm.index + nameOffset);
        diags.push({
          line: pos.line, col: pos.character, endCol: pos.character + raw.length,
          severity: Severity.Error,
          message: `Variable name '${name}' exceeds the 128-character limit.`,
        });
      }
    }

    // ── Key-field type check ──────────────────────────────────────────────
    const headerText = text.slice(i, braceOpen);
    const dictionaryHeaderRe = /\bDictionary\s+(`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)/;
    const dictionaryHeader = dictionaryHeaderRe.exec(headerText);
    if (dictionaryHeader) {
      const rawName = dictionaryHeader[1];
      const dictName = rawName.startsWith('`') ? rawName.slice(1, -1).replace(/``/g, '`') : rawName;
      if (dictName.length > 128) {
        const nameOffset = dictionaryHeader.index + dictionaryHeader[0].indexOf(rawName);
        const pos = document.positionAt(i + nameOffset);
        diags.push({
          line: pos.line, col: pos.character, endCol: pos.character + rawName.length,
          severity: Severity.Error,
          message: `Dictionary name '${dictName}' exceeds the 128-character limit.`,
        });
      }
    }
    while (headerCursor < significantTokens.length && significantTokens[headerCursor].start < i) { headerCursor++; }
    const headerTokens: KdicToken[] = [];
    while (headerCursor < significantTokens.length && significantTokens[headerCursor].end <= braceOpen) {
      if (!metadataIndices.has(headerCursor)) { headerTokens.push(significantTokens[headerCursor]); }
      headerCursor++;
    }
    const dictionaryIndex = headerTokens.findIndex(token => token.text === 'Dictionary');
    const headerName = headerTokens[dictionaryIndex + 1];
    const keys: KdicToken[] = [];
    let headerValid = dictionaryIndex >= 0 && !!headerName
      && (headerName.kind === 'identifier' || (headerName.kind === 'quotedIdentifier' && headerName.closed === true));
    let keyIndex = dictionaryIndex + 2;
    if (headerValid && headerTokens[keyIndex]?.text === '(') {
      keyIndex++;
      let expectKey = true;
      while (keyIndex < headerTokens.length && headerTokens[keyIndex].text !== ')') {
        const keyToken = headerTokens[keyIndex++];
        if (expectKey && (keyToken.kind === 'identifier' || (keyToken.kind === 'quotedIdentifier' && keyToken.closed))) {
          keys.push(keyToken);
        } else if (expectKey || keyToken.text !== ',') {
          headerValid = false;
        }
        expectKey = !expectKey;
      }
      if (expectKey || headerTokens[keyIndex]?.text !== ')') { headerValid = false; }
      else { keyIndex++; }
    }
    if (keyIndex !== headerTokens.length) { headerValid = false; }
    if (headerValid) {
      const startLine = document.positionAt(headerTokens[dictionaryIndex].start).line;
      const bracePosition = document.positionAt(braceOpen);
      for (let line = startLine; line <= bracePosition.line; line++) {
        if (line !== bracePosition.line || !document.lineAt(line).text.slice(bracePosition.character + 1).trim()) {
          headerLines.add(line);
        }
      }
      while (declarationCursor < declarations.length && declarations[declarationCursor].start.start < blockStart) {
        declarationCursor++;
      }
      const blockDeclarations: Declaration[] = [];
      while (declarationCursor < declarations.length && declarations[declarationCursor].start.start < blockEnd) {
        blockDeclarations.push(declarations[declarationCursor++]);
      }
      for (const key of keys) {
        const keyField = key.kind === 'quotedIdentifier' ? key.text.slice(1, -1).replace(/``/g, '`') : key.text;
        const declaration = blockDeclarations.find(item =>
          (item.name.kind === 'quotedIdentifier' ? item.name.text.slice(1, -1).replace(/``/g, '`') : item.name.text) === keyField);
        if (!declaration) {
          const pos = document.positionAt(key.start);
          diags.push({
            line: pos.line, col: pos.character, endCol: pos.character + key.text.length,
            severity: Severity.Error, message: `Key field '${keyField}' is not declared in this dictionary.`,
          });
          continue;
        }
        const pos = document.positionAt(declaration.type.start);
        if (declaration.type.text !== 'Categorical') {
          diags.push({
            line: pos.line, col: pos.character,
            endCol: pos.character + declaration.type.text.length,
            severity: Severity.Error,
            message: `Key field '${keyField}' must be 'Categorical' but is declared as '${declaration.type.text}'.`,
          });
        }
        if (declaration.derived) {
          diags.push({
            line: pos.line, col: pos.character,
            endCol: pos.character + declaration.type.text.length,
            severity: Severity.Error,
            message: `Key field '${keyField}' must not be derived from a rule.`,
          });
        }
      }
    }

    // ── Unknown dictionary check ──────────────────────────────────────────
    for (const relation of relationRefs) {
      const rawName = relation.rawName;
      const dictName = rawName.startsWith('`') ? rawName.slice(1, -1).replace(/``/g, '`') : rawName;
      if (knownDicts.has(dictName)) { continue; }
      const pos = document.positionAt(blockStart + relation.offset);
      diags.push({
        line: pos.line, col: pos.character,
        endCol: pos.character + rawName.length,
        severity: Severity.Error,
        message: `Dictionary '${dictName}' is not declared in this file.`,
      });
    }

    // ── Return-type check ─────────────────────────────────────────────────
    const derivedDeclRe = new RegExp(
      '(?:Unused\\s+)?(' + typeAlt + ')(?:\\([^)]*\\))?\\s+(?:`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\([^()]*\\)',
      'g',
    );
    derivedDeclRe.lastIndex = 0;
    let dm: RegExpExecArray | null;
    while ((dm = derivedDeclRe.exec(blockText)) !== null) {
      const declaredType = dm[1];
      const fnName = dm[2];
      const returnType = returnTypeMap.get(fnName);
      if (!returnType || returnType === 'any') { continue; }
      if (returnType.split('|').includes(declaredType)) { continue; }
      const typeOffsetInMatch = dm[0].indexOf(declaredType);
      const pos = document.positionAt(blockStart + dm.index + typeOffsetInMatch);
      diags.push({
        line: pos.line, col: pos.character,
        endCol: pos.character + declaredType.length,
        severity: Severity.Error,
        message: `'${fnName}' returns '${returnType}' but variable is declared as '${declaredType}'.`,
      });
    }

    // ── Argument-type check ───────────────────────────────────────────────
    callRe.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(blockText)) !== null) {
      const fnName = cm[1];
      const paramTypes = paramTypeMap.get(fnName);
      if (!paramTypes) { continue; }

      const args = cm[2].split(',').map(a => a.trim()).filter(a => a.length > 0);
      const hasVararg = paramTypes[paramTypes.length - 1] === '...';
      const baseTypes = hasVararg ? paramTypes.slice(0, -1) : paramTypes;
      const firstType = baseTypes.length > 0 ? baseTypes[0] : '';
      const isRelationalFn = firstType === 'Table' || firstType === 'Entity'
        || firstType === 'Block(Table)' || firstType === 'Block(Entity)';

      let searchFrom = cm[0].indexOf('(') + 1;
      for (let ai = 0; ai < args.length; ai++) {
        const arg = args[ai];
        const posInCall = cm[0].indexOf(arg, searchFrom);
        if (posInCall !== -1) { searchFrom = posInCall + arg.length; }

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) { continue; }

        const expected =
          ai < baseTypes.length ? baseTypes[ai]
          : 'any';
        if (expected === 'any' || expected === '...' || expected.startsWith('Block(')) { continue; }
        const scope = paramScopeMap?.get(fnName)?.[ai] ?? (isRelationalFn && ai > 0 ? 'unknown' : 'current');
        if (scope !== 'current') { continue; }

        const actual = vars.get(arg);
        if (actual === undefined) {
          // Variable not declared in this block — warn (likely a typo)
          const argDocOffset = blockStart + cm.index + (posInCall !== -1 ? posInCall : cm[0].indexOf('(') + 1);
          const pos = document.positionAt(argDocOffset);
          diags.push({
            line: pos.line, col: pos.character,
            endCol: pos.character + arg.length,
            severity: Severity.Warning,
            message: `'${arg}' is not declared in this dictionary.`,
          });
          continue;
        }

        if (actual !== expected) {
          const argDocOffset = blockStart + cm.index + (posInCall !== -1 ? posInCall : cm[0].indexOf('(') + 1);
          const pos = document.positionAt(argDocOffset);
          diags.push({
            line: pos.line, col: pos.character,
            endCol: pos.character + arg.length,
            severity: Severity.Error,
            message: `'${arg}' is '${actual}' but '${fnName}' expects '${expected}' for argument ${ai + 1}.`,
          });
        }
      }
    }

    i = depth === 0 ? j : text.length;
  }

  // ── Line-level pass ───────────────────────────────────────────────────────
  const metaOnlyRe = /^(<[A-Za-z_][A-Za-z0-9_]*(?:=(?:"[^"]*(?:""[^"]*)*"|[^"<>\s]*))?>\ *)+$/;
  const identifierPattern = '(?:`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)';
  const variableBlockMemberRe = new RegExp(
    '^(?:Unused\\s+)?(Numerical|Categorical|Table)(?:\\([^)]*\\))?\\s+'
      + identifierPattern + '(?:\\s*\\[[^\\]]*\\])?(?:\\s*=\\s*[^;]+)?\\s*;'
      + '(?:\\s*<[A-Za-z_][A-Za-z0-9_]*(?:=(?:"[^"]*(?:""[^"]*)*"|[^"<>\\s]*))?>)*\\s*$',
  );
  const variableBlockCloseRe = new RegExp(
    '^}\\s+' + identifierPattern + '(?:\\s*=.*)?;\\s*(?:<[A-Za-z_][A-Za-z0-9_]*(?:=(?:"[^"]*(?:""[^"]*)*"|[^"<>\\s]*))?>\\s*)*$',
  );
  const outsidePatterns = [
    /^$/,
    /^#Khiops\b/,
    /^(Root\s+)?Dictionary\s+(`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)(\s*\([^)]*\))?(\s*<[A-Za-z_][A-Za-z0-9_]*(?:=(?:"[^"]*(?:""[^"]*)*"|[^"<>\s]*))?>\s*)*(\s*\{)?\s*$/,
    metaOnlyRe,
    /^\([^)]*\)\s*(?:\{)?\s*$/,
    /^\{$/,
    /^\};?$/,
  ];
  const insidePatterns = [
    /^$/,
    /^\{$/,
    /^\}\s+\S/,
    /^\};?$/,
    metaOnlyRe,
    new RegExp('^(Unused\\s+)?(' + typeAlt + ')(\\([^)]*\\))?\\s+'),
  ];
  const varDeclStartRe = new RegExp('^(Unused\\s+)?(' + typeAlt + ')(\\([^)]*\\))?\\s+');
  /** Checks whether a line contains a complete dictionary with recognizable declarations. */
  const isInlineDictionary = (line: string): boolean => {
    const lineTokens = tokenizeKdic(line).filter(token => token.kind !== 'comment');
    const open = lineTokens.findIndex(token => token.kind === 'symbol' && token.text === '{');
    if (open < 0 || !outsidePatterns.some(pattern => pattern.test(line.slice(0, lineTokens[open].end).trim()))) {
      return false;
    }
    let start = lineTokens[open].end;
    let depth = 0;
    let metadata = false;
    for (let index = open + 1; index < lineTokens.length; index++) {
      const token = lineTokens[index];
      if (token.kind !== 'symbol') { continue; }
      if (token.text === '<' && depth === 0) { metadata = true; }
      else if (token.text === '>' && metadata) { metadata = false; start = token.end; }
      else if (!metadata && (token.text === '(' || token.text === '[')) { depth++; }
      else if (!metadata && (token.text === ')' || token.text === ']')) { depth--; }
      else if (!metadata && depth === 0 && (token.text === ';' || token.text === '}')) {
        const fragment = line.slice(start, token.end).trim();
        if (token.text === '}') {
          if (fragment !== '}' || lineTokens[index + 1]?.text !== ';' || index + 2 !== lineTokens.length) { return false; }
          return true;
        }
        if (!insidePatterns.some(pattern => pattern.test(fragment))) { return false; }
        start = token.end;
      }
    }
    return false;
  };

  const strippedLines = text.split(/\r?\n/);
  const maskedText = text.split('');
  for (const range of metadataRanges) {
    for (let index = range.start; index < range.end; index++) {
      if (maskedText[index] !== '\n' && maskedText[index] !== '\r') { maskedText[index] = ' '; }
    }
  }
  const metadataMaskedLines = maskedText.join('').split(/\r?\n/);
  let lineDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let prevLineEndsWithAssign = false;
  let variableBlockOpen = false;
  let variableBlockType: string | undefined;

  for (let li = 0; li < document.lineCount; li++) {
    const lineRaw = document.lineAt(li).text;
    const trimmed = lineRaw.trimStart();
    if (trimmed.startsWith('//')) { continue; }

    const strippedLine = strippedLines[li] ?? '';
    const effective = strippedLine.trim();

    const depthBefore = lineDepth;
    {
      let inBt = false, inDq = false;
      for (let k = 0; k < effective.length; k++) {
        const ch = effective[k];
        if (inBt) { if (ch === '`') { inBt = false; } }
        else if (inDq) {
          if (ch === '"') {
            if (k + 1 < effective.length && effective[k + 1] === '"') { k++; }
            else { inDq = false; }
          }
        }
        else if (ch === '`') { inBt = true; }
        else if (ch === '"') { inDq = true; }
        else if (ch === '{') { lineDepth++; }
        else if (ch === '}') {
          lineDepth = Math.max(0, lineDepth - 1);
        }
      }
    }
    if (depthBefore === 1 && effective === '{') {
      variableBlockOpen = true;
      variableBlockType = undefined;
    } else if (variableBlockOpen && depthBefore === 2 && effective.startsWith('}')) {
      if (!variableBlockCloseRe.test(effective)) {
        const col = lineRaw.indexOf('}');
        diags.push({
          line: li, col, endCol: col + 1,
          severity: Severity.Error,
          message: "Variable block must have a name and ';' after its closing brace.",
        });
      }
      variableBlockOpen = false;
      variableBlockType = undefined;
    } else if (variableBlockOpen && depthBefore === 2 && effective.length > 0) {
      const memberMatch = variableBlockMemberRe.exec(effective);
      if (memberMatch) {
        const memberText = effective.slice(0, findUnquotedChar(effective, ';') + 1);
        if (findUnquotedChar(memberText, '=') !== -1) {
          const equalsCol = effective.indexOf('=');
          diags.push({
            line: li, col: equalsCol, endCol: equalsCol + 1,
            severity: Severity.Error,
            message: 'Variable block members cannot be derived individually.',
          });
        }
        if (variableBlockType === undefined) {
          variableBlockType = memberMatch[1];
        } else if (memberMatch[1] !== variableBlockType) {
          const typeCol = effective.indexOf(memberMatch[1]);
          diags.push({
            line: li, col: typeCol, endCol: typeCol + memberMatch[1].length,
            severity: Severity.Error,
            message: 'Variable block members must all have the same type.',
          });
        }
      } else if (varDeclStartRe.test(effective)) {
        const typeMatch = effective.match(varDeclStartRe);
        const typeCol = typeMatch ? effective.indexOf(typeMatch[2]) : 0;
        diags.push({
          line: li, col: typeCol, endCol: typeCol + (typeMatch?.[2].length ?? 1),
          severity: Severity.Error,
          message: 'Variable block members must be Numerical, Categorical, or Table.',
        });
      }
    }
    if (lineDepth === 0) { parenDepth = 0; bracketDepth = 0; prevLineEndsWithAssign = false; }

    // Check 1: non-comment content after ';'
    const semiIdx = (() => {
      let inBt = false, inDq = false, last = -1;
      for (let k = 0; k < strippedLine.length; k++) {
        const ch = strippedLine[k];
        if (inBt) { if (ch === '`') { inBt = false; } }
        else if (inDq) {
          if (ch === '"') {
            if (k + 1 < strippedLine.length && strippedLine[k + 1] === '"') { k++; }
            else { inDq = false; }
          }
        } else {
          if (ch === '`') { inBt = true; }
          else if (ch === '"') { inDq = true; }
          else if (ch === ';') { last = k; }
        }
      }
      return last;
    })();
    if (semiIdx !== -1) {
      const afterSemi = (metadataMaskedLines[li] ?? '').slice(semiIdx + 1);
      const metaOne = /<[A-Za-z_][A-Za-z0-9_]*(?:=(?:"[^"]*(?:""[^"]*)*"|[^"<>\s]*))?>/g;
      let mEnd = 0;
      {
        const ws = afterSemi.match(/^\s*/)?.[0] ?? '';
        let pos = ws.length;
        metaOne.lastIndex = pos;
        let m;
        while ((m = metaOne.exec(afterSemi)) !== null && m.index === pos) {
          pos = metaOne.lastIndex;
          const trailingWs = afterSemi.slice(pos).match(/^\s*/)?.[0] ?? '';
          pos += trailingWs.length;
          metaOne.lastIndex = pos;
        }
        mEnd = pos;
      }
      const validPrefixLen = mEnd;
      const remainder = afterSemi.slice(validPrefixLen);
      if (remainder.trim().length > 0) {
        const leadingWs = remainder.length - remainder.trimStart().length;
        const col = semiIdx + 1 + validPrefixLen + leadingWs;
        const endCol = strippedLine.trimEnd().length;
        diags.push({
          line: li, col, endCol,
          severity: Severity.Error,
          message: "Only metadata (<key>, <key=value>, <key=\"value\">) and // comments are allowed after ';'.",
        });
      }
    }

    // Check 2: line matches a known kdic grammar pattern
    if (effective.length > 0 && parenDepth === 0 && bracketDepth === 0 && !prevLineEndsWithAssign) {
      const patterns = depthBefore > 0 ? insidePatterns : outsidePatterns;
      const metadataMaskedEffective = (metadataMaskedLines[li] ?? '').trim();
      if (!patterns.some(p => p.test(effective))
        && !(metadataLines.has(li) && patterns.some(p => p.test(metadataMaskedEffective)))
        && !declarationLines.has(li) && !headerLines.has(li)
        && !(effective === ';' && dictionaryTerminatorLines.has(li))
        && !(depthBefore === 0 && isInlineDictionary(effective))) {
        const indentLen = lineRaw.length - trimmed.length;
        const endCol = strippedLine.trimEnd().length;
        diags.push({
          line: li, col: indentLen, endCol,
          severity: Severity.Warning,
          message: 'Line does not match kdic grammar. Use // for non-kdic content.',
        });
      }
    }

    // Compute net parens for this line
    let lineNetParens = 0;
    let lineNetBrackets = 0;
    if (depthBefore > 0) {
      for (const token of tokenizeKdic(effective)) {
        if (token.kind === 'symbol' && token.text === '[') { lineNetBrackets++; }
        else if (token.kind === 'symbol' && token.text === ']') { lineNetBrackets--; }
      }
      let inBtP = false, inDqP = false;
      for (let k = 0; k < effective.length; k++) {
        const ch = effective[k];
        if (inBtP) { if (ch === '`') { inBtP = false; } }
        else if (inDqP) {
          if (ch === '"') {
            if (k + 1 < effective.length && effective[k + 1] === '"') { k++; }
            else { inDqP = false; }
          }
        } else {
          if (ch === '`') { inBtP = true; }
          else if (ch === '"') { inDqP = true; }
          else if (ch === '(') { lineNetParens++; }
          else if (ch === ')') { lineNetParens--; }
        }
      }
    }

    // Update parenDepth
    if (depthBefore > 0) {
      parenDepth = Math.max(0, parenDepth + lineNetParens);
      bracketDepth = Math.max(0, bracketDepth + lineNetBrackets);
    }

    prevLineEndsWithAssign = depthBefore > 0 && effective.trimEnd().endsWith('=');
  }

  return diags;
}
