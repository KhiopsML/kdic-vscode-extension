#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { analyzeCompletionPrefix, declaredTypeOnLine, isInMetadataKey } = require('../out/completion-context');

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

const metadataKeyCases = [
  ['<', true],
  ['Date d ; <', true],
  ['Date d ; <Dat', true],
  ['Date d ; <DateFormat="x"> <', true],
  ['Date d ; <DateFormat', true],
  ['Date d ; <DateFormat=', false],
  ['Date d ; <DateFormat="x">', false],
  ['Date d ; <1', false],
  ['Date d ; // <', false],
  ['Categorical c = Concat("<', false],
  ['Categorical c = Concat("a <D', false],
  ['Categorical `a <D', false],
  ['Date d ;', false],
];
for (const [prefix, expected] of metadataKeyCases) {
  assert.strictEqual(isInMetadataKey(prefix), expected, `isInMetadataKey(${JSON.stringify(prefix)})`);
}

const declaredTypeCases = [
  ['Date d ; <', 'Date'],
  ['  \tTime t ;', 'Time'],
  ['Unused Timestamp s ;', 'Timestamp'],
  ['TimestampTZ z ; <', 'TimestampTZ'],
  ['Categorical c ; <', 'Categorical'],
  ['<', undefined],
  ['Dateline d ; <', undefined],
  ['Unused', undefined],
];
for (const [prefix, expected] of declaredTypeCases) {
  assert.strictEqual(declaredTypeOnLine(prefix), expected, `declaredTypeOnLine(${JSON.stringify(prefix)})`);
}
console.log(`Completion context tests passed (${cases.length + metadataKeyCases.length + declaredTypeCases.length} cases).`);
