#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Module = require('module');

const reads = [];
const warnings = [];
const watchers = [];
const vscode = {
  EndOfLine: { LF: 1, CRLF: 2 },
  Uri: { joinPath: uri => uri },
  RelativePattern: class RelativePattern {},
  workspace: {
    fs: {
      readFile: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    },
    decode: async bytes => Buffer.from(bytes).toString('utf8'),
    createFileSystemWatcher: () => {
      const watcher = {
        disposed: false,
        onDidChange() {},
        onDidCreate() {},
        onDidDelete() {},
        dispose() { this.disposed = true; },
      };
      watchers.push(watcher);
      return watcher;
    },
  },
  window: { showWarningMessage: message => { warnings.push(message); } },
};

const originalLoad = Module._load;
let KdicEditorDocuments;
try {
  Module._load = function(request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  ({ KdicEditorDocuments } = require('../out/kdic-editor-documents'));
} finally {
  Module._load = originalLoad;
}

function document(name, text) {
  return {
    uri: { scheme: 'file', toString: () => `file:///${name}` },
    version: 1,
    eol: vscode.EndOfLine.LF,
    encoding: 'utf8',
    isDirty: false,
    text,
    getText() { return this.text; },
  };
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

async function run() {
  const ready = [];
  const manager = new KdicEditorDocuments(doc => ready.push(doc));

  const closed = document('closed.kdic', 'a\nb');
  manager.open(closed);
  const closedRead = reads.shift();
  manager.close(closed);
  closedRead.resolve(Buffer.from('a\rb'));
  await settle();
  assert.strictEqual(manager.get(closed), undefined);
  assert.deepStrictEqual(ready, []);
  assert.ok(watchers[0].disposed, 'Closing a document disposes its watcher');

  const refreshed = document('refresh.kdic', 'a\nb');
  manager.open(refreshed);
  const oldRead = reads.shift();
  manager.refresh(refreshed);
  const newRead = reads.shift();
  newRead.resolve(Buffer.from('a\rb'));
  await settle();
  assert.strictEqual(manager.get(refreshed).getText(), 'a\rb');
  oldRead.resolve(Buffer.from('stale'));
  await settle();
  assert.strictEqual(manager.get(refreshed).getText(), 'a\rb');
  assert.deepStrictEqual(ready, [refreshed]);
  refreshed.encoding = 'utf16le';
  manager.change({ document: refreshed, contentChanges: [] });
  assert.strictEqual(manager.get(refreshed), undefined);
  reads.shift().resolve(Buffer.from('a\rb'));
  await settle();
  assert.strictEqual(manager.get(refreshed).getText(), 'a\rb');

  const unavailable = document('unavailable.kdic', 'original');
  manager.open(unavailable);
  reads.shift().reject(new Error('unavailable'));
  await settle();
  assert.ok(warnings.some(message => message.includes('source reconciliation failed') && message.includes('unavailable')));
  assert.strictEqual(manager.get(unavailable).getText(), 'original');
  unavailable.version++;
  unavailable.text = 'updated';
  manager.change({ document: unavailable, contentChanges: [{ rangeOffset: 0, rangeLength: 8, text: 'updated' }] });
  assert.strictEqual(manager.get(unavailable).getText(), 'updated');

  const mismatched = document('mismatched.kdic', 'current');
  manager.open(mismatched);
  reads.shift().resolve(Buffer.from('different source'));
  await settle();
  assert.strictEqual(manager.get(mismatched).getText(), 'current');
  assert.ok(warnings.some(message => message.includes('does not match the editor document')));

  delete vscode.workspace.decode;
  vscode.workspace.getConfiguration = () => ({ get: () => 'windows1252' });
  const legacy = document('legacy.kdic', 'é\nx');
  legacy.encoding = undefined;
  manager.open(legacy);
  reads.shift().resolve(Buffer.from([0xe9, 0x0d, 0x78]));
  await settle();
  assert.strictEqual(manager.get(legacy).getText(), 'é\rx');

  const legacyUtf16 = document('legacy-utf16.kdic', 'é\nx');
  legacyUtf16.encoding = undefined;
  manager.open(legacyUtf16);
  reads.shift().resolve(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('é\rx', 'utf16le')]));
  await settle();
  assert.strictEqual(manager.get(legacyUtf16).getText(), 'é\rx');

  manager.dispose();
  assert.ok(watchers.every(watcher => watcher.disposed));
  console.log('Editor document lifecycle tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
