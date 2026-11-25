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
 * Walks the significant tokens once and builds the document's structure:
 * dictionaries, their declarations, and the lines they cover.
 *
 * Along the way it reports a missing `;` after a declaration or after a
 * dictionary's closing brace, and invalid variable names. A declaration that
 * is still being typed (last line, or the cursor line) is not reported.
 */
export function scanStructure(
  tokens: readonly KdicToken[],
  metadata: MetadataInfo,
  out: DiagnosticCollector,
  cursorLine: number | undefined,
): Structure {
  const structure: Structure = { dictionaries: [], declarationLines: new Set(), terminatorLines: new Set(), rejectedLines: new Set() };
  const document = out.document;
  const lineOf = (token: KdicToken): number => out.lineOf(token.start);

  let braceDepth = 0;
  // Open `(` / `[` of the current statement: separators inside them do not end a declaration.
  let groupDepth = 0;
  // Set right after a variable block's `}`: its `Name [= rule] ;` tail is not a declaration.
  let afterBlockClose = false;
  // The tail being read after a variable block's `}`, once its name is seen.
  let blockTail: BlockTail | undefined;
  // The variables declared in the variable block being read, which its tail takes over.
  let blockMembers: Declaration[] = [];
  // Whether the next token starts a statement: right after a `{` or a `;` that ends one.
  let statementStart = false;
  let pending: Declaration | undefined;
  let headerStart = 0;
  let dictionary: Dictionary | undefined;

  /** Ends the pending declaration at `endIndex` and reports its missing `;`. */
  const endWithoutSemicolon = (endIndex: number): void => {
    if (!pending) { return; }
    pending.endIndex = endIndex;
    const { line, character } = document.positionAt(pending.start.start);
    if (line < document.lineCount - 1 && line !== cursorLine) {
      out.atLine(line, character, document.lineAt(line).text.trimEnd().length,
        "Missing ';' at end of variable declaration.");
    }
    pending = undefined;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (metadata.tokenIndices.has(index)) { continue; }

    if (token.kind === 'symbol') {
      if (token.text === '(' || token.text === '[') { groupDepth++; continue; }
      if (token.text === ')' || token.text === ']') { groupDepth = Math.max(0, groupDepth - 1); continue; }

      if (token.text === '{') {
        if (braceDepth === 0) {
          const headerTokens: KdicToken[] = [];
          for (let k = headerStart; k < index; k++) {
            if (!metadata.tokenIndices.has(k)) { headerTokens.push(tokens[k]); }
          }
          dictionary = {
            headerTokens, header: parseHeader(headerTokens),
            openIndex: index, closeIndex: tokens.length, declarations: [], blocks: [],
          };
          structure.dictionaries.push(dictionary);
        }
        braceDepth++;
        if (braceDepth === 2) { blockMembers = []; }
        statementStart = true;
        groupDepth = 0;
        continue;
      }

      if (token.text === '}') {
        endWithoutSemicolon(index);
        if (braceDepth === 1) {
          // End of a dictionary: it must be followed by `;`.
          const next = tokens[index + 1];
          if (next?.text !== ';') { out.at(token.start, 1, "Missing ';' after closing brace of dictionary."); }
          else { structure.terminatorLines.add(lineOf(next)); }
          dictionary!.closeIndex = index;
          dictionary = undefined;
          headerStart = index + 1;
        }
        afterBlockClose = braceDepth > 1;
        blockTail = undefined;
        statementStart = false;
        braceDepth = Math.max(0, braceDepth - 1);
        groupDepth = 0;
        continue;
      }
    }

    // Outside a dictionary, or inside the parentheses of a call or key list.
    if (groupDepth > 0 || braceDepth === 0) { continue; }

    if (token.kind === 'symbol' && token.text === '=') {
      if (pending) { pending.equalsIndex = index; }
      else if (blockTail && blockTail.equalsIndex === undefined) { blockTail.equalsIndex = index; }
      continue;
    }
    if (token.kind === 'symbol' && token.text === ';') {
      if (pending) {
        pending.endIndex = index;
        for (let line = lineOf(pending.start); line <= lineOf(token); line++) { structure.declarationLines.add(line); }
      }
      pending = undefined;
      afterBlockClose = false;
      statementStart = true;
      if (blockTail) { blockTail.endIndex = index; }
      blockTail = undefined;
      continue;
    }
    if (afterBlockClose) {
      if (!blockTail && isNameLike(token)) {
        blockTail = { name: token, nameText: tokenName(token), members: blockMembers };
        dictionary!.blocks.push(blockTail);
      }
      continue;
    }
    if (statementStart && !pending) {
      statementStart = false;
      const rejected = checkStatementStart(tokens, index, out);
      if (rejected) { structure.rejectedLines.add(lineOf(rejected)); }
    }

    // Does a declaration start here?
    const nameIndex = declarationHeadEnd(tokens, index);
    if (nameIndex < 0) { continue; }
    if (pending && index <= pending.nameIndex) { continue; } // still inside the pending declaration's own head
    const previous = tokens[index - 1];
    if (previous?.text === '=' || previous?.text === 'Unused') { continue; } // a value, or the type of an `Unused` declaration
    if (!pending && isNameLike(previous) && lineOf(previous) === lineOf(token)) { continue; }

    const name = tokens[nameIndex];
    if (!isNameLike(name)) {
      out.at(name?.start ?? token.end, name?.text.length ?? 1, 'Invalid variable name.');
      continue;
    }
    endWithoutSemicolon(index); // a new declaration ends the previous one that lacks its `;`

    const typeIndex = index + (token.text === 'Unused' ? 1 : 0);
    const declaration: Declaration = {
      start: token, type: tokens[typeIndex], name, nameText: tokenName(name), nameIndex,
      relationTarget: relationTargetAt(tokens, typeIndex), joinKeys: joinKeysAt(tokens, nameIndex + 1), inBlock: braceDepth === 2,
      wordAfterName: wordAfterName(tokens[nameIndex + 1]),
    };
    pending = declaration;
    dictionary!.declarations.push(declaration);
    if (declaration.inBlock) { blockMembers.push(declaration); }
    if (isInvalidVariableName(name, tokens[nameIndex + 1])) {
      out.atToken(name, 'Invalid variable name.');
    } else if (declaration.wordAfterName) {
      out.atToken(declaration.wordAfterName,
        `Unexpected '${tokenName(declaration.wordAfterName)}' after variable name '${declaration.nameText}': ';' expected. A name with spaces needs backquotes.`);
    }
  }
  endWithoutSemicolon(tokens.length);
  return structure;
}
