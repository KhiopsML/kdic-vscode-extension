import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { KdicDocumentMirror, type TextChange } from './kdic-document-mirror';

interface PendingChange {
  changes: readonly TextChange[];
  model: string;
  eol: string;
  version: number;
}

interface DocumentState {
  document: vscode.TextDocument;
  mirror?: KdicDocumentMirror;
  version: number;
  encoding?: string;
  pending: PendingChange[];
  watcher?: vscode.FileSystemWatcher;
  refreshTimer?: ReturnType<typeof setTimeout>;
  diskPending?: boolean;
}

/** Returns the line-ending sequence used by the editor model. */
function documentEol(document: vscode.TextDocument): string {
  return document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

/** Decodes source bytes using VS Code's decoder or a compatible encoding and BOM fallback. */
async function decodeSource(bytes: Uint8Array, document: vscode.TextDocument): Promise<string> {
  if (typeof vscode.workspace.decode === 'function') {
    return document.encoding
      ? vscode.workspace.decode(bytes, { encoding: document.encoding })
      : vscode.workspace.decode(bytes, { uri: document.uri });
  }
  const configured = vscode.workspace.getConfiguration('files', document.uri).get<string>('encoding', 'utf8');
  const encoding = document.encoding || configured;
  const labels: Record<string, string> = {
    utf8: 'utf-8', utf8bom: 'utf-8', utf16le: 'utf-16le', utf16be: 'utf-16be',
    shiftjis: 'shift_jis', eucjp: 'euc-jp', euckr: 'euc-kr',
    koi8r: 'koi8-r', koi8u: 'koi8-u', macroman: 'x-mac-roman',
  };
  let label = labels[encoding] ?? encoding.replace(/^windows(\d+)$/, 'windows-$1').replace(/^iso8859(\d+)$/, 'iso-8859-$1');
  if (!document.encoding && bytes[0] === 0xff && bytes[1] === 0xfe) { label = 'utf-16le'; }
  else if (!document.encoding && bytes[0] === 0xfe && bytes[1] === 0xff) { label = 'utf-16be'; }
  else if (!document.encoding && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { label = 'utf-8'; }
  return new TextDecoder(label).decode(bytes);
}

export class KdicEditorDocuments implements vscode.Disposable {
  private readonly states = new Map<string, DocumentState>();
  private readonly warned = new Set<string>();

  /** Calls onReady whenever a document's usable mirror or availability changes. */
  constructor(private readonly onReady: (document: vscode.TextDocument) => void) {}

  /** Returns the current mirror only if its version and disk state are current. */
  get(document: vscode.TextDocument): KdicDocumentMirror | undefined {
    const state = this.states.get(document.uri.toString());
    return state?.version === document.version && !state.diskPending ? state.mirror : undefined;
  }

  /** Starts tracking a document, its source file and subsequent external changes. */
  open(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    if (this.states.has(key)) { return; }
    const state: DocumentState = { document, version: document.version, encoding: document.encoding, pending: [] };
    this.states.set(key, state);
    if (document.uri.scheme === 'untitled') {
      state.mirror = KdicDocumentMirror.create(document.getText(), document.getText(), documentEol(document));
      this.onReady(document);
      return;
    }

    try {
      const parent = vscode.Uri.joinPath(document.uri, '..');
      state.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(parent, '*'));
    } catch (error) {
      this.fallback(state, error);
      return;
    }
    /** Debounces changes to this clean document's file before refreshing its source. */
    const onDiskChange = (uri: vscode.Uri): void => {
      if (uri.toString() !== key || document.isDirty || this.states.get(key) !== state) { return; }
      if (state.refreshTimer) { clearTimeout(state.refreshTimer); }
      state.diskPending = true;
      this.onReady(document);
      state.refreshTimer = setTimeout(() => {
        state.refreshTimer = undefined;
        if (this.states.get(key) === state && !document.isDirty) { this.refresh(document); }
        else if (this.states.get(key) === state) {
          state.diskPending = false;
          this.onReady(document);
        }
      }, 300);
    };
    state.watcher.onDidChange(onDiskChange);
    state.watcher.onDidCreate(onDiskChange);
    state.watcher.onDidDelete(onDiskChange);
    this.load(state);
  }

  /** Reads the source asynchronously and replays edits made while the read was pending. */
  private load(state: DocumentState): void {
    const document = state.document;
    const key = document.uri.toString();
    const initialModel = document.getText();
    const initialEol = documentEol(document);
    state.version = document.version;
    state.pending = [];
    state.mirror = undefined;

    void (async () => {
      let mirror: KdicDocumentMirror | undefined;
      try {
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        const source = await decodeSource(bytes, document);
        if (this.states.get(key) !== state) { return; }
        mirror = KdicDocumentMirror.create(source, initialModel, initialEol);
        for (const change of state.pending) {
          mirror = mirror?.applyChanges(change.changes, change.model, change.eol);
        }
        if (!mirror || state.version !== document.version) {
          throw new Error('The saved source does not match the editor document.');
        }
      } catch (error) {
        if (this.states.get(key) !== state) { return; }
        this.fallback(state, error);
        return;
      }
      state.mirror = mirror;
      state.pending = [];
      this.warned.delete(key);
      this.onReady(document);
    })();
  }

  /** Warns once per document and falls back to the editor text when reconciliation fails. */
  private fallback(state: DocumentState, error: unknown): void {
    const document = state.document;
    const key = document.uri.toString();
    const detail = error instanceof Error ? error.message : String(error);
    if (!this.warned.has(key)) {
      this.warned.add(key);
      void vscode.window.showWarningMessage(`KDIC source reconciliation failed for ${document.uri.toString()}: ${detail} Validation uses editor text and may report incorrect diagnostics.`);
    }
    state.version = document.version;
    state.pending = [];
    state.mirror = KdicDocumentMirror.create(document.getText(), document.getText(), documentEol(document));
    this.onReady(document);
  }

  /** Applies or queues editor changes, refreshing when disk state or encoding requires it. */
  change(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    const state = this.states.get(document.uri.toString());
    if (!state) { this.open(document); return; }
    if (state.encoding !== document.encoding) {
      this.refresh(document);
      return;
    }
    if (state.diskPending && !document.isDirty) {
      this.refresh(document);
      return;
    }
    if (state.diskPending) {
      if (state.refreshTimer) { clearTimeout(state.refreshTimer); }
      state.refreshTimer = undefined;
      state.diskPending = false;
    }
    const change: PendingChange = {
      changes: event.contentChanges.map(({ rangeOffset, rangeLength, text }) => ({ rangeOffset, rangeLength, text })),
      model: document.getText(), eol: documentEol(document), version: document.version,
    };
    state.version = change.version;
    if (!state.mirror) {
      state.pending.push(change);
      return;
    }
    const updated = state.mirror.applyChanges(change.changes, change.model, change.eol);
    if (!updated) {
      this.fallback(state, new Error('Editor changes could not be reconciled with the source.'));
      return;
    }
    state.mirror = updated;
  }

  /** Replaces a document's tracking state and reloads its current source. */
  refresh(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const previous = this.states.get(key);
    if (previous?.refreshTimer) { clearTimeout(previous.refreshTimer); }
    previous?.watcher?.dispose();
    this.states.delete(key);
    this.open(document);
  }

  /** Stops tracking a document and releases its watcher and pending refresh. */
  close(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const state = this.states.get(key);
    if (state?.refreshTimer) { clearTimeout(state.refreshTimer); }
    state?.watcher?.dispose();
    this.states.delete(key);
    this.warned.delete(key);
  }

  /** Releases all document watchers, timers and tracking state. */
  dispose(): void {
    for (const state of this.states.values()) {
      if (state.refreshTimer) { clearTimeout(state.refreshTimer); }
      state.watcher?.dispose();
    }
    this.states.clear();
    this.warned.clear();
  }
}
