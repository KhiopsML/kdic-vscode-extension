import type { KdicDocument } from './validation/diagnostics';

/**
 * A KDIC source text with a line index: the plain implementation of `KdicDocument`.
 *
 * Lines are split on `\n` only, so a lone `\r` stays inside its line (it can be
 * part of quoted text), and the `\r` of a `\r\n` pair is not part of the line.
 */
export class KdicTextDocument implements KdicDocument {
  private readonly lines: string[];
  private readonly lineStarts: number[] = [0];

  constructor(private readonly source: string) {
    const rawLines = source.split('\n');
    this.lines = rawLines.map((line, index) =>
      index < rawLines.length - 1 && line.endsWith('\r') ? line.slice(0, -1) : line);
    for (let index = 0; index < source.length; index++) {
      if (source[index] === '\n') { this.lineStarts.push(index + 1); }
    }
  }

  getText(): string { return this.source; }

  get lineCount(): number { return this.lines.length; }

  /** Returns a line without its `\n` or `\r\n` terminator. */
  lineAt(line: number): { text: string } { return { text: this.lines[line] }; }

  /** Converts an offset to a zero-based line and character position (binary search on line starts). */
  positionAt(offset: number): { line: number; character: number } {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.lineStarts[mid] <= offset) { low = mid; } else { high = mid - 1; }
    }
    return { line: low, character: offset - this.lineStarts[low] };
  }
}
