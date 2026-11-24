import { isNameToken, tokenName, type KdicToken } from '../kdic-lexer';
import type { RuleMaps } from '../rule-maps';
import { Severity, type DiagnosticCollector } from './diagnostics';
import type { Dictionary, DictionaryHeader, Structure } from './structure';

const MAX_NAME_LENGTH = 128;

/** A rule call with no nested parentheses: `rule(arg, …)`; each argument is the list of its tokens. */
interface SimpleCall {
  rule: KdicToken;
  args: KdicToken[][];
}

/** Parses the call that follows the `=` at `equalsIndex`; returns undefined for anything more complex. */
function parseSimpleCall(tokens: readonly KdicToken[], equalsIndex: number): SimpleCall | undefined {
  const rule = tokens[equalsIndex + 1];
  if (rule?.kind !== 'identifier' || tokens[equalsIndex + 2]?.text !== '(') { return undefined; }
  const args: KdicToken[][] = [[]];
  for (let index = equalsIndex + 3; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'symbol' && token.text === '(') { return undefined; }
    if (token.kind === 'symbol' && token.text === ')') { return { rule, args: args.filter(arg => arg.length > 0) }; }
    if (token.kind === 'symbol' && token.text === ',') { args.push([]); continue; }
    args[args.length - 1].push(token);
  }
  return undefined;
}

/** Everything the checks of one dictionary share. */
interface DictionaryScope {
  dictionary: Dictionary;
  header: DictionaryHeader;
  /** Variable name → declared type, for every declaration of the block. */
  variables: Map<string, string>;
}

/**
 * Semantic checks on each dictionary: name lengths, key fields, relation
 * targets, and (for simple calls) rule return and argument types.
 *
 * Returns the lines taken by valid dictionary headers, which the line grammar
 * check must not flag.
 */
export function checkDictionaries(
  structure: Structure,
  tokens: readonly KdicToken[],
  knownDictionaries: ReadonlySet<string>,
  rules: RuleMaps,
  out: DiagnosticCollector,
): Set<number> {
  const headerLines = new Set<number>();
  for (const dictionary of structure.dictionaries) {
    const { header } = dictionary;
    const variables = new Map<string, string>();
    for (const declaration of dictionary.declarations) { variables.set(declaration.nameText, declaration.type.text); }
    const scope: DictionaryScope = { dictionary, header, variables };

    checkNameLengths(scope, out);
    if (header.valid) {
      collectHeaderLines(scope, tokens[dictionary.openIndex], headerLines, out);
      checkKeys(scope, out);
    }
    checkRelationTargets(scope, knownDictionaries, out);
    checkReturnTypes(scope, tokens, rules, out);
    checkRuleArguments(scope, tokens, rules, out);
  }
  return headerLines;
}

function checkNameLengths({ dictionary, header }: DictionaryScope, out: DiagnosticCollector): void {
  for (const { name, nameText } of dictionary.declarations) {
    if (nameText.length > MAX_NAME_LENGTH) {
      out.atToken(name, `Variable name '${nameText}' exceeds the 128-character limit.`);
    }
  }
  if (isNameToken(header.name) && tokenName(header.name).length > MAX_NAME_LENGTH) {
    out.atToken(header.name, `Dictionary name '${tokenName(header.name)}' exceeds the 128-character limit.`);
  }
}

/** Records the lines of a valid header, up to the `{` line unless code follows the brace. */
function collectHeaderLines({ header }: DictionaryScope, brace: KdicToken, lines: Set<number>, out: DiagnosticCollector): void {
  const bracePosition = out.document.positionAt(brace.start);
  for (let line = out.lineOf(header.keyword!.start); line <= bracePosition.line; line++) {
    const afterBrace = out.document.lineAt(line).text.slice(bracePosition.character + 1);
    if (line !== bracePosition.line || !afterBrace.trim()) { lines.add(line); }
  }
}

