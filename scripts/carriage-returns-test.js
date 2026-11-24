#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Module = require('module');

let readFile = async () => { throw new Error('unavailable'); };
const vscode = { workspace: { fs: { readFile: uri => readFile(uri) } } };
const originalLoad = Module._load;
let carriageReturns;
try {
  Module._load = function(request, ...args) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args);
  };
  carriageReturns = require('../out/carriage-returns');
} finally {
  Module._load = originalLoad;
}
const { hasLoneCarriageReturn, fileHasLoneCarriageReturn } = carriageReturns;

const utf8 = text => Buffer.from(text, 'utf8');
const utf16 = (text, bom) => Buffer.concat([Buffer.from(bom), Buffer.from(text, 'utf16le')]);

assert.strictEqual(hasLoneCarriageReturn(utf8('a\nb\n')), false);
assert.strictEqual(hasLoneCarriageReturn(utf8('a\r\nb\r\n')), false);
assert.strictEqual(hasLoneCarriageReturn(utf8('Copy("a\rb")\r\n')), true);
assert.strictEqual(hasLoneCarriageReturn(utf8('a\r')), true, 'a carriage return ending the file is isolated');
assert.strictEqual(hasLoneCarriageReturn(utf8('é\r\né')), false, 'multi-byte characters do not matter');
assert.strictEqual(hasLoneCarriageReturn(Buffer.from([0xe9, 0x0d, 0x78])), true, 'single-byte encodings work as well');
assert.strictEqual(hasLoneCarriageReturn(utf16('a\r\nb', [0xff, 0xfe])), false, 'UTF-16: CRLF');
assert.strictEqual(hasLoneCarriageReturn(utf16('a\rb', [0xff, 0xfe])), true, 'UTF-16: isolated CR');

(async () => {
  const file = scheme => ({ scheme });
  assert.strictEqual(await fileHasLoneCarriageReturn(file('untitled')), false);
  assert.strictEqual(await fileHasLoneCarriageReturn(file('file')), false, 'an unreadable file has none');
  readFile = async () => utf8('Copy("a\rb")');
  assert.strictEqual(await fileHasLoneCarriageReturn(file('file')), true);
  console.log('Carriage return detection tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
