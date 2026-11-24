#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Module = require('module');

let completionProvider;
const disposable = {};
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(start, end) { this.start = start; this.end = end; }
}
class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; }
}
class StringValue {
  constructor(value) { this.value = value; }
}
const vscode = {
  Position, Range, CompletionItem,
  MarkdownString: StringValue,
  SnippetString: StringValue,
  CompletionItemKind: { Keyword: 0, TypeParameter: 1, Function: 2, Class: 3, Property: 4, Constant: 5 },
  languages: {
    registerCompletionItemProvider: (_selector, provider) => { completionProvider = provider; return disposable; },
    registerHoverProvider: () => disposable,
  },
};
const originalLoad = Module._load;
try {
  Module._load = function(request, ...args) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args);
  };
  require('../out/language-features').registerLanguageFeatures({ subscriptions: [] });
} finally {
  Module._load = originalLoad;
}

function completionItems(prefix, before = 'Dictionary Main\n{\n', after = '\n};') {
  const text = before + prefix + after;
  const lines = text.split('\n');
  const line = before.split('\n').length - 1;
  const position = new Position(line, prefix.length);
  const document = {
    lineAt: pos => ({ text: lines[pos.line] }),
    getText: range => range ? text.slice(0, before.length + prefix.length) : text,
  };
  return completionProvider.provideCompletionItems(document, position);
}

function completions(...args) {
  return completionItems(...args).map(item => item.label);
}

function normal(prefix) {
  const labels = completions(prefix);
  assert.ok(labels.includes('Numerical'), `${prefix}: expected type suggestions`);
  assert.ok(labels.includes('Unused'), `${prefix}: expected Unused`);
  assert.ok(labels.includes('TableCount'), `${prefix}: expected rule suggestions`);
}

