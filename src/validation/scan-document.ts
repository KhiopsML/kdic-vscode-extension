/** Reading a document for what it declares, without checking it: for the code that is not a validation. */
import { tokenizeKdic, type KdicToken } from '../kdic-lexer';
import { KdicTextDocument } from '../kdic-text-document';
import { DiagnosticCollector } from './diagnostics';
import { scanMetadata } from './metadata';
import { scanStructure, type Structure } from './structure';

/** A document read for what it declares: its line index, its tokens (comments left out) and its structure. */
export interface ScannedDocument {
  document: KdicTextDocument;
  tokens: KdicToken[];
  structure: Structure;
}

/** Reads a document without checking it: what the scan would report is dropped. */
export function scanDocument(text: string): ScannedDocument {
  const document = new KdicTextDocument(text);
  const ignored = new DiagnosticCollector(document);
  const tokens = tokenizeKdic(text).filter(token => token.kind !== 'comment');
  return { document, tokens, structure: scanStructure(tokens, scanMetadata(tokens, ignored), ignored, undefined) };
}
