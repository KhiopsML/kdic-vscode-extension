#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  isNativeValidationCurrent,
  parseKhiopsErrorLocations,
  shouldRunNativeValidation,
} = require('../out/khiops-validation');

assert.strictEqual(shouldRunNativeValidation([]), true);
assert.strictEqual(shouldRunNativeValidation([{ severity: 1 }]), true);
assert.strictEqual(shouldRunNativeValidation([{ severity: 0 }]), false);
assert.strictEqual(isNativeValidationCurrent(4, 4, false), true);
assert.strictEqual(isNativeValidationCurrent(4, 5, false), false);
assert.strictEqual(isNativeValidationCurrent(4, 4, true), false);

const documentText = [
  'Root Dictionary First {',
  '  Categorical first;',
  '};',
  'Dictionary Second {',
  '  Numerical target;',
  '  Numerical duplicate;',
  '  Categorical duplicate;',
  '};',
].join('\n');
const errorLocations = parseKhiopsErrorLocations([
  "error : Read dictionary file Line 3 : Missing ';'",
  'error : Dictionary Second : Variable target : Derivation rule is invalid',
  'error : Dictionary Second : Variable missing : Derivation rule is invalid',
  'error : Dictionary Second : Variable duplicate : Derivation rule is invalid',
  'error : Errors detected during parsing',
].join('\n'), documentText);
assert.deepStrictEqual(errorLocations, [
  { line: 2, message: "Missing ';'" },
  { line: 4, message: 'Dictionary Second : Variable target : Derivation rule is invalid' },
  { line: 0, message: 'Dictionary Second : Variable missing : Derivation rule is invalid' },
  { line: 0, message: 'Dictionary Second : Variable duplicate : Derivation rule is invalid' },
]);

console.log('Native validation coordination tests passed.');
