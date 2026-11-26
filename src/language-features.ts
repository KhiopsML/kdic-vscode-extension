/**
 * VS Code language features that need no validation: completion and hover.
 */
import * as vscode from 'vscode';
import {
  analyzeCompletionPrefix, declaredTypeOnLine, expectedOperandType, hashWordBeforeCursor, isAfterRelationalTypeParens,
  isInMetadataKey, isInsideDictionaryBlock, partialOperand,
} from './completion-context';
import { DERIVATION_RULES, type DerivationRule } from './derivation-rules';
import { tokenName } from './kdic-lexer';
import { encodeIdentifier, extractDictionaryNames, FORMAT_METADATA_KEYS } from './kdic-syntax';
import { operandVariablesAt, type OperandVariables } from './operand-completion';
import { RULE_MAPS } from './rule-maps';
import {
  ADVANCED_TYPES, KEYWORDS, METADATA_KEYS, MISSING_VALUE, NATIVE_TYPES, type LanguageEntry,
} from './language-data';

const UNUSED_KEYWORD = KEYWORDS.find(keyword => keyword.label === 'Unused')!;

/**
 * Beyond this many characters, a completion that reads the whole document is too slow (about 100 ms at
 * 3 MB, over a second at 45 MB): such a document, nearly always a generated model, is only completed
 * from the line.
 */
const MAX_ANALYZED_CHARS = 1_000_000;

/** Builds a completion item that shows the entry's documentation and, if any, expands to its snippet. */
function entryItem(entry: LanguageEntry, kind: vscode.CompletionItemKind): vscode.CompletionItem {
  const item = new vscode.CompletionItem(entry.label, kind);
  item.detail = entry.detail;
  item.documentation = new vscode.MarkdownString(entry.documentation);
  if (entry.insertText) { item.insertText = new vscode.SnippetString(entry.insertText); }
  return item;
}

/** Builds a completion item for a derivation rule: its signature, documentation and a `Rule($0)` snippet. */
function ruleItem(rule: DerivationRule): vscode.CompletionItem {
  const item = new vscode.CompletionItem(rule.label, vscode.CompletionItemKind.Function);
  item.detail = `${rule.returnType} · ${rule.detail}`;
  item.documentation = new vscode.MarkdownString(`\`\`\`\n${rule.signature}\n\`\`\`\n\n${rule.documentation}`);
  item.insertText = new vscode.SnippetString(`${rule.label}($0)`);
  return item;
}

/**
 * The metadata keys that set a date or time format. When the line declares a variable
 * of one of those types, its own key comes first and is preselected.
 */
function metadataKeyItems(linePrefix: string): vscode.CompletionItem[] {
  const declaredType = declaredTypeOnLine(linePrefix);
  const ownKey = declaredType && FORMAT_METADATA_KEYS[declaredType];
  return METADATA_KEYS.map(entry => {
    const item = entryItem(entry, vscode.CompletionItemKind.Property);
    item.sortText = `${entry.label === ownKey ? 0 : 1}${entry.label}`;
    item.preselect = entry.label === ownKey;
    return item;
  });
}

/** `#Missing`, replacing the `#word` already typed before the cursor, if any (`#` is not part of a word). */
function missingValueItem(position: vscode.Position, typed: string): vscode.CompletionItem {
  const item = entryItem(MISSING_VALUE, vscode.CompletionItemKind.Constant);
  if (typed) { item.range = new vscode.Range(new vscode.Position(position.line, position.character - typed.length), position); }
  return item;
}

/** The number of characters of a document, which is known without copying its text. */
function documentLength(document: vscode.TextDocument): number {
  const last = document.lineCount - 1;
  return document.offsetAt(new vscode.Position(last, document.lineAt(last).text.length));
}

/** The dictionaries of the file, for the operand of `Entity(` and `Table(`. */
function dictionaryNameItems(document: vscode.TextDocument): vscode.CompletionItem[] {
  return [...extractDictionaryNames(document.getText())].map(name => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
    item.detail = 'dictionary name';
    item.documentation = new vscode.MarkdownString(`Referenced dictionary: **${name}**`);
    return item;
  });
}

/**
 * The variables and variable blocks an operand can name. Those of the type the rule expects come first
 * (a block when it expects one). A name that has to be written between backquotes is inserted so; when
 * the user already typed the opening backquote, the name replaces it, and the closing one that VS Code added.
 */
