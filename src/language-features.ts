/**
 * VS Code language features that need no validation: completion and hover.
 */
import * as vscode from 'vscode';
import {
  analyzeCompletionPrefix, declaredTypeOnLine, isAfterRelationalTypeParens, isInMetadataKey, isInsideDictionaryBlock,
} from './completion-context';
import { DERIVATION_RULES, type DerivationRule } from './derivation-rules';
import { extractDictionaryNames, FORMAT_METADATA_KEYS } from './kdic-syntax';
import { ADVANCED_TYPES, KEYWORDS, METADATA_KEYS, NATIVE_TYPES, type LanguageEntry } from './language-data';

const UNUSED_KEYWORD = KEYWORDS.find(keyword => keyword.label === 'Unused')!;

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

/** What to suggest at `position`, depending on where in the file the cursor is. */
function provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
  const linePrefix = document.lineAt(position).text.substring(0, position.character);
  const { inComment, inDerivation } = analyzeCompletionPrefix(linePrefix);
  if (inComment) { return []; }

  // Right after `Entity(` or `Table(`: the dictionaries of this file.
  if (isAfterRelationalTypeParens(linePrefix)) {
    return [...extractDictionaryNames(document.getText())].map(name => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
      item.detail = 'dictionary name';
      item.documentation = new vscode.MarkdownString(`Referenced dictionary: **${name}**`);
      return item;
    });
  }

  const textBeforeCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const insideDictionary = isInsideDictionaryBlock(textBeforeCursor);

  // On the key of a metadata tag: the format keys, which only variables of a dictionary can carry.
  if (isInMetadataKey(linePrefix)) { return insideDictionary ? metadataKeyItems(linePrefix) : []; }

  // Outside any dictionary: the keywords that start one.
  if (!insideDictionary) {
    return KEYWORDS.map(keyword => entryItem(keyword, vscode.CompletionItemKind.Keyword));
  }

  // Inside a dictionary: declaration keywords and types, unless the cursor is already in a derivation.
  const items: vscode.CompletionItem[] = [];
  if (!inDerivation) {
    items.push(entryItem(UNUSED_KEYWORD, vscode.CompletionItemKind.Keyword));
    for (const type of [...NATIVE_TYPES, ...ADVANCED_TYPES]) {
      items.push(entryItem(type, vscode.CompletionItemKind.TypeParameter));
    }
  }
  // Rules are always offered: after `=`, and when naming a rule on a derived variable's line.
  items.push(...DERIVATION_RULES.map(ruleItem));
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
      '(', ' ', '\t', '<', // trigger characters
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
