#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { analyzeCompletionPrefix } = require('../out/completion-context');

const cases = [
  ['"a//b= "', false, false],
  ['`a//b= `', false, false],
  ['"a""//b=', false, false],
  ['`a``//b=', false, false],
  ['"a""b" = ', false, true],
  ['`a``b` = ', false, true],
  ['"a"', false, false],
  ['`a`', false, false],
  ['<Meta="a > b // c = d">', false, false],
  ['"<Meta=x>"', false, false],
  ['<Meta=value> = ', false, true],
  ['= <Meta=value>', false, true],
  ['<Meta=a//comment>', true, false],
  ['"//" // comment =', true, false],
  ['`//` // comment =', true, false],
  ['= // comment', true, true],
];

for (const [prefix, inComment, inDerivation] of cases) {
  assert.deepStrictEqual(analyzeCompletionPrefix(prefix), { inComment, inDerivation }, prefix);
}
console.log(`Completion context tests passed (${cases.length} cases).`);
