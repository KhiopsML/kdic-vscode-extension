#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { operandVariablesAt } = require('../out/operand-completion');
const { DERIVATION_RULES } = require('../out/derivation-rules');
const { buildRuleMaps } = require('../out/rule-maps');

const rules = buildRuleMaps([...DERIVATION_RULES, {
  label: 'BuildJoinTest',
  returnType: 'Table',
  signature: 'BuildJoinTest(Table source, Categorical sourceKey, Table history, Date historicalDate : any target, ...)',
  operandScopes: ['current', { tableArgument: 0 }, 'current', { tableArgument: 2 }],
}]);

/** A dictionary file where `body` is written in Client; `|` in the text marks the cursor. */
function client(body, extra = '', purchaseBody = '') {
  return `Dictionary Client
{
    Categorical id;
    Numerical age;
    Categorical segment;
    Table(Purchase) purchases;
    Entity(Purchase) last;
    Unused Numerical hidden;
    ${body}
    Numerical later;
};
Dictionary Purchase
{
    Numerical amount;
    Categorical shop;
    Table(Item) items;
    Numerical \`unit price\`;
    ${purchaseBody}
};
Dictionary Item
{
    Numerical price;
    Categorical sku;
};${extra}`;
}

/** What is proposed at the cursor of `text`: the variable and block names, the type expected and the dictionary. */
function at(text) {
  const offset = text.indexOf('|');
  assert.ok(offset >= 0, 'no cursor in the text');
  const found = operandVariablesAt(text.slice(0, offset) + text.slice(offset + 1), offset, rules);
  return found && {
    names: found.variables.map(variable => variable.nameText),
    blocks: found.blocks.map(block => block.nameText),
    expected: found.expected,
    label: found.label,
  };
}

const CLIENT = ['id', 'age', 'segment', 'purchases', 'last', 'hidden', 'later'];
const PURCHASE = ['amount', 'shop', 'items', 'unit price'];
const BEFORE = CLIENT.slice(0, -1); // what Client declares before the line under test
const here = (names, expected, blocks = []) => ({ names, blocks, expected, label: 'this dictionary' });
const there = (names, expected, blocks = []) => ({ names, blocks, expected, label: "dictionary 'Purchase'" });
const without = (names, name) => names.filter(candidate => candidate !== name);

