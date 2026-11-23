#!/usr/bin/env node
// Small regression suite for the VS Code-independent validator.
'use strict';

const assert = require('assert');
const path = require('path');

const validator = require(path.join(__dirname, '..', 'out', 'validator.js'));

function createDocument(text) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const lines = normalizedText.split('\n');
  const offsets = [];
  let offset = 0;

  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  return {
    getText: () => normalizedText,
    lineCount: lines.length,
    lineAt: line => ({ text: lines[line] ?? '' }),
    positionAt: position => {
      let line = 0;
      while (line + 1 < offsets.length && offsets[line + 1] <= position) {
        line++;
      }
      return { line, character: position - offsets[line] };
    },
  };
}

const { validate, buildTypeMaps, stripLineComments, extractDictionaryNames } = validator;
const { paramTypeMap, returnTypeMap, paramScopeMap } = buildTypeMaps([
  { label: 'Concat', returnType: 'Categorical', signature: 'Concat(Categorical value1, ...)' },
  { label: 'Replace', returnType: 'Categorical', signature: 'Replace(Categorical value, Numerical start, Categorical search, Categorical replacement)' },
  { label: 'TableCount', returnType: 'Numerical', signature: 'TableCount(Table table)' },
  { label: 'TableMean', returnType: 'Numerical', signature: 'TableMean(Table table, Numerical value)', operandScopes: ['current', 'secondary'] },
  { label: 'TableDifference', returnType: 'Table', signature: 'TableDifference(Table table1, Table table2)', operandScopes: ['current', 'current'] },
  { label: 'TableAt', returnType: 'Entity', signature: 'TableAt(Table table, Numerical rank)' },
]);

function diagnosticsFor(text) {
  return validate(createDocument(text), paramTypeMap, returnTypeMap, undefined, paramScopeMap);
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
    [...extractDictionaryNames(stripLineComments('// Dictionary Phantom\nDictionary Real {'))],
    ['Real'],
  );
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
}

function testStringSemicolonInDerivation() {
  assertNoDiagnostics('semicolon inside string literal', `Dictionary Texts
{
    Categorical name;
    Categorical value = Replace(name, 1, ";", ",");
    Categorical description; <Description="A > B">
};`);
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
  testQuotedStringsAndIdentifiers();
  testStringSemicolonInDerivation();
  testUnknownDictionaryReference();
  testKeyAndMissingSemicolonDiagnostics();
  testStructuralBoundaries();
  testVariableBlocks();
  testMultilineDerivation();
  testDerivationArgumentScopes();
  console.log('validator tests passed');
}

run();