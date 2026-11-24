#!/usr/bin/env node
// Small regression suite for the VS Code-independent validator.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const validator = require(path.join(__dirname, '..', 'out', 'validator.js'));
const { buildRuleMaps } = require(path.join(__dirname, '..', 'out', 'rule-maps.js'));
const { stripLineComments, extractDictionaryNames } = require(path.join(__dirname, '..', 'out', 'kdic-syntax.js'));
const { tokenizeKdic } = require(path.join(__dirname, '..', 'out', 'kdic-lexer.js'));
const { KdicTextDocument } = require(path.join(__dirname, '..', 'out', 'kdic-text-document.js'));
const { formatsOf, isValidFormat } = require(path.join(__dirname, '..', 'out', 'date-time-formats.js'));
const { FORMAT_METADATA_KEYS } = require(path.join(__dirname, '..', 'out', 'kdic-syntax.js'));
const { METADATA_KEYS } = require(path.join(__dirname, '..', 'out', 'language-data.js'));

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
  { label: 'Sum', returnType: 'Numerical', signature: 'Sum(Numerical value1, ...)' },
  { label: 'Deploy', returnType: 'Categorical', signature: 'Deploy(Structure(Grid) grid, Numerical index, ...)' },
  { label: 'Overloaded', returnType: 'Numerical', signature: 'Overloaded(Categorical key, Categorical target, Numerical rank)' },
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

function testFormatMetadata() {
  const document = declarations => `Dictionary Records\n{\n    ${declarations}\n};`;
  const messages = declarations => diagnosticsFor(document(declarations)).map(diagnostic => diagnostic.message);

  for (const declarations of [
    'Date d; <DateFormat="DD/MM/YYYY">',
    'Time t; <TimeFormat="HH.MM">',
    'Timestamp s; <TimestampFormat="YYYY-MM-DD_HH:MM:SS">',
    'TimestampTZ z; <TimestampTZFormat="YYYY-MM-DD_HH:MM:SS.zzzzz">',
    'Unused Date d; <DateFormat="DD/MM/YYYY">',
    'Date d; <Flag> <DateFormat="DD/MM/YYYY"> <Number=1>',
    'Date d; // the format follows\n    <DateFormat="DD/MM/YYYY">',
    'Date d; <DateFormat="DD/MM/YYYY"> Time t; <TimeFormat="HH.MM">',
    'Date d; <dateformat=1> <Other="x">', // only the exact format keys are checked
    'Categorical c; <Flag> <Number=1>',
  ]) {
    assertNoDiagnostics(`format metadata ${declarations}`, document(declarations));
  }

  const wrongType = (declarations, key, expected, actual) => {
    assertDiagnostic(`${key} on ${actual}`, document(declarations),
      `Meta-data '${key}' only applies to '${expected}' variables, not '${actual}'`);
  };
  wrongType('Time t; <DateFormat="DD/MM/YYYY">', 'DateFormat', 'Date', 'Time');
  wrongType('Timestamp s; <TimestampTZFormat="YYYY-MM-DD">', 'TimestampTZFormat', 'TimestampTZ', 'Timestamp');
  wrongType('Categorical c; <TimestampFormat="YYYY-MM-DD">', 'TimestampFormat', 'Timestamp', 'Categorical');
  wrongType('Numerical n; <Flag> <TimeFormat="HH.MM">', 'TimeFormat', 'Time', 'Numerical');
  wrongType('Date d; Time t; <DateFormat="DD/MM/YYYY">', 'DateFormat', 'Date', 'Time'); // the tag belongs to `t`

  for (const value of ['<DateFormat>', '<DateFormat=12>']) {
    assertDiagnostic(`non-string ${value}`, document(`Date d; ${value}`), "Meta-data 'DateFormat' needs a string value");
  }

  // The diagnostic covers the key, or the value when the key is right but the value is not.
  const [wrongKey] = diagnosticsFor(document('Time t; <DateFormat="x">'));
  assert.strictEqual(wrongKey.col, '    Time t; <'.length);
  assert.strictEqual(wrongKey.endCol - wrongKey.col, 'DateFormat'.length);
  const [wrongValue] = diagnosticsFor(document('Date d; <DateFormat=12>'));
  assert.strictEqual(wrongValue.col, '    Date d; <DateFormat='.length);
  assert.strictEqual(wrongValue.endCol - wrongValue.col, '12'.length);

  // A malformed tag is reported as such, and nothing more.
  assert.deepStrictEqual(messages('Time t; <DateFormat=abc>'), ['Invalid or unclosed metadata.']);
}

