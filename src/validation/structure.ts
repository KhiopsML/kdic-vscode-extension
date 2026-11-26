/**
 * The structure of a document, built by one walk over its tokens: its dictionaries (header, declarations,
 * variable blocks) and the lines they cover. The checks that follow read this structure instead of the tokens.
 */
import { isNameToken, tokenName, type KdicToken } from '../kdic-lexer';
import { isKdicType } from '../kdic-syntax';
import type { DiagnosticCollector } from './diagnostics';
import type { MetadataInfo } from './metadata';

/** A variable declaration: `[Unused] Type[(Target)] name [[key]] [= rule(...)] ;`. */
export interface Declaration {
  /** First token of the declaration: `Unused` or the type. */
  start: KdicToken;
  type: KdicToken;
  name: KdicToken;
  /** Name without backticks. */
  nameText: string;
  /** Index of the name in the token list. */
  nameIndex: number;
  /** `X` of a `Table(X)` or `Entity(X)` type. */
  relationTarget?: KdicToken;
  /** The key of an external entity, `Entity(X) name [key, …]`, one token per key, as `[a, f(b)]` has two; undefined when the name has no brackets. */
  joinKeys?: KdicToken[];
  /** Whether the variable is declared inside a variable block. */
  inBlock: boolean;
  /** The word written after the name where `;` is expected, which makes the declaration malformed. */
  wordAfterName?: KdicToken;
  /** Index of the `=` of the derivation, if any. */
  equalsIndex?: number;
  /** Index of the terminating `;`, or of the token that ended the declaration when `;` is missing. */
  endIndex?: number;
}

/** The `} Name [= rule] ;` tail of a variable block, which names the block as a whole. */
export interface BlockTail {
  name: KdicToken;
  /** Name without backticks. */
  nameText: string;
  /** The variables declared inside the block. */
  members: Declaration[];
  /** Index of the `=` of the derivation, if any. */
  equalsIndex?: number;
  /** Index of the `;` that ends the tail: the block's metadata tags follow it. */
  endIndex?: number;
}

/** The parsed `Root Dictionary Name (key, …)` header of a dictionary. */
export interface DictionaryHeader {
  /** The `Dictionary` keyword token, when present. */
  keyword?: KdicToken;
  name?: KdicToken;
  keys: KdicToken[];
  /** Whether the keyword is preceded by `Root`. */
  root: boolean;
  /** Whether the header is exactly `[…] Dictionary Name [(key, …)]`. */
  valid: boolean;
}

/** A top-level `{ … }` block together with the header that precedes it. */
export interface Dictionary {
  /** Non-metadata tokens since the previous dictionary: `Root Dictionary Name (keys)`. */
  headerTokens: KdicToken[];
  header: DictionaryHeader;
  /** Index of the opening `{`. */
  openIndex: number;
  /** Index of the closing `}`, or the token count when the block is never closed. */
  closeIndex: number;
  /** Every declaration of the block, including those of nested variable blocks. */
  declarations: Declaration[];
  /** The variable blocks of the dictionary, by the tail that names them. */
  blocks: BlockTail[];
}

/** What the token scan learns about the document's overall shape. */
export interface Structure {
  dictionaries: Dictionary[];
  /** Lines covered by a declaration that ends with `;`. */
  declarationLines: Set<number>;
  /** Lines whose statement starts with a word that is not a type: already reported as an error. */
  rejectedLines: Set<number>;
  /** Lines holding the `;` that follows a dictionary's closing brace. */
  terminatorLines: Set<number>;
}

/** The dictionaries of the file by name, in document order: a name declared twice has several. */
export function dictionariesByName(structure: Structure): Map<string, Dictionary[]> {
  const byName = new Map<string, Dictionary[]>();
  for (const dictionary of structure.dictionaries) {
    const name = dictionary.header.name;
    if (name) { byName.set(tokenName(name), [...(byName.get(tokenName(name)) ?? []), dictionary]); }
  }
  return byName;
}

