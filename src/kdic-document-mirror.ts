import type { KdicDocument } from './validator';

export interface TextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

interface OffsetChange {
  sourceStart: number;
  sourceEnd: number;
  modelStart: number;
  modelEnd: number;
  deltaAfter: number;
}

export class KdicDocumentMirror implements KdicDocument {
  private readonly lines: string[];
  private readonly lineStarts: number[];
  private readonly changes: OffsetChange[] = [];

  /** Builds source line indexes and offset adjustments for normalized editor line endings. */
  private constructor(private readonly source: string, private readonly modelEol: string) {
    const lines = source.split('\n');
    this.lines = lines.map((line, index) => index < lines.length - 1 && line.endsWith('\r') ? line.slice(0, -1) : line);
    this.lineStarts = [0];
    for (let index = 0; index < source.length; index++) {
      if (source[index] === '\n') { this.lineStarts.push(index + 1); }
    }

    let delta = 0;
    for (let index = 0; index < source.length; index++) {
      if (source[index] !== '\r' && source[index] !== '\n') { continue; }
      const sourceStart = index;
      if (source[index] === '\r' && source[index + 1] === '\n') { index++; }
      const sourceEnd = index + 1;
      const deltaAfter = delta + modelEol.length - (sourceEnd - sourceStart);
      if (deltaAfter !== delta) {
        this.changes.push({
          sourceStart, sourceEnd, modelStart: sourceStart + delta,
          modelEnd: sourceStart + delta + modelEol.length,
          deltaAfter,
        });
      }
      delta = deltaAfter;
    }
  }

  /** Creates a mirror only when normalizing source line endings reproduces the editor model. */
  static create(source: string, model: string, modelEol: string): KdicDocumentMirror | undefined {
    if (source.replace(/\r\n|\r|\n/g, modelEol) !== model) { return undefined; }
    return new KdicDocumentMirror(source, modelEol);
  }

  /** Returns the original, unnormalized source text. */
  getText(): string { return this.source; }
  /** Returns the number of source lines, split on line feeds. */
  get lineCount(): number { return this.lines.length; }
  /** Returns a source line without its trailing CRLF or LF terminator. */
  lineAt(line: number): { text: string } { return { text: this.lines[line] }; }

  /** Converts a source offset to a zero-based line and character position. */
  positionAt(offset: number): { line: number; character: number } {
    let low = 0, high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.lineStarts[mid] <= offset) { low = mid; } else { high = mid - 1; }
    }
    return { line: low, character: offset - this.lineStarts[low] };
  }

  /** Converts a source line and character position to an offset. */
  offsetAt(line: number, character: number): number {
    return this.lineStarts[line] + character;
  }

  /** Translates an offset between source and model, accounting for normalized line endings. */
  private translate(offset: number, toModel: boolean): number {
    let low = 0, high = this.changes.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const start = toModel ? this.changes[mid].sourceStart : this.changes[mid].modelStart;
      if (start < offset) { low = mid + 1; } else { high = mid; }
    }
    if (low === 0) { return offset; }
    const change = this.changes[low - 1];
    const start = toModel ? change.sourceStart : change.modelStart;
    const end = toModel ? change.sourceEnd : change.modelEnd;
    if (offset < end) {
      const targetStart = toModel ? change.modelStart : change.sourceStart;
      const targetEnd = toModel ? change.modelEnd : change.sourceEnd;
      return Math.min(targetStart + offset - start, targetEnd);
    }
    return offset + (toModel ? change.deltaAfter : -change.deltaAfter);
  }

  /** Converts a source offset to an editor-model offset. */
  modelOffsetAt(sourceOffset: number): number { return this.translate(sourceOffset, true); }
  /** Converts an editor-model offset to a source offset. */
  sourceOffsetAt(modelOffset: number): number { return this.translate(modelOffset, false); }

  /** Applies editor changes to the source and rejects the result if it does not match the model. */
  applyChanges(changes: readonly TextChange[], model: string, modelEol: string): KdicDocumentMirror | undefined {
    let source = this.source;
    const translated = changes.map(change => ({
      start: this.sourceOffsetAt(change.rangeOffset),
      end: this.sourceOffsetAt(change.rangeOffset + change.rangeLength),
      text: change.text,
    })).sort((a, b) => b.start - a.start);
    for (const change of translated) {
      source = source.slice(0, change.start) + change.text + source.slice(change.end);
    }
    return KdicDocumentMirror.create(source, model, modelEol);
  }
}
