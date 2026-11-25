'use strict';

// Optional end-to-end tests on a directory of real .kdic files, run inside a real VS Code with the
// packaged extension installed: set KDIC_VSCODE_CORPUS to the directory (see "Tests in a VS Code host"
// in README.md). The files of the directory are only read: they are never saved.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const out = path.join(__dirname, '..', '..', 'out');
const { validate } = require(path.join(out, 'validator.js'));
const { KdicTextDocument } = require(path.join(out, 'kdic-text-document.js'));
const { DERIVATION_RULES } = require(path.join(out, 'derivation-rules.js'));
const { buildRuleMaps } = require(path.join(out, 'rule-maps.js'));
const { findKhiopsBinary, runKhiops } = require(path.join(out, 'khiops-runner.js'));

const RULES = buildRuleMaps(DERIVATION_RULES);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// VS Code may close a document that no editor shows within a few hundred milliseconds, and the extension
// then clears its diagnostics: each file is checked on its own, right after it is opened. It counts as
// checked once it has shown what is expected for a while, which grows with its size (the extension reads
// and validates it in this same process, so a clean file cannot be told from one not yet validated).
const SETTLE_MS = 100;
const SETTLE_MS_PER_MB = 150;
const FILE_TIMEOUT_MS = 60000;
function kdicFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { return kdicFiles(full); }
      return entry.isFile() && entry.name.endsWith('.kdic') ? [full] : [];
    })
    .sort();
}

const describe = d => `${d.line + 1}:${d.col + 1}-${d.endCol + 1} ${d.severity === 0 ? 'error' : 'warning'} ${d.message}`;

/** What the built-in validator reports for the text of a file; none for a file with isolated carriage returns. */
function expectedDiagnostics(text) {
  if (/\r(?!\n)/.test(text)) { return []; }
  return validate(new KdicTextDocument(text.replace(/^\uFEFF/, '')), RULES).map(describe).sort();
}

/** What VS Code shows for a document: the built-in diagnostics of the extension. */
function shownDiagnostics(uri) {
  return vscode.languages.getDiagnostics(uri)
    .filter(item => item.source === 'kdic')
    .map(item => describe({
      line: item.range.start.line, col: item.range.start.character, endCol: item.range.end.character,
      severity: item.severity, message: item.message,
    }))
    .sort();
}

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

/** Opens a file and waits until VS Code shows for it what the validator reports; records a mismatch otherwise. */
async function checkFile(file, totals) {
  const expected = expectedDiagnostics(fs.readFileSync(file, 'utf8'));
  let document;
  try {
    document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  } catch (error) {
    totals.notOpened.push(`${file}: ${error.message}`);
    return;
  }
  if (document.languageId !== 'kdic') { totals.wrongLanguage.push(file); }
  if (expected.length) { totals.withDiagnostics++; }
  totals.opened++;

  const settle = SETTLE_MS + SETTLE_MS_PER_MB * fs.statSync(file).size / 1e6;
  const deadline = Date.now() + FILE_TIMEOUT_MS;
  let sameSince;
  while (Date.now() < deadline && !document.isClosed) {
    await pause(20);
    if (!sameList(shownDiagnostics(document.uri), expected)) { sameSince = undefined; continue; }
    sameSince = sameSince ?? Date.now();
    if (Date.now() - sameSince >= settle) { return; }
  }

  const shown = shownDiagnostics(document.uri);
  const mismatch = {
    file,
    closed: document.isClosed,
    missing: expected.filter(line => !shown.includes(line)),
    unexpected: shown.filter(line => !expected.includes(line)),
  };
  totals.mismatches.push(mismatch);
  reportMismatch(mismatch);
}

/** Prints a mismatch as soon as it is found: a run over a large corpus is long. */
function reportMismatch(item) {
  console.log(`FAIL mismatch in ${item.file} (closed: ${item.closed})`);
  for (const line of item.missing.slice(0, 3)) { console.log(`       not shown: ${line}`); }
  for (const line of item.unexpected.slice(0, 3)) { console.log(`       unexpected: ${line}`); }
}

async function testCorpus(directory) {
  const files = kdicFiles(directory);
  assert.ok(files.length, `No .kdic file in ${directory}`);
  const totals = { opened: 0, withDiagnostics: 0, notOpened: [], wrongLanguage: [], mismatches: [] };
  const start = Date.now();

  for (const [index, file] of files.entries()) {
    await checkFile(file, totals);
    if ((index + 1) % 250 === 0) {
      console.log(`INFO corpus ${index + 1}/${files.length} files checked, ${totals.mismatches.length} mismatch(es)`);
    }
  }

  console.log(`INFO corpus: ${files.length} files, ${totals.opened} opened in ${Math.round((Date.now() - start) / 1000)}s, `
    + `${totals.withDiagnostics} with built-in diagnostics, ${totals.notOpened.length} not opened, ${totals.mismatches.length} mismatch(es)`);
  for (const item of totals.notOpened.slice(0, 10)) { console.log(`INFO not opened: ${item}`); }
  assert.deepStrictEqual(totals.wrongLanguage, [], 'Some files were not recognized as kdic');
  assert.strictEqual(totals.mismatches.length, 0, `${totals.mismatches.length} file(s) show diagnostics that differ from the validator's`);
  console.log(`PASS corpus: the ${totals.opened} files opened show exactly the diagnostics of the validator`);
}