/** Parses a header; anything before `Dictionary` (such as `Root` or a previous `;`) is ignored. */
function parseHeader(tokens: readonly KdicToken[]): DictionaryHeader {
  const keywordIndex = tokens.findIndex(token => token.text === 'Dictionary');
  const keyword = keywordIndex >= 0 ? tokens[keywordIndex] : undefined;
  const name = keyword ? tokens[keywordIndex + 1] : undefined;
  const keys: KdicToken[] = [];
  let valid = isNameToken(name);

  // Optional key list: `( name , name , … )`, alternating key and comma.
  let next = keywordIndex + 2;
  if (valid && tokens[next]?.text === '(') {
    next++;
    let expectKey = true;
    while (next < tokens.length && tokens[next].text !== ')') {
      const token = tokens[next++];
      if (expectKey && isNameToken(token)) { keys.push(token); }
      else if (expectKey || token.text !== ',') { valid = false; }
      expectKey = !expectKey;
    }
    if (expectKey || tokens[next]?.text !== ')') { valid = false; }
    else { next++; }
  }
  if (next !== tokens.length) { valid = false; }
  return { keyword, name, keys, root: keywordIndex > 0 && tokens[keywordIndex - 1].text === 'Root', valid };
}

/**
 * Index of the token following `[Unused] Type [( … )]` when a declaration
 * head starts at `index`, or -1 when it does not.
 */
function declarationHeadEnd(tokens: readonly KdicToken[], index: number): number {
  let offset = index;
  if (tokens[offset]?.text === 'Unused') { offset++; }
  if (!tokens[offset] || !isKdicType(tokens[offset].text)) { return -1; }
  offset++;
  if (tokens[offset]?.text === '(') {
    let depth = 1;
    offset++;
    while (offset < tokens.length && depth > 0) {
      if (tokens[offset].text === '(') { depth++; }
      else if (tokens[offset].text === ')') { depth--; }
      offset++;
    }
  }
  return offset;
}

const isNameLike = (token: KdicToken | undefined): boolean =>
  token?.kind === 'identifier' || token?.kind === 'quotedIdentifier';

/** The dictionary named in `Table(X)` / `Entity(X)` when the type token at `typeIndex` is followed by `( X )`. */
function relationTargetAt(tokens: readonly KdicToken[], typeIndex: number): KdicToken | undefined {
  const isRelation = tokens[typeIndex].text === 'Table' || tokens[typeIndex].text === 'Entity';
  const [open, target, close] = tokens.slice(typeIndex + 1, typeIndex + 4);
  return isRelation && open?.text === '(' && isNameToken(target) && close?.text === ')' ? target : undefined;
}

/** The keys of an external entity, `[k1, f(k2)]` written at `index`: the first token of each key; undefined when there is no bracket there. */
function joinKeysAt(tokens: readonly KdicToken[], index: number): KdicToken[] | undefined {
  if (tokens[index]?.text !== '[') { return undefined; }
  const keys: KdicToken[] = [];
  let depth = 0;
  let startsKey = true;
  for (let next = index + 1; next < tokens.length; next++) {
    const token = tokens[next];
    if (depth === 0 && (token.text === ']' || token.text === ';')) { break; }
    if (depth === 0 && token.text === ',') { startsKey = true; continue; }
    if (startsKey) { keys.push(token); startsKey = false; }
    if (token.text === '(') { depth++; } else if (token.text === ')') { depth--; }
  }
  return keys;
}

/**
 * A statement of a dictionary starts with a type, or with `Unused` and then a type. Khiops rejects any other word
 * there: a keyword that is misspelled (`Categorial`, `Unuset`, `numerical`), a word before the type (`Foo Numerical x;`)
 * or after `Unused`. `Root` and `Dictionary` are left to the checks of the braces, as they mean a missing `}`.
 */
