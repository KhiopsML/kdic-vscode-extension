/**
 * Detecting files that contain isolated carriage returns.
 *
 * In a KDIC file a lone `\r` (one that is not followed by `\n`) is not a line
 * break: it can sit inside quoted text. VS Code, however, turns every `\r` into
 * a line break in the editor, so the text the extension sees no longer matches
 * the file and a quoted value appears to be cut in two. Built-in validation
 * cannot be trusted on such a file; native Khiops reads the real bytes.
 */
import * as vscode from 'vscode';

const LONE_CARRIAGE_RETURN = /\r(?!\n)/;

/**
 * Whether file content holds a carriage return that is not part of a `\r\n` pair.
 *
 * UTF-16 files (recognized by their byte-order mark) are decoded first. For every
 * other encoding the bytes are searched as they are: `\r` is a single byte in all
 * ASCII-compatible encodings, UTF-8 included.
 */
export function hasLoneCarriageReturn(bytes: Uint8Array): boolean {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { text = new TextDecoder('utf-16le').decode(bytes); }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { text = new TextDecoder('utf-16be').decode(bytes); }
  else { text = Buffer.from(bytes).toString('latin1'); }
  return LONE_CARRIAGE_RETURN.test(text);
}

/** Whether the file behind `uri` holds an isolated carriage return. A file that cannot be read has none. */
export async function fileHasLoneCarriageReturn(uri: vscode.Uri): Promise<boolean> {
  if (uri.scheme === 'untitled') { return false; }
  try {
    return hasLoneCarriageReturn(await vscode.workspace.fs.readFile(uri));
  } catch {
    return false;
  }
}