function variableItems(found: OperandVariables, typedWord: string, position: vscode.Position, next: string): vscode.CompletionItem[] {
  const start = new vscode.Position(position.line, position.character - typedWord.length);
  const range = typedWord.startsWith('`')
    ? new vscode.Range(start, new vscode.Position(position.line, position.character + (next === '`' ? 1 : 0)))
    : undefined;

  const makeItem = (name: string, detail: string, what: string, expected: boolean): vscode.CompletionItem => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
    item.detail = detail;
    item.documentation = new vscode.MarkdownString(`${what} of ${found.label}.`);
    const written = encodeIdentifier(name);
    if (written !== name) {
      item.insertText = written;
      item.filterText = written;
    }
    item.sortText = `${expected ? 0 : 1}${name}`;
    if (range) { item.range = range; }
    return item;
  };

  const variables = found.variables.map(declaration => {
    const target = declaration.relationTarget ? `(${tokenName(declaration.relationTarget)})` : '';
    const expected = found.expected === 'any' || declaration.type.text === found.expected;
    return makeItem(declaration.nameText, `${declaration.type.text}${target}`, 'Variable', expected);
  });
  const blockExpected = found.expected === 'any' || found.expected.startsWith('Block');
  return [...variables, ...found.blocks.map(block => makeItem(block.nameText, 'Block', 'Variable block', blockExpected))];
}

/** What to suggest at `position`, depending on where in the file the cursor is. */
function provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const line = document.lineAt(position).text;
  const linePrefix = line.substring(0, position.character);
  const { inComment, inDerivation } = analyzeCompletionPrefix(linePrefix);
  if (inComment) { return []; }

  const analyzed = documentLength(document) <= MAX_ANALYZED_CHARS;

  // Right after `Entity(` or `Table(`: the dictionaries of this file.
  if (isAfterRelationalTypeParens(linePrefix)) { return analyzed ? dictionaryNameItems(document) : []; }

  const textBeforeCursor = analyzed ? document.getText(new vscode.Range(new vscode.Position(0, 0), position)) : '';
  const insideDictionary = !analyzed || isInsideDictionaryBlock(textBeforeCursor);

  // On the key of a metadata tag: the format keys, which only variables of a dictionary can carry.
  if (isInMetadataKey(linePrefix)) { return insideDictionary ? metadataKeyItems(linePrefix) : []; }

  // Where an operand starts in a call of a known rule: the type it expects is known.
  const operandType = analyzed && insideDictionary ? expectedOperandType(textBeforeCursor, RULE_MAPS.paramTypes) : undefined;
  const typed = partialOperand(linePrefix);
  // A dot anywhere else is a decimal point or text, which asks for nothing.
  if (/\.\s*$/.test(linePrefix) && operandType === undefined) { return []; }

  // Where a rule expects a Numerical operand, `#Missing` is possible. Once `#` is typed, nothing else is.
  const missingAllowed = operandType === 'Numerical' && typed.dots === 0;
  const hashWord = hashWordBeforeCursor(linePrefix);
  if (hashWord !== undefined) { return missingAllowed ? [missingValueItem(position, hashWord)] : []; }

  // Outside any dictionary: the keywords that start one.
  if (!insideDictionary) {
    return KEYWORDS.map(keyword => entryItem(keyword, vscode.CompletionItemKind.Keyword));
  }

  // Inside a dictionary: declaration keywords and types, unless the cursor is already in a derivation.
  const items: vscode.CompletionItem[] = [];
  if (!inDerivation && operandType === undefined) {
    items.push(entryItem(UNUSED_KEYWORD, vscode.CompletionItemKind.Keyword));
    for (const type of [...NATIVE_TYPES, ...ADVANCED_TYPES]) {
      items.push(entryItem(type, vscode.CompletionItemKind.TypeParameter));
    }
  }
  // Rules are always offered: after `=`, and when naming a rule on a derived variable's line.
  items.push(...DERIVATION_RULES.map(ruleItem));
  if (missingAllowed) { items.push(missingValueItem(position, '')); }

  // The variables of the scope the operand is in, which the rule resolves as the validator does.
  const found = operandType === undefined ? undefined : operandVariablesAt(document.getText(), document.offsetAt(position), RULE_MAPS);
  if (found) { items.push(...variableItems(found, typed.word, position, line[position.character])); }
  return items;
}

/** Hover documentation of a keyword, type or rule, by name. Earlier entries win over later ones. */
function buildHoverIndex(): Map<string, LanguageEntry | DerivationRule> {
  const index = new Map<string, LanguageEntry | DerivationRule>();
  for (const entry of [...KEYWORDS, ...NATIVE_TYPES, ...ADVANCED_TYPES, ...DERIVATION_RULES]) {
    if (!index.has(entry.label)) { index.set(entry.label, entry); }
  }
  return index;
}

/** Registers the completion and hover providers for `.kdic` documents. */
export function registerLanguageFeatures(context: vscode.ExtensionContext): void {
  const hoverIndex = buildHoverIndex();

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'kdic' },
      { provideCompletionItems },
      '(', ' ', '\t', '<', '#', '.', // trigger characters
    ),
    vscode.languages.registerHoverProvider({ language: 'kdic' }, {
      provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        const entry = range && hoverIndex.get(document.getText(range));
        if (!range || !entry) { return undefined; }

        const content = new vscode.MarkdownString();
        if ('signature' in entry) { content.appendCodeblock(entry.signature, 'kdic'); }
        content.appendMarkdown(entry.documentation);
        return new vscode.Hover(content, range);
      },
    }),
  );
}
