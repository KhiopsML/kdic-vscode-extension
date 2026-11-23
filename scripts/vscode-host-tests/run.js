'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

async function waitFor(predicate, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) { return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function diagnostics(uri) {
  return vscode.languages.getDiagnostics(uri).filter(item => item.source === 'kdic');
}

async function edit(uri, start, end, text) {
  const document = await vscode.workspace.openTextDocument(uri);
  const change = new vscode.WorkspaceEdit();
  change.replace(uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
  assert.ok(await vscode.workspace.applyEdit(change));
}

async function testDelayedSource() {
  const source = 'Dictionary D\n{\n Categorical value = Copy("left\rright");\n};\n';
  const bytes = Buffer.from(source);
  const event = new vscode.EventEmitter();
  let readCount = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const provider = {
    onDidChangeFile: event.event,
    watch: () => new vscode.Disposable(() => {}),
    stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length }),
    readDirectory: () => [],
    readFile: async () => {
      readCount++;
      if (readCount === 2) { await gate; }
      return bytes;
    },
    writeFile: () => { throw vscode.FileSystemError.NoPermissions(); },
    delete: () => { throw vscode.FileSystemError.NoPermissions(); },
    rename: () => { throw vscode.FileSystemError.NoPermissions(); },
    createDirectory: () => { throw vscode.FileSystemError.NoPermissions(); },
  };
  const registration = vscode.workspace.registerFileSystemProvider('kdic-test-source', provider, { isCaseSensitive: true });
  const uri = vscode.Uri.parse('kdic-test-source:/race.kdic');
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await waitFor(() => readCount >= 2, 'The extension did not read the original source');
    const start = document.getText().indexOf('};');
    await edit(uri, start, start, 'Numerical 1bad;\n');
    release();
    await waitFor(() => diagnostics(uri).some(item => item.message.includes('Invalid variable name')),
      'Delayed source lost the unsaved edit');
    assert.strictEqual(diagnostics(uri).length, 1, JSON.stringify(diagnostics(uri).map(item => item.message)));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    console.log('PASS delayed source read with concurrent unsaved edit');
  } finally {
    release();
    registration.dispose();
    event.dispose();
  }
}

async function testUnavailableSource() {
  const initial = Buffer.from('Dictionary D\n{\n Categorical 1bad;\n};\n');
  const event = new vscode.EventEmitter();
  let readCount = 0;
  const provider = {
    onDidChangeFile: event.event,
    watch: () => new vscode.Disposable(() => {}),
    stat: () => ({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: initial.length }),
    readDirectory: () => [],
    readFile: () => {
      readCount++;
      if (readCount > 1) { throw vscode.FileSystemError.Unavailable('Source unavailable'); }
      return initial;
    },
    writeFile: () => { throw vscode.FileSystemError.NoPermissions(); },
    delete: () => { throw vscode.FileSystemError.NoPermissions(); },
    rename: () => { throw vscode.FileSystemError.NoPermissions(); },
    createDirectory: () => { throw vscode.FileSystemError.NoPermissions(); },
  };
  const registration = vscode.workspace.registerFileSystemProvider('kdic-test-unavailable', provider, { isCaseSensitive: true });
  const uri = vscode.Uri.parse('kdic-test-unavailable:/unavailable.kdic');
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await waitFor(() => diagnostics(uri).some(item => item.message.includes('Invalid variable name')),
      'Unavailable source did not fall back to the current editor text');
    const start = document.getText().indexOf('1bad');
    await edit(uri, start, start + 4, 'good');
    await waitFor(() => diagnostics(uri).length === 0, 'Fallback retained stale diagnostics after editing');
    await vscode.commands.executeCommand('undo');
    await waitFor(() => !document.isDirty, 'Undo did not restore the clean document');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    console.log('PASS unavailable source falls back without stale diagnostics');
  } finally {
    registration.dispose();
    event.dispose();
  }
}

async function testUtf16(directory) {
  const source = 'Dictionary D\n{\n Categorical value = Copy("left\rright");\n};\n';
  const fixture = path.join(directory, 'utf16.kdic');
  fs.writeFileSync(fixture, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')]));
  const uri = vscode.Uri.file(fixture);
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const start = document.getText().indexOf('};');
    await edit(uri, start, start, 'Numerical 1bad;\n');
    await waitFor(() => diagnostics(uri).some(item => item.message.includes('Invalid variable name')),
      'UTF-16 document did not report the edited error');
    assert.strictEqual(diagnostics(uri).length, 1, JSON.stringify(diagnostics(uri).map(item => item.message)));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    console.log('PASS UTF-16 encoded source with unsaved edits');
  } finally {
    fs.unlinkSync(fixture);
  }
}

