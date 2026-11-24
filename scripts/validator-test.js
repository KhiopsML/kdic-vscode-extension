#!/usr/bin/env node
// Small regression suite for the VS Code-independent validator.
'use strict';

const assert = require('assert');
const path = require('path');

const validator = require(path.join(__dirname, '..', 'out', 'validator.js'));
const { buildRuleMaps } = require(path.join(__dirname, '..', 'out', 'rule-maps.js'));
const { stripLineComments, extractDictionaryNames } = require(path.join(__dirname, '..', 'out', 'kdic-syntax.js'));
const { tokenizeKdic } = require(path.join(__dirname, '..', 'out', 'kdic-lexer.js'));
const { KdicTextDocument } = require(path.join(__dirname, '..', 'out', 'kdic-text-document.js'));

function createDocument(text) {
  return new KdicTextDocument(text.replace(/\r\n/g, '\n'));
}

const { validate } = validator;
const rules = buildRuleMaps([
  { label: 'Concat', returnType: 'Categorical', signature: 'Concat(Categorical value1, ...)' },
  { label: 'Replace', returnType: 'Categorical', signature: 'Replace(Categorical value, Numerical start, Categorical search, Categorical replacement)' },
  { label: 'TableCount', returnType: 'Numerical', signature: 'TableCount(Table table)' },
  { label: 'TableMean', returnType: 'Numerical', signature: 'TableMean(Table table, Numerical value)', operandScopes: ['current', 'secondary'] },
  { label: 'TableDifference', returnType: 'Table', signature: 'TableDifference(Table table1, Table table2)', operandScopes: ['current', 'current'] },
  { label: 'TableAt', returnType: 'Entity', signature: 'TableAt(Table table, Numerical rank)' },
]);

function diagnosticsFor(text) {
  return validate(createDocument(text), rules);
}

function assertNoDiagnostics(name, text) {
  const diagnostics = diagnosticsFor(text);
  assert.deepStrictEqual(diagnostics, [], `${name}: unexpected diagnostics\n${JSON.stringify(diagnostics, null, 2)}`);
}

function assertDiagnostic(name, text, messagePart) {
  const diagnostics = diagnosticsFor(text);
  assert.ok(
    diagnostics.some(diagnostic => diagnostic.message.includes(messagePart)),
    `${name}: expected a diagnostic containing ${JSON.stringify(messagePart)}\n${JSON.stringify(diagnostics, null, 2)}`,
  );
}

function testCommentHelpers() {
  const source = 'Categorical value = Concat("//", "text"); // comment';
  assert.strictEqual(
    stripLineComments(source),
    'Categorical value = Concat("//", "text");           ',
  );
  assert.deepStrictEqual(
    [...extractDictionaryNames('// Dictionary Phantom\nDictionary Real {')],
    ['Real'],
  );
}

function testLexicalTokens() {
  const source = ' \t`a``//b` "x""//y" -1.3e+7 #Missing // comment\r\n`open\n"open';
  const tokens = tokenizeKdic(source);
  assert.deepStrictEqual(tokens.map(token => [token.kind, token.text, token.closed]), [
    ['quotedIdentifier', '`a``//b`', true],
    ['string', '"x""//y"', true],
    ['number', '-1.3e+7', undefined],
    ['missing', '#Missing', undefined],
    ['comment', '// comment\r', undefined],
    ['quotedIdentifier', '`open', false],
    ['string', '"open', false],
  ]);
  for (const token of tokens) {
    assert.strictEqual(source.slice(token.start, token.end), token.text);
  }
  assert.strictEqual(stripLineComments(source).length, source.length);
  assert.ok(stripLineComments(source).includes('`a``//b` "x""//y"'));
  assert.deepStrictEqual(tokenizeKdic('#Khiops (header)\n#Missing').map(token => token.kind), ['comment', 'missing']);

  const controlCharacters = '"a\r<//b>" `a\r//b`';
  assert.deepStrictEqual(tokenizeKdic(controlCharacters).map(token => [token.kind, token.text, token.closed]), [
    ['string', '"a\r<//b>"', true],
    ['quotedIdentifier', '`a\r//b`', true],
  ]);
  assert.strictEqual(stripLineComments(controlCharacters), controlCharacters);
  assert.deepStrictEqual(tokenizeKdic('// comment\r )\nDictionary').map(token => token.kind), ['comment', 'identifier']);
}

