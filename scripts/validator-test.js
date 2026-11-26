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
const { parseCall } = require(path.join(__dirname, '..', 'out', 'validation', 'call-tree.js'));
const { KdicTextDocument } = require(path.join(__dirname, '..', 'out', 'kdic-text-document.js'));
const { formatsOf, isValidFormat } = require(path.join(__dirname, '..', 'out', 'date-time-formats.js'));
const { FORMAT_METADATA_KEYS } = require(path.join(__dirname, '..', 'out', 'kdic-syntax.js'));
const { METADATA_KEYS } = require(path.join(__dirname, '..', 'out', 'language-data.js'));

function createDocument(text) {
  return new KdicTextDocument(text.replace(/\r\n/g, '\n'));
}

const { validate } = validator;
const { DERIVATION_RULES } = require(path.join(__dirname, '..', 'out', 'derivation-rules.js'));
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
  { label: 'Length', returnType: 'Numerical', signature: 'Length(Categorical value)' },
  { label: 'Pick', returnType: 'Numerical|Categorical', signature: 'Pick(Numerical index, Categorical value)' },
  { label: 'Anything', returnType: 'any', signature: 'Anything(Numerical value)' },
  { label: 'GE', returnType: 'Numerical', signature: 'GE(Numerical value1, Numerical value2)' },
  { label: 'EQc', returnType: 'Numerical', signature: 'EQc(Categorical value1, Categorical value2)' },
  { label: 'Select', returnType: 'Table', signature: 'Select(Table table, Numerical criterion)', operandScopes: ['current', 'secondary'] },
  { label: 'GetValue', returnType: 'Numerical', signature: 'GetValue(Entity entity, Numerical value)', operandScopes: ['current', 'secondary'] },
  { label: 'TableAtRank', returnType: 'Entity', signature: 'TableAtRank(Table table, Numerical rank)', operandScopes: ['current', 'current'] },
  { label: 'BuildJoin', returnType: 'Table', signature: 'BuildJoin(Table source, Categorical sourceKey, Table history, Date historicalDate)', operandScopes: ['current', { tableArgument: 0 }, 'current', { tableArgument: 2 }] },
  { label: 'BuildMappedTest', returnType: 'Entity', signature: 'BuildMappedTest(Categorical source : any target, ...)' },
  ...DERIVATION_RULES.filter(rule => rule.detail === 'instance building'),
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
  // A statement that starts with a word that is not a type is an error, reported once, without the unknown-line warning.
  const notAType = word => [[0, `'${word}' is not a type: a declaration starts with 'Unused' or a type.`]];
  const summary = text => diagnosticsFor(text).map(d => [d.severity, d.message]);
  assert.deepStrictEqual(summary('Dictionary Records\n{\n not a declaration\n};'), notAType('not'));
  assert.deepStrictEqual(summary('Dictionary Records\n{\n Symbol Date;\n};'), notAType('Symbol'));
  // Anything else that no pattern recognizes stays a warning: the grammar is only a set of patterns.
  const unknownLine = diagnosticsFor('Dictionary Records\n{\n 12 apples;\n};');
  assert.ok(unknownLine.some(d => d.severity === 1 && d.message.includes('Line does not match kdic grammar')));
  assert.ok(!unknownLine.some(d => d.severity === 0));

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

  assertNoDiagnostics('balanced multiline nested delimiters', `Root Dictionary Records
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

  // Khiops writes `}<tab>Name<tab>;`, with block metadata after the semicolon.
  assertNoDiagnostics('variable block closed with blanks before the semicolon', `Dictionary Document
{
\tCategorical id;
\t{
\tNumerical archive\t; <VarKey=1>
\t}\tWords\t; <DefaultNumericalValue=0>
\t{
\tNumerical other; <VarKey=1>
\t} \`Other words\` = CopyBlock(Words) ;
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
  assertNoDiagnostics('call with more arguments than parameters', document('Numerical x = Overloaded(text, "t", "r", 1);'));
  assert.deepStrictEqual(messages('Numerical x = Overloaded(text, "t", "r");'),
    [mismatch('"r"', 'Categorical', 'Overloaded', 'Numerical', 3)]);
}

function testBackquotedVariableArguments() {
  const document = declaration => `Dictionary Records
{
    Categorical \`the text\`;
    Numerical \`a \`\`quoted\`\` number\`;
    Numerical plain;
    Table(Records) rows;
    ${declaration}
};`;
  const diagnostics = declaration => diagnosticsFor(document(declaration));

  for (const declaration of [
    'Categorical x = Concat(`the text`, "b");',
    'Numerical x = Sum(`a ``quoted`` number`, 1, `a ``quoted`` number`);',
    'Numerical x = Sum(`plain`, plain);',          // backquotes around a plain name denote the same variable
    'Numerical x = TableMean(rows, `a ``quoted`` number`);', // looked up in the dictionary of `rows`, which is this one
  ]) {
    assertNoDiagnostics(declaration, document(declaration));
  }

  // The message names the variable as declared, without backquotes.
  assert.deepStrictEqual(diagnostics('Numerical x = Sum(`the text`, 1);').map(d => d.message),
    ["'the text' is 'Categorical' but 'Sum' expects 'Numerical' for argument 1."]);
  assert.deepStrictEqual(diagnostics('Categorical x = Concat("a", `a ``quoted`` number`);').map(d => d.message),
    ["'a `quoted` number' is 'Numerical' but 'Concat' expects 'Categorical' for argument 2."]);
  assert.deepStrictEqual(diagnostics('Categorical x = Concat(`plain`, "b");').map(d => d.message),
    ["'plain' is 'Numerical' but 'Concat' expects 'Categorical' for argument 1."]);

  // The diagnostic covers the whole quoted token; an undeclared name is a warning.
  const [mismatch] = diagnostics('Numerical x = Sum(`the text`, 1);');
  assert.strictEqual(mismatch.col, '    Numerical x = Sum('.length);
  assert.strictEqual(mismatch.endCol - mismatch.col, '`the text`'.length);
  const [undeclared] = diagnostics('Numerical x = Sum(`no such variable`, 1);');
  assert.strictEqual(undeclared.message, "'no such variable' is not declared in this dictionary.");
  assert.strictEqual(undeclared.severity, 1);
}

function testNestedCalls() {
  const document = declaration => `Dictionary Records
{
    Categorical text;
    Numerical number;
    Table(Records) rows;
    ${declaration}
};`;
  const diagnostics = declaration => diagnosticsFor(document(declaration));
  const messages = declaration => diagnostics(declaration).map(diagnostic => diagnostic.message);

  for (const declaration of [
    'Numerical x = Sum(number, Length(Concat(text, "b")));',
    'Numerical x = Sum(number, Sum(number, 1), 3);',
    'Numerical x = TableCount(TableDifference(rows, rows));',
    'Numerical x = Sum(Length(text), Pick(1, "a"));',           // a result with several possible types
    'Categorical x = Concat(Pick(1, "a"), "b");',
    'Numerical x = Sum(number, Anything(1));',                  // a result of unknown type
    'Numerical x = TableMean(rows, Sum(number, 1));',           // inside a secondary operand, in the dictionary of `rows`
    'Numerical x = Unknown(Sum(number, 1), Sum(undeclared, 2));', // an unknown rule: its operands have no known scope
    'Numerical x = Sum(number, Sum(number, Sum(number, 1)));',
  ]) {
    assertNoDiagnostics(declaration, document(declaration));
  }

  const result = (nested, type, rule, expected, argument) =>
    `'${nested}' returns '${type}' but '${rule}' expects '${expected}' for argument ${argument}.`;
  for (const [declaration, expected] of [
    ['Numerical x = Sum(number, Concat(text, "b"));', [result('Concat', 'Categorical', 'Sum', 'Numerical', 2)]],
    ['Categorical x = Concat(text, Sum(number, 1));', [result('Sum', 'Numerical', 'Concat', 'Categorical', 2)]],
    ['Numerical x = TableCount(Sum(number, 1));', [result('Sum', 'Numerical', 'TableCount', 'Table', 1)]],
    ['Numerical x = TableCount(TableAt(rows, 1));', [result('TableAt', 'Entity', 'TableCount', 'Table', 1)]],
    ['Numerical x = TableMean(rows, Concat("a"));', [result('Concat', 'Categorical', 'TableMean', 'Numerical', 2)]], // any scope
    ['Numerical x = Sum(Concat(text), Concat(text));',
      [result('Concat', 'Categorical', 'Sum', 'Numerical', 1), result('Concat', 'Categorical', 'Sum', 'Numerical', 2)]],
    // the calls nested in a nested call are checked with their own parameters
    ['Numerical x = Sum(number, Sum(Length(number), 1));', ["'number' is 'Numerical' but 'Length' expects 'Categorical' for argument 1."]],
    ['Numerical x = Sum(number, Sum(1, "a"));', [`Constant "a" is 'Categorical' but 'Sum' expects 'Numerical' for argument 2.`]],
    ['Numerical x = Unknown(Sum(number, "a"));', [`Constant "a" is 'Categorical' but 'Sum' expects 'Numerical' for argument 2.`]],
    ['Numerical x = TableMean(rows, Sum(number, "a"));', [`Constant "a" is 'Categorical' but 'Sum' expects 'Numerical' for argument 2.`]],
    // and the return type of the whole derivation, however deeply it is nested
    ['Categorical x = Sum(number, Sum(number, 1));', ["'Sum' returns 'Numerical' but variable is declared as 'Categorical'."]],
  ]) {
    assert.deepStrictEqual(messages(declaration), expected, declaration);
  }

  // A nested call is current-scope where its parent operand is: its variables are checked.
  const [undeclared] = diagnostics('Numerical x = Sum(number, Sum(undeclared, 1));');
  assert.strictEqual(undeclared.message, "'undeclared' is not declared in this dictionary.");
  assert.strictEqual(undeclared.severity, 1);

  // The diagnostic covers the name of the nested rule.
  const [mismatch] = diagnostics('Numerical x = Sum(number, Concat(text, "b"));');
  assert.strictEqual(mismatch.col, '    Numerical x = Sum(number, '.length);
  assert.strictEqual(mismatch.endCol - mismatch.col, 'Concat'.length);

  // A call that is not closed, as while typing, is not checked; nor is one nested too deeply.
  assert.ok(!messages('Numerical x = Sum(number, Concat(text);').some(message => message.includes('expects')));
  assert.ok(!messages('Numerical x = Sum(number, Concat(text, ').some(message => message.includes('expects')));
  const deep = `Numerical x = ${'Sum(1, '.repeat(150)}"a"${')'.repeat(150)};`;
  assert.doesNotThrow(() => diagnostics(deep));
}

function testSecondaryScopes() {
  const document = (body, extra = '') => `Dictionary Client
{
    Categorical id;
    Numerical age;
    Table(Purchase) purchases;
    Entity(Purchase) last;
    ${body}
};
Dictionary Purchase
{
    Numerical amount;
    Categorical shop;
    Numerical \`unit price\`;
};${extra}`;
  const diagnostics = (body, extra) => diagnosticsFor(document(body, extra));
  const messages = (body, extra) => diagnostics(body, extra).map(diagnostic => diagnostic.message);

  for (const body of [
    'Numerical x = TableMean(purchases, amount);',
    'Numerical x = TableMean(purchases, `unit price`);',
    'Numerical x = GetValue(last, amount);',
    'Numerical x = TableMean(purchases, Sum(amount, 1));',            // the whole operand is in the secondary table
    'Table(Purchase) x = Select(purchases, GE(amount, 10));',         // also inside a criterion
    'Numerical x = TableCount(Select(purchases, GE(amount, 10)));',
    'Entity(Purchase) x = TableAtRank(purchases, age);',               // an operand documented as current
    'Numerical x = Sum(TableMean(purchases, amount), age);',           // each rule has its own scope
    'Numerical x = TableMean(Select(purchases, GE(amount, 1)), anything);', // first operand not a variable: scope unknown
  ]) {
    assertNoDiagnostics(body, document(body));
  }
  // The dictionary a table points to is not declared: only that is reported, not the operand.
  assert.deepStrictEqual(messages('Table(Missing) lost;\n    Numerical x = TableMean(lost, anything);'),
    ["Dictionary 'Missing' is not declared in this file."]);
  // Several dictionaries with the name: which one is meant is not known, so only the duplicate is reported.
  assert.deepStrictEqual(messages('Numerical x = TableMean(purchases, anything);', '\nDictionary Purchase\n{\n    Numerical other;\n};'),
    ["Dictionary 'Purchase' is declared more than once."]);

  const mismatch = (name, actual, rule, expected, argument) =>
    `'${name}' is '${actual}' but '${rule}' expects '${expected}' for argument ${argument}.`;
  for (const [body, expected] of [
    ['Numerical x = TableMean(purchases, shop);', [mismatch('shop', 'Categorical', 'TableMean', 'Numerical', 2)]],
    ['Numerical x = GetValue(last, shop);', [mismatch('shop', 'Categorical', 'GetValue', 'Numerical', 2)]],
    ['Numerical x = TableMean(purchases, Sum(shop, 1));', [mismatch('shop', 'Categorical', 'Sum', 'Numerical', 1)]],
    ['Table(Purchase) x = Select(purchases, GE(shop, 10));', [mismatch('shop', 'Categorical', 'GE', 'Numerical', 1)]],
    ['Numerical x = TableMean(purchases, age);', ["'age' is not declared in dictionary 'Purchase'."]],
    ['Numerical x = TableMean(purchases, `no such variable`);', ["'no such variable' is not declared in dictionary 'Purchase'."]],
    ['Entity(Purchase) x = TableAtRank(purchases, amount);', ["'amount' is not declared in this dictionary."]],
    ['Entity(Purchase) x = TableAtRank(purchases, id);', [mismatch('id', 'Categorical', 'TableAtRank', 'Numerical', 2)]],
    // a first operand that is not a table gives no scope to the next one, which is then not checked
    ['Numerical x = TableMean(age, anything);', [mismatch('age', 'Numerical', 'TableMean', 'Table', 1)]],
    ['Numerical x = TableMean(undeclared, anything);', ["'undeclared' is not declared in this dictionary."]],
  ]) {
    assert.deepStrictEqual(messages(body), expected, body);
  }

  // A missing variable is a warning; a wrong type an error.
  const [missing] = diagnostics('Numerical x = TableMean(purchases, age);');
  assert.strictEqual(missing.severity, 1);
  assert.strictEqual(diagnostics('Numerical x = TableMean(purchases, shop);')[0].severity, 0);
  // The diagnostic covers the operand.
  assert.strictEqual(missing.col, '    Numerical x = TableMean(purchases, '.length);
  assert.strictEqual(missing.endCol - missing.col, 'age'.length);
}

function testScopeOperator() {
  const document = body => `Dictionary Client
{
    Categorical id;
    Numerical age;
    Categorical segment;
    Table(Purchase) purchases;
    Table(Purchase) others;
    ${body}
};
Dictionary Purchase
{
    Numerical amount;
    Categorical shop;
    Table(Item) items;
};
Dictionary Item
{
    Numerical price;
    Categorical sku;
};`;
  const diagnostics = body => diagnosticsFor(document(body));
  const messages = body => diagnostics(body).map(diagnostic => diagnostic.message);
  const select = criterion => `Table(Purchase) x = Select(purchases, ${criterion});`;
  const deeper = criterion => select(`GE(TableCount(Select(items, ${criterion})), 1)`);

  for (const body of [
    select('GE(amount, .age)'),
    select('EQc(shop, .segment)'),
    select('GE(amount, . age)'),                          // a space after the dot is allowed
    select('GE(amount, .Sum(age, 1))'),                   // a call behind a dot is evaluated one scope up
    select('GE(amount, .Sum(.age, 1))'),                  // dots inside it count from where the operand is written
    select('GE(TableCount(.others), 1)'),                 // the first operand of a nested table rule
    deeper('GE(price, ..age)'),                           // two dots: two scopes up
    deeper('GE(price, .amount)'),
    'Numerical x = Mystery(purchases, .age);',            // an unregistered rule: its scope is unknown
    'Numerical x = Overloaded(segment, "t", 1, .age);',    // a rule called in a form its signature does not describe
    'Numerical x = TableMean(Select(purchases, GE(amount, 1)), .age);',
  ]) {
    assertNoDiagnostics(body, document(body));
  }

  const beyond = dots => [`Scope operator '${dots}' goes beyond the depth of the calling rules.`];
  const mismatch = (name, actual, rule, expected, argument) =>
    [`'${name}' is '${actual}' but '${rule}' expects '${expected}' for argument ${argument}.`];
  for (const [body, expected] of [
    [select('GE(amount, .amount)'), ["'amount' is not declared in this dictionary."]],      // not in the scope above
    [select('EQc(shop, .age)'), mismatch('age', 'Numerical', 'EQc', 'Categorical', 2)],
    [select('EQc(shop, .Sum(age, 1))'), ["'Sum' returns 'Numerical' but 'EQc' expects 'Categorical' for argument 2."]],
    [select('GE(amount, .Sum(amount, 1))'), ["'amount' is not declared in this dictionary."]], // the call is evaluated in Client
    [select('GE(amount, .Sum(..age, 1))'), beyond('..')],
    [deeper('GE(price, .age)'), ["'age' is not declared in dictionary 'Purchase'."]],
    [deeper('GE(price, ..amount)'), ["'amount' is not declared in this dictionary."]],
    ['Numerical x = Sum(.age, 1);', beyond('.')],
    [select('GE(amount, ..age)'), beyond('..')],
    [select('GE(TableCount(..others), 1)'), beyond('..')],
    ['Numerical x = Sum(.Sum(age, 1), 1);', beyond('.')],
  ]) {
    assert.deepStrictEqual(messages(body), expected, body);
  }

  // A missing variable is a warning, a wrong type or a scope beyond the depth an error.
  assert.strictEqual(diagnostics(select('GE(amount, .amount)'))[0].severity, 1);
  assert.strictEqual(diagnostics(select('EQc(shop, .age)'))[0].severity, 0);
  assert.strictEqual(diagnostics('Numerical x = Sum(.age, 1);')[0].severity, 0);

  // The error covers the dots, the other diagnostics the variable.
  const [dots] = diagnostics('Numerical x = Sum(..age, 1);');
  assert.strictEqual(dots.col, '    Numerical x = Sum('.length);
  assert.strictEqual(dots.endCol - dots.col, 2);
  const [variable] = diagnostics(select('EQc(shop, .age)'));
  assert.strictEqual(variable.col, '    Table(Purchase) x = Select(purchases, EQc(shop, .'.length);
  assert.strictEqual(variable.endCol - variable.col, 'age'.length);
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
  assertDiagnostic('unquoted name with spaces', 'Dictionary Records\n{\n Categorical bad name;\n};', "Unexpected 'name' after variable name 'bad'");

  // A keyword is a valid name for Khiops, which objects to the word after it. The word is reported, once per
  // declaration, and the repeated name is not taken for a duplicate.
  const extraWord = diagnosticsFor('Dictionary Records\n{\n\tDate\tCategorical\t`A`\t;\n\tDate\tCategorical\t`B`\t;\n};');
  assert.deepStrictEqual(extraWord.map(d => [d.line, d.col, d.endCol, d.message]), [
    [2, 'Date\tCategorical\t'.length + 1, 'Date\tCategorical\t'.length + 4, "Unexpected 'A' after variable name 'Categorical': ';' expected. A name with spaces needs backquotes."],
    [3, 'Date\tCategorical\t'.length + 1, 'Date\tCategorical\t'.length + 4, "Unexpected 'B' after variable name 'Categorical': ';' expected. A name with spaces needs backquotes."],
  ]);
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

function testRuleCallOutputMappings() {
  const parse = text => {
    const tokens = tokenizeKdic(text);
    return parseCall(tokens, 0, tokens.length);
  };
  const unmapped = parse('BuildRule(source)');
  assert.ok(unmapped);
  assert.strictEqual(unmapped.outputNames, undefined);

  const empty = parse('BuildRule(source :)');
  assert.ok(empty);
  assert.deepStrictEqual(empty.outputNames, []);
  assert.ok(empty.outputSeparator);

  const mapped = parse('BuildRule(source, Sum(value, 1) : `target field`, other)');
  assert.ok(mapped);
  assert.deepStrictEqual(mapped.args.map(argument => argument.kind), ['variable', 'call']);
  assert.deepStrictEqual(mapped.outputNames.map(token => token.text), ['`target field`', 'other']);
  assert.strictEqual(mapped.outputSeparator.text, ':');

  const quotedColon = parse('Rule("value:still input")');
  assert.ok(quotedColon);
  assert.strictEqual(quotedColon.outputNames, undefined);

  assertNoDiagnostics('colon is not an output mapping for ordinary rules', `Dictionary Main
{
    Numerical result = TableCount(DNAExtended : Type);
};`);
  assertNoDiagnostics('mapped target variable', `Dictionary Main
{
    Categorical source;
    Entity(Target) result = BuildMappedTest(source : targetValue);
};
Dictionary Target
{
    Categorical targetValue;
};`);
  assertDiagnostic('unknown mapped target variable', `Dictionary Main
{
    Categorical source;
    Entity(Target) result = BuildMappedTest(source : absent);
};
Dictionary Target
{
    Numerical targetValue;
};`, "is not declared in target dictionary 'Target'");

  assertDiagnostic('BuildEntity source and target types must match', `Dictionary Main
{
    Numerical source;
    Entity(Target) result = BuildEntity(source : targetValue);
};
Dictionary Target
{
    Categorical targetValue;
};`, "'BuildEntity' maps a 'Numerical' value to 'targetValue' of type 'Categorical'");
  assertDiagnostic('BuildEntity return type', `Dictionary Main
{
    Numerical source;
    Numerical result = BuildEntity(source : targetValue);
};
Dictionary Target
{
    Numerical targetValue;
};`, "'BuildEntity' returns 'Entity' but variable is declared as 'Numerical'");
  assertDiagnostic('BuildTableAdvancedView source and target types must match', `Root Dictionary Main (id)
{
    Categorical id;
    Table(Source) source;
    Table(Target) result = BuildTableAdvancedView(source, 1 : targetValue);
};
Dictionary Source (id)
{
    Categorical id;
};
Dictionary Target
{
    Categorical targetValue;
};`, "'BuildTableAdvancedView' maps a 'Numerical' value to 'targetValue' of type 'Categorical'");
  assertDiagnostic('BuildDiffTable target type', `Root Dictionary Main (id)
{
    Categorical id;
    Table(Source) source;
    Table(Target) result = BuildDiffTable(source, value : difference);
};
Dictionary Source (id)
{
    Categorical id;
    Numerical value;
};
Dictionary Target
{
    Categorical difference;
};`, "'difference' is 'Categorical' but 'BuildDiffTable' requires 'Numerical' for output 1");
  assertDiagnostic('BuildEntity source and target counts must match', `Dictionary Main
{
    Numerical first;
    Numerical second;
    Entity(Target) result = BuildEntity(first, second : targetValue);
};
Dictionary Target
{
    Numerical targetValue;
};`, "'BuildEntity' has 1 output names for 2 mapped source operands");
  assertDiagnostic('table creation rules cannot be nested', `Root Dictionary Main (id)
{
    Categorical id;
    Table(Source) source;
    Table(Target) result = BuildTableAdvancedView(BuildTableView(source), value : targetValue);
};
Dictionary Source (id)
{
    Categorical id;
    Numerical value;
};
Dictionary Target
{
    Numerical targetValue;
};`, "'BuildTableView' cannot be used as an operand of 'BuildTableAdvancedView'");
  assertDiagnostic('entity creation rules cannot be nested', `Dictionary Main
{
    Numerical source;
    Entity(Outer) result = BuildEntity(BuildEntity(source : value) : inner);
};
Dictionary Outer
{
    Entity(Inner) inner;
};
Dictionary Inner
{
    Numerical value;
};`, "'BuildEntity' cannot be used as an operand of 'BuildEntity'");
  assertDiagnostic('fixed output mappings require every target name', `Root Dictionary Main (id)
{
    Categorical id;
    Table(Source) source;
    Table(Link) result = BuildList(source : sourceEntity, previousElement);
};
Dictionary Source (id)
{
    Categorical id;
};
Dictionary Link
{
    Entity(Source) sourceEntity;
    Entity(Link) previousElement;
    Entity(Link) nextElement;
};`, "'BuildList' requires 3 output names but has 2");
  assertNoDiagnostics('unverified temporal rule remains unchecked', `Dictionary Main
{
    Numerical result = BuildTemporalJoin(1 : absent);
};
Dictionary Target
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

/** Dictionary text for the schema tests: the key fields are declared, `body` follows. */
const dictionaryText = (name, keys, body = '', root = false) =>
  `${root ? 'Root ' : ''}Dictionary ${name}${keys.length ? ` (${keys.join(', ')})` : ''}\n{\n${keys.map(key => `  Categorical ${key};`).join('\n')}\n${body}\n};`;

function testMultipleTableArgumentScopes() {
  const text = `Dictionary Main
{
    Numerical sourceKey;
    Date historicalDate;
    Table(Source) source;
    Table(Historical) history;
    Table(Output) joined = BuildJoin(source, sourceKey, history, historicalDate);
};
Dictionary Source
{
    Numerical sourceKey;
};
Dictionary Historical
{
    Categorical historicalDate;
};
Dictionary Output
{
};`;
  assert.deepStrictEqual(diagnosticsFor(text).map(diagnostic => diagnostic.message), [
    "'sourceKey' is 'Numerical' but 'BuildJoin' expects 'Categorical' for argument 2.",
    "'historicalDate' is 'Categorical' but 'BuildJoin' expects 'Date' for argument 4.",
  ]);
}

function testDuplicateAndEdgeSpaceNames() {
  const messages = text => diagnosticsFor(text).map(diagnostic => diagnostic.message);
  const block = (member, tail) => `{\n  Numerical ${member}; <VarKey=1>\n} ${tail};`;
  const inDictionary = body => `Dictionary D\n{\n${body}\n};`;

  for (const [name, body, expected] of [
    ['two variables', 'Numerical a;\nCategorical a;', ["Variable name 'a' is already used by a variable."]],
    ['a name written with and without backquotes', 'Numerical a;\nNumerical `a`;', ["Variable name 'a' is already used by a variable."]],
    ['an Unused variable', 'Numerical a;\nUnused Numerical a;', ["Variable name 'a' is already used by a variable."]],
    ['a block member and a variable', `Numerical x;\n${block('x', 'B')}`, ["Variable name 'x' is already used by a variable."]],
    ['a variable then a block', `Numerical a;\n${block('x', 'a')}`, ["Variable block name 'a' is already used by a variable."]],
    ['a block then a variable', `${block('x', 'a')}\nNumerical a;`, ["Variable name 'a' is already used by a variable block."]],
    ['two blocks', `${block('x', 'B')}\n${block('y', 'B')}`, ["Variable block name 'B' is already used by a variable block."]],
    ['a block name with a space at its end', block('x', '`B `'), ["Variable block name 'B ' must not start or end with a space."]],
    ['names that differ by their case', 'Numerical a;\nNumerical A;', []],
    ['the same name in two blocks', `${block('x', 'B1')}\n${block('y', 'B2')}`, []],
  ]) {
    assert.deepStrictEqual(messages(inDictionary(body)), expected, name);
  }

  assert.deepStrictEqual(messages('Dictionary D\n{\n Numerical a;\n};\nDictionary D\n{\n Numerical b;\n};'),
    ["Dictionary 'D' is declared more than once."]);
  assert.deepStrictEqual(messages('Dictionary D\n{\n Numerical a;\n};\nDictionary E\n{\n Numerical a;\n};'), [], 'the same variable in two dictionaries');
  assert.deepStrictEqual(messages('Dictionary `D `\n{\n Numerical a;\n};'), ["Dictionary name 'D ' must not start or end with a space."]);
  assert.deepStrictEqual(messages('Dictionary ` D`\n{\n Numerical a;\n};'), ["Dictionary name ' D' must not start or end with a space."]);
  assert.deepStrictEqual(messages('Dictionary `D E`\n{\n Numerical a;\n};'), [], 'a space inside a name');
  assert.deepStrictEqual(messages('Dictionary `D `\n{\n Numerical a;\n};\nDictionary E\n{\n Table(`D `) t;\n};'),
    ["Dictionary name 'D ' must not start or end with a space.", "Referenced dictionary name 'D ' must not start or end with a space."]);
}

function testRelationSchema() {
  const messages = (...dictionaries) => diagnosticsFor(dictionaries.join('\n')).map(diagnostic => diagnostic.message);
  const [K, K2, K3] = [['K'], ['K', 'K2'], ['K', 'K2', 'K3']];
  const shorter = (child, cn, parent, pn) => `The key of dictionary '${child}' (${cn}) must not be shorter than that of its parent dictionary '${parent}' (${pn}).`;
  const longer = (child, cn, parent, pn) => `The key of dictionary '${child}' (${cn}) must be longer than that of its parent dictionary '${parent}' (${pn}), as it has relation variables of its own.`;

  // A root dictionary has a key and is no component; the key of a component is not shorter than its parent's.
  assert.deepStrictEqual(messages(dictionaryText('P', [], '', true)), ["Root dictionary 'P' must have a key."]);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Entity(C) c;', true), dictionaryText('C', K, '', true)),
    ["Dictionary 'C' is a root dictionary: it cannot be the target of a Entity variable, unless the variable has a key between brackets."]);
  assert.deepStrictEqual(messages(dictionaryText('P', K2, '  Table(C) t;', true), dictionaryText('C', K)), [shorter('C', 1, 'P', 2)]);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) t;', true), dictionaryText('C', [])),
    ["Dictionary 'C' must have a key, as the target of Table variable 't'."]);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) t;', true), dictionaryText('C', K2)), [], 'a longer key');
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) t;', true), dictionaryText('C', K)), [], 'a leaf with the same key');

  // Under a Table, a dictionary with relations of its own needs a longer key; under an Entity it does not. Unused counts.
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) t;', true), dictionaryText('C', K, '  Table(E) u;'), dictionaryText('E', K2)),
    [longer('C', 1, 'P', 1)]);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) t;', true), dictionaryText('C', K, '  Unused Entity(E) u;'), dictionaryText('E', K2)),
    [longer('C', 1, 'P', 1)]);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Entity(C) t;', true), dictionaryText('C', K, '  Table(E) u;'), dictionaryText('E', K2)), []);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) t;', true), dictionaryText('C', K2, '  Table(E) u;'), dictionaryText('E', K3)), []);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) t;', true), dictionaryText('C', K2, '  Table(E) u;'), dictionaryText('E', K)),
    [shorter('E', 1, 'C', 2)]);

  // Only the dictionaries reached from a root are checked, and only through native relations.
  assert.deepStrictEqual(messages(dictionaryText('P', K2, '  Table(C) t;'), dictionaryText('C', K)), [], 'not reached from a root');
  assert.deepStrictEqual(messages(dictionaryText('P', K2, '  Table(C) t = TableSelection(t, GE(a, 1));', true), dictionaryText('C', K)).filter(message => message.startsWith('The key')), [], 'a derived relation');
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) t;', true),
    dictionaryText('C', K, '  {\n    Table(E) v; <VarKey=1>\n  } B = Rule(t);'), dictionaryText('E', [])).filter(message => message.includes('key')), [],
  'a variable of a block is not a component');

  // An external entity refers to a root dictionary, with as many keys as it has; they may be computed.
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Entity(C) c [K];', true), dictionaryText('C', K, '', true)), []);
  assert.deepStrictEqual(messages(dictionaryText('P', K2, '  Entity(C) c [K];', true), dictionaryText('C', K, '', true)), [], 'no hierarchy for an external entity');
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Entity(C) c [Concat("", K)];', true), dictionaryText('C', K, '', true)), [], 'a computed key');
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Entity(C) c [K];', true), dictionaryText('C', K)),
    ["Dictionary 'C' must be a root dictionary, as the target of external entity 'c'."]);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Entity(C) c [K];', true), dictionaryText('C', K2, '', true)),
    ["External entity 'c' has 1 key field(s), but dictionary 'C' has 2."]);
  assert.deepStrictEqual(messages(dictionaryText('P', K, '  Table(C) c [K];', true), dictionaryText('C', K, '', true)),
    ["Variable 'c' has a key between brackets: it must be an 'Entity'."]);
}

function testVariableBlockKeys() {
  const messages = (members, tail = 'B;', type = 'Numerical') => diagnosticsFor(
    `Dictionary D\n{\n  {\n${members.map((tags, index) => `    ${type} v${index}; ${tags}`).join('\n')}\n  } ${tail}\n};`).map(diagnostic => diagnostic.message);
  const missing = index => `Meta-data VarKey must be specified for variable 'v${index}' of a variable block.`;

  for (const [name, members, expected] of [
    ['integer keys', ['<VarKey=1>', '<VarKey=2>'], []],
    ['string keys', ['<VarKey="a">', '<VarKey="b">'], []],
    ['a numeric string is a string', ['<VarKey="1">'], []],
    ['a key given in scientific notation', ['<VarKey=1e3>'], []],
    ['the largest key', ['<VarKey=1000000000>'], []],
    ['a key on every member of a block, with other tags', ['<Cost=1> <VarKey=1>', '<VarKey=2> <Cost=2>'], []],
    ['no key', ['', ''], [missing(0), missing(1)]],
    ['the second without a key', ['<VarKey=1>', ''], [missing(1)]],
    ['a single member without a key', [''], [missing(0)]],
    ['a repeated integer', ['<VarKey=1>', '<VarKey=01>'], ['Meta-data VarKey 01 is already used by variable \'v0\' of the block.']],
    ['a repeated string', ['<VarKey="a">', '<VarKey="a">'], ['Meta-data VarKey "a" is already used by variable \'v0\' of the block.']],
    ['a string after integers', ['<VarKey=1>', '<VarKey="b">'], ['Meta-data VarKey must be an integer, like the other keys of the block.']],
    ['an integer after strings', ['<VarKey="a">', '<VarKey=2>'], ['Meta-data VarKey must be a string, like the other keys of the block.']],
    ['zero', ['<VarKey=0>'], ['Meta-data VarKey must be between 1 and 1,000,000,000.']],
    ['a negative key', ['<VarKey=-1>'], ['Meta-data VarKey must be between 1 and 1,000,000,000.']],
    ['a key above the largest', ['<VarKey=1000000001>'], ['Meta-data VarKey must be between 1 and 1,000,000,000.']],
    ['a decimal key', ['<VarKey=1.5>'], ['Meta-data VarKey must be an integer.']],
    ['an empty string', ['<VarKey="">'], ['Meta-data VarKey must not be empty.']],
    ['a key without value is left alone', ['<VarKey>', '<VarKey>'], []],
  ]) {
    assert.deepStrictEqual(messages(members), expected, name);
  }
  assert.deepStrictEqual(messages(['<VarKey=1>'], 'B;', 'Categorical'), [], 'Categorical members');
  assert.deepStrictEqual(messages([''], 'B;', 'Categorical'), [missing(0)], 'Categorical members need a key too');

  const twoBlocks = '{\n Numerical a; <VarKey=1>\n} B1;\n{\n Numerical b; <VarKey=1>\n} B2;';
  assert.deepStrictEqual(diagnosticsFor(`Dictionary D\n{\n${twoBlocks}\n};`), [], 'the same key in two blocks');
  assert.deepStrictEqual(diagnosticsFor('Dictionary D\n{\n Numerical a; <VarKey=1>\n Numerical b; <VarKey=1>\n};'), [], 'keys outside a block');

  // The default value of a block: a number for Numerical, a string for Categorical, and not the other way round.
  const defaults = (tags, type = 'Numerical') => messages(['<VarKey=1>'], `B; ${tags}`, type);
  assert.deepStrictEqual(defaults('<DefaultNumericalValue=0>'), []);
  assert.deepStrictEqual(defaults('<DefaultNumericalValue=1.5>'), []);
  assert.deepStrictEqual(defaults('<DefaultCategoricalValue="x">', 'Categorical'), []);
  assert.deepStrictEqual(defaults('<DefaultNumericalValue="">'), ["Meta-data 'DefaultNumericalValue' needs a numerical value."]);
  assert.deepStrictEqual(defaults('<DefaultNumericalValue>'), ["Meta-data 'DefaultNumericalValue' needs a numerical value."]);
  assert.deepStrictEqual(defaults('<DefaultCategoricalValue=1>', 'Categorical'), ["Meta-data 'DefaultCategoricalValue' needs a string value."]);
  assert.deepStrictEqual(defaults('<DefaultCategoricalValue="x">'), ["Meta-data 'DefaultCategoricalValue' does not apply to a block of 'Numerical' variables."]);
  assert.deepStrictEqual(defaults('<DefaultNumericalValue=0>', 'Categorical'), ["Meta-data 'DefaultNumericalValue' does not apply to a block of 'Categorical' variables."]);
  assert.deepStrictEqual(defaults('<Foo=1>'), [], 'another tag');
}

function testStatementStart() {
  const inDictionary = body => `Dictionary D\n{\n${body}\n};`;
  const reported = body => diagnosticsFor(inDictionary(body)).map(d => [d.severity, d.line, d.col, d.message]);
  const notAType = (word, line, col, afterUnused = false) => [0, line, col,
    `'${word}' is not a type: ${afterUnused ? "'Unused' must be followed by one" : "a declaration starts with 'Unused' or a type"}.`];

  // Khiops rejects each of these with a syntax error: one error, on the word that is not a type.
  for (const [name, body, expected] of [
    ['a misspelled type', '  Categorial x;', [notAType('Categorial', 2, 2)]],
    ['a misspelled Unused', '  Unuset Numerical x;', [notAType('Unuset', 2, 2)]],
    ['a lowercase type', '  numerical x;', [notAType('numerical', 2, 2)]],
    ['a word before the type', '  Foo Numerical x;', [notAType('Foo', 2, 2)]],
    ['a word before the type, on the line before', '  Foo\n  Numerical x;', [notAType('Foo', 2, 2)]],
    ['Unused without a type', '  Unused x;', [notAType('x', 2, 9, true)]],
    ['a word after Unused', '  Unused Foo Numerical x;', [notAType('Foo', 2, 9, true)]],
    ['a word after Unused, before an Entity', '  Unused Foo Entity(D) y;', [notAType('Foo', 2, 9, true)]],
    ['a stray word', '  Numerical a;\n  Foo;', [notAType('Foo', 3, 2)]],
    ['a stray backquoted name', '  Numerical a;\n  `my name`;', [notAType('my name', 3, 2)]],
    ['after a statement, on the same line', '  Numerical a; Foo Numerical b;', [notAType('Foo', 2, 15)]],
    ['inside a variable block', '  {\n    Foo Numerical a; <VarKey=1>\n  } B;', [notAType('Foo', 3, 4)]],
    ['after a variable block', '  {\n    Numerical a; <VarKey=1>\n  } B;\n  Foo Numerical b;', [notAType('Foo', 5, 2)]],
  ]) {
    assert.deepStrictEqual(reported(body), expected, name);
  }

  // These are valid for Khiops.
  for (const [name, body] of [
    ['two statements on a line', '  Numerical a; Numerical b;'],
    ['a derivation on several lines', '  Numerical a;\n  Numerical y = Sum(a,\n    a,\n    1);'],
    ['a derivation line that starts with a keyword used as a name', '  Numerical Unused;\n  Numerical y = Sum(\n    Unused,\n    1);'],
    ['a block with a derived tail', '  {\n    Numerical a; <VarKey=1>\n  } B;\n  {\n    Numerical b; <VarKey=1>\n  } C = CopyBlock(B);'],
    ['Unused before a Structure', '  Unused Structure(Partition) p = Partition(IntervalBounds(1));'],
    ['metadata and comments between statements', '  Numerical a; // one\n  <Label="x">\n  // two\n  Numerical b;'],
    ['keywords used as names', '  Categorical Numerical;\n  Numerical Unused;\n  Date Root;'],
  ]) {
    assert.deepStrictEqual(reported(body), [], name);
  }
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
  testBackquotedVariableArguments();
  testNestedCalls();
  testSecondaryScopes();
  testScopeOperator();
  testDictionaryKeysAndNames();
  testDerivationConstants();
  testRuleCallOutputMappings();
  testDerivationArgumentScopes();
  testMultipleTableArgumentScopes();
  testDuplicateAndEdgeSpaceNames();
  testRelationSchema();
  testVariableBlockKeys();
  testStatementStart();
  console.log('validator tests passed');
}

run();