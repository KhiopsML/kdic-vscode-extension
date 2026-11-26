/**
 * Khiops Dictionary (.kdic) VS Code extension.
 *
 * Language support for Khiops dictionary files
 * (grammar reference: https://khiops.org/api-docs/kdic/dictionary-files/):
 *
 *  - syntax highlighting and snippets: declarative, in `syntaxes/` and `snippets/`;
 *  - completion and hover: `language-features.ts`;
 *  - diagnostics, built-in and native Khiops: `diagnostics-controller.ts`;
 *  - dictionary creation from data files: `dictionary-creation.ts`.
 *
 * Data and logic that need no VS Code API live in their own modules so they can be
 * tested and run from the command line: `derivation-rules.ts`, `language-data.ts`,
 * `validator.ts`, `khiops-runner.ts`, `khiops-validation.ts`.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { DiagnosticsController } from './diagnostics-controller';
import { registerDictionaryCreation } from './dictionary-creation';
import { registerLanguageFeatures } from './language-features';
import { KHIOPS_REFERENCE_VERSION, readKhiopsVersion, type KhiopsVersionCheck } from './khiops-runner';

/** Registers the language features and the diagnostics of `.kdic` documents. */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Khiops');
  const trace = (message: string): void => {
    if (vscode.workspace.getConfiguration('kdic').get<boolean>('enableDebugTraces', false)) {
      output.appendLine(message);
    }
  };
  const versionChecks = new Map<string, Promise<void>>();
  const checkVersion: KhiopsVersionCheck = binary => {
    const key = path.resolve(binary);
    let pending = versionChecks.get(key);
    if (!pending) {
      pending = readKhiopsVersion(binary, trace).then(result => {
        if (result.ok && result.version === KHIOPS_REFERENCE_VERSION) { return; }
        const message = result.ok
          ? `Khiops ${result.version} differs from the extension's reference version ${KHIOPS_REFERENCE_VERSION}. `
            + 'Built-in language support follows the reference documentation. The requested operation will continue.'
          : 'The Khiops version could not be determined. The requested operation will continue.';
        output.appendLine(`[Khiops] ${binary}: ${message}`);
        if (!result.ok) {
          output.appendLine(result.reason);
          output.appendLine(result.output || 'No version output captured.');
        }
        void vscode.window.showWarningMessage(message, 'Show Output').then(choice => {
          if (choice === 'Show Output') { output.show(); }
        }, error => output.appendLine(`[Khiops] Unable to show version warning: ${String(error)}`));
      });
      versionChecks.set(key, pending);
    }
    return pending;
  };
  registerLanguageFeatures(context);
  context.subscriptions.push(output, new DiagnosticsController(output, trace, checkVersion));
  registerDictionaryCreation(context, output, trace, checkVersion);
}

/** Registered disposables are released by VS Code; nothing else to clean up. */
export function deactivate(): void {}
