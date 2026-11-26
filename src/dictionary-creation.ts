import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { createDictionary, dictionaryPathFor } from './dictionary-builder';
import { findKhiopsBinary, type KhiopsVersionCheck, type Trace } from './khiops-runner';

interface HeaderChoice extends vscode.QuickPickItem {
  headerLineUsed: boolean;
}

const HEADER_CHOICES: HeaderChoice[] = [
  { label: 'With header', description: 'The first line contains column names.', headerLineUsed: true },
  { label: 'Without header', description: 'The first line contains data.', headerLineUsed: false },
];

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function sourceUri(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri) { return uri; }
  if (vscode.window.activeTextEditor) { return vscode.window.activeTextEditor.document.uri; }
  return (await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false }))?.[0];
}

async function destinationExists(destination: string): Promise<boolean> {
  try {
    await fs.promises.lstat(destination);
    return true;
  } catch (error) {
    if (isMissing(error)) { return false; }
    throw error;
  }
}

async function createFromFile(
  uri: vscode.Uri | undefined, output: vscode.OutputChannel, trace: Trace, checkVersion: KhiopsVersionCheck,
): Promise<void> {
  const source = await sourceUri(uri);
  if (!source) { return; }
  if (source.scheme !== 'file' || path.extname(source.fsPath).toLowerCase() === '.kdic') {
    await vscode.window.showErrorMessage('Select a local data file other than a .kdic file.');
    return;
  }

  try {
    const stat = await fs.promises.stat(source.fsPath);
    if (!stat.isFile()) {
      await vscode.window.showErrorMessage('Select a local data file, not a folder.');
      return;
    }
  } catch (error) {
    if (!isMissing(error)) {
      await vscode.window.showErrorMessage(`Cannot access ${source.fsPath}: ${String(error)}`);
      return;
    }
  }

  const destination = dictionaryPathFor(source.fsPath);
  if (/[\r\n]/.test(source.fsPath) || /[\r\n]/.test(destination)) {
    await vscode.window.showErrorMessage('Paths containing a carriage return or line feed cannot be used in a Khiops scenario.');
    return;
  }

  const binary = findKhiopsBinary(vscode.workspace.getConfiguration('kdic', source).get<string>('khiopsPath', ''), trace);
  if (!binary) {
    const choice = await vscode.window.showErrorMessage(
      'Khiops was not found. Install Khiops or set "kdic.khiopsPath" to its executable.', 'Open Settings');
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'kdic.khiopsPath');
    }
    return;
  }

  const header = await vscode.window.showQuickPick(HEADER_CHOICES, {
    title: 'Does the data file have a header?',
    placeHolder: 'Choose how Khiops should interpret the first line',
  });
  if (!header) { return; }

  if (await destinationExists(destination)) {
    const choice = await vscode.window.showWarningMessage(
      `Replace the existing dictionary ${destination}?`, { modal: true }, 'Replace');
    if (choice !== 'Replace') { return; }
  }

  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Creating dictionary from ${path.basename(source.fsPath)}`,
    cancellable: false,
  }, async () => {
    await checkVersion(binary);
    return createDictionary(binary, source.fsPath, destination, header.headerLineUsed, trace);
  });

  if (!result.ok) {
    output.appendLine(`[Khiops] Dictionary creation failed for ${source.fsPath}:`);
    output.appendLine(result.output || result.reason || 'No output captured.');
    const extra = result.errors.length > 1 ? ` (${result.errors.length - 1} more in the output)` : '';
    const message = result.errors.length
      ? `Khiops could not create the dictionary: ${result.errors[0]}${extra}`
      : `Khiops could not create the dictionary: ${result.reason ?? 'Unknown failure'}`;
    if (await vscode.window.showErrorMessage(message, 'Show Output') === 'Show Output') { output.show(); }
    return;
  }

  if (result.reason) { await vscode.window.showWarningMessage(result.reason); }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(destination));
  await vscode.window.showTextDocument(document);
}

/** Registers the user-initiated dictionary creation command. */
export function registerDictionaryCreation(
  context: vscode.ExtensionContext, output: vscode.OutputChannel, trace: Trace, checkVersion: KhiopsVersionCheck,
): void {
  context.subscriptions.push(vscode.commands.registerCommand('kdic.createDictionaryFromFile', async (uri?: vscode.Uri) => {
    try {
      await createFromFile(uri, output, trace, checkVersion);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[Khiops] Dictionary creation failed: ${message}`);
      if (await vscode.window.showErrorMessage(`Dictionary creation failed: ${message}`, 'Show Output') === 'Show Output') {
        output.show();
      }
    }
  }));
}
