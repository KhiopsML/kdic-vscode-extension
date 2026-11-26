#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { khiopsErrorMessages, parseKhiopsErrorLocations } = require('../out/khiops-validation');

assert.deepStrictEqual(khiopsErrorMessages([
  'Khiops.log\tDatabase /tmp/error : data : Recognized variable types: 1 Numerical',
  'Khiops.log\twarning : ignore this warning',
  'Khiops.log\terror : Cannot open input',
  'fatal error : Batch mode failure',
  'Khiops.log\tfatal error : More details',
].join('\r\n')), ['Cannot open input', 'Batch mode failure', 'More details']);
assert.deepStrictEqual(khiopsErrorMessages(''), []);

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

// An operand that a table rule looks up in the table it points to is placed where it is written,
// in another dictionary than the one named by the error; a dot sends it back to the dictionary above.
const secondaryText = [
  'Root Dictionary Client (id) {',
  '  Categorical id;',
  '  Numerical age;',
  '  Table(Purchase) purchases;',
  '  Numerical a = Sum(age, ghost);',                                  // line 4: ghost in Client
  '  Numerical b = TableMean(purchases, ghost);',                      // line 5: ghost in Purchase
  '  Table(Purchase) c = TableSelection(purchases, GE(amount, .ghost));', // line 6: ghost in Client
  '  Numerical d = TableCount(TableSelection(purchases, EQ(ghost, 1)));', // line 7: ghost in Purchase
  '};',
  'Dictionary Purchase (id) {',
  '  Categorical id;',
  '  Numerical amount;',
  '};',
].join('\n');
assert.deepStrictEqual(parseKhiopsErrorLocations([
  notFound('ghost', 'Client'),
  notFound('ghost', 'Client'),
  notFound('ghost', 'Client'), // more errors than uses in Client: falls back to the first
  notFound('ghost', 'Purchase'),
  notFound('ghost', 'Purchase'),
  notFound('ghost', 'Purchase'),
].join('\n'), secondaryText).map(location => location.line), [4, 6, 4, 5, 7, 5]);

console.log('Khiops output parsing tests passed.');
