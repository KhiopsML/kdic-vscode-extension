'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

exports.run = async function(directory, extension, captured, { open, edit, waitFor, pause }) {
  if (process.platform === 'win32') {
    console.log('SKIP version integration: POSIX mock executables');
    return;
  }
  const api = require('module').createRequire(path.join(extension.extensionPath, 'out', 'extension.js'))('vscode');
  const original = {
    showQuickPick: api.window.showQuickPick,
    showWarningMessage: api.window.showWarningMessage,
    showErrorMessage: api.window.showErrorMessage,
  };
  const config = vscode.workspace.getConfiguration('kdic');
  const warnings = [];
  const dismissals = [];
  const errors = [];
  const files = [];
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  const dictionary = 'Dictionary VersionTest\n{\n Categorical value;\n};\n';
  let header = true;
  let sequence = 0;
  const count = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').length : 0;
  const mock = (name, version, status = 0) => {
    const binary = path.join(directory, `version-${name}`);
    files.push(binary, binary + '.probes', binary + '.runs', binary + '.wait', binary + '.done');
    fs.writeFileSync(binary, `#!/bin/sh
if [ "$1" = "-v" ]; then
  printf 'probe\\n' >> ${quote(binary + '.probes')}
  while [ -f ${quote(binary + '.wait')} ]; do sleep 0.05; done
  printf '%s\\n' ${quote(version ? `Khiops ${version}` : 'cannot read version')}
  touch ${quote(binary + '.done')}
  exit ${status}
fi
printf 'batch\\n' >> ${quote(binary + '.runs')}
if grep -q '^BuildClassDef$' "$3"; then
  target=$(sed -n 's/^ClassFileName //p' "$3")
  printf '%s' ${quote(dictionary)} > "$target"
else
  printf 'error : mock validation completed\\n'
fi
`, { mode: 0o755 });
    return binary;
  };
  const select = binary => config.update('khiopsPath', binary, vscode.ConfigurationTarget.Global);
  const nativeEnabled = enabled => config.update('enableKhiopsValidation', enabled, vscode.ConfigurationTarget.Global);
  const create = async (cancelled = false, real = false) => {
    const source = path.join(directory, `version-data-${++sequence}.txt`);
    const destination = source.replace(/\.txt$/, '.kdic');
    files.push(source, destination);
    fs.writeFileSync(source, 'value\nexample\n');
    await vscode.commands.executeCommand('kdic.createDictionaryFromFile', vscode.Uri.file(source));
    if (cancelled) {
      assert.ok(!fs.existsSync(destination));
    } else {
      const text = fs.readFileSync(destination, 'utf8');
      if (real) { assert.match(text, /Categorical\s+value\b/); }
      else { assert.strictEqual(text, dictionary); }
      await pause(400);
      assert.deepStrictEqual(vscode.languages.getDiagnostics(vscode.Uri.file(destination)), []);
    }
  };
  let document;
  const save = async (invalid = false) => {
    const text = dictionary.replace('value;', invalid ? '1bad;' : 'value;') + `// ${++sequence}\n`;
    await edit(document.uri, 0, document.getText().length, text);
    assert.ok(await document.save());
  };
  const validate = async binary => {
    const before = count(binary + '.runs');
    await save();
    await waitFor(() => count(binary + '.runs') === before + 1
      && vscode.languages.getDiagnostics(document.uri).some(item => item.source === 'khiops'),
    'Version checking prevented native validation');
    assert.deepStrictEqual(vscode.languages.getDiagnostics(document.uri).map(item => ({
      source: item.source, message: item.message,
    })), [{ source: 'khiops', message: 'mock validation completed' }], 'Version checking added diagnostics');
  };
  const concurrentOperations = async binary => {
    await select(binary);
    fs.writeFileSync(binary + '.wait', '');
    await save();
    await waitFor(() => count(binary + '.probes') === 1, 'Version probe did not start');
    const creation = create();
    try {
      await pause(200);
      assert.strictEqual(count(binary + '.probes'), 1);
      assert.strictEqual(count(binary + '.runs'), 0);
    } finally { fs.unlinkSync(binary + '.wait'); }
    await creation;
    await waitFor(() => count(binary + '.runs') === 2, 'Concurrent validation/creation did not complete');
    await validate(binary);
    await create();
    assert.strictEqual(count(binary + '.probes'), 1, 'Version check was not shared or cached');
  };
  try {
    api.window.showQuickPick = async choices => header === undefined ? undefined : choices.find(item => item.headerLineUsed === header);
    api.window.showWarningMessage = (message, ...actions) => {
      assert.ok(actions.includes('Show Output'));
      warnings.push(message);
      return new Promise(resolve => dismissals.push(resolve));
    };
    api.window.showErrorMessage = async message => { errors.push(message); return undefined; };
    await config.update('enableDebugTraces', false, vscode.ConfigurationTarget.Global);
    await nativeEnabled(false);
    const fixture = path.join(directory, 'version-native.kdic');
    files.push(fixture);
    fs.writeFileSync(fixture, dictionary);
    document = await open(fixture);
    await vscode.window.showTextDocument(document, { preview: false });
    const matching = mock('matching', '11.0.2');
    await select(matching);
    await create();
    assert.strictEqual(warnings.length, 0);
    await nativeEnabled(true);
    await validate(matching);
    assert.strictEqual(count(matching + '.probes'), 1);

    const mismatch = mock('mismatch', '11.0.3-a.0');
    await concurrentOperations(mismatch);
    assert.strictEqual(warnings.length, 1, 'Mismatch warning repeated');
    assert.match(warnings[0], /11\.0\.3-a\.0/);
    assert.match(warnings[0], /11\.0\.2/);
    assert.ok(captured.lines.some(line => line.includes(mismatch) && line.includes('11.0.3-a.0') && line.includes('11.0.2')));
    const shown = captured.shown;
    dismissals[0]('Show Output');
    await waitFor(() => captured.shown === shown + 1, 'Show Output did not reveal the channel');

    const failed = mock('failed', undefined, 1);
    await concurrentOperations(failed);
    assert.strictEqual(warnings.length, 2, 'Failed probe warning repeated');
    assert.match(warnings[1], /could not be determined/);
    assert.ok(captured.lines.some(line => line.includes(failed)));
    assert.ok(captured.lines.some(line => line.includes('cannot read version')));
    await select(mismatch);
    await validate(mismatch);
    assert.strictEqual(count(mismatch + '.probes'), 1);
    assert.strictEqual(warnings.length, 2);

    const unused = mock('unused', '12.0.0');
    await select(unused);
    await save(true);
    await waitFor(() => vscode.languages.getDiagnostics(document.uri).some(item => item.source === 'kdic'), 'Built-in error missing');
    await pause(400);
    assert.strictEqual(count(unused + '.probes'), 0, 'Built-in error did not prevent version probing');
    await nativeEnabled(false);
    header = undefined;
    await create(true);
    assert.strictEqual(count(unused + '.probes'), 0, 'Cancelled creation probed the version');
    header = true;

    for (const change of ['edit', 'disable', 'path']) {
      const binary = mock(`stale-${change}`, '11.0.2');
      await select(binary);
      await nativeEnabled(true);
      fs.writeFileSync(binary + '.wait', '');
      await save();
      await waitFor(() => count(binary + '.probes') === 1, 'Delayed version probe did not start');
      if (change === 'edit') { await edit(document.uri, 0, 0, '// changed during probe\n'); }
      else if (change === 'disable') { await nativeEnabled(false); }
      else { await select(matching); }
      fs.unlinkSync(binary + '.wait');
      await waitFor(() => fs.existsSync(binary + '.done'), 'Delayed version probe did not finish');
      await pause(400);
      assert.strictEqual(count(binary + '.runs'), 0, `A stale native run started after ${change}`);
    }
    assert.strictEqual(warnings.length, 2);
    assert.deepStrictEqual(errors, []);
    console.log('PASS version checks: equality, mismatch, failures, shared concurrent cache, output and stale-run gates');

    if (process.env.KDIC_VSCODE_REAL_KHIOPS) {
      const binary = process.env.KDIC_VSCODE_REAL_KHIOPS;
      const { readKhiopsVersion, KHIOPS_REFERENCE_VERSION } = require(path.join(extension.extensionPath, 'out', 'khiops-version'));
      const result = await readKhiopsVersion(binary, () => {});
      assert.ok(result.ok, JSON.stringify(result));
      assert.strictEqual(result.version, '11.0.3-a.0');
      assert.strictEqual(KHIOPS_REFERENCE_VERSION, '11.0.2');
      await nativeEnabled(false);
      await select(binary);
      await create(false, true);
      await create(false, true);
      assert.strictEqual(warnings.length, 3);
      assert.match(warnings[2], /11\.0\.3-a\.0/);
      assert.match(warnings[2], /11\.0\.2/);
      assert.deepStrictEqual(errors, []);
      console.log('PASS real Khiops: 11.0.3-a.0, reference 11.0.2, one advisory warning and two successful creations');
    }
  } finally {
    for (const dismiss of dismissals) { dismiss(undefined); }
    Object.assign(api.window, original);
    await nativeEnabled(false);
    await config.update('khiopsPath', undefined, vscode.ConfigurationTarget.Global);
    if (document && !document.isClosed && document.isDirty) {
      await edit(document.uri, 0, document.getText().length, dictionary);
      assert.ok(await document.save());
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const file of files) {
      if (fs.existsSync(file)) { fs.unlinkSync(file); }
    }
  }
};
