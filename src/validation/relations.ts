import { tokenName } from '../kdic-lexer';
import type { DiagnosticCollector } from './diagnostics';
import type { Declaration, Dictionary, Structure } from './structure';

/** A relation variable, `Table(X)` or `Entity(X)`, whose target is a dictionary of the file. */
interface Relation {
  declaration: Declaration;
  target: Dictionary;
}

const keyLength = (dictionary: Dictionary): number => dictionary.header.keys.length;

/**
 * A native relation is stored in the data, so its dictionary is a component of the one that holds it. An external
 * entity (`[key]` after its name) refers to a root dictionary, a derived one (`= rule`) is computed, and a variable
 * of a variable block is defined by the block: none of them is a component.
 */
const isNative = ({ relationTarget, equalsIndex, joinKeys, inBlock }: Declaration): boolean =>
  relationTarget !== undefined && equalsIndex === undefined && joinKeys === undefined && !inBlock;

const isExternal = ({ relationTarget, joinKeys }: Declaration): boolean => relationTarget !== undefined && joinKeys !== undefined;

/** The dictionaries of the file by name; a name declared twice is left out, as it is reported on its own. */
function dictionariesByName(structure: Structure): Map<string, Dictionary> {
  const found = new Map<string, Dictionary[]>();
  for (const dictionary of structure.dictionaries) {
    const name = dictionary.header.name;
    if (name) { found.set(tokenName(name), [...(found.get(tokenName(name)) ?? []), dictionary]); }
  }
  return new Map([...found].filter(([, same]) => same.length === 1).map(([name, [dictionary]]) => [name, dictionary]));
}

/** The relations of a dictionary that satisfy `keep`, including those marked `Unused`, which Khiops checks as well. */
function relationsOf(dictionary: Dictionary, byName: Map<string, Dictionary>, keep: (declaration: Declaration) => boolean): Relation[] {
  return dictionary.declarations.filter(keep).flatMap(declaration => {
    const target = declaration.relationTarget && byName.get(tokenName(declaration.relationTarget));
    return target ? [{ declaration, target }] : [];
  });
}

/** The root dictionaries and every dictionary that a native relation leads to from one of them. */
function reachableFromRoots(structure: Structure, components: Map<Dictionary, Relation[]>): Set<Dictionary> {
  const reached = new Set(structure.dictionaries.filter(dictionary => dictionary.header.root));
  const queue = [...reached];
  for (let dictionary = queue.pop(); dictionary; dictionary = queue.pop()) {
    for (const { target } of components.get(dictionary) ?? []) {
      if (!reached.has(target)) { reached.add(target); queue.push(target); }
    }
  }
  return reached;
}

/**
 * The key of the dictionary of a native relation, against that of the dictionary that holds the variable: it exists,
 * is not shorter, and is longer when the variable is a `Table` and the dictionary has native relations of its own.
 */
function checkKeyLengths(parent: Dictionary, { declaration, target }: Relation, out: DiagnosticCollector): void {
  const relationTarget = declaration.relationTarget!;
  const [parentName, targetName] = [tokenName(parent.header.name!), tokenName(relationTarget)];
  const [parentKeys, targetKeys] = [keyLength(parent), keyLength(target)];
  if (targetKeys === 0) {
    out.atToken(relationTarget, `Dictionary '${targetName}' must have a key, as the target of ${declaration.type.text} variable '${declaration.nameText}'.`);
  } else if (targetKeys < parentKeys) {
    out.atToken(relationTarget, `The key of dictionary '${targetName}' (${targetKeys}) must not be shorter than that of its parent dictionary '${parentName}' (${parentKeys}).`);
  } else if (declaration.type.text === 'Table' && targetKeys === parentKeys && target.declarations.some(isNative)) {
    out.atToken(relationTarget, `The key of dictionary '${targetName}' (${targetKeys}) must be longer than that of its parent dictionary '${parentName}' (${parentKeys}), as it has relation variables of its own.`);
  }
}

/** An external entity is an `Entity` that refers to a root dictionary, with as many key fields as that dictionary. */
function checkExternalEntity({ declaration, target }: Relation, out: DiagnosticCollector): void {
  const targetName = tokenName(declaration.relationTarget!);
  if (declaration.type.text !== 'Entity') {
    out.atToken(declaration.type, `Variable '${declaration.nameText}' has a key between brackets: it must be an 'Entity'.`);
  }
  if (!target.header.root) {
    out.atToken(declaration.relationTarget!, `Dictionary '${targetName}' must be a root dictionary, as the target of external entity '${declaration.nameText}'.`);
  } else if (declaration.joinKeys!.length !== keyLength(target)) {
    out.atToken(declaration.name, `External entity '${declaration.nameText}' has ${declaration.joinKeys!.length} key field(s), but dictionary '${targetName}' has ${keyLength(target)}.`);
  }
}

/**
 * Rules of the multi-table schema that Khiops checks when it loads the dictionaries: a root dictionary has a key
 * and is not the component of another one, the keys of the dictionaries reached from a root grow with the depth,
 * and an external entity refers to a root dictionary.
 */
export function checkRelations(structure: Structure, out: DiagnosticCollector): void {
  const byName = dictionariesByName(structure);
  const components = new Map(structure.dictionaries.map(dictionary => [dictionary, relationsOf(dictionary, byName, isNative)]));

  for (const dictionary of structure.dictionaries) {
    const { header } = dictionary;
    if (header.valid && header.root && keyLength(dictionary) === 0) {
      out.atToken(header.name!, `Root dictionary '${tokenName(header.name!)}' must have a key.`);
    }
    for (const { declaration, target } of components.get(dictionary)!) {
      if (target.header.root) {
        out.atToken(declaration.relationTarget!, `Dictionary '${tokenName(declaration.relationTarget!)}' is a root dictionary: it cannot be the target of a ${declaration.type.text} variable, unless the variable has a key between brackets.`);
      }
    }
    for (const relation of relationsOf(dictionary, byName, isExternal)) { checkExternalEntity(relation, out); }
  }

  for (const parent of reachableFromRoots(structure, components)) {
    if (!parent.header.valid) { continue; }
    for (const relation of components.get(parent)!) { checkKeyLengths(parent, relation, out); }
  }
}