function testTextDocument() {
  // Raw file text: CRLF line breaks, and an isolated carriage return inside a quoted value.
  const source = 'Dictionary Records\r\n{\r\n Categorical value = Copy("a\r<b>");\r\n};\r\n';
  const document = new KdicTextDocument(source);
  assert.strictEqual(document.lineCount, 5);
  assert.strictEqual(document.lineAt(2).text, ' Categorical value = Copy("a\r<b>");');
  assert.deepStrictEqual(document.positionAt(source.indexOf('<b>')), { line: 2, character: 29 });
  assert.deepStrictEqual(validate(document, rules), []);

  // A genuine line break inside a quoted value is still an error.
  const broken = new KdicTextDocument('Dictionary D\n{\n Categorical x = Copy("broken\nvalue");\n};\n');
  assert.ok(validate(broken, rules).some(d => d.message.includes('Unclosed categorical constant')));
}

function testQuotedStringsAndIdentifiers() {
  assertNoDiagnostics('quoted strings', `Dictionary Texts
{
    Categorical name;
    Categorical value = Concat("{", ";", "//");
};`);

  assertNoDiagnostics('quoted identifiers', `Dictionary Names
{
    Categorical \`value//name\`;
};`);

  assertNoDiagnostics('carriage return inside quoted text', 'Dictionary Names\n{\n Categorical `a\rb`;\n Categorical value = Concat("a\r<//b>");\n};');
  assertNoDiagnostics('carriage return inside a comment', 'Dictionary Names\n{\n Categorical name; // comment\r )\n};');
}

function testStringSemicolonInDerivation() {
  assertNoDiagnostics('semicolon inside string literal', `Dictionary Texts
{
    Categorical name;
    Categorical value = Replace(name, 1, ";", ",");
    Categorical description; <Description="A > B">
};`);

  assertNoDiagnostics('commas inside a string argument are not argument separators', `Dictionary Texts
{
    Categorical name;
    Categorical value = Replace(name, 1, "a, b, c", "d");
};`);

  assertDiagnostic('parentheses inside a backtick argument do not hide the call', `Dictionary Texts
{
    Numerical n;
    Categorical value = Replace(n, 1, \`x(y)\`, "z");
};`, "'n' is 'Numerical' but 'Replace' expects 'Categorical'");
}

function testUnknownDictionaryReference() {
  assertDiagnostic('unknown dictionary reference', `Dictionary Real
{
    Table(Phantom) vehicles;
};`, "Dictionary 'Phantom' is not declared");
}

function testKeyAndMissingSemicolonDiagnostics() {
  assertDiagnostic('non-categorical key', `Dictionary Records (id)
{
    Numerical id;
};`, "Key field 'id' must be 'Categorical'");

  assertDiagnostic('derived key', `Dictionary Records (id)
{
    Categorical id = Copy(id);
};`, "Key field 'id' must not be derived");

  assertDiagnostic('missing variable semicolon', `Dictionary Records
{
    Categorical id
    Categorical name;
};`, "Missing ';' at end of variable declaration");

  assertDiagnostic('missing dictionary semicolon', `Dictionary Records
{
    Categorical id;
}
`, "Missing ';' after closing brace");

  assertDiagnostic('long variable name', `Dictionary Records
{
    Categorical ${'v'.repeat(129)};
};`, 'exceeds the 128-character limit');

  assertDiagnostic('long dictionary name', `Dictionary ${'D'.repeat(129)}
{
};`, 'Dictionary name');
}

