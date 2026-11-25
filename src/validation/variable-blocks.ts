import type { KdicToken } from '../kdic-lexer';
import type { DiagnosticCollector } from './diagnostics';
import { tagsAfter, type MetadataInfo, type MetadataTag } from './metadata';
import type { BlockTail, Structure } from './structure';

/** The largest integer Khiops accepts as a `VarKey`. */
const MAX_VARKEY = 1_000_000_000;

/** The value of a string tag, without its quotes and with doubled quotes undone. */
const stringValue = (token: KdicToken): string => token.text.slice(1, -1).replace(/""/g, '"');

/** The tags of what ends at `;` — a variable or the tail of a block — or none when it has no `;`. */
function tagsOf(endIndex: number | undefined, tokens: readonly KdicToken[], metadata: MetadataInfo): MetadataTag[] {
  return endIndex !== undefined && tokens[endIndex]?.text === ';' ? tagsAfter(metadata, endIndex) : [];
}

/**
 * Every variable of a block needs a `VarKey`, an integer between 1 and 1,000,000,000 or a non-empty
 * string, of the same kind in the whole block and not used twice. Khiops rejects the dictionary otherwise.
 * A `<VarKey>` without a value is left alone: Khiops reads it in ways that depend on its neighbours.
 */
function checkVarKeys(block: BlockTail, tokens: readonly KdicToken[], metadata: MetadataInfo, out: DiagnosticCollector): void {
  let kind: 'integer' | 'string' | undefined;
  const owners = new Map<string, string>();

  for (const member of block.members) {
    const tag = tagsOf(member.endIndex, tokens, metadata).find(candidate => candidate.key.text === 'VarKey');
    if (!tag) {
      out.atToken(member.name, `Meta-data VarKey must be specified for variable '${member.nameText}' of a variable block.`);
      continue;
    }
    const value = tag.value;
    if (!value) { continue; }

    const current = value.kind === 'number' ? 'integer' : 'string';
    kind ??= current;
    if (current !== kind) {
      out.atToken(value, `Meta-data VarKey must be ${kind === 'integer' ? 'an integer' : 'a string'}, like the other keys of the block.`);
      continue;
    }

    const number = Number(value.text);
    const text = current === 'integer' ? String(number) : stringValue(value);
    if (current === 'integer' && !Number.isInteger(number)) {
      out.atToken(value, 'Meta-data VarKey must be an integer.');
    } else if (current === 'integer' && (number < 1 || number > MAX_VARKEY)) {
      out.atToken(value, `Meta-data VarKey must be between 1 and ${MAX_VARKEY.toLocaleString('en-US')}.`);
    } else if (current === 'string' && text === '') {
      out.atToken(value, 'Meta-data VarKey must not be empty.');
    } else if (owners.has(text)) {
      out.atToken(value, `Meta-data VarKey ${value.text} is already used by variable '${owners.get(text)}' of the block.`);
    } else {
      owners.set(text, member.nameText);
    }
  }
}

/**
 * The default value of a block of `Numerical` variables is a number, `DefaultNumericalValue`; that of a block of
 * `Categorical` variables is a string, `DefaultCategoricalValue`. Each is rejected on the other kind of block.
 * Blocks of other or mixed types are not checked.
 */
function checkBlockDefaults(block: BlockTail, tokens: readonly KdicToken[], metadata: MetadataInfo, out: DiagnosticCollector): void {
  const types = new Set(block.members.map(member => member.type.text));
  const type = types.size === 1 ? [...types][0] : undefined;
  if (type !== 'Numerical' && type !== 'Categorical') { return; }

  for (const tag of tagsOf(block.endIndex, tokens, metadata)) {
    const key = tag.key.text;
    const wrongBlock = (key === 'DefaultNumericalValue' && type === 'Categorical')
      || (key === 'DefaultCategoricalValue' && type === 'Numerical');
    if (wrongBlock) {
      out.atToken(tag.key, `Meta-data '${key}' does not apply to a block of '${type}' variables.`);
    } else if (key === 'DefaultNumericalValue' && tag.value?.kind !== 'number') {
      out.atToken(tag.value ?? tag.key, "Meta-data 'DefaultNumericalValue' needs a numerical value.");
    } else if (key === 'DefaultCategoricalValue' && tag.value?.kind === 'number') {
      out.atToken(tag.value, "Meta-data 'DefaultCategoricalValue' needs a string value.");
    }
  }
}

/** Checks the keys and the default values of the variable blocks of every dictionary. */
export function checkVariableBlocks(
  structure: Structure, tokens: readonly KdicToken[], metadata: MetadataInfo, out: DiagnosticCollector,
): void {
  for (const dictionary of structure.dictionaries) {
    for (const block of dictionary.blocks) {
      checkVarKeys(block, tokens, metadata, out);
      checkBlockDefaults(block, tokens, metadata, out);
    }
  }
}
