/**
 * The command "Create Khiops Dictionary from This File": every user interaction (the file, the header
 * option, the replacement of an existing dictionary, progress and errors). `dictionary-builder.ts`
 * builds the dictionary.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { createDictionary, dictionaryPathFor, scenarioPathProblem, type DictionaryCreationResult } from './dictionary-builder';
import { findKhiopsBinary } from './khiops-runner';
import { showErrorWithOutput, type KhiopsServices } from './khiops-services';

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

/** The data file: the one the menu gives, else the active editor's, else the one the user picks. */
async function sourceUri(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri) { return uri; }
  if (vscode.window.activeTextEditor) { return vscode.window.activeTextEditor.document.uri; }
  return (await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false }))?.[0];
}

/** Whether `source` is a local data file that can be used; if not, tells the user why. */
async function isUsableSource(source: vscode.Uri): Promise<boolean> {
  if (source.scheme !== 'file' || path.extname(source.fsPath).toLowerCase() === '.kdic') {
    await vscode.window.showErrorMessage('Select a local data file other than a .kdic file.');
    return false;
  }
  try {
    if (!(await fs.promises.stat(source.fsPath)).isFile()) {
      await vscode.window.showErrorMessage('Select a local data file, not a folder.');
      return false;
    }
  } catch (error) {
    // A file that does not exist is left to Khiops, which reports it.
    if (!isMissing(error)) {
      await vscode.window.showErrorMessage(`Cannot access ${source.fsPath}: ${String(error)}`);
      return false;
    }
  }
  return true;
}

/** The Khiops executable, or undefined, after telling the user how to set one, when there is none. */
async function findBinary(source: vscode.Uri, { trace }: KhiopsServices): Promise<string | undefined> {
  const binary = findKhiopsBinary(vscode.workspace.getConfiguration('kdic', source).get<string>('khiopsPath', ''), trace);
  if (!binary) {
    const choice = await vscode.window.showErrorMessage(
      'Khiops was not found. Install Khiops or set "kdic.khiopsPath" to its executable.', 'Open Settings');
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'kdic.khiopsPath');
    }
  }
  return binary;
}

/** Whether something, even a broken link, is at `target`. Any error other than "not found" is thrown. */
async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.lstat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) { return false; }
    throw error;
  }
}

/** Whether the destination can be written: it is free, or the user agrees to replace it. */
async function confirmDestination(destination: string): Promise<boolean> {
  if (!await pathExists(destination)) { return true; }
  const choice = await vscode.window.showWarningMessage(
    `Replace the existing dictionary ${destination}?`, { modal: true }, 'Replace');
  return choice === 'Replace';
}

/** Tells the user why the creation failed, with the first Khiops error, and logs the whole Khiops output. */
async function reportFailure(
  source: string, failure: Extract<DictionaryCreationResult, { ok: false }>, services: KhiopsServices,
): Promise<void> {
  services.output.appendLine(`[Khiops] Dictionary creation failed for ${source}:`);
  services.output.appendLine(failure.output || failure.reason);

  const [first, ...others] = failure.errors;
  const detail = first === undefined ? failure.reason
    : others.length ? `${first} (${others.length} more in the output)` : first;
  await showErrorWithOutput(services, `Khiops could not create the dictionary: ${detail}`);
}

/** The whole command, from the choice of the data file to the opening of the new dictionary. */
async function createFromFile(uri: vscode.Uri | undefined, services: KhiopsServices): Promise<void> {
  const source = await sourceUri(uri);
  if (!source || !await isUsableSource(source)) { return; }

  const destination = dictionaryPathFor(source.fsPath);
  const pathProblem = scenarioPathProblem(source.fsPath, destination);
  if (pathProblem) {
    await vscode.window.showErrorMessage(pathProblem);
    return;
  }

  const binary = await findBinary(source, services);
  if (!binary) { return; }

  const header = await vscode.window.showQuickPick(HEADER_CHOICES, {
    title: 'Does the data file have a header?',
    placeHolder: 'Choose how Khiops should interpret the first line',
  });
  if (!header || !await confirmDestination(destination)) { return; }

  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Creating dictionary from ${path.basename(source.fsPath)}`,
    cancellable: false,
  }, async () => {
    await services.checkVersion(binary);
    return createDictionary(binary, source.fsPath, destination, header.headerLineUsed, services.trace);
  });
  if (!result.ok) {
    await reportFailure(source.fsPath, result, services);
    return;
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(destination));
  await vscode.window.showTextDocument(document);
}

/** Registers the user-initiated dictionary creation command. */
export function registerDictionaryCreation(context: vscode.ExtensionContext, services: KhiopsServices): void {
  context.subscriptions.push(vscode.commands.registerCommand('kdic.createDictionaryFromFile', async (uri?: vscode.Uri) => {
    try {
      await createFromFile(uri, services);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      services.output.appendLine(`[Khiops] Dictionary creation failed: ${message}`);
      await showErrorWithOutput(services, `Dictionary creation failed: ${message}`);
    }
  }));
}