function checkStatementStart(tokens: readonly KdicToken[], index: number, out: DiagnosticCollector): KdicToken | undefined {
  const token = tokens[index];
  if (!isNameLike(token) || token.text === 'Root' || token.text === 'Dictionary') { return undefined; }

  const afterUnused = token.text === 'Unused';
  const word = afterUnused ? tokens[index + 1] : token;
  if (!isNameLike(word) || isKdicType(word!.text)) { return undefined; }
  const reason = afterUnused ? "'Unused' must be followed by one" : "a declaration starts with 'Unused' or a type";
  out.atToken(word!, `'${tokenName(word!)}' is not a type: ${reason}.`);
  return word;
}

/** Whether the name written right after a type cannot be a valid variable name. */
function isInvalidVariableName(name: KdicToken, next: KdicToken | undefined): boolean {
  const decoded = tokenName(name);
  const touchesNext = next !== undefined && next.start === name.end;
  const badFollowingSymbol = touchesNext && next.kind === 'symbol' && ![';', '=', '[', '}'].includes(next.text);
  const badFollowingNumber = touchesNext && (next.kind === 'number' || next.kind === 'missing');
  return name.closed === false || decoded.length === 0 || decoded.trim() !== decoded
    || badFollowingSymbol || badFollowingNumber;
}

/**
 * The word that follows a variable name where `;` or `=` is expected (`Categorical bad name;`), unless it starts the
 * next declaration. Khiops takes any word, keywords included, as the name, and objects to the one after it.
 */
function wordAfterName(next: KdicToken | undefined): KdicToken | undefined {
  return isNameLike(next) && next!.text !== 'Unused' && !isKdicType(next!.text) ? next : undefined;
}

/**
 * Walks the significant tokens once and builds the document's structure: dictionaries, their declarations,
 * the variable blocks, and the lines they cover.
 *
 * It follows the braces (a dictionary is at depth 1, a variable block at depth 2) and, inside them, the
 * statements: a declaration is `[Unused] Type name [= rule] ;`. Along the way it reports a missing `;`
 * after a declaration or after a dictionary's closing brace, and invalid variable names. A declaration
 * that is still being typed (last line, or the cursor line) is not reported.
 */
class StructureScanner {
  private readonly structure: Structure = {
    dictionaries: [], declarationLines: new Set(), terminatorLines: new Set(), rejectedLines: new Set(),
  };

  private braceDepth = 0;
  /** Open `(` / `[` of the current statement: separators inside them do not end a declaration. */
  private groupDepth = 0;
  /** The dictionary being read, between its `{` and its `}`. */
  private dictionary: Dictionary | undefined;
  /** Index of the first token after the previous dictionary: where the next header starts. */
  private headerStart = 0;
  /** Whether the next token starts a statement: right after a `{` or a `;` that ends one. */
  private statementStart = false;
  /** The declaration being read, until its `;` or the start of the next declaration. */
  private pending: Declaration | undefined;

  /** The variables declared in the variable block being read, which its tail takes over. */
  private blockMembers: Declaration[] = [];
  /** Set right after a variable block's `}`: its `Name [= rule] ;` tail is not a declaration. */
  private afterBlockClose = false;
  /** The tail being read after a variable block's `}`, once its name is seen. */
  private blockTail: BlockTail | undefined;

  constructor(
    private readonly tokens: readonly KdicToken[],
    private readonly metadata: MetadataInfo,
    private readonly out: DiagnosticCollector,
    private readonly cursorLine: number | undefined,
  ) {}

  scan(): Structure {
    for (let index = 0; index < this.tokens.length; index++) {
      if (!this.metadata.tokenIndices.has(index)) { this.visit(index); }
    }
    this.endWithoutSemicolon(this.tokens.length);
    return this.structure;
  }

  private lineOf(token: KdicToken): number {
    return this.out.lineOf(token.start);
  }

