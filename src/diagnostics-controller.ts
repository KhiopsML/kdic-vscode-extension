/**
 * Diagnostics for `.kdic` documents, from two sources:
 *
 *  - the built-in validator (collection `kdic`): while editing, debounced, on the editor text;
 *  - the native Khiops parser (collection `khiops`): after a save, when a Khiops
 *    binary is available and the built-in validator found no error.
 *
 * A file holding isolated carriage returns is not validated by the built-in
 * validator, because VS Code turns them into line breaks and the editor text no
 * longer matches the file (see carriage-returns.ts). Khiops still checks it.
 */
import * as vscode from 'vscode';
import { fileHasLoneCarriageReturn } from './carriage-returns';
import { DERIVATION_RULES } from './derivation-rules';
import { findKhiopsBinary, runKhiops, type KhiopsVersionCheck, type Trace } from './khiops-runner';
import { parseKhiopsErrorLocations } from './khiops-validation';
import { buildRuleMaps } from './rule-maps';
import { Severity, validate } from './validator';

const RULES = buildRuleMaps(DERIVATION_RULES);

/** Delay between the last keystroke and the built-in validation. */
const VALIDATE_DEBOUNCE_MS = 300;

const isKdic = (document: vscode.TextDocument): boolean => document.languageId === 'kdic';

const settings = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('kdic');

export class DiagnosticsController implements vscode.Disposable {
  private readonly builtIn = vscode.languages.createDiagnosticCollection('kdic');
  private readonly khiops = vscode.languages.createDiagnosticCollection('khiops');
  private readonly disposables: vscode.Disposable[] = [];

  /** The Khiops executable, or undefined when native validation is disabled or Khiops is not installed. */
  private khiopsPath: string | undefined;
  /** Khiops runs one document at a time: each run waits for the previous one. */
  private nativeQueue: Promise<void> = Promise.resolve();

  private readonly validateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly saveReasons = new Map<string, vscode.TextDocumentSaveReason>();
  /** Documents whose file holds isolated carriage returns: no built-in diagnostics for them. */
  private readonly withCarriageReturns = new Set<string>();
  /** Latest file check of each document, so that a slow, outdated check cannot overwrite a newer one. */
  private readonly fileChecks = new Map<string, number>();

  constructor(
    private readonly output: vscode.OutputChannel, private readonly trace: Trace,
    private readonly checkVersion: KhiopsVersionCheck,
  ) {
    if (this.debugTracesEnabled()) { this.output.show(true); }
    this.refreshKhiops();

    const workspace = vscode.workspace;
    this.disposables.push(
      this.builtIn, this.khiops,
      workspace.onWillSaveTextDocument(event => {
        if (isKdic(event.document)) { this.saveReasons.set(event.document.uri.toString(), event.reason); }
      }),
      workspace.onDidOpenTextDocument(document => { if (isKdic(document)) { void this.checkFile(document); } }),
      workspace.onDidChangeTextDocument(event => { if (isKdic(event.document)) { this.onChange(event); } }),
      workspace.onDidSaveTextDocument(document => { if (isKdic(document)) { void this.onSave(document); } }),
      workspace.onDidCloseTextDocument(document => this.onClose(document)),
      workspace.onDidChangeConfiguration(event => this.onConfigurationChange(event)),
    );
    this.checkOpenDocuments();
  }

  dispose(): void {
    this.khiopsPath = undefined;
    for (const timer of this.validateTimers.values()) { clearTimeout(timer); }
    this.disposables.forEach(disposable => disposable.dispose());
  }

  // ─────────────────────────── Settings ──────────────────────────────────────

  private debugTracesEnabled(): boolean {
    return settings().get<boolean>('enableDebugTraces', false);
  }

  /** Locates the Khiops binary according to the settings; without one, only built-in diagnostics remain. */
  private refreshKhiops(): void {
    const enabled = settings().get<boolean>('enableKhiopsValidation', true);
    this.khiopsPath = enabled ? findKhiopsBinary(settings().get<string>('khiopsPath', ''), this.trace) : undefined;
    this.trace(`[Khiops] Runtime config: enableKhiopsValidation=${enabled}, useKhiops=${Boolean(this.khiopsPath)}`);

    if (!this.khiopsPath) { this.khiops.clear(); }
    if (enabled && !this.khiopsPath) {
      void vscode.window.showWarningMessage(
        'Khiops binary not found. Using built-in validation. Set "kdic.khiopsPath" in settings.');
    }
  }