function testStructuralBoundaries() {
  const unknownLine = diagnosticsFor('Dictionary Records\n{\n not a declaration\n};');
  assert.ok(unknownLine.some(d => d.severity === 1 && d.message.includes('Line does not match kdic grammar')));
  const legacyLine = diagnosticsFor('Dictionary Records\n{\n Symbol Date;\n};');
  assert.ok(legacyLine.some(d => d.severity === 1 && d.message.includes('Line does not match kdic grammar')));
  assert.ok(!legacyLine.some(d => d.message.includes('Invalid variable name')));

  assertDiagnostic('unclosed dictionary', `Dictionary Records
{
    Categorical id;
`, "Unclosed '{'");

  assertDiagnostic('unmatched closing brace', `Dictionary Records
{
    Categorical id;
};
}`, "Unmatched '}'");

  assertNoDiagnostics('nested relation expression', `Dictionary Records
{
    Numerical count = TableCount(Table(Events));
};`);

  assertNoDiagnostics('multiline dictionary header', `Dictionary Records
(id) {
    Categorical id;
};`);

  assertNoDiagnostics('balanced multiline nested delimiters', `Dictionary Records
(id) {
    Categorical id;
    Entity(Records) ref [
      id
    ];
    Numerical count = TableCount(
      Table(Records)
    ); // ) ] }
};`);

  for (const [name, text, message, line, col] of [
    ['unclosed key parenthesis', 'Dictionary D (id\n{\n Categorical id;\n};', "Unclosed '('", 0, 13],
    ['unmatched call parenthesis', 'Dictionary D\n{\n Numerical x = Copy(1));\n};', "Unmatched ')'", 2, 22],
    ['unclosed relation bracket', 'Dictionary D\n{\n Entity(D) x [id;\n};', "Unclosed '['", 2, 13],
    ['unmatched relation bracket', 'Dictionary D\n{\n Entity(D) x id];\n};', "Unmatched ']'", 2, 15],
    ['mismatched nesting', 'Dictionary D\n{\n Numerical x = F([1)];\n};', "Unclosed '['", 2, 17],
  ]) {
    const diagnostics = diagnosticsFor(text);
    assert.ok(diagnostics.some(d => d.severity === 0 && d.message.includes(message) && d.line === line && d.col === col),
      `${name}: expected ${message} at ${line}:${col}\n${JSON.stringify(diagnostics, null, 2)}`);
  }
}

function testVariableBlocks() {
  assertNoDiagnostics('variable block', `Dictionary Document
{
    Categorical id;
    {
        Numerical archive; <VarKey=1>
        Numerical name; <VarKey=2>
    } Words;
};`);

  assertDiagnostic('mixed variable-block types', `Dictionary Document
{
    {
        Numerical archive;
        Categorical name;
    } Words;
};`, 'Variable block members must all have the same type');

  assertDiagnostic('mixed typed variable-block metadata', `Dictionary Document
{
    {
        Numerical archive; <VarKey=1>
        Categorical name; <VarKey=2>
    } Words;
};`, 'Variable block members must all have the same type');

  assertDiagnostic('derived variable-block member', `Dictionary Document
{
    {
        Numerical archive = Copy(archive);
    } Words;
};`, 'Variable block members cannot be derived individually');
  const derivedMember = diagnosticsFor('Dictionary Document\n{\n    {\n        Numerical archive = Copy(archive);\n    } Words;\n};')
    .find(d => d.message.includes('cannot be derived individually'));
  assert.strictEqual(derivedMember.col, '        Numerical archive '.length, 'the column accounts for indentation');

  assertDiagnostic('unnamed variable block', `Dictionary Document
{
    {
        Numerical archive;
    }
};`, 'Variable block must have a name and');
}

function testMultilineDerivation() {
  assertNoDiagnostics('multiline derivation', `Dictionary Records
{
    Table(Events) events;
    Numerical count =
        TableCount(events);
};

Dictionary Events
{
};`);
}

