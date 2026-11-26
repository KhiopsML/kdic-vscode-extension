'use strict';

// End-to-end tests run inside a real VS Code with the extension installed or loaded from source
// (see "Tests in a VS Code host" in README.md).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) { return; }
    await pause(100);
  }
  throw new Error(message);
}

/** Built-in diagnostics of a file. */
function diagnostics(uri) {
  return vscode.languages.getDiagnostics(uri).filter(item => item.source === 'kdic');
}

const hasMessage = (uri, fragment) => diagnostics(uri).some(item => item.message.includes(fragment));

async function edit(uri, start, end, text) {
  const document = await vscode.workspace.openTextDocument(uri);
  const change = new vscode.WorkspaceEdit();
  change.replace(uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
  assert.ok(await vscode.workspace.applyEdit(change));
}

/** Opens a file in an editor and returns its document. */
async function open(fixture) {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixture));
  await vscode.window.showTextDocument(document);
  return document;
}

// ─────────────────────────── A file without isolated carriage returns ───────────────────────────

async function testPlainFile(directory) {
  const fixture = path.join(directory, 'plain.kdic');
  const source = 'Dictionary D\r\n{\r\n Categorical input;\r\n Categorical value = Copy(input);\r\n};\r\n';
  fs.writeFileSync(fixture, source);
  const uri = vscode.Uri.file(fixture);

  const document = await open(fixture);
  assert.strictEqual(document.languageId, 'kdic');
  await pause(800);
  assert.deepStrictEqual(diagnostics(uri), []);

  const items = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, new vscode.Position(2, 1));
  assert.ok(items.items.some(item => item.label === 'Numerical'));
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, new vscode.Position(2, 5));
  assert.ok(hovers.length);

  // An unsaved error is reported where it is, and goes away when fixed.
  const insertion = document.getText().indexOf('};');
  await edit(uri, insertion, insertion, 'Categorical bad-1;\n');
  await waitFor(() => hasMessage(uri, 'Invalid variable name'), 'Unsaved error not reported');
  assert.strictEqual(diagnostics(uri).length, 1);
  assert.strictEqual(document.getText(diagnostics(uri)[0].range), 'bad');
  const errorStart = document.getText().indexOf('Categorical bad-1;');
  await edit(uri, errorStart, errorStart + 'Categorical bad-1;'.length, '');
  await waitFor(() => diagnostics(uri).length === 0, 'Correction did not clear diagnostics');

  assert.ok(await document.save());
  await pause(800);
  assert.deepStrictEqual(diagnostics(uri), []);

  // A change made on disk is picked up.
  fs.writeFileSync(fixture, source.replace('Categorical input;', 'Categorical 1bad;'));
  await waitFor(() => hasMessage(uri, 'Invalid variable name'), 'External file change did not refresh diagnostics');
  fs.writeFileSync(fixture, source);
  await waitFor(() => diagnostics(uri).length === 0, 'External file restoration did not refresh diagnostics');

  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  console.log('PASS plain file: diagnostics, completion, hover, edits, save and external changes');
}

// ─────────────────────────── A file with an isolated carriage return ───────────────────────────

async function testIsolatedCarriageReturn(directory) {
  const fixture = path.join(directory, 'carriage-return.kdic');
  // The isolated \r inside the string is a line break for VS Code, but not for Khiops.
  const source = 'Dictionary D\r\n{\r\n Categorical value = Copy("left\rright");\r\n};\r\n';
  fs.writeFileSync(fixture, source);
  const uri = vscode.Uri.file(fixture);

  const document = await open(fixture);
  await pause(800);
  assert.deepStrictEqual(diagnostics(uri), [], 'A file with an isolated carriage return got built-in diagnostics');

  // Editing does not bring the diagnostics back: the editor text still cannot be trusted.
  const insertion = document.getText().indexOf('};');
  await edit(uri, insertion, insertion, 'Categorical bad-1;\n');
  await pause(800);
  assert.deepStrictEqual(diagnostics(uri), []);

  // Saving rewrites the file with ordinary line breaks: it is validated normally again.
  assert.ok(await document.save());
  await waitFor(() => hasMessage(uri, 'Unclosed categorical constant'), 'Diagnostics did not resume after saving');
  assert.ok(!/\r(?!\n)/.test(fs.readFileSync(fixture, 'utf8')), 'The saved file still has an isolated carriage return');

  // The same holds when the file changes on disk.
  fs.writeFileSync(fixture, source);
  await waitFor(() => diagnostics(uri).length === 0, 'An external change adding a carriage return kept the diagnostics');
  fs.writeFileSync(fixture, 'Dictionary D\n{\n Categorical 1bad;\n};\n');
  await waitFor(() => hasMessage(uri, 'Invalid variable name'), 'An external change removing it did not bring them back');

  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  console.log('PASS isolated carriage return: no built-in diagnostics until the file is saved or replaced');
}