function testFormatStrings() {
  const document = (type, key, value) => `Dictionary Records\n{\n    ${type} v; <${key}=${value}>\n};`;

  // The documented lists: 16 date formats and 15 time formats.
  assert.strictEqual(formatsOf('Date').size, 16);
  assert.strictEqual(formatsOf('Time').size, 15);

  // Each of these is accepted, or rejected, by native Khiops as well.
  const valid = {
    Date: ['YYYY-MM-DD', 'DD/MM/YYYY', 'YYYY.DD.MM', 'MMDDYYYY'],
    Time: ['HH:MM:SS', 'HH:MM:SS.', '(H)H.(M)M', 'HHMM', 'HHMMSS.'],
    Timestamp: ['YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DDTHH:MM:SS.', 'YYYY-MM-DD_HH:MM:SS', 'MM/DD/YYYY-(H)H.(M)M', 'YYYYMMDDHHMMSS', 'YYYYMMDDHHMM'],
    TimestampTZ: ['YYYY-MM-DD HH:MM:SSzzzzzz', 'YYYY-MM-DD_HH:MM:SS.zzzzz', 'YYYYMMDDHHMMSS.zzzzzz'],
  };
  const invalid = {
    Date: ['', 'garbage', 'yyyy-mm-dd', 'YYYY-M-D', 'YY-MM-DD', 'YYYY_MM_DD', 'YYYY-MM/DD', 'YYYY-MM-DD '],
    Time: ['', 'HH', 'HH:MM:SS.SSS', 'H:M:S', 'HH:(M)M', '(H)H:MM:SS', 'hh:mm:ss', 'SS:MM:HH', 'HH-MM-SS'],
    Timestamp: ['YYYY-MM-DD', 'HH:MM:SS', 'YYYY-MM-DDHH:MM:SS', 'YYYYMMDDHH:MM:SS', 'YYYY-MM-DD  HH:MM:SS', 'YYYY-MM-DD:HH:MM:SS', 'HH:MM:SS YYYY-MM-DD'],
    TimestampTZ: ['YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DD HH:MM:SSz', 'YYYY-MM-DD HH:MM:SSzzzz', 'YYYY-MM-DD HH:MM:SSzzzzzzz', 'YYYY-MM-DD HH:MM:SS zzzzz', 'YYYY-MM-DD HH:MM:SSZZZZZ'],
  };
  for (const [type, key] of Object.entries(FORMAT_METADATA_KEYS)) {
    for (const format of valid[type]) {
      assert.ok(isValidFormat(type, format), `${type} format ${format}`);
      assertNoDiagnostics(`${key} ${format}`, document(type, key, `"${format}"`));
    }
    for (const format of invalid[type]) {
      assert.ok(!isValidFormat(type, format), `${type} format ${JSON.stringify(format)}`);
      assertDiagnostic(`${key} ${format}`, document(type, key, `"${format}"`), `Invalid ${type} format '${format}' in meta-data '${key}'`);
    }
  }
  // A format of another type is not valid either.
  assert.ok(!isValidFormat('Date', 'HH:MM:SS') && !isValidFormat('Time', 'YYYY-MM-DD'));

  // The diagnostic covers the string, quotes included, and points to the list of formats.
  const [found] = diagnosticsFor(document('Date', 'DateFormat', '"garbage"'));
  assert.strictEqual(found.col, '    Date v; <DateFormat='.length);
  assert.strictEqual(found.endCol - found.col, '"garbage"'.length);
  assert.ok(found.message.endsWith('https://khiops.org/api-docs/kdic/date-rules/'), found.message);
  assertDiagnostic('escaped quote', document('Date', 'DateFormat', '"a""b"'), `Invalid Date format 'a"b'`);
}

