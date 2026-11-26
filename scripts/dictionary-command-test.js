#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

async function main() {
  if (process.platform === 'win32') {
    console.log('Dictionary command mock tests skipped on Windows.');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdic-command-test-'));
  const binary = path.join(root, 'mock-khiops');
  const marker = path.join(root, 'scenarios');
  const checked = path.join(root, 'version-checked');
  const one = path.join(root, 'one.txt');
  const two = path.join(root, 'two.txt');
  const uri = fsPath => ({ scheme: 'file', fsPath });
  let command;
  let active;
  let selectedFile;
  let header;
  let confirmation;
  let binaryPath = binary;
  let mode = 'success';
  let opened;
  let shown;
  const errors = [];
  const output = [];
  const actions = [];
  let versionChecks = 0;
  const vscode = {
    Uri: { file: uri },
    ProgressLocation: { Notification: 1 },
    commands: {
      registerCommand: (id, callback) => {
        assert.strictEqual(id, 'kdic.createDictionaryFromFile');
        command = callback;
        return { dispose() {} };
      },
      executeCommand: async (...args) => { actions.push(args); },
    },
    workspace: {
      getConfiguration: () => ({ get: () => binaryPath }),
      openTextDocument: async file => { opened = file; return { uri: file }; },
    },
    window: {
      get activeTextEditor() { return active && { document: { uri: active } }; },
      showOpenDialog: async () => selectedFile ? [selectedFile] : undefined,
      showQuickPick: async choices => header === undefined ? undefined : choices.find(item => item.headerLineUsed === header),
      showWarningMessage: async () => confirmation,
      showErrorMessage: async message => { errors.push(message); return undefined; },
      withProgress: async (_options, run) => run(),
      showTextDocument: async document => { shown = document.uri; },
    },
  };
  const channel = { appendLine: line => output.push(line), show() {} };

  fs.writeFileSync(one, 'a\tb\n1\t2\n');
  fs.writeFileSync(two, 'a\tb\n1\t2\n');
  fs.writeFileSync(binary, `#!/usr/bin/env node
const fs = require('fs');
if (!fs.existsSync(${JSON.stringify(checked)})) {
  console.log('error : Version was not checked before the batch run');
  process.exit(1);
}
const scenario = fs.readFileSync(process.argv[4], 'utf8');
fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify(scenario) + '\\n');
const target = scenario.split('\\n').find(line => line.startsWith('ClassFileName ')).slice('ClassFileName '.length);
if (process.env.KDIC_COMMAND_MODE === 'error') console.log('Khiops.log\\terror : mock creation error');
else fs.writeFileSync(target, 'Dictionary Mock { Categorical value; };\\n');
`, { mode: 0o755 });

  const originalLoad = Module._load;
  try {
    Module._load = function(request, ...args) {
      return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args);
    };
    require('../out/dictionary-creation').registerDictionaryCreation({ subscriptions: [] }, channel, () => {}, async found => {
      assert.strictEqual(found, binary);
      versionChecks++;
      fs.writeFileSync(checked, '');
    });
  } finally {
    Module._load = originalLoad;
  }
  const count = () => fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim().split('\n').length : 0;
  const scenario = () => JSON.parse(fs.readFileSync(marker, 'utf8').trim().split('\n').at(-1));
  const run = async (...args) => {
    if (fs.existsSync(checked)) { fs.unlinkSync(checked); }
    process.env.KDIC_COMMAND_MODE = mode;
    await command(...args);
  };
  const previousMode = process.env.KDIC_COMMAND_MODE;
  try {
    active = uri(two);
    header = true;
    await run(uri(one));
    assert.strictEqual(shown.fsPath, path.join(root, 'one.kdic'));
    assert.match(scenario(), /HeaderLineUsed true/);
    assert.match(scenario(), /DatabaseName .*one\.txt/);
    assert.strictEqual(versionChecks, 1);

    header = false;
    await run();
    assert.strictEqual(opened.fsPath, path.join(root, 'two.kdic'));
    assert.match(scenario(), /HeaderLineUsed false/);
    assert.match(scenario(), /DatabaseName .*two\.txt/);
    assert.strictEqual(versionChecks, 2);

    active = undefined;
    selectedFile = uri(one);
    confirmation = 'Replace';
    await run();
    assert.match(scenario(), /DatabaseName .*one\.txt/);
    let runs = count();
    const checks = versionChecks;
    selectedFile = undefined;
    await run();
    assert.strictEqual(count(), runs);
    assert.strictEqual(versionChecks, checks);

    active = uri(one);
    header = undefined;
    await run();
    assert.strictEqual(count(), runs);
    header = true;
    confirmation = undefined;
    await run();
    assert.strictEqual(count(), runs);

    await run({ scheme: 'untitled', fsPath: one });
    await run(uri(path.join(root, 'existing.kdic')));
    assert.strictEqual(count(), runs);
    assert.ok(errors.some(message => message.includes('local data file')));

    binaryPath = path.join(root, 'missing-khiops');
    await run(uri(one));
    assert.ok(errors.some(message => message.includes('Khiops was not found')));
    assert.strictEqual(count(), runs);
    assert.strictEqual(versionChecks, checks, 'Cancellation or invalid input checked the version');

    binaryPath = binary;
    mode = 'error';
    confirmation = 'Replace';
    const previous = fs.readFileSync(path.join(root, 'one.kdic'), 'utf8');
    await run(uri(one));
    assert.strictEqual(count(), ++runs);
    assert.strictEqual(fs.readFileSync(path.join(root, 'one.kdic'), 'utf8'), previous);
    assert.ok(errors.some(message => message.includes('mock creation error')));
    assert.ok(output.some(line => line.includes('mock creation error')));
    assert.deepStrictEqual(actions, []);
  } finally {
    if (previousMode === undefined) { delete process.env.KDIC_COMMAND_MODE; }
    else { process.env.KDIC_COMMAND_MODE = previousMode; }
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('Dictionary command mock tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