const cases = [
  // The variables of the dictionary: all of them, those declared below and those marked Unused included,
  // except the one whose derivation is being written.
  ['first operand', client('Numerical x = Sum(|);'), here(CLIENT, 'Numerical')],
  ['name started', client('Numerical x = Sum(ag|);'), here(CLIENT, 'Numerical')],
  ['after a comma', client('Numerical x = Sum(age, |);'), here(CLIENT, 'Numerical')],
  ['before what follows', client('Numerical x = Sum(|, age);'), here(CLIENT, 'Numerical')],
  ['next line', client('Numerical x = Sum(age,\n        |);'), here(CLIENT, 'Numerical')],
  ['after a comment', client('Numerical x = Sum(age, // the second\n        |);'), here(CLIENT, 'Numerical')],
  ['call not closed', client('Numerical x = Sum(|'), here(['id', 'age', 'segment', 'purchases', 'last', 'hidden'], 'Numerical')],
  ['backquoted name started', client('Numerical x = Sum(`ag|`);'), here(CLIENT, 'Numerical')],
  ['nested call', client('Numerical x = Sum(age, Length(|));'), here(CLIENT, 'Categorical')],
  ['table rule, first operand', client('Numerical x = TableMean(|);'), here(CLIENT, 'Table')],

  // Operands of a table rule that are in the secondary table.
  ['secondary operand', client('Numerical x = TableMean(purchases, |);'), there(PURCHASE, 'Numerical')],
  ['secondary operand of an entity', client('Numerical x = GetValue(last, |);'), there(PURCHASE, 'Numerical')],
  // The variable being defined is excluded where it is declared, not where another has the same name.
  ['same name in the secondary table', client('Categorical shop = GetValueC(last, |);'), there(PURCHASE, 'Categorical')],
  ['same name in the current dictionary', client('Categorical segment = Concat(|);'), here(without(CLIENT, 'segment'), 'Categorical')],
  ['secondary, nested', client('Table(Purchase) t = TableSelection(purchases, GE(|, 1));'), there(PURCHASE, 'Numerical')],
  ['secondary, name started', client('Table(Purchase) t = TableSelection(purchases, GE(am|, 1));'), there(PURCHASE, 'Numerical')],
  ['current operand of a table rule', client('Entity(Purchase) e = TableAt(purchases, |);'), here(CLIENT, 'Numerical')],
  ['block of the secondary table', client('{ Numerical a; <VarKey="a"> } B = GetBlock(last, |);'), there(PURCHASE, 'Block(Numerical)')],

  // Variable blocks are named by the tail after their `}`, in the dictionary that declares them.
  ['block of the secondary table, by name', client('{ Numerical a; <VarKey="a"> } B = GetBlock(last, |);', '', '{ Numerical m; <VarKey="m"> } Marks ;'),
    there([...PURCHASE, 'm'], 'Block(Numerical)', ['Marks'])],
  ['block of the dictionary', client('{ Numerical a; <VarKey="a"> } Parts ;\n    { Numerical b; <VarKey="a"> } Copy = CopyBlock(|);'),
    here([...BEFORE, 'a', 'b', 'later'], 'Block(Numerical)', ['Parts'])],
  ['block with a name between backquotes', client('{ Numerical a; <VarKey="a"> } `Parts per Pos(4)` = CopyBlock(x);\n    { Numerical b; <VarKey="a"> } Copy = CopyBlock(|);'),
    here([...BEFORE, 'a', 'b', 'later'], 'Block(Numerical)', ['Parts per Pos(4)'])],
  ['block declared below', client('{ Numerical b; <VarKey="a"> } Copy = CopyBlock(|);').replace('Numerical later;', '{ Numerical a; <VarKey="a"> } Later ;'),
    here([...BEFORE, 'b', 'a'], 'Block(Numerical)', ['Later'])],

  // The scope operator.
  ['one dot', client('Table(Purchase) t = TableSelection(purchases, GE(amount, .|));'), here(CLIENT, 'Numerical')],
  ['one dot, name started', client('Table(Purchase) t = TableSelection(purchases, GE(amount, .ag|));'), here(CLIENT, 'Numerical')],
  ['one dot and a space', client('Table(Purchase) t = TableSelection(purchases, GE(amount, . |));'), here(CLIENT, 'Numerical')],
  ['two dots', client('Table(Purchase) t = TableSelection(purchases, GE(TableCount(TableSelection(items, GE(price, ..|))), 1));'), here(CLIENT, 'Numerical')],
  ['one dot, two scopes down', client('Table(Purchase) t = TableSelection(purchases, GE(TableCount(TableSelection(items, GE(price, .|))), 1));'), there(PURCHASE, 'Numerical')],
  ['no dot, two scopes down', client('Table(Purchase) t = TableSelection(purchases, GE(TableCount(TableSelection(items, GE(|, 1))), 1));'),
    { names: ['price', 'sku'], blocks: [], expected: 'Numerical', label: "dictionary 'Item'" }],
  ['call behind a dot', client('Table(Purchase) t = TableSelection(purchases, EQc(shop, .Concat(|)));'), here(CLIENT, 'Categorical')],
  ['dots in a call behind a dot', client('Table(Purchase) t = TableSelection(purchases, EQc(shop, .Concat(.|)));'), here(CLIENT, 'Categorical')],
  ['first operand of a nested table rule', client('Table(Purchase) t = TableSelection(purchases, GE(TableCount(.|), 1));'), here(CLIENT, 'Table')],
  ['more dots than scopes', client('Numerical x = Sum(.|);'), undefined],
  ['two dots, one scope', client('Table(Purchase) t = TableSelection(purchases, GE(amount, ..|));'), undefined],

  // Not an operand, or a scope that is not known.
  ['unregistered rule', client('Numerical x = Mystery(|);'), undefined],
  ['operand beyond the parameters', client('Numerical x = ContributionValueAt(a, b, c, |);'), here(CLIENT, 'any')],
  ['table not resolved', client('Numerical x = TableMean(age, |);'), undefined],
  ['table of a dictionary not declared', client('Table(Missing) lost;\n    Numerical x = TableMean(lost, |);'), undefined],
  ['after an operand', client('Numerical x = Sum(age |);'), undefined],
  ['no call', client('Numerical x = |;'), undefined],
  ['call closed before', client('Numerical x = Sum(age) |;'), undefined],
  ['in a string', client('Categorical x = Concat("a, |");'), undefined],
  ['after a number', client('Numerical x = Sum(3.|);'), undefined],
  ['number started', client('Numerical x = Sum(12|);'), undefined],
  ['in a metadata tag', client('Numerical y; <Cost=|>'), undefined],
  ['declaration, not a derivation', client('Numerical |'), undefined],
  ['outside a dictionary', 'Sum(|', undefined],
  ['in the header', 'Dictionary Client (|)\n{\n};', undefined],
];

