import { KDIC_TYPES, Severity, stripLineComments } from './validator';

export interface KhiopsErrorLocation {
  line: number;
  message: string;
}

const identifierPattern = '(`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*)';

function decodeIdentifier(raw: string): string {
  return raw.startsWith('`') ? raw.slice(1, -1).replace(/``/g, '`') : raw;
}

function isQuotedAt(text: string, position: number): boolean {
  let inBackticks = false;
  let inDoubleQuotes = false;
  for (let index = 0; index < position; index++) {
    const character = text[index];
    if (inBackticks) {
      if (character === '`') {
        if (text[index + 1] === '`') { index++; }
        else { inBackticks = false; }
      }
    } else if (inDoubleQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { index++; }
        else { inDoubleQuotes = false; }
      }
    } else if (character === '`') {
      inBackticks = true;
    } else if (character === '"') {
      inDoubleQuotes = true;
    }
  }
  return inBackticks || inDoubleQuotes;
}

function findOpeningBrace(text: string, start: number): number {
  let inBackticks = false;
  let inDoubleQuotes = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (inBackticks) {
      if (character === '`') {
        if (text[index + 1] === '`') { index++; }
        else { inBackticks = false; }
      }
    } else if (inDoubleQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { index++; }
        else { inDoubleQuotes = false; }
      }
    } else if (character === '`') {
      inBackticks = true;
    } else if (character === '"') {
      inDoubleQuotes = true;
    } else if (character === '{') {
      return index;
    }
  }
  return -1;
}

function findClosingBrace(text: string, openingBrace: number): number {
  let depth = 1;
  let inBackticks = false;
  let inDoubleQuotes = false;
  for (let index = openingBrace + 1; index < text.length; index++) {
    const character = text[index];
    if (inBackticks) {
      if (character === '`') {
        if (text[index + 1] === '`') { index++; }
        else { inBackticks = false; }
      }
    } else if (inDoubleQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { index++; }
        else { inDoubleQuotes = false; }
      }
    } else if (character === '`') {
      inBackticks = true;
    } else if (character === '"') {
      inDoubleQuotes = true;
    } else if (character === '{') {
      depth++;
    } else if (character === '}' && --depth === 0) {
      return index;
    }
  }
  return text.length;
}

function findVariableDeclarationLine(
  documentText: string,
  dictionaryName: string,
  variableName: string,
): number | undefined {
  const text = stripLineComments(documentText);
  const dictionaryPattern = new RegExp(`\\bDictionary\\s+${identifierPattern}`, 'g');
  const typeAlt = KDIC_TYPES.join('|');
  const variablePattern = new RegExp(
    `(?:Unused\\s+)?(${typeAlt})(?:\\([^)]*\\))?\\s+${identifierPattern}(?:\\s*\\[[^\\]]*\\])?\\s*(?:=(?:"(?:[^"]|"")*"|[^;"])*)?;`,
    'g',
  );
  const lines: number[] = [];

  let dictionaryMatch: RegExpExecArray | null;
  while ((dictionaryMatch = dictionaryPattern.exec(text)) !== null) {
    if (isQuotedAt(text, dictionaryMatch.index)) { continue; }
    const blockName = decodeIdentifier(dictionaryMatch[1]);
    const openingBrace = findOpeningBrace(text, dictionaryPattern.lastIndex);
    if (openingBrace === -1) { break; }
    const closingBrace = findClosingBrace(text, openingBrace);
    dictionaryPattern.lastIndex = closingBrace + 1;

    if (blockName !== dictionaryName) { continue; }
    const blockStart = openingBrace + 1;
    const blockText = text.slice(blockStart, closingBrace);
    variablePattern.lastIndex = 0;
    let variableMatch: RegExpExecArray | null;
    while ((variableMatch = variablePattern.exec(blockText)) !== null) {
      if (decodeIdentifier(variableMatch[2]) !== variableName) { continue; }
      lines.push(text.slice(0, blockStart + variableMatch.index).split('\n').length - 1);
    }
  }

  return lines.length === 1 ? lines[0] : undefined;
}

function resolveErrorLine(message: string, documentText: string): number | undefined {
  const lineMatch = /\bLine\s+(\d+)\s*:\s*(.*)$/i.exec(message);
  if (lineMatch) { return Math.max(0, Number.parseInt(lineMatch[1], 10) - 1); }

  const dictionaryMatch = new RegExp(`\\bDictionary\\s+${identifierPattern}`, 'i').exec(message);
  const variableMatch = new RegExp(`\\bVariable\\s+${identifierPattern}`, 'i').exec(message);
  if (!dictionaryMatch || !variableMatch) { return undefined; }
  return findVariableDeclarationLine(
    documentText,
    decodeIdentifier(dictionaryMatch[1]),
    decodeIdentifier(variableMatch[1]),
  );
}

/** Parses native error lines and resolves each one to a source line when possible. */
export function parseKhiopsErrorLocations(output: string, documentText: string): KhiopsErrorLocation[] {
  const locations: KhiopsErrorLocation[] = [];
  const reWithLine = /error\s*:\s*.*?Line\s+(\d+)\s*:\s*(.+)$/gm;
  const reGeneral = /error\s*:\s*(.+)$/gm;
  const matched = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = reWithLine.exec(output)) !== null) {
    matched.add(match.index);
    locations.push({
      line: resolveErrorLine(`Line ${match[1]} : ${match[2]}`, documentText) ?? 0,
      message: match[2].trim(),
    });
  }

  while ((match = reGeneral.exec(output)) !== null) {
    if (matched.has(match.index)) { continue; }
    const message = match[1].trim();
    if (/Errors detected during parsing|Read cancelled/i.test(message)) { continue; }
    locations.push({
      line: resolveErrorLine(message, documentText) ?? 0,
      message,
    });
  }

  return locations;
}

/** Whether the selected diagnostic sources permit a native validation run. */
export function shouldRunNativeValidation(
  diagnosticSource: string,
  builtInDiagnostics: readonly { severity: number }[],
): boolean {
  if (diagnosticSource === 'khiops') { return true; }
  return diagnosticSource === 'both'
    && !builtInDiagnostics.some(diagnostic => diagnostic.severity === Severity.Error);
}

/** Whether a native result still belongs to the current, open document. */
export function isNativeValidationCurrent(
  runVersion: number,
  currentVersion: number,
  isClosed: boolean,
): boolean {
  return !isClosed && runVersion === currentVersion;
}
