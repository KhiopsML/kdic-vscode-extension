#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { parseKhiopsErrorLocations } = require('../out/khiops-validation');

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

// An unknown variable is placed on its n-th use in the named dictionary, one error per use.
// Khiops prints names decoded: without backquotes, a doubled backquote written once.
const unknownVariableText = [
  'Root Dictionary First (Key) {',
  '  Categorical Key;',
  '  Categorical a = AsCategorical(Exist(toto));', // line 2
  '  Categorical b = Concat(toto,',                // line 3
  '    `odd name`);',                              // line 4
  '  Categorical c = Exist(toto); // toto(comment)', // line 5
  '};',
  'Dictionary Second {',
  '  Categorical Key;',
  '  Categorical toto = Exist(other);',            // line 9
  '};',
  'Dictionary `my``dict` {',
  '  Categorical Key;',
  '  Categorical c = Exist(`x``y : z`);',          // line 13
  '  Categorical `it``s ok`;',                     // line 14
  '};',
].join('\n');
const notFound = (name, dictionary = 'First') =>
  `error : Operand Entity() ${name} : Variable ${name} not found (in dictionary ${dictionary})`;
assert.deepStrictEqual(parseKhiopsErrorLocations([
  notFound('toto'),
  notFound('toto'),
  notFound('toto'),
  notFound('toto'), // more errors than uses: falls back to the first use
  notFound('odd name'),
  notFound('missing'),
  notFound('toto', 'Unknown'),
  notFound('x`y : z', 'my`dict'),
  'error : Dictionary my`dict : Variable it`s ok : Derivation rule is invalid',
].join('\n'), unknownVariableText).map(location => location.line), [2, 3, 5, 2, 4, 0, 0, 13, 14]);

console.log('Khiops output parsing tests passed.');