for (const [name, text, expected] of cases) {
  assert.deepStrictEqual(at(text), expected, name);
}

// A derivation in another dictionary sees that dictionary.
assert.deepStrictEqual(at(client('', '\nDictionary Other\n{\n    Numerical seen;\n    Numerical z = Sum(|);\n    Categorical below;\n};')),
  here(['seen', 'below'], 'Numerical'));
assert.strictEqual(at(client('', '\nDictionary Other\n{\n    Numerical seen;\n    Numerical z = TableMean(purchases, |);\n};')),
  undefined, 'purchases is a variable of Client, not of Other');

const multiTable = body => `Dictionary Main
{
    Numerical sourceKey;
    Time historicalDate;
    Table(Source) source;
    Table(Historical) history;
    ${body}
};
Dictionary Source
{
    Categorical sourceKey;
    Numerical sourceOnly;
};
Dictionary Historical
{
    Date historicalDate;
    Categorical historicalOnly;
};
Dictionary Target
{
    Categorical targetValue;
    Numerical targetNumber;
};`;
assert.deepStrictEqual(at(multiTable('Table(Target) output = BuildJoinTest(source, |);')),
  { names: ['sourceKey', 'sourceOnly'], blocks: [], expected: 'Categorical', label: "dictionary 'Source'" });
assert.deepStrictEqual(at(multiTable('Table(Target) output = BuildJoinTest(source, sourceKey, history, |);')),
  { names: ['historicalDate', 'historicalOnly'], blocks: [], expected: 'Date', label: "dictionary 'Historical'" });
assert.deepStrictEqual(at(multiTable('Table(Target) output = BuildJoinTest(source, sourceKey, history, historicalDate : |);')),
  { names: ['targetValue', 'targetNumber'], blocks: [], expected: 'any', label: "target dictionary 'Target'" });
assert.deepStrictEqual(at(multiTable('Table(Target) output = BuildJoinTest(source, sourceKey, history, historicalDate : targetValue, |);')),
  { names: ['targetValue', 'targetNumber'], blocks: [], expected: 'any', label: "target dictionary 'Target'" });

const graph = body => `Root Dictionary Main (id)
{
    Categorical id;
    Table(NetworkNode) nodeData;
    Table(NetworkEdge) edgeData;
    Entity(Graph) graph = BuildGraph(nodeData, NodeId, edgeData, SourceNodeId, TargetNodeId : ${body});
};
Dictionary NetworkNode (id)
{
    Categorical id;
    Numerical NodeValue;
};
Dictionary NetworkEdge (id)
{
    Categorical id;
    Categorical SourceNodeId;
    Categorical TargetNodeId;
};
Dictionary Node
{
    Entity(NetworkNode) Data;
    Table(Edge) AdjacentEdges;
    Categorical NodeId;
};
Dictionary Edge
{
    Entity(NetworkEdge) Data;
    Entity(Node) SourceNode;
    Entity(Node) TargetNode;
};
Dictionary Graph
{
    Table(Node) Nodes;
    Table(Edge) Edges;
};`;
assert.deepStrictEqual(at(graph('Nodes, |')),
  { names: ['Data', 'AdjacentEdges', 'NodeId'], blocks: [], expected: 'any', label: "target dictionary 'Node'" });
assert.deepStrictEqual(at(graph('Nodes, Data, AdjacentEdges, Edges, |')),
  { names: ['Data', 'SourceNode', 'TargetNode'], blocks: [], expected: 'any', label: "target dictionary 'Edge'" });

console.log(`Operand completion tests passed (${cases.length + 6} cases).`);
