/**
 * Khiops Dictionary (.kdic) VS Code extension.
 *
 * Language support for Khiops dictionary files
 * (grammar reference: https://khiops.org/api-docs/kdic/dictionary-files/):
 *
 *  - syntax highlighting and snippets: declarative, in `syntaxes/` and `snippets/`;
 *  - completion and hover: `language-features.ts`;
 *  - diagnostics, built-in and native Khiops: `diagnostics-controller.ts`;
 *  - dictionary creation from data files: `dictionary-creation.ts`;
 *  - what the features that run Khiops share (output channel, traces, version check): `khiops-services.ts`.
 *
 * Data and logic that need no VS Code API live in their own modules so they can be
 * tested and run from the command line: `derivation-rules.ts`, `language-data.ts`,
 * `validator.ts`, `khiops-runner.ts`, `khiops-validation.ts`.
 */
import * as vscode from 'vscode';
import { DiagnosticsController } from './diagnostics-controller';
import { registerDictionaryCreation } from './dictionary-creation';
import { createKhiopsServices } from './khiops-services';
import { registerLanguageFeatures } from './language-features';

/** Registers the language features, the diagnostics and the dictionary creation command. */
export function activate(context: vscode.ExtensionContext): void {
  const khiops = createKhiopsServices();
  registerLanguageFeatures(context);
  context.subscriptions.push(khiops.output, new DiagnosticsController(khiops));
  registerDictionaryCreation(context, khiops);
}

/** Registered disposables are released by VS Code; nothing else to clean up. */
export function deactivate(): void {}