// ─────────────────────────── Native Khiops validation ───────────────────────────

async function testNativeValidation(directory) {
  const config = vscode.workspace.getConfiguration('kdic');
  const binary = path.join(directory, process.platform === 'win32' ? 'mock-khiops.cmd' : 'mock-khiops');
  const runs = path.join(directory, 'native-runs');
  const slow = path.join(directory, 'native-slow');
  const fixture = path.join(directory, 'native.kdic');
  const uri = vscode.Uri.file(fixture);
  // A mock Khiops that records each run, reports one error, and takes a second when the `slow` file exists.
  const script = process.platform === 'win32'
    ? `@echo off\r\nif "%~1"=="-v" (\r\necho Khiops 11.0.2\r\nexit /b 0\r\n)\r\necho run>>"${runs}"\r\nif exist "${slow}" timeout /t 1 /nobreak >nul\r\necho error : mock native error\r\n`
    : `#!/bin/sh\nif [ "$1" = "-v" ]; then printf 'Khiops 11.0.2\\n'; exit 0; fi\nprintf 'run\\n' >> '${runs.replace(/'/g, "'\\''")}'\n[ -f '${slow.replace(/'/g, "'\\''")}' ] && sleep 1\nprintf 'error : mock native error\\n'\n`;
  fs.writeFileSync(binary, script, { mode: 0o755 });
  fs.writeFileSync(fixture, 'Dictionary D\n{\n Categorical value;\n};\n');
  const nativeDiagnostics = () => vscode.languages.getDiagnostics(uri).filter(item => item.source === 'khiops');
  const runCount = () => fs.existsSync(runs) ? fs.readFileSync(runs, 'utf8').trim().split(/\r?\n/).length : 0;
  const replaceDocument = async (document, text) => {
    await edit(uri, 0, document.getText().length, text);
    assert.ok(await document.save());
  };

  try {
    await config.update('khiopsPath', binary, vscode.ConfigurationTarget.Global);
    await config.update('enableKhiopsValidation', true, vscode.ConfigurationTarget.Global);
    const document = await open(fixture);

    await replaceDocument(document, 'Dictionary D\n{\n Categorical value;\n};\n// valid\n');
    await waitFor(() => nativeDiagnostics().length === 1, 'Native validation did not run on a valid save');
    assert.strictEqual(runCount(), 1);

    await replaceDocument(document, 'Dictionary D\n{\n Categorical 1bad;\n};\n');
    await waitFor(() => diagnostics(uri).some(item => item.severity === vscode.DiagnosticSeverity.Error),
      'Built-in error not reported');
    await waitFor(() => nativeDiagnostics().length === 0, 'Built-in error did not clear native diagnostics');
    await pause(600);
    assert.strictEqual(runCount(), 1, 'Native validation ran despite a built-in error');

    // An edit made while Khiops is running makes its result obsolete: it must not be published.
    fs.writeFileSync(slow, '');
    try {
      await replaceDocument(document, 'Dictionary D\n{\n Categorical value;\n};\n// pending\n');
      await waitFor(() => runCount() === 2, 'Native validation did not start');
      await edit(uri, document.getText().indexOf('value'), document.getText().indexOf('value') + 5, '1bad');
      await pause(1800);
      assert.strictEqual(nativeDiagnostics().length, 0, 'The result of a run on an outdated version was published');
    } finally {
      fs.unlinkSync(slow);
    }

    await replaceDocument(document, 'Dictionary D\n{\n 12 apples;\n Categorical value;\n};\n');
    await waitFor(() => diagnostics(uri).some(item => item.severity === vscode.DiagnosticSeverity.Warning),
      'Built-in warning not reported');
    await waitFor(() => nativeDiagnostics().length === 1 && runCount() === 3,
      'Built-in warning prevented native validation');

    await replaceDocument(document, 'Dictionary D\n{\n Categorical value;\n};\n// saved again\n');
    await waitFor(() => runCount() === 4 && nativeDiagnostics().length === 1,
      'Native validation did not run after saving the current version');

    await config.update('enableKhiopsValidation', false, vscode.ConfigurationTarget.Global);
    await waitFor(() => nativeDiagnostics().length === 0, 'Disabling native validation did not clear diagnostics');
    await replaceDocument(document, 'Dictionary D\n{\n Categorical 1bad;\n};\n// disabled\n');
    await waitFor(() => diagnostics(uri).some(item => item.severity === vscode.DiagnosticSeverity.Error),
      'Built-in validation stopped when native validation was disabled');
    await pause(600);
    assert.strictEqual(runCount(), 4);

    await config.update('khiopsPath', path.join(directory, 'missing-khiops'), vscode.ConfigurationTarget.Global);
    await config.update('enableKhiopsValidation', true, vscode.ConfigurationTarget.Global);
    await replaceDocument(document, 'Dictionary D\n{\n Categorical 1bad;\n};\n// missing\n');
    await waitFor(() => diagnostics(uri).some(item => item.severity === vscode.DiagnosticSeverity.Error),
      'Built-in validation stopped when the binary was missing');
    await pause(600);
    assert.strictEqual(runCount(), 4);
    assert.strictEqual(nativeDiagnostics().length, 0);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    console.log('PASS native validation availability and save-time diagnostic gates');
  } finally {
    await config.update('enableKhiopsValidation', false, vscode.ConfigurationTarget.Global);
    await config.update('khiopsPath', undefined, vscode.ConfigurationTarget.Global);
    for (const file of [binary, runs, slow, fixture]) {
      if (fs.existsSync(file)) { fs.unlinkSync(file); }
    }
  }
}