  private onConfigurationChange(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration('kdic.enableDebugTraces') && this.debugTracesEnabled()) {
      this.output.show(true);
      this.trace('[Khiops] Debug traces enabled');
    }
    if (event.affectsConfiguration('kdic.enableKhiopsValidation') || event.affectsConfiguration('kdic.khiopsPath')) {
      this.refreshKhiops();
    }
  }

  // ─────────────────────────── Built-in validation ───────────────────────────

  private checkOpenDocuments(): void {
    for (const document of vscode.workspace.textDocuments.filter(isKdic)) { void this.checkFile(document); }
  }

  /**
   * Looks for isolated carriage returns in the document's file, then validates the document
   * and returns its diagnostics (undefined if the document closed or a newer check took over).
   * Done when the document opens, is saved, or has its content replaced from disk: the only
   * times the file can differ from what was last checked.
   */
  private async checkFile(document: vscode.TextDocument): Promise<vscode.Diagnostic[] | undefined> {
    const key = document.uri.toString();
    const check = (this.fileChecks.get(key) ?? 0) + 1;
    this.fileChecks.set(key, check);

    const found = await fileHasLoneCarriageReturn(document.uri);
    if (document.isClosed || this.fileChecks.get(key) !== check) { return undefined; }
    if (found) {
      this.trace(`[Khiops] Isolated carriage returns in ${document.fileName}: built-in validation is off for it`);
      this.withCarriageReturns.add(key);
    } else {
      this.withCarriageReturns.delete(key);
    }
    return this.validateBuiltIn(document);
  }

  /**
   * Publishes the built-in diagnostics of a document and returns them.
   * A document whose file holds isolated carriage returns gets none.
   */
  private validateBuiltIn(document: vscode.TextDocument): vscode.Diagnostic[] {
    if (this.withCarriageReturns.has(document.uri.toString())) {
      this.builtIn.delete(document.uri);
      return [];
    }
    // The line being typed on may legitimately lack its `;`.
    const editor = vscode.window.activeTextEditor;
    const cursorLine = editor?.document === document ? editor.selection.active.line : undefined;

    const diagnostics = validate(document, RULES, cursorLine).map(found => {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(found.line, found.col, found.line, found.endCol),
        found.message,
        found.severity === Severity.Error ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = 'kdic';
      return diagnostic;
    });
    this.builtIn.set(document.uri, diagnostics);
    return diagnostics;
  }

  private onChange(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    const key = document.uri.toString();

    // A change that leaves the document clean replaces its content from disk (reload, revert, undo to the saved state).
    if (event.contentChanges.length > 0 && !document.isDirty) { void this.checkFile(document); }

    clearTimeout(this.validateTimers.get(key));
    this.validateTimers.set(key, setTimeout(() => {
      this.validateTimers.delete(key);
      this.validateBuiltIn(document);
    }, VALIDATE_DEBOUNCE_MS));
  }

  // ─────────────────────────── Native Khiops validation ──────────────────────

  /**
   * After a save the file is read again before built-in validation is trusted (VS Code rewrote
   * it with ordinary line breaks). Khiops then runs, unless this save is skipped, the document
   * was edited meanwhile, or the built-in validator found errors.
   */
  private async onSave(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const reason = this.saveReasons.get(key);
    this.saveReasons.delete(key);
    const savedVersion = document.version;

    const diagnostics = await this.checkFile(document);
    if (!diagnostics) { return; }

    // Auto-saves can be excluded for very large files. A save with no recorded reason always runs.
    const skipped = !settings().get<boolean>('runKhiopsOnAutoSave', true)
      && reason !== undefined && reason !== vscode.TextDocumentSaveReason.Manual;
    if (skipped) {
      this.trace(`[Khiops] Skip non-manual save (reason=${reason}) for: ${document.fileName}`);
    } else if (document.version === savedVersion) {
      this.runNativeIfClean(document, diagnostics);
    }
  }

  /** Runs Khiops unless the built-in validator already found errors, which Khiops would only repeat. */
  private runNativeIfClean(document: vscode.TextDocument, builtInDiagnostics: readonly vscode.Diagnostic[]): void {
    if (!this.khiopsPath || document.uri.scheme !== 'file') {
      this.khiops.delete(document.uri);
      return;
    }
    if (builtInDiagnostics.some(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error)) {
      this.trace(`[Khiops] Skipped: built-in validation found errors for ${document.fileName}`);
      this.khiops.delete(document.uri);
      return;
    }
    this.trace(`[Khiops] onDidSave: ${document.fileName}`);
    this.runNative(document, this.khiopsPath);
  }

  /** Queues a Khiops run; its result is published only if the document is still open and unchanged. */
  private runNative(document: vscode.TextDocument, binary: string): void {
    const version = document.version;
    const text = document.getText();
    const isCurrent = (): boolean => !document.isClosed && document.version === version && this.khiopsPath === binary;

    this.nativeQueue = this.nativeQueue.then(async () => {
      if (!isCurrent()) { return; }
      await this.checkVersion(binary);
      if (!isCurrent()) { return; }
      const output = await runKhiops(binary, document.uri.fsPath, this.trace);
      if (output === undefined) { return; }

      const diagnostics = parseKhiopsErrorLocations(output, text).map(({ line, message }) => {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'khiops';
        return diagnostic;
      });
      this.trace(`[Khiops] Parsed ${diagnostics.length} diagnostic(s)`);
      if (isCurrent()) { this.khiops.set(document.uri, diagnostics); }
    }).catch(error => this.trace(`[Khiops] Validation failed: ${error}`));
  }

  private onClose(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.validateTimers.get(key));
    this.validateTimers.delete(key);
    this.saveReasons.delete(key);
    this.withCarriageReturns.delete(key);
    this.fileChecks.delete(key);
    this.builtIn.delete(document.uri);
    this.khiops.delete(document.uri);
  }
}
