/**
 * Shared kdic validation logic.
 *
 * This module is intentionally free of any VS Code dependency so it can be
 * used by both `extension.ts` (inside VS Code) and `scripts/smoke-test.js`
 * (standalone Node.js CLI).
 */

// ─────────────────────────── Public interfaces ──────────────────────────────

/** Minimal document interface — satisfied by both vscode.TextDocument and the smoke-test mock. */
export interface KdicDocument {
  getText(): string;
  lineCount: number;
  lineAt(line: number): { text: string };
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
 * Builds PARAM_TYPE_MAP and RETURN_TYPE_MAP from derivation rule definitions.
 *
 * Each rule must provide `label`, `returnType`, and `signature`.
 * This is called once at startup; the maps are then passed to `validate()`.
 */
export function buildTypeMaps(
  rules: ReadonlyArray<{ label: string; returnType: string; signature: string }>,
): { paramTypeMap: ParamTypeMap; returnTypeMap: ReturnTypeMap } {
  const typeAlt = KDIC_TYPES.join('|');
  const typeRe = new RegExp('^(?:Block\\((' + typeAlt + ')\\)|(' + typeAlt + '))\\s+');
  const paramTypeMap: ParamTypeMap = new Map();
  const returnTypeMap: ReturnTypeMap = new Map();
  for (const fn of rules) {
    returnTypeMap.set(fn.label, fn.returnType);
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
  return { paramTypeMap, returnTypeMap };
}

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
 */
export function validate(
  document: KdicDocument,
  paramTypeMap: ParamTypeMap,
  returnTypeMap: ReturnTypeMap,
  cursorLine?: number,
): KdicDiagnostic[] {
  const diags: KdicDiagnostic[] = [];

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
      const pos = document.positionAt(braceOpen);
      diags.push({
        line: pos.line, col: pos.character, endCol: pos.character + 1,
        severity: Severity.Error,
        message: "Unclosed '{' in dictionary or variable block.",
      });
      blockEnd = text.length;
    }
    const blockText = text.slice(blockStart, blockEnd);

    // Collect variable types declared in this dictionary block
    const vars = new Map<string, string>();
    const varDeclInfo = new Map<string, {
      type: string;
      index: number;
      typeOffset: number;
      derived: boolean;
    }>();
    const relationRefs: Array<{ rawName: string; offset: number }> = [];
    varDeclRe.lastIndex = 0;
    let vm: RegExpExecArray | null;
    while ((vm = varDeclRe.exec(blockText)) !== null) {
      const raw = vm[2];
      const name = raw.startsWith('`') ? raw.slice(1, -1).replace(/``/g, '`') : raw;
      vars.set(name, vm[1]);
      varDeclInfo.set(name, {
        type: vm[1],
        index: vm.index,
        typeOffset: vm[0].indexOf(vm[1]),
        derived: findUnquotedChar(vm[0], '=') !== -1,
      });

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
    const keyListRe = /\bDictionary\s+(?:`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/;
    const klMatch = keyListRe.exec(headerText);
    if (klMatch) {
      const keyFields = klMatch[1].split(',').map(k => {
        const t = k.trim();
        return t.startsWith('`') ? t.slice(1, -1).replace(/``/g, '`') : t;
      }).filter(k => k.length > 0);
      for (const keyField of keyFields) {
        const declaration = varDeclInfo.get(keyField);
        if (!declaration) { continue; }
        const pos = document.positionAt(blockStart + declaration.index + declaration.typeOffset);
        if (declaration.type !== 'Categorical') {
          diags.push({
            line: pos.line, col: pos.character,
            endCol: pos.character + declaration.type.length,
            severity: Severity.Error,
            message: `Key field '${keyField}' must be 'Categorical' but is declared as '${declaration.type}'.`,
          });
        }
        if (declaration.derived) {
          diags.push({
            line: pos.line, col: pos.character,
            endCol: pos.character + declaration.type.length,
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
      // When the first parameter expects Table/Entity (directly or via
      // Block(Table)), subsequent arguments reference variables from the
      // secondary table — not from this block.
      const firstType = baseTypes.length > 0 ? baseTypes[0] : '';
      const isCrossTableFn = firstType === 'Table' || firstType === 'Entity'
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

        const actual = vars.get(arg);
        if (actual === undefined) {
          // Skip cross-table arguments (positions after a Table/Entity first param)
          if (isCrossTableFn && ai > 0) { continue; }
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

  const strippedLines = text.split(/\r?\n/);
  let lineDepth = 0;
  let parenDepth = 0;
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
    let unmatchedCloseOffset = -1;
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
          if (lineDepth === 0 && unmatchedCloseOffset === -1) { unmatchedCloseOffset = k; }
          lineDepth = Math.max(0, lineDepth - 1);
        }
      }
    }
    if (unmatchedCloseOffset !== -1) {
      const indentLen = lineRaw.length - trimmed.length;
      diags.push({
        line: li, col: indentLen + unmatchedCloseOffset, endCol: indentLen + unmatchedCloseOffset + 1,
        severity: Severity.Error,
        message: "Unmatched '}' outside a dictionary or variable block.",
      });
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
    if (lineDepth === 0) { parenDepth = 0; prevLineEndsWithAssign = false; }

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
      const afterSemi = strippedLine.slice(semiIdx + 1);
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
    if (effective.length > 0 && parenDepth === 0 && !prevLineEndsWithAssign) {
      const patterns = depthBefore > 0 ? insidePatterns : outsidePatterns;
      if (!patterns.some(p => p.test(effective))) {
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
    if (depthBefore > 0) {
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

    // Check 3: missing ';' at end of a complete variable declaration.
    // Only fire when the user has already moved to the next line (li is not the
    // last line), so the error doesn't flash while they are still typing.
    // Also skip the line the cursor is currently on — the user may still be editing it.
    if (
      depthBefore > 0 &&
      parenDepth === 0 &&
      !prevLineEndsWithAssign &&
      effective.length > 0 &&
      lineNetParens === 0 &&
      !effective.trimEnd().endsWith('=') &&
      semiIdx === -1 &&
      varDeclStartRe.test(effective) &&
      li < document.lineCount - 1 &&
      li !== cursorLine
    ) {
      const indentLen = lineRaw.length - trimmed.length;
      const endCol = strippedLine.trimEnd().length;
      diags.push({
        line: li, col: indentLen, endCol,
        severity: Severity.Error,
        message: "Missing ';' at end of variable declaration.",
      });
    }

    // Update parenDepth
    if (depthBefore > 0) {
      parenDepth = Math.max(0, parenDepth + lineNetParens);
    }

    // Check 4: missing ';' after the closing brace of a dictionary block
    if (depthBefore === 1 && lineDepth === 0 && effective === '}') {
      const col = strippedLine.indexOf('}');
      diags.push({
        line: li, col, endCol: col + 1,
        severity: Severity.Error,
        message: "Missing ';' after closing brace of dictionary.",
      });
    }

    prevLineEndsWithAssign = depthBefore > 0 && effective.trimEnd().endsWith('=');
  }

  return diags;
}