/** Key fields must be declared in the dictionary, `Categorical`, and not derived. */
function checkKeys({ dictionary, header }: DictionaryScope, out: DiagnosticCollector): void {
  for (const key of header.keys) {
    const keyName = tokenName(key);
    const declaration = dictionary.declarations.find(candidate => candidate.nameText === keyName);
    if (!declaration) {
      out.atToken(key, `Key field '${keyName}' is not declared in this dictionary.`);
      continue;
    }
    if (declaration.type.text !== 'Categorical') {
      out.atToken(declaration.type,
        `Key field '${keyName}' must be 'Categorical' but is declared as '${declaration.type.text}'.`);
    }
    if (declaration.equalsIndex !== undefined) {
      out.atToken(declaration.type, `Key field '${keyName}' must not be derived from a rule.`);
    }
  }
}

/** `Table(X)` and `Entity(X)` must name a dictionary declared in the file. */
function checkRelationTargets(
  { dictionary }: DictionaryScope, knownDictionaries: ReadonlySet<string>, out: DiagnosticCollector,
): void {
  for (const { relationTarget } of dictionary.declarations) {
    if (!relationTarget || knownDictionaries.has(tokenName(relationTarget))) { continue; }
    out.atToken(relationTarget, `Dictionary '${tokenName(relationTarget)}' is not declared in this file.`);
  }
}

/** The declared type of `Type name = rule(…)` must be one the rule can return. */
function checkReturnTypes(
  { dictionary }: DictionaryScope, tokens: readonly KdicToken[], rules: RuleMaps, out: DiagnosticCollector,
): void {
  for (const declaration of dictionary.declarations) {
    if (declaration.equalsIndex !== declaration.nameIndex + 1) { continue; }
    const call = parseSimpleCall(tokens, declaration.equalsIndex);
    const returnType = call && rules.returnTypes.get(call.rule.text);
    if (!call || !returnType || returnType === 'any' || returnType.split('|').includes(declaration.type.text)) { continue; }
    out.atToken(declaration.type,
      `'${call.rule.text}' returns '${returnType}' but variable is declared as '${declaration.type.text}'.`);
  }
}

/**
 * Checks the arguments of every simple rule call in the block (`= rule(a, b)`)
 * that is a bare variable of the current dictionary: it must be declared and
 * have the type the rule expects. Operands of another scope are left to Khiops.
 */
function checkRuleArguments(
  { dictionary, variables }: DictionaryScope, tokens: readonly KdicToken[], rules: RuleMaps, out: DiagnosticCollector,
): void {
  for (let index = dictionary.openIndex + 1; index < dictionary.closeIndex; index++) {
    if (tokens[index].kind !== 'symbol' || tokens[index].text !== '=') { continue; }
    const call = parseSimpleCall(tokens, index);
    const paramTypes = call && rules.paramTypes.get(call.rule.text);
    if (!call || !paramTypes) { continue; }

    const ruleName = call.rule.text;
    const baseTypes = paramTypes[paramTypes.length - 1] === '...' ? paramTypes.slice(0, -1) : paramTypes;
    // Rules over a table or entity: operands after the first live in the secondary table unless documented otherwise.
    const isRelational = ['Table', 'Entity', 'Block(Table)', 'Block(Entity)'].includes(baseTypes[0] ?? '');

    call.args.forEach((arg, position) => {
      if (arg.length !== 1 || arg[0].kind !== 'identifier') { return; }
      const expected = position < baseTypes.length ? baseTypes[position] : 'any';
      if (expected === 'any' || expected === '...' || expected.startsWith('Block(')) { return; }
      const scope = rules.paramScopes.get(ruleName)?.[position] ?? (isRelational && position > 0 ? 'unknown' : 'current');
      if (scope !== 'current') { return; }

      const variable = arg[0];
      const actual = variables.get(variable.text);
      if (actual === undefined) {
        out.atToken(variable, `'${variable.text}' is not declared in this dictionary.`, Severity.Warning);
      } else if (actual !== expected) {
        out.atToken(variable,
          `'${variable.text}' is '${actual}' but '${ruleName}' expects '${expected}' for argument ${position + 1}.`);
      }
    });
  }
}