function testDeclarationTerminators() {
  const missing = `Dictionary Records
{
    Numerical result = Sum(
        1, 2
    )
    Categorical name;
};`;
  assertDiagnostic('multiline missing semicolon', missing, "Missing ';' at end of variable declaration");
  assertNoDiagnostics('multiline declaration with semicolon', missing.replace('    )\n', '    );\n'));
  const cursorDiagnostics = validate(createDocument(missing), rules, 2);
  assert.ok(!cursorDiagnostics.some(d => d.message.includes("Missing ';' at end of variable declaration")));
  assertNoDiagnostics('inline declarations', 'Dictionary Records { Categorical id; Numerical value; };');
  assertNoDiagnostics('inline metadata and declarations', 'Dictionary Records { Categorical id; <Key> Numerical value; };');
  assertNoDiagnostics('declaration split across lines', 'Dictionary Records\n{\n Numerical\n value\n ;\n};');
  assertNoDiagnostics('dictionary terminator on next line', 'Dictionary Records\n{\n Categorical id;\n}\n;');
  assertDiagnostic('inline variable missing semicolon', 'Dictionary Records { Categorical id Numerical value; };\n',
    "Missing ';' at end of variable declaration");
  assert.ok(!diagnosticsFor('Dictionary Records\n{\n Categorical id').some(d => d.message.includes("Missing ';'")));
  assertDiagnostic('inline dictionary missing semicolon', 'Dictionary Records { Categorical id; } // end',
    "Missing ';' after closing brace");
}

function testMetadataSyntax() {
  const document = metadata => `Dictionary Records
{
    Categorical id; ${metadata}
};`;
  for (const metadata of ['<Flag>', '<Number=-1.3e+7>', '<Label="a > b ""quoted"" // text">']) {
    assertNoDiagnostics(`valid metadata ${metadata}`, document(metadata));
  }
  assertNoDiagnostics('multiline metadata', document('<Number\n =\n 1.5\n>'));
  assertNoDiagnostics('dictionary metadata', 'Dictionary Records <Number\n = 1.5\n>\n{\n Categorical id;\n};');
  for (const metadata of ['<Flag', 'Flag>', '<123>', '<Flag=abc>', '<Flag=#Missing>', '<Flag=>', '<Flag="open', '<Flag=1e+>']) {
    assertDiagnostic(`invalid metadata ${metadata}`, document(metadata), 'metadata');
  }
}

function testDictionaryKeysAndNames() {
  assertNoDiagnostics('quoted multiline key', 'Dictionary Records (\n `a,b`,\n `a``b`\n)\n{\n Categorical `a,b`;\n Categorical `a``b`;\n};');
  assertNoDiagnostics('quoted parenthesis in key', 'Dictionary Records (`a)b`)\n{\n Categorical `a)b`;\n};');
  assertDiagnostic('missing key', 'Dictionary Records (missing)\n{\n Categorical id;\n};', "Key field 'missing' is not declared");
  assertDiagnostic('quoted non-categorical key', 'Dictionary Records (`a,b`)\n{\n Numerical `a,b`;\n};', "Key field 'a,b' must be 'Categorical'");
  assertDiagnostic('invalid unquoted name', 'Dictionary Records\n{\n Categorical bad-name;\n};', 'Invalid variable name');
  assertDiagnostic('name starting with a digit', 'Dictionary Records\n{\n Categorical 1bad;\n};', 'Invalid variable name');
  assertDiagnostic('name ending with numeric punctuation', 'Dictionary Records\n{\n Categorical bad-1;\n};', 'Invalid variable name');
  assertDiagnostic('numeric variable name', 'Dictionary Records\n{\n Unused Categorical 123;\n};', 'Invalid variable name');
  assertNoDiagnostics('type or modifier used as a variable name', 'Dictionary Records\n{\n Categorical Unused;\n Numerical Text;\n};');
  assertDiagnostic('unquoted name with spaces', 'Dictionary Records\n{\n Categorical bad name;\n};', 'Invalid variable name');
  assertDiagnostic('unclosed quoted name', 'Dictionary Records\n{\n Categorical `bad\n};', 'Invalid variable name');
  assertDiagnostic('empty quoted name', 'Dictionary Records\n{\n Categorical ``;\n};', 'Invalid variable name');
  assertDiagnostic('quoted name with leading space', 'Dictionary Records\n{\n Categorical ` bad`;\n};', 'Invalid variable name');
  assert.ok(!diagnosticsFor('Dictionary Records (id)\n{\n Categorical id\n};')
    .some(d => d.message.includes("Key field 'id' is not declared")));
}