// The example formats offered by the snippets and by the metadata key completion must be valid.
function testFormatExamples() {
  const snippets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'snippets', 'kdic.code-snippets'), 'utf8'));
  const expand = body => body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$0/g, '');
  const formatSnippets = Object.values(snippets).flatMap(snippet => snippet.body).filter(body => body.includes('Format='));
  assert.strictEqual(formatSnippets.length, 4);
  for (const body of formatSnippets) {
    assertNoDiagnostics(`snippet ${body}`, `Dictionary Records\n{\n    ${expand(body)}\n};`);
  }

  const typeOf = Object.fromEntries(Object.entries(FORMAT_METADATA_KEYS).map(([type, key]) => [key, type]));
  assert.strictEqual(METADATA_KEYS.length, 4);
  for (const { label, insertText } of METADATA_KEYS) {
    assertNoDiagnostics(`completion ${label}`, `Dictionary Records\n{\n    ${typeOf[label]} v; <${expand(insertText)}>\n};`);
  }
}

function testConstantArguments() {
  const document = declaration => `Dictionary Records
{
    Categorical text;
    Numerical number;
    Table(Records) rows;
    ${declaration}
};`;
  const messages = declaration => diagnosticsFor(document(declaration)).map(diagnostic => diagnostic.message);

  for (const declaration of [
    'Categorical x = Concat("a", "b");',
    'Categorical x = Concat(text, "b", text);',
    'Numerical x = Sum(number, 3, -1.5, #Missing);',
    'Categorical x = Replace("abc", 1, "b", "c");',
    'Numerical x = TableMean(rows, 3);',
    'Numerical x = TableMean(rows, #Missing);',
    'Numerical x = Sum(number, Sum(1, "a"));', // nested calls are not checked
  ]) {
    assertNoDiagnostics(declaration, document(declaration));
  }

  const mismatch = (constant, type, rule, expected, argument) =>
    `Constant ${constant} is '${type}' but '${rule}' expects '${expected}' for argument ${argument}.`;
  for (const [declaration, expected] of [
    ['Categorical x = Concat("a", #Missing);', mismatch('#Missing', 'Numerical', 'Concat', 'Categorical', 2)],
    ['Categorical x = Concat("a", 3);', mismatch('3', 'Numerical', 'Concat', 'Categorical', 2)],
    ['Categorical x = Concat(3, "a");', mismatch('3', 'Numerical', 'Concat', 'Categorical', 1)],
    ['Numerical x = Sum(number, "a");', mismatch('"a"', 'Categorical', 'Sum', 'Numerical', 2)],
    ['Numerical x = Sum("a", 1);', mismatch('"a"', 'Categorical', 'Sum', 'Numerical', 1)],
    ['Categorical x = Replace("abc", "1", "b", "c");', mismatch('"1"', 'Categorical', 'Replace', 'Numerical', 2)],
    ['Numerical x = TableMean(rows, "a");', mismatch('"a"', 'Categorical', 'TableMean', 'Numerical', 2)], // any scope
  ]) {
    assert.deepStrictEqual(messages(declaration), [expected], declaration);
  }

  // A variable of the wrong type is also found where a rule repeats its last parameter.
  assert.deepStrictEqual(messages('Numerical x = Sum(number, text);'),
    ["'text' is 'Categorical' but 'Sum' expects 'Numerical' for argument 2."]);

  // The diagnostic covers the constant, which is shortened in the message when long.
  const [found] = diagnosticsFor(document('Numerical x = Sum(number, "a");'));
  assert.strictEqual(found.col, '    Numerical x = Sum(number, '.length);
  assert.strictEqual(found.endCol - found.col, '"a"'.length);
  const [long] = messages(`Numerical x = Sum(number, "${'a'.repeat(100)}");`);
  assert.ok(long.length < 120 && long.includes('…'), long);

  // Rules the signature does not describe well are left to Khiops.
  assertNoDiagnostics('extra operands of an untyped rule', document('Categorical x = Deploy(rows, 1, rows, text, "a", 3);'));
  assertNoDiagnostics('call with fewer arguments than parameters', document('Numerical x = Overloaded(text, 1);'));
  assert.deepStrictEqual(messages('Numerical x = Overloaded(text, "t", "r");'),
    [mismatch('"r"', 'Categorical', 'Overloaded', 'Numerical', 3)]);
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
  testFormatMetadata();
  testFormatStrings();
  testFormatExamples();
  testConstantArguments();
  testDictionaryKeysAndNames();
  testDerivationConstants();
  testDerivationArgumentScopes();
  console.log('validator tests passed');
}

run();