#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  analyzeCompletionPrefix, declaredTypeOnLine, expectedOperandType, hashWordBeforeCursor, isInMetadataKey,
} = require('../out/completion-context');

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

const hashWordCases = [
  ['#', '#'],
  ['Numerical x = EQ(Age, #Mis', '#Mis'],
  ['#Khiops', '#Khiops'],
  ['Numerical x = EQ(Age, ', undefined],
  ['Numerical x = EQ(Age, #Missing)', undefined],
  ['Categorical c = Concat("#Mis', undefined],
  ['Categorical `a#Mis', undefined],
  ['Numerical x ; // #Mis', undefined],
];
for (const [prefix, expected] of hashWordCases) {
  assert.strictEqual(hashWordBeforeCursor(prefix), expected, `hashWordBeforeCursor(${JSON.stringify(prefix)})`);
}

const paramTypes = new Map([
  ['EQ', ['Numerical', 'Numerical']],
  ['Min', ['Numerical', '...']],
  ['Concat', ['Categorical', '...']],
  ['SwitchC', ['Numerical', 'Categorical', 'Categorical', '...']],
  ['TableMean', ['Table', 'Numerical']],
  ['CopyBlock', ['Block(Numerical)']],
  ['Ignore', ['any', 'Numerical']],
  ['Deploy', ['any', 'Numerical', '...']],
]);
const operandCases = [
  ['EQ(', 'Numerical'],
  ['Numerical x = EQ(Age, ', 'Numerical'],
  ['Numerical x = EQ(Age, #Mis', 'Numerical'],       // the operand being typed does not count
  ['Numerical x = EQ(Age,\n    ', 'Numerical'],       // continued on the next line
  ['Numerical x = EQ(Age, // note\n    ', 'Numerical'], // a comment does not change the position
  ['Numerical x = EQ(Concat("a", "b"), ', 'Numerical'], // a closed call is behind
  ['Numerical x = EQ(Min(', 'Numerical'],              // the innermost call decides
  ['Categorical c = Concat(Age, EQ(', 'Numerical'],
  ['Numerical x = Min(Age, Age, ', 'Numerical'],       // varargs repeat the parameter before `...`
  ['Categorical c = SwitchC(Age, "a", "b", ', 'Categorical'],
  ['Categorical c = SwitchC(', 'Numerical'],
  ['Numerical x = TableMean(t, ', 'Numerical'],
  ['Numerical x = TableMean(', 'Table'],
  ['Numerical x = Ignore(Age, ', 'Numerical'],
  ['Numerical x = Deploy(grid, ', 'Numerical'],
  ['Numerical x = Deploy(grid, 1, ', undefined],          // `...` repeats nothing after an `any` parameter
  ['Numerical x = EQ(Age, 3, ', undefined],             // more arguments than parameters
  ['Numerical x = EQ(Age ', undefined],                 // not at the start of an operand
  ['Numerical x = EQ(Age, 3 ', undefined],
  ['Numerical x = EQ(Age, "a, ', undefined],            // in a string
  ['Numerical x = EQ(Age, `a, ', undefined],
  ['Numerical x = EQ("a(", ', 'Numerical'],             // a quoted parenthesis opens nothing
  ['Numerical x = EQ(Age, Age)', undefined],
  ['Numerical x = EQ(Age, Age) ', undefined],
  ['Numerical x = EQ(Age); Numerical y = ', undefined], // a statement end closes the call
  ['Numerical x = ', undefined],
  ['Numerical x = EQ', undefined],
  ['Numerical x = Unknown(', undefined],
  ['Numerical x = CopyBlock(', 'Block(Numerical)'],     // not a plain Numerical, so no `#Missing`
  ['Table(Other) t ; Numerical x = EQ(', 'Numerical'],
  ['#Khiops 9.0 (beta\nNumerical x = EQ(', 'Numerical'],
];
for (const [text, expected] of operandCases) {
  assert.strictEqual(expectedOperandType(text, paramTypes), expected, `expectedOperandType(${JSON.stringify(text)})`);
}
console.log(`Completion context tests passed (${cases.length + metadataKeyCases.length + declaredTypeCases.length + hashWordCases.length + operandCases.length} cases).`);