const tests = [
  ...[
    'Categorical "a//b"',
    'Categorical `a//b`',
    'Categorical "a=b"',
    'Categorical `a=b`',
    'Categorical "a""//b=',
    'Categorical `a``//b=',
    'Categorical "a""//b="',
    'Categorical `a``//b=`',
    'Categorical "a//b=',
    'Categorical `a//b=',
    'Categorical "<Meta=x>"',
    'Categorical x <Meta="a > b // c = d">',
  ].map(prefix => [prefix, () => normal(prefix)]),
  ['real comment after quoted marker', () => assert.deepStrictEqual(completions('Categorical "a//b" // comment'), [])],
  ['real comment after quoted identifier', () => assert.deepStrictEqual(completions('Categorical `a//b` // comment'), [])],
  ['ordinary block', () => normal('Categorical value')],
  ['real assignment after metadata', () => {
    const labels = completions('Categorical x <Meta="a=b"> = ');
    assert.ok(labels.includes('TableCount'));
    assert.ok(!labels.includes('Numerical'));
    assert.ok(!labels.includes('Unused'));
  }],
  ['metadata keys', () => {
    const keys = ['DateFormat', 'TimeFormat', 'TimestampFormat', 'TimestampTZFormat'];
    for (const prefix of ['Categorical c ; <', 'Date d ; <Da', '<', 'Date d ; <A> <']) {
      assert.deepStrictEqual(completions(prefix), keys, prefix);
    }
    assert.strictEqual(completionItems('Date d ; <')[0].insertText.value, 'DateFormat="${1:DD/MM/YYYY}"');
  }],
  ['metadata key of the declared type first', () => {
    for (const [prefix, key] of [
      ['Date d ; <', 'DateFormat'], ['Time t ; <', 'TimeFormat'], ['Unused Timestamp s ; <', 'TimestampFormat'],
      ['TimestampTZ z ; <', 'TimestampTZFormat'],
    ]) {
      const items = completionItems(prefix);
      assert.deepStrictEqual(items.filter(item => item.preselect).map(item => item.label), [key], prefix);
      assert.strictEqual([...items].sort((a, b) => a.sortText.localeCompare(b.sortText))[0].label, key, prefix);
    }
    assert.ok(completionItems('<').every(item => !item.preselect));
  }],
  ['no metadata key in a comment, quoted text or outside a dictionary', () => {
    assert.deepStrictEqual(completions('Date d ; // <'), []);
    assert.ok(!completions('Categorical c = Concat("<').includes('DateFormat'));
    assert.deepStrictEqual(completions('Dictionary D <', ''), []);
  }],
  ['#Missing where a rule expects a Numerical', () => {
    for (const prefix of [
      'Numerical x = EQ(Age, ', 'Numerical x = EQ(', 'Numerical x = Sum(Age, Age, ', 'Numerical x = Sum(Age, Sum(',
      'Numerical x = Sum(Age, Mi', 'Numerical x = Sum(Age,\t', 'Numerical x = TableMean(t, ',
    ]) {
      assert.ok(completions(prefix).includes('#Missing'), prefix);
    }
    // The list stays the usual one, with `#Missing` added.
    assert.ok(completions('Numerical x = EQ(Age, ').includes('TableCount'));
    const [item] = completionItems('Numerical x = EQ(Age, ').filter(candidate => candidate.label === '#Missing');
    assert.strictEqual(item.range, undefined);
  }],
  ['#Missing on a continuation line', () => {
    assert.ok(completions('    ', 'Dictionary Main\n{\n  Numerical x = Sum(Age,\n').includes('#Missing'));
    assert.ok(completions('    ', 'Dictionary Main\n{\n  Numerical x = Sum(Age, // note\n').includes('#Missing'));
  }],
  ['no #Missing elsewhere', () => {
    for (const prefix of [
      'Numerical x = ', 'Numerical x = EQ(Age ', 'Numerical x = EQ(Age, 3, ', 'Categorical c = Concat("a", ',
      'Categorical c = Concat(Age, ', 'Numerical x = Sum(Age, Concat(', 'Numerical x = Unknown(',
      'Numerical x = EQ(Age, "a, ', 'Numerical x = EQ(Age); Numerical y = ', 'Numerical x = TableMean(',
      'Numerical x = CopyBlock(', 'Categorical c',
    ]) {
      assert.ok(!completions(prefix).includes('#Missing'), prefix);
    }
    assert.ok(!completions('Numerical x = EQ(Age, ', 'Dictionary Main\n').includes('#Missing')); // outside a block
  }],
  ['typing # offers only #Missing, which replaces what was typed', () => {
    for (const typed of ['#', '#M', '#Mis']) {
      const prefix = `Numerical x = EQ(Age, ${typed}`;
      const items = completionItems(prefix);
      assert.deepStrictEqual(items.map(item => item.label), ['#Missing'], prefix);
      assert.strictEqual(items[0].range.start.character, prefix.length - typed.length, prefix);
      assert.strictEqual(items[0].range.end.character, prefix.length, prefix);
    }
  }],
  ['typing # where #Missing is not possible offers nothing', () => {
    assert.deepStrictEqual(completions('Categorical c = Concat("a", #'), []);
    assert.deepStrictEqual(completions('Numerical x = #'), []);
    assert.deepStrictEqual(completions('#Khiops', ''), []); // the header line of a file
    assert.deepStrictEqual(completions('#', ''), []);
  }],
  ['top level', () => assert.deepStrictEqual(completions('', ''), ['Dictionary', 'Root', 'Unused'])],
  ['relation target', () => {
    assert.deepStrictEqual(completions('Table( ', '// Dictionary Hidden\nDictionary Other {};\nDictionary Main\n{\n'), ['Other', 'Main']);
  }],
];

let failures = 0;
for (const [name, test] of tests) {
  try { test(); } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
assert.strictEqual(failures, 0, `${failures} completion test(s) failed`);
console.log(`Completion tests passed (${tests.length} cases).`);