async function testDictionaryCreation(directory, extension) {
  if (process.platform === 'win32') {
    console.log('SKIP dictionary creation host test: POSIX mock executable');
    return;
  }
  const config = vscode.workspace.getConfiguration('kdic');
  const binary = path.join(directory, 'mock-create');
  const scenarioFile = path.join(directory, 'creation-scenario');
  const fail = path.join(directory, 'creation-fail');
  const one = path.join(directory, 'one.txt');
  const two = path.join(directory, 'two.txt');
  const rejected = path.join(directory, 'rejected.txt');
  const destination = file => file.replace(/\.txt$/, '.kdic');
  const dictionary = 'Dictionary Created\n{\n Categorical value;\n};\n';
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(binary, `#!/bin/sh
if [ "$1" = "-v" ]; then printf 'Khiops 11.0.2\\n'; exit 0; fi
cp "$3" ${quote(scenarioFile)}
if [ -f ${quote(fail)} ]; then
  printf 'error : mock creation error\\n'
  exit 0
fi
target=$(sed -n 's/^ClassFileName //p' "$3")
printf '%s' ${quote(dictionary)} > "$target"
`, { mode: 0o755 });
  for (const file of [one, two, rejected]) { fs.writeFileSync(file, 'value\nexample\n'); }

  // Each extension receives its own API object; mock only this extension's prompts.
  const api = require('module').createRequire(path.join(extension.extensionPath, 'out', 'extension.js'))('vscode');
  const original = {
    showQuickPick: api.window.showQuickPick,
    showOpenDialog: api.window.showOpenDialog,
    showWarningMessage: api.window.showWarningMessage,
    showErrorMessage: api.window.showErrorMessage,
  };
  let header = true;
  let selectedFile;
  let confirmations = 0;
  const errors = [];
  const command = (...args) => vscode.commands.executeCommand('kdic.createDictionaryFromFile', ...args);
  const scenario = () => fs.readFileSync(scenarioFile, 'utf8');
  try {
    api.window.showQuickPick = async choices => choices.find(choice => choice.headerLineUsed === header);
    api.window.showOpenDialog = async () => selectedFile ? [vscode.Uri.file(selectedFile)] : undefined;
    api.window.showWarningMessage = async () => { confirmations++; return undefined; };
    api.window.showErrorMessage = async message => { errors.push(message); return undefined; };
    await config.update('khiopsPath', binary, vscode.ConfigurationTarget.Global);
    await config.update('enableKhiopsValidation', false, vscode.ConfigurationTarget.Global);

    await open(two);
    await command(vscode.Uri.file(one));
    assert.deepStrictEqual(errors, [], 'Creation reported an error');
    assert.strictEqual(fs.readFileSync(destination(one), 'utf8'), dictionary);
    assert.strictEqual(vscode.window.activeTextEditor.document.uri.fsPath, destination(one));
    assert.ok(scenario().includes(`DatabaseName ${one}\n`));
    assert.match(scenario(), /HeaderLineUsed true\n/);
    await pause(500);
    assert.deepStrictEqual(diagnostics(vscode.Uri.file(destination(one))), []);

    await open(two);
    header = false;
    await command();
    assert.strictEqual(fs.readFileSync(destination(two), 'utf8'), dictionary);
    assert.strictEqual(vscode.window.activeTextEditor.document.uri.fsPath, destination(two));
    assert.ok(scenario().includes(`DatabaseName ${two}\n`));
    assert.match(scenario(), /HeaderLineUsed false\n/);

    fs.unlinkSync(scenarioFile);
    header = undefined;
    await command(vscode.Uri.file(one));
    assert.strictEqual(confirmations, 0, 'Cancelling the header choice prompted for overwrite');
    assert.strictEqual(fs.readFileSync(destination(one), 'utf8'), dictionary);
    assert.ok(!fs.existsSync(scenarioFile), 'Cancelling the header choice ran Khiops');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.strictEqual(vscode.window.activeTextEditor, undefined);
    await command();
    assert.ok(!fs.existsSync(scenarioFile), 'Cancelling the file picker ran Khiops');
    header = true;
    await command(vscode.Uri.parse('untitled:ineligible'));
    await command(vscode.Uri.file(destination(one)));
    assert.strictEqual(errors.length, 2);
    assert.ok(!fs.existsSync(scenarioFile), 'Invalid input ran Khiops');

    selectedFile = rejected;
    fs.writeFileSync(fail, '');
    await command();
    assert.ok(scenario().includes(`DatabaseName ${rejected}\n`));
    assert.ok(!fs.existsSync(destination(rejected)), 'Failed creation left a dictionary');
    assert.match(errors.at(-1), /mock creation error/);
    assert.deepStrictEqual(vscode.languages.getDiagnostics(vscode.Uri.file(rejected)), []);

    fs.unlinkSync(fail);
    await command();
    assert.strictEqual(fs.readFileSync(destination(rejected), 'utf8'), dictionary);
    assert.strictEqual(vscode.window.activeTextEditor.document.uri.fsPath, destination(rejected));
    assert.strictEqual(errors.length, 3, 'Successful creation reported an error');
    console.log('PASS dictionary creation: context URI, active file, picker, headers, cancellation and errors');
  } finally {
    Object.assign(api.window, original);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await config.update('khiopsPath', undefined, vscode.ConfigurationTarget.Global);
    for (const file of [binary, scenarioFile, fail, one, two, rejected, ...[one, two, rejected].map(destination)]) {
      if (fs.existsSync(file)) { fs.unlinkSync(file); }
    }
  }
}