/** A small real dictionary that the built-in validator and Khiops both accept, to feed the native validation. */
async function findAcceptedDictionary(files, binary) {
  const candidates = files
    .map(file => ({ file, size: fs.statSync(file).size }))
    .filter(item => item.size > 1000 && item.size < 30000)
    .sort((a, b) => a.size - b.size);
  for (const { file } of candidates) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(' = ') && !/\t=\s/.test(text)) { continue; }
    if (expectedDiagnostics(text).length || /\r/.test(text)) { continue; }
    const output = await runKhiops(binary, file, () => {});
    if (output !== undefined && !/error\s*:/.test(output)) { return { file, text }; }
  }
  return undefined;
}

async function testRealKhiops(directory, fixturesDirectory) {
  const binary = findKhiopsBinary('', () => {});
  if (!binary) { console.log('INFO real Khiops: no Khiops binary found, native validation not tested'); return; }

  const config = vscode.workspace.getConfiguration('kdic');
  const fixture = path.join(fixturesDirectory, 'real-khiops.kdic');
  const uri = vscode.Uri.file(fixture);
  const nativeDiagnostics = () => vscode.languages.getDiagnostics(uri).filter(item => item.source === 'khiops');
  const waitForNative = async (predicate, message) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (predicate()) { return; }
      await pause(200);
    }
    throw new Error(`${message}\n${nativeDiagnostics().map(item => `${item.range.start.line}: ${item.message}`).join('\n')}`);
  };
  const replaceAndSave = async (document, text) => {
    const change = new vscode.WorkspaceEdit();
    change.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.ok(await vscode.workspace.applyEdit(change));
    assert.ok(await document.save());
  };

  // Each unknown variable is used on a line of its own; Khiops reports it without a line number.
  const broken = [
    'Root Dictionary Client (id)', '{', '    Categorical id;', '    Numerical age;', '    Table(Purchase) purchases;',
    '    Numerical broken = Sum(age, toto);',
    '    Numerical special = Sum(age, `x y`);',
    '    Numerical mean = TableMean(purchases, nothing);',
    '};', '', 'Dictionary Purchase (id)', '{', '    Categorical id;', '    Numerical amount;', '};', '',
  ].join('\n');
  const accepted = await findAcceptedDictionary(kdicFiles(directory), binary);
  assert.ok(accepted, 'No real dictionary accepted by Khiops found in the corpus');

  try {
    await config.update('khiopsPath', '', vscode.ConfigurationTarget.Global);
    await config.update('enableKhiopsValidation', true, vscode.ConfigurationTarget.Global);
    fs.writeFileSync(fixture, broken);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    // The real Khiops runs on save, and its errors land on the lines that use the unknown variables.
    // A trailing blank line makes the document differ from its file; Khiops rejects a comment at the end of a file.
    await replaceAndSave(document, `${broken}\n`);
    const placed = (fragment, line) => nativeDiagnostics().some(item =>
      item.message.includes(fragment) && item.range.start.line === line);
    await waitForNative(() => placed('Variable toto not found (in dictionary Client)', 5), 'Unknown variable not placed on its line');
    await waitForNative(() => placed('Variable x y not found (in dictionary Client)', 6), 'Name with a space not placed on its line');
    await waitForNative(() => placed('Variable nothing not found (in dictionary Purchase)', 7), 'Variable of a secondary table not placed on its line');
    console.log('PASS real Khiops: unknown variables (plain, with a space, of a secondary table) are shown on their lines');

    // A real dictionary of the corpus, saved from a copy, clears them: Khiops accepts it.
    await replaceAndSave(document, accepted.text);
    await waitForNative(() => nativeDiagnostics().length === 0, 'A dictionary accepted by Khiops kept native diagnostics');
    console.log(`PASS real Khiops: ${path.relative(directory, accepted.file)} is accepted, and the native diagnostics are cleared`);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  } finally {
    await config.update('enableKhiopsValidation', false, vscode.ConfigurationTarget.Global);
    await config.update('khiopsPath', undefined, vscode.ConfigurationTarget.Global);
    if (fs.existsSync(fixture)) { fs.unlinkSync(fixture); }
  }
}

exports.run = async function run(directory, fixturesDirectory) {
  await testCorpus(directory);
  await testRealKhiops(directory, fixturesDirectory);
};