function testDerivationConstants() {
  const document = expr => `Dictionary Records
{
    Numerical input;
    Categorical output = Copy(${expr});
};`;
  for (const expression of ['"a""b"', '"a" + "b"', '-1.3e+7', '#Missing', 'input', 'Copy(\n 1.2e-3\n)']) {
    const diagnostics = diagnosticsFor(document(expression));
    assert.ok(!diagnostics.some(d => d.message.includes('constant')), `${expression}: ${JSON.stringify(diagnostics)}`);
  }
  assertNoDiagnostics('numeric input before output operands', `Dictionary Records
{
    Table(Records) output = BuildDummyTable(1, 10 : first, second);
};`);
  assertNoDiagnostics('missing input before output operands', `Dictionary Records
{
    Table(Records) output = BuildDummyTable(#Missing : first);
};`);
  for (const expression of ['1e+', '1.2.3', '#MissingOops', 'Copy(1e-)', '"unterminated']) {
    assertDiagnostic(`invalid constant ${expression}`, document(expression), 'constant');
  }
  assertDiagnostic('malformed numeric input before output operands', 'Dictionary Records\n{\n Table(Records) output = BuildDummyTable(1e+ : first);\n};', 'Invalid numerical constant');
}

function testDerivationArgumentScopes() {
  const document = body => `Dictionary Client
{
    Table(Achat) achats;
    ${body}
};
Dictionary Achat
{
    Numerical montant;
};`;
  const hasDiagnostic = (text, message, severity) => {
    const diagnostics = diagnosticsFor(document(text));
    assert.ok(diagnostics.some(d => d.severity === severity && d.message.includes(message)),
      `Expected ${severity}: ${message}\n${JSON.stringify(diagnostics, null, 2)}`);
  };
  const noArgumentDiagnostic = (text, name) => {
    const diagnostics = diagnosticsFor(document(text));
    assert.ok(!diagnostics.some(d => d.message.startsWith(`'${name}' `)),
      `Unexpected diagnostic for ${name}\n${JSON.stringify(diagnostics, null, 2)}`);
  };

  noArgumentDiagnostic('Categorical montant;\n    Numerical moyenne = TableMean(achats, montant);', 'montant');
  noArgumentDiagnostic('Numerical moyenne = TableMean(achats, montant);', 'montant');
  hasDiagnostic('Categorical second;\n    Table(Achat) diff = TableDifference(achats, second);', "'second' is 'Categorical' but 'TableDifference' expects 'Table'", 0);
  hasDiagnostic('Table(Achat) diff = TableDifference(achats, absent);', "'absent' is not declared", 1);
  hasDiagnostic('Categorical mauvais;\n    Numerical n = TableCount(mauvais);', "'mauvais' is 'Categorical' but 'TableCount' expects 'Table'", 0);
  hasDiagnostic('Numerical n;\n    Categorical result = Replace(n, 1, "x", "y");', "'n' is 'Numerical' but 'Replace' expects 'Categorical'", 0);
  noArgumentDiagnostic('Categorical rank;\n    Entity(Achat) result = TableAt(achats, rank);', 'rank');
  noArgumentDiagnostic('Entity(Achat) result = TableAt(achats, absent);', 'absent');
}

function run() {
  testCommentHelpers();
  testLexicalTokens();
  testTextDocument();
  testQuotedStringsAndIdentifiers();
  testStringSemicolonInDerivation();
  testUnknownDictionaryReference();
  testKeyAndMissingSemicolonDiagnostics();
  testStructuralBoundaries();
  testVariableBlocks();
  testMultilineDerivation();
  testDeclarationTerminators();
  testMetadataSyntax();
  testDictionaryKeysAndNames();
  testDerivationConstants();
  testDerivationArgumentScopes();
  console.log('validator tests passed');
}

run();