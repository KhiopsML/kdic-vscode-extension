#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Module = require('module');

let completionProvider;
let hoverProvider;
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
  constructor(value = '') { this.value = value; }
  appendCodeblock(value, language) { this.value += `\`\`\`${language}\n${value}\n\`\`\`\n`; }
  appendMarkdown(value) { this.value += value; }
}
class Hover {
  constructor(contents, range) { this.contents = contents; this.range = range; }
}
const vscode = {
  Position, Range, CompletionItem, Hover,
  MarkdownString: StringValue,
  SnippetString: StringValue,
  CompletionItemKind: { Keyword: 0, TypeParameter: 1, Function: 2, Class: 3, Property: 4, Constant: 5, Variable: 6 },
  languages: {
    registerCompletionItemProvider: (_selector, provider) => { completionProvider = provider; return disposable; },
    registerHoverProvider: (_selector, provider) => { hoverProvider = provider; return disposable; },
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
    lineCount: lines.length,
    lineAt: arg => ({ text: lines[typeof arg === 'number' ? arg : arg.line] }),
    offsetAt: pos => lines.slice(0, pos.line).reduce((total, text) => total + text.length + 1, 0) + pos.character,
    getText: range => range ? text.slice(0, before.length + prefix.length) : text,
  };
  return completionProvider.provideCompletionItems(document, position);
}

function completions(...args) {
  return completionItems(...args).map(item => item.label);
}

function hover(label) {
  const range = new Range(new Position(0, 0), new Position(0, label.length));
  return hoverProvider.provideHover({ getWordRangeAtPosition: () => range, getText: () => label }, new Position(0, 0));
}

const { DERIVATION_RULES } = require('../out/derivation-rules');
const instanceBuildingRules = DERIVATION_RULES.filter(rule => rule.detail === 'instance building');

