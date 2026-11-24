/**
 * Khiops Dictionary (.kdic) VS Code extension.
 *
 * Language support for Khiops dictionary files
 * (grammar reference: https://khiops.org/api-docs/kdic/dictionary-files/):
 *
 *  - syntax highlighting and snippets: declarative, in `syntaxes/` and `snippets/`;
 *  - completion and hover: `language-features.ts`;
 *  - diagnostics, built-in and native Khiops: `diagnostics-controller.ts`.
 *
 * Data and logic that need no VS Code API live in their own modules so they can be
 * tested and run from the command line: `derivation-rules.ts`, `language-data.ts`,
 * `validator.ts`, `khiops-runner.ts`, `khiops-validation.ts`.
 */
import * as vscode from 'vscode';
import { DiagnosticsController } from './diagnostics-controller';
import { registerLanguageFeatures } from './language-features';

/** Registers the language features and the diagnostics of `.kdic` documents. */
export function activate(context: vscode.ExtensionContext): void {
  registerLanguageFeatures(context);
  context.subscriptions.push(new DiagnosticsController());
}

/** Registered disposables are released by VS Code; nothing else to clean up. */
export function deactivate(): void {}