  /** Updates the state with the token at `index`. */
  private visit(index: number): void {
    const token = this.tokens[index];
    const symbol = token.kind === 'symbol' ? token.text : undefined;
    if (symbol && this.visitBracket(symbol, index)) { return; }

    // Outside a dictionary, or inside the parentheses of a call or key list: nothing starts or ends here.
    if (this.groupDepth > 0 || this.braceDepth === 0) { return; }

    if (symbol === '=') { this.visitEquals(index); }
    else if (symbol === ';') { this.visitSemicolon(index); }
    else if (this.afterBlockClose) { this.visitBlockTail(token); }
    else { this.visitStatementToken(index); }
  }

  /** Handles a bracket; false for any other symbol. */
  private visitBracket(symbol: string, index: number): boolean {
    switch (symbol) {
      case '(': case '[': this.groupDepth++; return true;
      case ')': case ']': this.groupDepth = Math.max(0, this.groupDepth - 1); return true;
      case '{': this.openBrace(index); return true;
      case '}': this.closeBrace(index); return true;
      default: return false;
    }
  }

  // ─────────────────────────── Braces ────────────────────────────────────────

  /** A `{` opens a dictionary (depth 1) or a variable block inside one (depth 2). */
  private openBrace(index: number): void {
    if (this.braceDepth === 0) { this.openDictionary(index); }
    this.braceDepth++;
    if (this.braceDepth === 2) { this.blockMembers = []; }
    this.statementStart = true;
    this.groupDepth = 0;
  }

  /** Starts the dictionary whose `{` is at `openIndex`, with the header written since the previous dictionary. */
  private openDictionary(openIndex: number): void {
    const headerTokens: KdicToken[] = [];
    for (let index = this.headerStart; index < openIndex; index++) {
      if (!this.metadata.tokenIndices.has(index)) { headerTokens.push(this.tokens[index]); }
    }
    this.dictionary = {
      headerTokens, header: parseHeader(headerTokens),
      openIndex, closeIndex: this.tokens.length, declarations: [], blocks: [],
    };
    this.structure.dictionaries.push(this.dictionary);
  }

  /** A `}` ends the declaration being read, then the variable block (depth 2) or the dictionary (depth 1). */
  private closeBrace(index: number): void {
    this.endWithoutSemicolon(index);
    if (this.braceDepth === 1) { this.closeDictionary(index); }
    this.afterBlockClose = this.braceDepth > 1;
    this.blockTail = undefined;
    this.statementStart = false;
    this.braceDepth = Math.max(0, this.braceDepth - 1);
    this.groupDepth = 0;
  }

  /** The closing brace of a dictionary must be followed by `;`. */
  private closeDictionary(closeIndex: number): void {
    const next = this.tokens[closeIndex + 1];
    if (next?.text !== ';') { this.out.at(this.tokens[closeIndex].start, 1, "Missing ';' after closing brace of dictionary."); }
    else { this.structure.terminatorLines.add(this.lineOf(next)); }
    this.dictionary!.closeIndex = closeIndex;
    this.dictionary = undefined;
    this.headerStart = closeIndex + 1;
  }

  // ─────────────────────────── Statements ────────────────────────────────────

  /** The `=` of a derivation: that of the declaration being read, or of a variable block's tail. */
  private visitEquals(index: number): void {
    if (this.pending) { this.pending.equalsIndex = index; }
    else if (this.blockTail && this.blockTail.equalsIndex === undefined) { this.blockTail.equalsIndex = index; }
  }

  /** A `;` ends the declaration being read, or a variable block's tail, and starts a new statement. */
  private visitSemicolon(index: number): void {
    const semicolon = this.tokens[index];
    if (this.pending) {
      this.pending.endIndex = index;
      for (let line = this.lineOf(this.pending.start); line <= this.lineOf(semicolon); line++) {
        this.structure.declarationLines.add(line);
      }
    }
    if (this.blockTail) { this.blockTail.endIndex = index; }
    this.pending = undefined;
    this.blockTail = undefined;
    this.afterBlockClose = false;
    this.statementStart = true;
  }

