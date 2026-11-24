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
  CompletionItemKind: { Keyword: 0, TypeParameter: 1, Function: 2, Class: 3 },
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

function completions(prefix, before = 'Dictionary Main\n{\n', after = '\n};') {
  const text = before + prefix + after;
  const lines = text.split('\n');
  const line = before.split('\n').length - 1;
  const position = new Position(line, prefix.length);
  const document = {
    lineAt: pos => ({ text: lines[pos.line] }),
    getText: range => range ? text.slice(0, before.length + prefix.length) : text,
  };
  return completionProvider.provideCompletionItems(document, position).map(item => item.label);
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