exports.run = async function run() {
  const config = vscode.workspace.getConfiguration('kdic');
  await config.update('enableKhiopsValidation', false, vscode.ConfigurationTarget.Global);

  const extension = vscode.extensions.getExtension('khiopsml.khiops-kdic');
  assert.ok(extension, 'Installed extension not found');
  if (process.env.KDIC_VSCODE_TEST_EXTENSIONS) {
    assert.ok(extension.extensionPath.startsWith(process.env.KDIC_VSCODE_TEST_EXTENSIONS));
  }
  const api = require('module').createRequire(path.join(extension.extensionPath, 'out', 'extension.js'))('vscode');
  const createOutputChannel = api.window.createOutputChannel;
  const captured = { lines: [], shown: 0 };
  api.window.createOutputChannel = (...args) => {
    const channel = createOutputChannel(...args);
    if (args[0] !== 'Khiops') { return channel; }
    return {
      ...channel,
      appendLine(line) { captured.lines.push(line); channel.appendLine(line); },
      show(...options) { captured.shown++; channel.show(...options); },
    };
  };
  try { await extension.activate(); }
  finally { api.window.createOutputChannel = createOutputChannel; }
  assert.ok(extension.isActive);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kdic-host-fixtures-'));
  try {
    await testPlainFile(directory);
    await testIsolatedCarriageReturn(directory);
    await testNativeValidation(directory);
    await testDictionaryCreation(directory, extension);
    await require('./version').run(directory, extension, captured, { open, edit, waitFor, pause });
    if (process.env.KDIC_VSCODE_CORPUS) { await require('./corpus').run(process.env.KDIC_VSCODE_CORPUS, directory); }
    console.log('PASS installed VS Code extension');
  } finally {
    for (const file of fs.readdirSync(directory)) { fs.unlinkSync(path.join(directory, file)); }
    fs.rmdirSync(directory);
  }
};
