import type { KdicToken } from '../kdic-lexer';

/** Minimal document interface, satisfied by vscode.TextDocument, `KdicTextDocument` and test mocks. */
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

/** A plain diagnostic with no VS Code dependency. Columns are zero-based and the range is on one line. */
export interface KdicDiagnostic {
  line: number;
  col: number;
  endCol: number;
  severity: Severity;
  message: string;
}

/** Accumulates diagnostics, converting source offsets to line/column positions. */
export class DiagnosticCollector {
  readonly diagnostics: KdicDiagnostic[] = [];

  constructor(readonly document: KdicDocument) {}

  /** Reports `length` characters starting at a source offset. */
  at(offset: number, length: number, message: string, severity: Severity = Severity.Error): void {
    const { line, character } = this.document.positionAt(offset);
    this.diagnostics.push({ line, col: character, endCol: character + length, severity, message });
  }

  /** Reports a whole token. */
  atToken(token: KdicToken, message: string, severity: Severity = Severity.Error): void {
    this.at(token.start, token.text.length, message, severity);
  }

  /** Reports a column range of a line. */
  atLine(line: number, col: number, endCol: number, message: string, severity: Severity = Severity.Error): void {
    this.diagnostics.push({ line, col, endCol, severity, message });
  }

  /** Zero-based line of a source offset. */
  lineOf(offset: number): number {
    return this.document.positionAt(offset).line;
  }
}