  /** The first name after a variable block's `}` is the name of the block as a whole. */
  private visitBlockTail(token: KdicToken): void {
    if (this.blockTail || !isNameLike(token)) { return; }
    this.blockTail = { name: token, nameText: tokenName(token), members: this.blockMembers };
    this.dictionary!.blocks.push(this.blockTail);
  }

  /** Any other token of a dictionary: where a statement starts, a declaration may start. */
  private visitStatementToken(index: number): void {
    if (this.statementStart && !this.pending) {
      this.statementStart = false;
      const rejected = checkStatementStart(this.tokens, index, this.out);
      if (rejected) { this.structure.rejectedLines.add(this.lineOf(rejected)); }
    }

    const nameIndex = declarationHeadEnd(this.tokens, index);
    if (nameIndex >= 0 && this.isDeclarationStart(index)) { this.startDeclaration(index, nameIndex); }
  }

  /**
   * Whether the declaration head found at `index` starts a declaration. It does not when it is part of the
   * pending declaration's own head, a value after `=`, the type after `Unused`, or follows a word on its line
   * without a declaration being pending.
   */
  private isDeclarationStart(index: number): boolean {
    const { pending } = this;
    if (pending && index <= pending.nameIndex) { return false; }
    const previous = this.tokens[index - 1];
    if (previous?.text === '=' || previous?.text === 'Unused') { return false; }
    return pending !== undefined || !isNameLike(previous) || this.lineOf(previous) !== this.lineOf(this.tokens[index]);
  }

  /** Starts the declaration whose head begins at `index` and whose name is at `nameIndex`. */
  private startDeclaration(index: number, nameIndex: number): void {
    const { tokens, out } = this;
    const token = tokens[index];
    const name = tokens[nameIndex];
    if (!isNameLike(name)) {
      out.at(name?.start ?? token.end, name?.text.length ?? 1, 'Invalid variable name.');
      return;
    }
    this.endWithoutSemicolon(index); // a new declaration ends the previous one that lacks its `;`

    const typeIndex = index + (token.text === 'Unused' ? 1 : 0);
    const declaration: Declaration = {
      start: token, type: tokens[typeIndex], name, nameText: tokenName(name), nameIndex,
      relationTarget: relationTargetAt(tokens, typeIndex), joinKeys: joinKeysAt(tokens, nameIndex + 1), inBlock: this.braceDepth === 2,
      wordAfterName: wordAfterName(tokens[nameIndex + 1]),
    };
    this.pending = declaration;
    this.dictionary!.declarations.push(declaration);
    if (declaration.inBlock) { this.blockMembers.push(declaration); }

    if (isInvalidVariableName(name, tokens[nameIndex + 1])) {
      out.atToken(name, 'Invalid variable name.');
    } else if (declaration.wordAfterName) {
      out.atToken(declaration.wordAfterName,
        `Unexpected '${tokenName(declaration.wordAfterName)}' after variable name '${declaration.nameText}': ';' expected. A name with spaces needs backquotes.`);
    }
  }

  /** Ends the pending declaration at `endIndex` and reports its missing `;`, unless it is still being typed. */
  private endWithoutSemicolon(endIndex: number): void {
    const { pending, out } = this;
    if (!pending) { return; }
    pending.endIndex = endIndex;
    const { line, character } = out.document.positionAt(pending.start.start);
    if (line < out.document.lineCount - 1 && line !== this.cursorLine) {
      out.atLine(line, character, out.document.lineAt(line).text.trimEnd().length,
        "Missing ';' at end of variable declaration.");
    }
    this.pending = undefined;
  }
}

/** Builds the structure of the document from its tokens, reporting what is malformed in it. */
export function scanStructure(
  tokens: readonly KdicToken[],
  metadata: MetadataInfo,
  out: DiagnosticCollector,
  cursorLine: number | undefined,
): Structure {
  return new StructureScanner(tokens, metadata, out, cursorLine).scan();
}