/** Variables to complete: a dictionary around the line being typed, and one that an entity of it points to. */
const VARIABLES = {
  before: 'Dictionary Main\n{\n  Categorical id;\n  Numerical age;\n  Entity(Other) other;\n',
  after: '\n};\n\nDictionary Other\n{\n  Numerical amount;\n  Categorical `unit shop`;\n};',
};

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
  ['variables of the dictionary', () => {
    const items = completionItems('Numerical x = Sum(', VARIABLES.before, VARIABLES.after);
    const variables = items.filter(item => item.kind === 6);
    assert.deepStrictEqual(variables.map(item => item.label), ['id', 'age', 'other']);   // not x, whose derivation this is
    assert.ok(items.some(item => item.label === 'TableCount'), 'the rules are still offered');
    assert.ok(!items.some(item => item.label === 'Numerical'), 'no type in a derivation');
    const byName = Object.fromEntries(variables.map(item => [item.label, item]));
    assert.strictEqual(byName.age.detail, 'Numerical');
    assert.strictEqual(byName.other.detail, 'Entity(Other)');
    // The variables of the expected type sort first.
    assert.ok(byName.age.sortText < byName.id.sortText, 'a Numerical comes before a Categorical where one is expected');
    assert.ok(variables.every(item => item.documentation.value === 'Variable of this dictionary.'));
  }],
  ['variables on a continuation line and after a name started', () => {
    for (const [prefix, before] of [
      ['ag', `${VARIABLES.before}Numerical x = Sum(id,\n`],
      ['Numerical x = Sum(ag', VARIABLES.before],
    ]) {
      const labels = completions(prefix, before, VARIABLES.after);
      assert.ok(labels.includes('age') && labels.includes('id'), prefix);
    }
  }],
  ['variables of the table of the first operand', () => {
    const items = completionItems('Numerical x = TableMean(other, ', VARIABLES.before, VARIABLES.after);
    const variables = items.filter(item => item.kind === 6);
    assert.deepStrictEqual(variables.map(item => item.label), ['amount', 'unit shop']);
    assert.ok(variables.every(item => item.documentation.value === "Variable of dictionary 'Other'."));
  }],
  ['variables behind a dot are those of the scope above', () => {
    const items = completionItems('Numerical x = TableMean(other, GE(amount, .', VARIABLES.before, VARIABLES.after);
    const labels = items.map(item => item.label);
    assert.deepStrictEqual(items.filter(item => item.kind === 6).map(item => item.label), ['id', 'age', 'other']);
    assert.ok(labels.includes('Concat'), 'a call can follow a dot');
    assert.ok(!labels.includes('Numerical') && !labels.includes('#Missing'), 'neither a type nor #Missing follows a dot');
  }],
  ['a name that needs backquotes is inserted with them', () => {
    const [item] = completionItems('Numerical x = TableMean(other, ', VARIABLES.before, VARIABLES.after).filter(candidate => candidate.label === 'unit shop');
    assert.strictEqual(item.insertText, '`unit shop`');
    assert.strictEqual(item.filterText, '`unit shop`');
    const [plain] = completionItems('Numerical x = TableMean(other, ', VARIABLES.before, VARIABLES.after).filter(candidate => candidate.label === 'amount');
    assert.strictEqual(plain.insertText, undefined);
  }],
  ['an opening backquote already typed is replaced, with the closing one', () => {
    const prefix = 'Numerical x = TableMean(other, `un';
    const [item] = completionItems(prefix, VARIABLES.before, '`)\n};\n\nDictionary Other\n{\n  Numerical amount;\n  Categorical `unit shop`;\n};')
      .filter(candidate => candidate.label === 'unit shop');
    assert.strictEqual(item.range.start.character, prefix.length - 3);
    assert.strictEqual(item.range.end.character, prefix.length + 1);
    const [open] = completionItems(prefix, VARIABLES.before, VARIABLES.after).filter(candidate => candidate.label === 'unit shop');
    assert.strictEqual(open.range.end.character, prefix.length, 'nothing to replace after the cursor when no backquote was added');
  }],
  ['no variable where the scope is not known', () => {
    for (const prefix of ['Numerical x = Mystery(', 'Numerical x = Sum(age ', 'Numerical x = ', 'Numerical x = Sum(.', 'Numerical x = TableMean(age, ']) {
      const labels = completions(prefix, VARIABLES.before, VARIABLES.after);
      assert.ok(!labels.includes('age') && !labels.includes('amount'), prefix);
    }
  }],
  ['a dot elsewhere than before a name offers nothing', () => {
    for (const prefix of ['Numerical x = Sum(age, 3.', 'Numerical x = Sum(age.', 'Categorical c = Concat("a.', 'Numerical x = Sum(`a b`.']) {
      assert.deepStrictEqual(completions(prefix, VARIABLES.before, VARIABLES.after), [], prefix);
    }
  }],
  ['a document too large is completed from the line only', () => {
    const big = `${VARIABLES.before}${'  Numerical filler;\n'.repeat(60000)}`;
    const labels = completions('Numerical x = Sum(', big, VARIABLES.after);
    assert.ok(labels.includes('TableCount'), 'the rules are still offered');
    assert.ok(!labels.includes('filler') && !labels.includes('age'), 'no variable is read from a document that large');
    assert.ok(!labels.includes('#Missing'));
    assert.deepStrictEqual(completions('Numerical x = Sum(age.', big, VARIABLES.after), []);
    assert.deepStrictEqual(completions('Table(', big, VARIABLES.after), [], 'the dictionary names are not read either');
    // A document just under the size still gets them.
    const small = `${VARIABLES.before}${'  Numerical filler;\n'.repeat(1000)}`;
    assert.ok(completions('Numerical x = Sum(', small, VARIABLES.after).includes('age'));
  }],
  ['variable blocks are offered, first where a block is expected', () => {
    const before = `${VARIABLES.before}  {\n    Numerical a; <VarKey="a">\n  } zones;\n  {\n    Numerical b; <VarKey="a">\n`;
    const items = completionItems('  } Copy = CopyBlock(', before, VARIABLES.after);
    const byName = Object.fromEntries(items.filter(item => item.kind === 6).map(item => [item.label, item]));
    assert.strictEqual(byName.zones.detail, 'Block');
    assert.strictEqual(byName.zones.documentation.value, 'Variable block of this dictionary.');
    assert.ok(byName.zones.sortText < byName.age.sortText, 'a block comes before a Numerical where a block is expected');
    assert.ok(!byName.Copy, 'not the block whose derivation this is');
    const [other] = completionItems('Numerical x = Sum(', before, VARIABLES.after).filter(item => item.label === 'zones');
    assert.ok(other.sortText > '0zones', 'a block comes after the variables where a Numerical is expected');
    assert.strictEqual(other.sortText, '1zones');
  }],
  ['top level', () => assert.deepStrictEqual(completions('', ''), ['Dictionary', 'Root', 'Unused'])],
  ['relation target', () => {
    assert.deepStrictEqual(completions('Table( ', '// Dictionary Hidden\nDictionary Other {};\nDictionary Main\n{\n'), ['Other', 'Main']);
  }],
  ['instance-building rules have completion and hover documentation', () => {
    const items = new Map(completionItems('Categorical x = ').map(item => [item.label, item]));
    assert.strictEqual(instanceBuildingRules.length, 12);
    for (const rule of instanceBuildingRules) {
      const item = items.get(rule.label);
      assert.ok(item, `${rule.label}: completion item`);
      assert.ok(item.documentation.value.includes(rule.signature), `${rule.label}: completion signature`);
      assert.ok(item.documentation.value.includes(rule.documentation), `${rule.label}: completion documentation`);
      const result = hover(rule.label);
      assert.ok(result.contents.value.includes(rule.signature), `${rule.label}: hover signature`);
      assert.ok(result.contents.value.includes(rule.documentation), `${rule.label}: hover documentation`);
    }
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
