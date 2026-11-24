/**
 * Completion and hover data for the KDIC keywords and variable types.
 * (Derivation rules live in derivation-rules.ts.)
 *
 * Free of any VS Code dependency. To add a type, also add it to `KDIC_TYPES`
 * in kdic-syntax.ts, at the position that keeps longer names first.
 */

export interface LanguageEntry {
  label: string;
  /** Short category shown next to the entry in the completion list. */
  detail: string;
  /** Markdown shown in the completion details and on hover. */
  documentation: string;
  /** VS Code snippet inserted instead of the label, when it should expand to more than a word. */
  insertText?: string;
}

export const KEYWORDS: LanguageEntry[] = [
  {
    label: 'Dictionary',
    detail: 'keyword',
    documentation: 'Declares a new dictionary. Syntax: [Root] Dictionary <Name> [(<key-fields>)] { ... };',
    insertText: 'Dictionary ${1:Name}\n{\n\t$0\n};',
  },
  {
    label: 'Root',
    detail: 'keyword',
    documentation:
      'Tags a dictionary as the main (root) entity in a multi-table schema. Entities must be unique by key.\n\nSyntax: Root Dictionary <Name> (<key-fields>) { ... };',
    insertText: 'Root Dictionary ${1:Name} (${2:key})\n{\n\t$0\n};',
  },
  {
    label: 'Unused',
    detail: 'keyword',
    documentation:
      "Marks a variable as unused (excluded from modeling/deployment), while still making it available for deriving other variables.\n\nSyntax: Unused <type> <name> ;",
  },
];

export const NATIVE_TYPES: LanguageEntry[] = [
  {
    label: 'Categorical',
    detail: 'native type',
    documentation: 'String/categorical variable. Values are discrete labels.',
  },
  {
    label: 'Numerical',
    detail: 'native type',
    documentation: 'Floating-point numerical variable. Supports scientific notation (e.g. 1.3E7). Missing value: #Missing.',
  },
  {
    label: 'Text',
    detail: 'native type',
    documentation: 'Free text variable. Used for natural language processing tasks.',
  },
  {
    label: 'Date',
    detail: 'native type',
    documentation: 'Date variable. Format can be specified via metadata: <DateFormat="DD/MM/YYYY">',
  },
  {
    label: 'Time',
    detail: 'native type',
    documentation: 'Time variable. Format can be specified via metadata: <TimeFormat="HH.MM">',
  },
  {
    label: 'Timestamp',
    detail: 'native type',
    documentation: 'Timestamp variable. Format: <TimestampFormat="YYYY-MM-DD_HH:MM:SS">',
  },
  {
    label: 'TimestampTZ',
    detail: 'native type',
    documentation: 'Timestamp with timezone. Format: <TimestampTZFormat="YYYY-MM-DD_HH:MM:SS.zzzzz">',
  },
];

export const ADVANCED_TYPES: LanguageEntry[] = [
  {
    label: 'TextList',
    detail: 'advanced type',
    documentation: 'List of Text values, derived from a multi-table schema.',
  },
  {
    label: 'Entity',
    detail: 'advanced type',
    documentation: 'Represents a 0-1 relationship in a multi-table schema.\n\nSyntax: Entity(<DictionaryName>) <varName>;',
    insertText: 'Entity(${1:DictionaryName}) ${2:varName};',
  },
  {
    label: 'Table',
    detail: 'advanced type',
    documentation: 'Represents a 0-n relationship in a multi-table schema.\n\nSyntax: Table(<DictionaryName>) <varName>;',
    insertText: 'Table(${1:DictionaryName}) ${2:varName};',
  },
  {
    label: 'Structure',
    detail: 'advanced type (internal)',
    documentation: 'Used internally by Khiops to store model parameters.\n\nSyntax: Structure(<name>) <varName>;',
    insertText: 'Structure(${1:name}) ${2:varName};',
  },
];