exports.run = async function run() {
  const config = vscode.workspace.getConfiguration('kdic');
  await config.update('enableKhiopsValidation', false, vscode.ConfigurationTarget.Global);
  await config.update('diagnosticSource', 'extension', vscode.ConfigurationTarget.Global);

  const extension = vscode.extensions.getExtension('khiopsml.khiops-kdic');
  assert.ok(extension, 'Installed extension not found');
  if (process.env.KDIC_VSCODE_TEST_EXTENSIONS) {
    assert.ok(extension.extensionPath.startsWith(process.env.KDIC_VSCODE_TEST_EXTENSIONS));
  }
  await extension.activate();
  assert.ok(extension.isActive);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kdic-host-fixtures-'));
  const fixture = path.join(directory, 'mixed.kdic');
  const source = 'Dictionary D\r\n{\r\n Categorical input;\r\n Categorical value = Copy("left\r// ) > right");\r\n};\r\n';
  fs.writeFileSync(fixture, source);
  const uri = vscode.Uri.file(fixture);
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    assert.strictEqual(document.languageId, 'kdic');
    await vscode.window.showTextDocument(document);
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.deepStrictEqual(diagnostics(uri), []);

    const items = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, new vscode.Position(2, 1));
    assert.ok(items.items.some(item => item.label === 'Numerical'));
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, new vscode.Position(2, 5));
    assert.ok(hovers.length);

    const insertion = document.getText().indexOf('};');
    await edit(uri, insertion, insertion, 'Categorical bad-1;\n');
    await waitFor(() => diagnostics(uri).some(item => item.message.includes('Invalid variable name')), 'Unsaved error not reported');
    assert.strictEqual(diagnostics(uri).length, 1);
    assert.strictEqual(document.getText(diagnostics(uri)[0].range), 'bad');
    const errorStart = document.getText().indexOf('Categorical bad-1;');
    await edit(uri, errorStart, errorStart + 'Categorical bad-1;'.length, '');
    await waitFor(() => diagnostics(uri).length === 0, 'Correction did not clear diagnostics');

    const before = document.getText().indexOf('Categorical input');
    await edit(uri, before, before, 'Numerical 1bad;\n ');
    await waitFor(() => diagnostics(uri).some(item => item.message.includes('Invalid variable name')), 'Error before CR not reported');
    assert.strictEqual(diagnostics(uri).length, 1);
    const beforeStart = document.getText().indexOf('Numerical 1bad;');
    const beforeEnd = document.getText().indexOf('Categorical input');
    await edit(uri, beforeStart, beforeEnd, '');
    await waitFor(() => diagnostics(uri).length === 0, 'Correction before CR did not clear diagnostics');

    const content = document.getText();
    const left = content.indexOf('left');
    const right = content.indexOf('right', left);
    await edit(uri, left, right + 'right'.length, 'replacement');
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.deepStrictEqual(diagnostics(uri), []);
    assert.ok(await document.save());
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.deepStrictEqual(diagnostics(uri), []);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

    fs.writeFileSync(fixture, source);
    const reopened = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(reopened);
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.deepStrictEqual(diagnostics(uri), []);
    fs.writeFileSync(fixture, source.replace('Categorical input;', 'Categorical 1bad;'));
    await waitFor(() => diagnostics(uri).some(item => item.message.includes('Invalid variable name')),
      'External file change did not refresh diagnostics');
    assert.strictEqual(diagnostics(uri).length, 1);
    fs.writeFileSync(fixture, source);
    await waitFor(() => diagnostics(uri).length === 0 && reopened.getText().includes('Categorical input;'),
      'External file restoration did not refresh diagnostics');
    fs.writeFileSync(fixture, source.replace('left\r', 'left\n'));
    await waitFor(() => diagnostics(uri).some(item => item.message.includes('Unclosed categorical constant')),
      'External newline change was not revalidated');
    fs.writeFileSync(fixture, source);
    await waitFor(() => diagnostics(uri).length === 0, 'Restoring the original CR did not clear diagnostics');
    await edit(uri, 0, 0, '// saved\n');
    assert.ok(await reopened.save());
    await waitFor(() => diagnostics(uri).some(item => item.message.includes('Unclosed categorical constant')),
      'Saved normalized newline was not revalidated');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await testDelayedSource();
    await testUnavailableSource();
    await testUtf16(directory);
    console.log('PASS installed VS Code extension: diagnostics, completion, hover, edits, positions, save and reload');
  } finally {
    if (fs.existsSync(fixture)) { fs.unlinkSync(fixture); }
    fs.rmdirSync(directory);
  }
};
