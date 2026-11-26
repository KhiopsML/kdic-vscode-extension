/**
 * What the features that run Khiops share: the `Khiops` output channel, debug traces, the version
 * check, and how a failure is shown to the user.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type { Trace } from './khiops-runner';
import { readKhiopsVersion, versionWarning, type KhiopsVersionCheck } from './khiops-version';

export interface KhiopsServices {
  /** The `Khiops` output channel, which holds the traces and the output of failed runs. */
  output: vscode.OutputChannel;
  /** Writes to the output channel when `kdic.enableDebugTraces` is on. */
  trace: Trace;
  /** Warns, once per executable, when its version is not the reference one. It never blocks the operation. */
  checkVersion: KhiopsVersionCheck;
}

/** Creates the output channel and the services built on it; the caller disposes the channel. */
export function createKhiopsServices(): KhiopsServices {
  const output = vscode.window.createOutputChannel('Khiops');
  const trace: Trace = message => {
    if (vscode.workspace.getConfiguration('kdic').get<boolean>('enableDebugTraces', false)) {
      output.appendLine(message);
    }
  };
  return { output, trace, checkVersion: createVersionCheck(output, trace) };
}

/** Shows an error message with a button that opens the output channel. */
export async function showErrorWithOutput({ output }: KhiopsServices, message: string): Promise<void> {
  if (await vscode.window.showErrorMessage(message, 'Show Output') === 'Show Output') { output.show(); }
}

/** A version check that reads each executable's version once, however many operations ask for it at the same time. */
function createVersionCheck(output: vscode.OutputChannel, trace: Trace): KhiopsVersionCheck {
  const checks = new Map<string, Promise<void>>();

  const check = async (binary: string): Promise<void> => {
    const result = await readKhiopsVersion(binary, trace);
    const warning = versionWarning(result);
    if (!warning) { return; }

    output.appendLine(`[Khiops] ${binary}: ${warning}`);
    if (!result.ok) {
      output.appendLine(result.reason);
      output.appendLine(result.output || 'No version output captured.');
    }
    // The warning is not awaited: the operation goes on while it is displayed.
    void vscode.window.showWarningMessage(warning, 'Show Output').then(choice => {
      if (choice === 'Show Output') { output.show(); }
    }, error => output.appendLine(`[Khiops] Unable to show version warning: ${String(error)}`));
  };

  return binary => {
    const key = path.resolve(binary);
    if (!checks.has(key)) { checks.set(key, check(binary)); }
    return checks.get(key)!;
  };
}
