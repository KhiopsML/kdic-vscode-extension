/**
 * Khiops Dictionary (.kdic) VS Code Extension
 *
 * Provides language support for Khiops dictionary files (.kdic), including:
 *  - Syntax highlighting  (declarative, via kdic.tmLanguage.json)
 *  - Context-aware IntelliSense completions
 *  - Hover documentation for all keywords, types, and derivation rules
 *  - Derivation rule type checking (argument types + return type vs declared type)
 *  - Line-level grammar validation
 *
 * Grammar reference: https://khiops.org/api-docs/kdic/dictionary-files/
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 *
 * KEYWORDS / NATIVE_TYPES / ADVANCED_TYPES
 *   Completion + hover data for the kdic language tokens (keywords and types).
 *
 * DERIVATION_RULES
 *   Completion + hover + type-checking data for the built-in derivation
 *   rules.  Each entry carries a human-readable `signature` and a `returnType`
 *   used by the type checker.
 *
 * PARAM_TYPE_MAP  (derived from DERIVATION_RULES at load time)
 *   Maps each rule name to its expected parameter types, parsed from `signature`.
 *   '...' marks vararg rules (e.g. Sum, And); 'any' marks untyped params.
 *
 * RETURN_TYPE_MAP  (derived from DERIVATION_RULES at load time)
 *   Maps each rule name to its return type string.  Union types such as
 *   'Numerical|Categorical' (used by If) are split on '|' when checking.
 *
 * activate()
 *   Registers the completion provider, hover provider, and diagnostic collection.
 *
 * validateDocument()
 *   Runs type checking and grammar validation on an open .kdic document.
 *
 * ── Extending the extension ───────────────────────────────────────────────────
 *
 * Adding a derivation rule: append one entry to DERIVATION_RULES with the
 *   correct `signature` (drives PARAM_TYPE_MAP) and `returnType` (drives
 *   RETURN_TYPE_MAP).  No other changes needed.
 *
 * Adding a keyword or type: append one entry to KEYWORDS, NATIVE_TYPES, or
 *   ADVANCED_TYPES.  Add the type name to KDIC_TYPES if it is a variable type.
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  KDIC_TYPES, Severity,
  type KdicDiagnostic, type KdicDocument,
  stripLineComments, extractDictionaryNames, buildTypeMaps, validate,
} from './validator';

// ─────────────────────────── Completion data ────────────────────────────────

interface CompletionEntry {
  label: string;
  kind: vscode.CompletionItemKind;
  detail: string;
  documentation: string;
  insertText?: string;
}

const KEYWORDS: CompletionEntry[] = [
  {
    label: 'Dictionary',
    kind: vscode.CompletionItemKind.Keyword,
    detail: 'keyword',
    documentation: 'Declares a new dictionary. Syntax: [Root] Dictionary <Name> [(<key-fields>)] { ... };',
    insertText: 'Dictionary ${1:Name}\n{\n\t$0\n};',
  },
  {
    label: 'Root',
    kind: vscode.CompletionItemKind.Keyword,
    detail: 'keyword',
    documentation:
      'Tags a dictionary as the main (root) entity in a multi-table schema. Entities must be unique by key.\n\nSyntax: Root Dictionary <Name> (<key-fields>) { ... };',
    insertText: 'Root Dictionary ${1:Name} (${2:key})\n{\n\t$0\n};',
  },
  {
    label: 'Unused',
    kind: vscode.CompletionItemKind.Keyword,
    detail: 'keyword',
    documentation:
      "Marks a variable as unused (excluded from modeling/deployment), while still making it available for deriving other variables.\n\nSyntax: Unused <type> <name> ;",
  },
];

const NATIVE_TYPES: CompletionEntry[] = [
  {
    label: 'Categorical',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'native type',
    documentation: 'String/categorical variable. Values are discrete labels.',
  },
  {
    label: 'Numerical',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'native type',
    documentation: 'Floating-point numerical variable. Supports scientific notation (e.g. 1.3E7). Missing value: #Missing.',
  },
  {
    label: 'Text',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'native type',
    documentation: 'Free text variable. Used for natural language processing tasks.',
  },
  {
    label: 'Date',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'native type',
    documentation: 'Date variable. Format can be specified via metadata: <DateFormat="DD/MM/YYYY">',
  },
  {
    label: 'Time',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'native type',
    documentation: 'Time variable. Format can be specified via metadata: <TimeFormat="HH.MM">',
  },
  {
    label: 'Timestamp',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'native type',
    documentation: 'Timestamp variable. Format: <TimestampFormat="YYYY-MM-DD_HH:MM:SS">',
  },
  {
    label: 'TimestampTZ',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'native type',
    documentation: 'Timestamp with timezone. Format: <TimestampTZFormat="YYYY-MM-DD_HH:MM:SS.zzzzz">',
  },
];

const ADVANCED_TYPES: CompletionEntry[] = [
  {
    label: 'TextList',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'advanced type',
    documentation: 'List of Text values, derived from a multi-table schema.',
  },
  {
    label: 'Entity',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'advanced type',
    documentation: 'Represents a 0-1 relationship in a multi-table schema.\n\nSyntax: Entity(<DictionaryName>) <varName>;',
    insertText: 'Entity(${1:DictionaryName}) ${2:varName};',
  },
  {
    label: 'Table',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'advanced type',
    documentation: 'Represents a 0-n relationship in a multi-table schema.\n\nSyntax: Table(<DictionaryName>) <varName>;',
    insertText: 'Table(${1:DictionaryName}) ${2:varName};',
  },
  {
    label: 'Structure',
    kind: vscode.CompletionItemKind.TypeParameter,
    detail: 'advanced type (internal)',
    documentation: 'Used internally by Khiops to store model parameters.\n\nSyntax: Structure(<name>) <varName>;',
    insertText: 'Structure(${1:name}) ${2:varName};',
  },
];

interface FunctionEntry extends CompletionEntry {
  signature: string;
  returnType: string;
}

const DERIVATION_RULES: FunctionEntry[] = [
  // Numerical comparisons
  { label: 'EQ', kind: vscode.CompletionItemKind.Function, detail: 'numerical comparison', returnType: 'Numerical', signature: 'EQ(Numerical value1, Numerical value2)', documentation: 'Equality test (returns 0 or 1). Missing value is treated as less than any valid value.' },
  { label: 'NEQ', kind: vscode.CompletionItemKind.Function, detail: 'numerical comparison', returnType: 'Numerical', signature: 'NEQ(Numerical value1, Numerical value2)', documentation: 'Inequality test (returns 0 or 1).' },
  { label: 'G', kind: vscode.CompletionItemKind.Function, detail: 'numerical comparison', returnType: 'Numerical', signature: 'G(Numerical value1, Numerical value2)', documentation: 'Greater than test (returns 0 or 1).' },
  { label: 'GE', kind: vscode.CompletionItemKind.Function, detail: 'numerical comparison', returnType: 'Numerical', signature: 'GE(Numerical value1, Numerical value2)', documentation: 'Greater than or equal test (returns 0 or 1).' },
  { label: 'L', kind: vscode.CompletionItemKind.Function, detail: 'numerical comparison', returnType: 'Numerical', signature: 'L(Numerical value1, Numerical value2)', documentation: 'Less than test (returns 0 or 1).' },
  { label: 'LE', kind: vscode.CompletionItemKind.Function, detail: 'numerical comparison', returnType: 'Numerical', signature: 'LE(Numerical value1, Numerical value2)', documentation: 'Less than or equal test (returns 0 or 1).' },

  // Categorical comparisons
  { label: 'EQc', kind: vscode.CompletionItemKind.Function, detail: 'categorical comparison', returnType: 'Numerical', signature: 'EQc(Categorical value1, Categorical value2)', documentation: 'Equality test for categorical values (returns 0 or 1).' },
  { label: 'NEQc', kind: vscode.CompletionItemKind.Function, detail: 'categorical comparison', returnType: 'Numerical', signature: 'NEQc(Categorical value1, Categorical value2)', documentation: 'Inequality test for categorical values (returns 0 or 1).' },
  { label: 'Gc', kind: vscode.CompletionItemKind.Function, detail: 'categorical comparison', returnType: 'Numerical', signature: 'Gc(Categorical value1, Categorical value2)', documentation: 'Lexicographic greater than test for categorical values (returns 0 or 1).' },
  { label: 'GEc', kind: vscode.CompletionItemKind.Function, detail: 'categorical comparison', returnType: 'Numerical', signature: 'GEc(Categorical value1, Categorical value2)', documentation: 'Lexicographic greater than or equal test for categorical values (returns 0 or 1).' },
  { label: 'Lc', kind: vscode.CompletionItemKind.Function, detail: 'categorical comparison', returnType: 'Numerical', signature: 'Lc(Categorical value1, Categorical value2)', documentation: 'Lexicographic less than test for categorical values (returns 0 or 1).' },
  { label: 'LEc', kind: vscode.CompletionItemKind.Function, detail: 'categorical comparison', returnType: 'Numerical', signature: 'LEc(Categorical value1, Categorical value2)', documentation: 'Lexicographic less than or equal test for categorical values (returns 0 or 1).' },

  // Logical
  { label: 'And', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Numerical', signature: 'And(Numerical value1, ...)', documentation: 'Logical AND of numerical boolean values (0 or 1).' },
  { label: 'Or', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Numerical', signature: 'Or(Numerical value1, ...)', documentation: 'Logical OR of numerical boolean values (0 or 1).' },
  { label: 'Not', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Numerical', signature: 'Not(Numerical value)', documentation: 'Logical NOT of a numerical boolean value (0 or 1).' },
  { label: 'If', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Numerical|Categorical', signature: 'If(Numerical condition, value1, value2)', documentation: 'Conditional expression: returns value1 if condition != 0, else value2.' },
  { label: 'IfC', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Categorical', signature: 'IfC(Numerical test, Categorical valueTrue, Categorical valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Categorical values, according to the condition in first operand.' },
  { label: 'IfD', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Date', signature: 'IfD(Numerical test, Date valueTrue, Date valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Date values, according to the condition in first operand.' },
  { label: 'IfT', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Time', signature: 'IfT(Numerical test, Time valueTrue, Time valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Time values, according to the condition in first operand.' },
  { label: 'IfTS', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Timestamp', signature: 'IfTS(Numerical test, Timestamp valueTrue, Timestamp valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Timestamp values, according to the condition in first operand.' },
  { label: 'IfTSTZ', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'TimestampTZ', signature: 'IfTSTZ(Numerical test, TimestampTZ valueTrue, TimestampTZ valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for TimestampTZ values, according to the condition in first operand.' },
  { label: 'IfText', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Text', signature: 'IfText(Numerical test, Text valueTrue, Text valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Text values, according to the condition in first operand.' },
  { label: 'Switch', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Numerical', signature: 'Switch(Numerical test, Numerical valueDefault, Numerical value1, ...)', documentation: 'Switch operator that returns the numerical value corresponding to the index given by the test operand if it is between 1 and K. The default value is returned if the index is outside the bounds.' },
  { label: 'SwitchC', kind: vscode.CompletionItemKind.Function, detail: 'logical', returnType: 'Categorical', signature: 'SwitchC(Numerical test, Categorical valueDefault, Categorical value1, ...)', documentation: 'Switch operator that returns the categorical value corresponding to the index given by the test operand if it is between 1 and K. The default value is returned if the index is outside the bounds.' },

  // Data copy and conversion
  { label: 'Copy', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'any', signature: 'Copy(value)', documentation: 'Copies the value of a variable. Allows to rename a variable.' },
  { label: 'CopyC', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Categorical', signature: 'CopyC(Categorical value)', documentation: 'Copy of a categorical value.' },
  { label: 'CopyD', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Date', signature: 'CopyD(Date value)', documentation: 'Copy of a date value.' },
  { label: 'CopyT', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Time', signature: 'CopyT(Time value)', documentation: 'Copy of a time value.' },
  { label: 'CopyTS', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Timestamp', signature: 'CopyTS(Timestamp value)', documentation: 'Copy of a timestamp value.' },
  { label: 'CopyTSTZ', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'TimestampTZ', signature: 'CopyTSTZ(TimestampTZ value)', documentation: 'Copy of a TimestampTZ value.' },
  { label: 'AsNumerical', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Numerical', signature: 'AsNumerical(Categorical value)', documentation: 'Converts a categorical value to numerical. Returns the missing value if the input is missing or not a valid number.' },
  { label: 'AsNumericalError', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Categorical', signature: 'AsNumericalError(Categorical value)', documentation: 'Label of the conversion error when converting a categorical value to numerical. Useful for analysing missing or erroneous values. Possible labels: "Unconverted end of string", "Underflow", "Overflow -inf", "Overflow +inf", "Conversion OK".' },
  { label: 'RecodeMissing', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Numerical', signature: 'RecodeMissing(Numerical inputValue, Numerical replaceValue)', documentation: 'Returns the input value if it is different from the missing value, and the replace value otherwise.' },
  { label: 'AsCategorical', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Categorical', signature: 'AsCategorical(Numerical value)', documentation: 'Converts a numerical value to categorical.' },
  { label: 'AsDate', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Date', signature: 'AsDate(Categorical value, Categorical format)', documentation: 'Parses a string into a Date using the given format.\n\nExample: AsDate("2014-01-15", "YYYY-MM-DD")' },
  { label: 'AsTime', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Time', signature: 'AsTime(Categorical value, Categorical format)', documentation: 'Parses a string into a Time using the given format.' },
  { label: 'AsTimestamp', kind: vscode.CompletionItemKind.Function, detail: 'conversion', returnType: 'Timestamp', signature: 'AsTimestamp(Categorical value, Categorical format)', documentation: 'Parses a string into a Timestamp using the given format.' },

  // Math
  { label: 'FormatNumerical', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Categorical', signature: 'FormatNumerical(Numerical value, Numerical width, Numerical precision)', documentation: 'Returns a formatted string of a numerical value.\n\nExample: FormatNumerical(3.14, 0, 2) → "3.14"' },
  { label: 'Sum', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Sum(Numerical value1, ...)', documentation: 'Sum of numerical values.' },
  { label: 'Minus', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Minus(Numerical value)', documentation: 'Opposite (negation) of a numerical value.' },
  { label: 'Diff', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Diff(Numerical value1, Numerical value2)', documentation: 'Difference between two numerical values.' },
  { label: 'Product', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Product(Numerical value1, ...)', documentation: 'Product of numerical values.' },
  { label: 'Divide', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Divide(Numerical value1, Numerical value2)', documentation: 'Ratio of two numerical values.' },
  { label: 'Index', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Index()', documentation: 'Integer index of the current record from the data file (starts at 1).' },
  { label: 'Random', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Random()', documentation: 'Random number between 0 and 1. Seed is fixed per database read for reproducibility.' },
  { label: 'Round', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Round(Numerical value)', documentation: 'Rounds to the closest integer.' },
  { label: 'Floor', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Floor(Numerical value)', documentation: 'Largest integer not greater than value.' },
  { label: 'Ceil', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Ceil(Numerical value)', documentation: 'Smallest integer not less than value.' },
  { label: 'Abs', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Abs(Numerical value)', documentation: 'Absolute value.' },
  { label: 'Sign', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Sign(Numerical value)', documentation: 'Sign: returns 1 for values >= 0, -1 for values < 0.' },
  { label: 'Mod', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Mod(Numerical value1, Numerical value2)', documentation: 'Modulo: value1 – value2 * Floor(value1/value2).' },
  { label: 'Log', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Log(Numerical value)', documentation: 'Natural logarithm.' },
  { label: 'Exp', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Exp(Numerical value)', documentation: 'Exponential (e^value).' },
  { label: 'Power', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Power(Numerical value1, Numerical value2)', documentation: 'Power: value1^value2.' },
  { label: 'Sqrt', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Sqrt(Numerical value)', documentation: 'Square root.' },
  { label: 'Sin', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Sin(Numerical value)', documentation: 'Sine function.' },
  { label: 'Cos', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Cos(Numerical value)', documentation: 'Cosine function.' },
  { label: 'Tan', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Tan(Numerical value)', documentation: 'Tangent function.' },
  { label: 'ASin', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'ASin(Numerical value)', documentation: 'Arc-sine function.' },
  { label: 'ACos', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'ACos(Numerical value)', documentation: 'Arc-cosine function.' },
  { label: 'ATan', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'ATan(Numerical value)', documentation: 'Arc-tangent function.' },
  { label: 'Pi', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Pi()', documentation: 'Pi constant.' },
  { label: 'Mean', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Mean(Numerical value1, ...)', documentation: 'Mean of numerical values.' },
  { label: 'StdDev', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'StdDev(Numerical value1, ...)', documentation: 'Standard deviation of numerical values.' },
  { label: 'Min', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Min(Numerical value1, ...)', documentation: 'Minimum of numerical values (non-missing).' },
  { label: 'Max', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'Max(Numerical value1, ...)', documentation: 'Maximum of numerical values (non-missing).' },
  { label: 'ArgMin', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'ArgMin(Numerical value1, ...)', documentation: 'Index (1-based) of the minimum value in a numerical series.' },
  { label: 'ArgMax', kind: vscode.CompletionItemKind.Function, detail: 'math', returnType: 'Numerical', signature: 'ArgMax(Numerical value1, ...)', documentation: 'Index (1-based) of the maximum value in a numerical series.' },

  // String rules
  { label: 'Length', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Numerical', signature: 'Length(Categorical value)', documentation: 'Length of a string.' },
  { label: 'Left', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'Left(Categorical value, Numerical charNumber)', documentation: 'Left n characters of a string.' },
  { label: 'Right', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'Right(Categorical value, Numerical charNumber)', documentation: 'Right n characters of a string.' },
  { label: 'Middle', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'Middle(Categorical value, Numerical startChar, Numerical charNumber)', documentation: 'Substring: charNumber characters starting at startChar (1-based).' },
  { label: 'TokenLength', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Numerical', signature: 'TokenLength(Categorical value, Categorical separators)', documentation: 'Number of tokens in a categorical value. A token is a non-empty substring containing no separator character.' },
  { label: 'TokenLeft', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'TokenLeft(Categorical value, Categorical separators, Numerical tokenNumber)', documentation: 'Extracts the leftmost tokens from a categorical value, retaining the original separators between tokens.' },
  { label: 'TokenRight', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'TokenRight(Categorical value, Categorical separators, Numerical tokenNumber)', documentation: 'Extracts the rightmost tokens from a categorical value, retaining the original separators between tokens.' },
  { label: 'TokenMiddle', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'TokenMiddle(Categorical value, Categorical separators, Numerical startToken, Numerical tokenNumber)', documentation: 'Extracts middle tokens from a categorical value (startToken is 1-based), retaining the original separators between tokens.' },
  { label: 'Translate', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'Translate(Categorical value, Structure(VectorC) searchValues, Structure(VectorC) replaceValues)', documentation: 'Replaces substrings in a categorical value using parallel search/replace VectorC literals.\n\nExample: Translate(v, VectorC("é","à"), VectorC("e","a"))' },
  { label: 'Search', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Numerical', signature: 'Search(Categorical value, Numerical startChar, Categorical searchValue)', documentation: 'Position (1-based) of first occurrence of searchValue in value, starting at startChar. Returns -1 if not found.' },
  { label: 'Replace', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'Replace(Categorical value, Numerical startChar, Categorical searchValue, Categorical replaceValue)', documentation: 'Replaces the first occurrence of searchValue in value with replaceValue.' },
  { label: 'ReplaceAll', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'ReplaceAll(Categorical value, Numerical startChar, Categorical searchValue, Categorical replaceValue)', documentation: 'Replaces all occurrences of searchValue in value with replaceValue.' },
  { label: 'RegexMatch', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Numerical', signature: 'RegexMatch(Categorical value, Categorical regexValue)', documentation: 'Returns 1 if the entire value matches the ECMAScript regex, 0 otherwise.' },
  { label: 'RegexSearch', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Numerical', signature: 'RegexSearch(Categorical value, Numerical startChar, Categorical regexValue)', documentation: 'Returns the position (1-based) of a regex match in a categorical value, or -1 if not found.' },
  { label: 'RegexReplace', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'RegexReplace(Categorical value, Numerical startChar, Categorical regexValue, Categorical replaceValue)', documentation: 'Replaces the first regex match in a categorical value.' },
  { label: 'RegexReplaceAll', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'RegexReplaceAll(Categorical value, Numerical startChar, Categorical regexValue, Categorical replaceValue)', documentation: 'Replaces all regex matches in a categorical value.' },
  { label: 'ToUpper', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'ToUpper(Categorical value)', documentation: 'Converts a string to upper case.' },
  { label: 'ToLower', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'ToLower(Categorical value)', documentation: 'Converts a string to lower case.' },
  { label: 'Concat', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'Concat(Categorical value1, ...)', documentation: 'Concatenates multiple string values.' },
  { label: 'Hash', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Numerical', signature: 'Hash(Categorical value, Numerical max)', documentation: 'Hash code of a string value, between 0 and max-1.' },
  { label: 'Encrypt', kind: vscode.CompletionItemKind.Function, detail: 'string', returnType: 'Categorical', signature: 'Encrypt(Categorical value, Categorical key)', documentation: 'Anonymizes a string using the given key. Output is alphanumeric only. Not cryptographically secure.' },

  // Date rules
  { label: 'Year', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'Year(Date date)', documentation: 'Year of a date.' },
  { label: 'Month', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'Month(Date date)', documentation: 'Month of a date (1–12).' },
  { label: 'Day', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'Day(Date date)', documentation: 'Day of month of a date (1–31).' },
  { label: 'YearDay', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'YearDay(Date date)', documentation: 'Day of year of a date (1–366).' },
  { label: 'Week', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'Week(Date date)', documentation: 'ISO week number of a date.' },
  { label: 'WeekDay', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'WeekDay(Date date)', documentation: 'Day of week (1=Monday … 7=Sunday).' },
  { label: 'DecimalYear', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'DecimalYear(Date date)', documentation: 'Date expressed as a decimal year.' },
  { label: 'AbsoluteDay', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'AbsoluteDay(Date value)', documentation: 'Total elapsed days since 2000-01-01.' },
  { label: 'DiffDate', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'DiffDate(Date date1, Date date2)', documentation: 'Difference in days between two dates.' },
  { label: 'AddDays', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Date', signature: 'AddDays(Date value, Numerical dayNumber)', documentation: 'Adds a number of days to a date value.' },
  { label: 'IsDateValid', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Numerical', signature: 'IsDateValid(Date value)', documentation: 'Returns 1 if the date value is valid, 0 otherwise.' },
  { label: 'BuildDate', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Date', signature: 'BuildDate(Numerical year, Numerical month, Numerical day)', documentation: 'Builds a Date value from year (1–9999), month (1–12) and day (1–31, consistent with month and year).' },
  { label: 'FormatDate', kind: vscode.CompletionItemKind.Function, detail: 'date', returnType: 'Categorical', signature: 'FormatDate(Date date, Categorical format)', documentation: 'Formats a date as a string using the given format.' },

  // Time rules
  { label: 'Hour', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Numerical', signature: 'Hour(Time time)', documentation: 'Hour of a time (0–23).' },
  { label: 'Minute', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Numerical', signature: 'Minute(Time time)', documentation: 'Minute of a time (0–59).' },
  { label: 'Second', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Numerical', signature: 'Second(Time time)', documentation: 'Second of a time (0–59.999, with millisecond precision).' },
  { label: 'DaySecond', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Numerical', signature: 'DaySecond(Time time)', documentation: 'Total seconds elapsed in a time value since 00:00:00.' },
  { label: 'DecimalTime', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Numerical', signature: 'DecimalTime(Time time)', documentation: 'Time expressed as a decimal fraction of a day (0.0 to ~23.999).' },
  { label: 'DiffTime', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Numerical', signature: 'DiffTime(Time time1, Time time2)', documentation: 'Difference in seconds between two time values.' },
  { label: 'IsTimeValid', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Numerical', signature: 'IsTimeValid(Time value)', documentation: 'Returns 1 if the time value is valid, 0 otherwise.' },
  { label: 'BuildTime', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Time', signature: 'BuildTime(Numerical hour, Numerical minute, Numerical second)', documentation: 'Builds a Time value from hour (0–23), minute (0–59) and second (0–59, with optional fraction).' },
  { label: 'FormatTime', kind: vscode.CompletionItemKind.Function, detail: 'time', returnType: 'Categorical', signature: 'FormatTime(Time time, Categorical format)', documentation: 'Formats a time as a string using the given format.' },

  // Timestamp rules
  { label: 'GetDate', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Date', signature: 'GetDate(Timestamp ts)', documentation: 'Extracts the date part of a timestamp.' },
  { label: 'GetTime', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Time', signature: 'GetTime(Timestamp ts)', documentation: 'Extracts the time part of a timestamp.' },
  { label: 'DecimalYearTS', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Numerical', signature: 'DecimalYearTS(Timestamp value)', documentation: 'Year in a timestamp value, including a decimal part for the day of the year and the time of day.' },
  { label: 'AbsoluteSecond', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Numerical', signature: 'AbsoluteSecond(Timestamp value)', documentation: 'Total elapsed seconds since 2000-01-01 00:00:00.' },
  { label: 'DecimalWeekDay', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Numerical', signature: 'DecimalWeekDay(Timestamp value)', documentation: 'Week day of the date of the timestamp value, plus decimal day of the time (WeekDay + DecimalTime/24).' },
  { label: 'DecimalTimestamp', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Numerical', signature: 'DecimalTimestamp(Timestamp ts)', documentation: 'Timestamp expressed as decimal seconds since epoch.' },
  { label: 'DiffTimestamp', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Numerical', signature: 'DiffTimestamp(Timestamp ts1, Timestamp ts2)', documentation: 'Difference in seconds between two timestamps.' },
  { label: 'AddSeconds', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Timestamp', signature: 'AddSeconds(Timestamp value, Numerical secondNumber)', documentation: 'Adds a number of seconds to a timestamp value.' },
  { label: 'IsTimestampValid', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Numerical', signature: 'IsTimestampValid(Timestamp value)', documentation: 'Returns 1 if the timestamp value is valid, 0 otherwise.' },
  { label: 'BuildTimestamp', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Timestamp', signature: 'BuildTimestamp(Date dateValue, Time timeValue)', documentation: 'Builds a Timestamp from a Date and a Time value.' },
  { label: 'FormatTimestamp', kind: vscode.CompletionItemKind.Function, detail: 'timestamp', returnType: 'Categorical', signature: 'FormatTimestamp(Timestamp ts, Categorical format)', documentation: 'Formats a timestamp as a string.' },

  // Table rules
  { label: 'TableCount', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableCount(Table table)', documentation: 'Number of records in a table.\n\nExample: TableCount(sales)' },
  { label: 'TableCountDistinct', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableCountDistinct(Table table, Categorical value)', documentation: 'Number of distinct categorical values in a table. Missing value counts as a distinct value.' },
  { label: 'TableEntropy', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableEntropy(Table table, Categorical value)', documentation: 'Entropy of a categorical variable in a table. High when all values are equally frequent.' },
  { label: 'TableMode', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Categorical', signature: 'TableMode(Table table, Categorical value)', documentation: 'Most frequent categorical value in a table. Ties resolved by lexicographic order.' },
  { label: 'TableModeAt', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Categorical', signature: 'TableModeAt(Table table, Categorical value, Numerical rank)', documentation: 'N-th most frequent categorical value in a table.' },
  { label: 'TableMean', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableMean(Table table, Numerical value)', documentation: 'Mean of numerical values in a table (non-missing only).' },
  { label: 'TableStdDev', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableStdDev(Table table, Numerical value)', documentation: 'Standard deviation of numerical values in a table.' },
  { label: 'TableMedian', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableMedian(Table table, Numerical value)', documentation: 'Median of numerical values in a table.' },
  { label: 'TableMin', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableMin(Table table, Numerical value)', documentation: 'Minimum of numerical values in a table.' },
  { label: 'TableMax', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableMax(Table table, Numerical value)', documentation: 'Maximum of numerical values in a table.' },
  { label: 'TableSum', kind: vscode.CompletionItemKind.Function, detail: 'table', returnType: 'Numerical', signature: 'TableSum(Table table, Numerical value)', documentation: 'Sum of numerical values in a table.' },

  // Table management rules
  { label: 'TableSelection', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'TableSelection(Table table, Numerical condition)', documentation: 'Filters a table to records where condition != 0.\n\nExample: TableSelection(DNA, EQc(Char, .MostFrequentChar))' },
  { label: 'TableAt', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Entity', signature: 'TableAt(Table table, Numerical rank)', documentation: 'Returns the record at given rank (1-based) in a table.' },
  { label: 'TableAtKey', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Entity', signature: 'TableAtKey(Table table, Categorical keyField1, ...)', documentation: 'Returns the first entity in the table matching the given key. Returns nothing if not found. Number of key fields must match the dictionary.' },
  { label: 'TableExtraction', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'TableExtraction(Table table, Numerical firstRank, Numerical lastRank)', documentation: 'Extracts a sub-table with entities between firstRank and lastRank (inclusive). Out-of-range ranks are ignored.' },
  { label: 'TableSelectFirst', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Entity', signature: 'TableSelectFirst(Table table, Numerical condition)', documentation: 'Returns the first entity meeting the selection criterion. Equivalent to TableAt(TableSelection(...), 1).' },
  { label: 'TableSort', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'TableSort(Table table, value1, ...)', documentation: 'Sorts a table by increasing order on one or more values (Numerical, Categorical, Date, Time, Timestamp, or TimestampTZ).' },
  { label: 'EntitySet', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'EntitySet(Entity entity1, Entity entity2, ...)', documentation: 'Builds a table from a set of entities sharing the same dictionary. Duplicate or missing entities are ignored.' },
  { label: 'TableUnion', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'TableUnion(Table table1, Table table2, ...)', documentation: 'Union of tables: contains entities belonging to any of the operands.' },
  { label: 'TableIntersection', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'TableIntersection(Table table1, Table table2, ...)', documentation: 'Intersection of tables: contains entities belonging to all operands.' },
  { label: 'TableDifference', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'TableDifference(Table table1, Table table2)', documentation: 'Symmetric difference of two tables: entities belonging to either operand but not both.' },
  { label: 'TableSubUnion', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'TableSubUnion(Table table, Table subTable)', documentation: 'Union of sub-tables of a table (snowflake schema). Aggregates all nested secondary tables into one flat table.' },
  { label: 'TableSubIntersection', kind: vscode.CompletionItemKind.Function, detail: 'table management', returnType: 'Table', signature: 'TableSubIntersection(Table table, Table subTable)', documentation: 'Intersection of sub-tables of a table (snowflake schema).' },

  // TimestampTZ rules — timezone-aware timestamps (ISO 8601 offset format)
  { label: 'AsTimestampTZ', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'TimestampTZ', signature: 'AsTimestampTZ(Categorical value, Categorical format)', documentation: 'Parses a string into a TimestampTZ using the given format.\n\nExample: AsTimestampTZ("2014-01-15 18:25:00+02:00", "YYYY-MM-DD HH:MM:SSzzzzzz")' },
  { label: 'FormatTimestampTZ', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'Categorical', signature: 'FormatTimestampTZ(TimestampTZ value, Categorical format)', documentation: 'Formats a TimestampTZ value as a string using the given format.' },
  { label: 'UtcTimestamp', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'Timestamp', signature: 'UtcTimestamp(TimestampTZ value)', documentation: 'Converts a TimestampTZ to a Timestamp in UTC time zone.' },
  { label: 'LocalTimestamp', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'Timestamp', signature: 'LocalTimestamp(TimestampTZ value)', documentation: 'Converts a TimestampTZ to a Timestamp in the local time zone.' },
  { label: 'SetTimeZoneMinutes', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'TimestampTZ', signature: 'SetTimeZoneMinutes(TimestampTZ value, Numerical minutes)', documentation: 'Modifies the time zone offset of a TimestampTZ. Minutes must be between -12*60 and +14*60.' },
  { label: 'GetTimeZoneMinutes', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'Numerical', signature: 'GetTimeZoneMinutes(TimestampTZ value)', documentation: 'Returns the time zone offset in total minutes (±(hh*60 + mm)) from a TimestampTZ value.' },
  { label: 'DiffTimestampTZ', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'Numerical', signature: 'DiffTimestampTZ(TimestampTZ value1, TimestampTZ value2)', documentation: 'Difference in seconds between two TimestampTZ values.' },
  { label: 'AddSecondsTSTZ', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'Timestamp', signature: 'AddSecondsTSTZ(TimestampTZ value, Numerical secondNumber)', documentation: 'Adds a number of seconds to a TimestampTZ value.' },
  { label: 'IsTimestampTZValid', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'Numerical', signature: 'IsTimestampTZValid(TimestampTZ value)', documentation: 'Returns 1 if the TimestampTZ value is valid, 0 otherwise.' },
  { label: 'BuildTimestampTZ', kind: vscode.CompletionItemKind.Function, detail: 'timestampTZ', returnType: 'TimestampTZ', signature: 'BuildTimestampTZ(Timestamp value, Numerical timezone)', documentation: 'Builds a TimestampTZ from a Timestamp and a time zone offset in minutes. Minutes must be between -12*60 and +14*60.' },

  // Entity rules — access fields/relations of a 0-1 related entity
  { label: 'Exist', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Numerical', signature: 'Exist(Entity entity)', documentation: 'Returns 1 if the entity exists, 0 otherwise.\n\nExample: Exist(customerAddress)' },
  { label: 'GetValue', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Numerical', signature: 'GetValue(Entity entity, Numerical value)', documentation: 'Returns a Numerical field from an entity. Returns missing if the entity does not exist.\n\nExample: GetValue(customerAddress, Length(street))' },
  { label: 'GetValueC', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Categorical', signature: 'GetValueC(Entity entity, Categorical value)', documentation: 'Returns a Categorical field from an entity. Returns "" if the entity does not exist.\n\nExample: GetValueC(customerAddress, city)' },
  { label: 'GetText', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Text', signature: 'GetText(Entity entity, Text value)', documentation: 'Returns a Text field from an entity. Returns "" if the entity does not exist.' },
  { label: 'GetValueD', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Date', signature: 'GetValueD(Entity entity, Date value)', documentation: 'Returns a Date field from an entity. Returns missing if the entity does not exist.' },
  { label: 'GetValueT', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Time', signature: 'GetValueT(Entity entity, Time value)', documentation: 'Returns a Time field from an entity. Returns missing if the entity does not exist.' },
  { label: 'GetValueTS', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Timestamp', signature: 'GetValueTS(Entity entity, Timestamp value)', documentation: 'Returns a Timestamp field from an entity. Returns missing if the entity does not exist.' },
  { label: 'GetValueTSTZ', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'TimestampTZ', signature: 'GetValueTSTZ(Entity entity, TimestampTZ value)', documentation: 'Returns a TimestampTZ field from an entity. Returns missing if the entity does not exist.' },
  { label: 'GetEntity', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Entity', signature: 'GetEntity(Entity entity, Entity value)', documentation: 'Returns a nested Entity field from an entity (snowflake schema).' },
  { label: 'GetTable', kind: vscode.CompletionItemKind.Function, detail: 'entity', returnType: 'Table', signature: 'GetTable(Entity entity, Table value)', documentation: 'Returns a Table field from an entity (snowflake schema).' },

  // Text rules — counterpart to string rules for the Text type (up to 1,000,000 chars)
  { label: 'FromText', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Categorical', signature: 'FromText(Text value)', documentation: 'Converts a Text value to Categorical (truncated to 1,000 chars).' },
  { label: 'ToText', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'ToText(Categorical value)', documentation: 'Converts a Categorical value to Text.' },
  { label: 'TextLoadFile', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextLoadFile(Categorical filePath)', documentation: 'Loads a file as a Text variable. Supports local paths and cloud URIs (when cloud drivers are loaded).' },
  { label: 'TextLength', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Numerical', signature: 'TextLength(Text value)', documentation: 'Length in characters of a Text value.' },
  { label: 'TextLeft', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextLeft(Text value, Numerical charNumber)', documentation: 'Extracts the left substring of a Text value.' },
  { label: 'TextRight', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextRight(Text value, Numerical charNumber)', documentation: 'Extracts the right substring of a Text value.' },
  { label: 'TextMiddle', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextMiddle(Text value, Numerical startChar, Numerical charNumber)', documentation: 'Extracts a substring from a Text value (startChar is 1-based).' },
  { label: 'TextTokenLength', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Numerical', signature: 'TextTokenLength(Text value, Categorical separators)', documentation: 'Number of tokens in a Text value. Tokens are non-empty substrings that contain no separator character.' },
  { label: 'TextTokenLeft', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextTokenLeft(Text value, Categorical separators, Numerical tokenNumber)', documentation: 'Extracts the leftmost tokens from a Text value.' },
  { label: 'TextTokenRight', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextTokenRight(Text value, Categorical separators, Numerical tokenNumber)', documentation: 'Extracts the rightmost tokens from a Text value.' },
  { label: 'TextTokenMiddle', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextTokenMiddle(Text value, Categorical separators, Numerical startToken, Numerical tokenNumber)', documentation: 'Extracts middle tokens from a Text value (startToken is 1-based).' },
  { label: 'TextTranslate', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextTranslate(Text value, Structure(VectorC) searchValues, Structure(VectorC) replaceValues)', documentation: 'Replaces substrings in a Text value using parallel search/replace VectorC literals.\n\nExample: TextTranslate(v, VectorC("é","à"), VectorC("e","a"))' },
  { label: 'TextSearch', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Numerical', signature: 'TextSearch(Text value, Numerical startChar, Categorical searchValue)', documentation: 'Returns the position (1-based) of a substring in a Text value, or -1 if not found.' },
  { label: 'TextReplace', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextReplace(Text value, Numerical startChar, Categorical searchValue, Categorical replaceValue)', documentation: 'Replaces the first occurrence of a substring in a Text value.' },
  { label: 'TextReplaceAll', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextReplaceAll(Text value, Numerical startChar, Categorical searchValue, Categorical replaceValue)', documentation: 'Replaces all occurrences of a substring in a Text value.' },
  { label: 'TextRegexMatch', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Numerical', signature: 'TextRegexMatch(Text value, Categorical regex)', documentation: 'Returns 1 if the entire Text value matches the ECMAScript regex, 0 otherwise.' },
  { label: 'TextRegexSearch', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Numerical', signature: 'TextRegexSearch(Text value, Numerical startChar, Categorical regex)', documentation: 'Returns the position of a regex match in a Text value, or -1 if not found.' },
  { label: 'TextRegexReplace', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextRegexReplace(Text value, Numerical startChar, Categorical regex, Categorical replacement)', documentation: 'Replaces the first regex match in a Text value.' },
  { label: 'TextRegexReplaceAll', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextRegexReplaceAll(Text value, Numerical startChar, Categorical regex, Categorical replacement)', documentation: 'Replaces all regex matches in a Text value.' },
  { label: 'TextToUpper', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextToUpper(Text value)', documentation: 'Converts a Text value to upper case.' },
  { label: 'TextToLower', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextToLower(Text value)', documentation: 'Converts a Text value to lower case.' },
  { label: 'TextConcat', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextConcat(Text value1, ...)', documentation: 'Concatenates multiple Text values.' },
  { label: 'TextHash', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Numerical', signature: 'TextHash(Text value, Numerical max)', documentation: 'Hash of a Text value, between 0 and max-1.' },
  { label: 'TextEncrypt', kind: vscode.CompletionItemKind.Function, detail: 'text', returnType: 'Text', signature: 'TextEncrypt(Text value, Categorical key)', documentation: 'Anonymizes a Text value using the given key. Output is alphanumeric only. Not cryptographically secure.' },

  // TextList rules — list of Text values, mainly for multi-table Text aggregation
  { label: 'TextList', kind: vscode.CompletionItemKind.Function, detail: 'textlist', returnType: 'TextList', signature: 'TextList(Text value1, ...)', documentation: 'Builds a TextList from a set of Text values.' },
  { label: 'TextListSize', kind: vscode.CompletionItemKind.Function, detail: 'textlist', returnType: 'Numerical', signature: 'TextListSize(TextList value)', documentation: 'Number of Text values in a TextList.' },
  { label: 'TextListAt', kind: vscode.CompletionItemKind.Function, detail: 'textlist', returnType: 'Text', signature: 'TextListAt(TextList value, Numerical index)', documentation: 'Returns the Text value at given index (1-based). Returns "" if out of bounds.' },
  { label: 'TextListConcat', kind: vscode.CompletionItemKind.Function, detail: 'textlist', returnType: 'TextList', signature: 'TextListConcat(TextList value1, ...)', documentation: 'Concatenates multiple TextList values into one.' },
  { label: 'GetTextList', kind: vscode.CompletionItemKind.Function, detail: 'textlist', returnType: 'TextList', signature: 'GetTextList(Entity entity, TextList value)', documentation: 'Returns a TextList field from an entity. Returns empty TextList if the entity does not exist.' },
  { label: 'TableAllTexts', kind: vscode.CompletionItemKind.Function, detail: 'textlist', returnType: 'TextList', signature: 'TableAllTexts(Table table, Text value)', documentation: 'Aggregates all Text values from a secondary table variable into a TextList.' },
  { label: 'TableAllTextLists', kind: vscode.CompletionItemKind.Function, detail: 'textlist', returnType: 'TextList', signature: 'TableAllTextLists(Table table, TextList value)', documentation: 'Concatenates all TextList values from a secondary table variable into a single TextList.' },

  // Vector rules — typed arrays used as arguments to data preparation and text rules
  { label: 'VectorC', kind: vscode.CompletionItemKind.Function, detail: 'vector', returnType: 'Structure', signature: 'VectorC(Categorical value1, ...)', documentation: 'Builds a Structure(VectorC) of Categorical values. Used e.g. as argument to TextTranslate.' },
  { label: 'TableVectorC', kind: vscode.CompletionItemKind.Function, detail: 'vector', returnType: 'Structure', signature: 'TableVectorC(Table table, Categorical value)', documentation: 'Builds a Structure(VectorC) from Categorical values in a table.' },
  { label: 'ValueAtC', kind: vscode.CompletionItemKind.Function, detail: 'vector', returnType: 'Categorical', signature: 'ValueAtC(Structure(VectorC) vector, Numerical index)', documentation: 'Returns the Categorical value at given index (1-based) in a VectorC. Returns "" if out of bounds.' },
  { label: 'Vector', kind: vscode.CompletionItemKind.Function, detail: 'vector', returnType: 'Structure', signature: 'Vector(Numerical value1, ...)', documentation: 'Builds a Structure(Vector) of Numerical values.' },
  { label: 'TableVector', kind: vscode.CompletionItemKind.Function, detail: 'vector', returnType: 'Structure', signature: 'TableVector(Table table, Numerical value)', documentation: 'Builds a Structure(Vector) from Numerical values in a table.' },
  { label: 'ValueAt', kind: vscode.CompletionItemKind.Function, detail: 'vector', returnType: 'Numerical', signature: 'ValueAt(Structure(Vector) vector, Numerical index)', documentation: 'Returns the Numerical value at given index (1-based) in a Vector. Returns missing if out of bounds.' },

  // Hash map rules — key-value lookup structures
  { label: 'HashMapC', kind: vscode.CompletionItemKind.Function, detail: 'hash map', returnType: 'Structure', signature: 'HashMapC(Structure(VectorC) keyVector, Structure(VectorC) valueVector)', documentation: 'Builds a Structure(HashMapC) of Categorical values indexed by Categorical keys. Both vectors must contain only literal values and have the same size with unique keys.' },
  { label: 'TableHashMapC', kind: vscode.CompletionItemKind.Function, detail: 'hash map', returnType: 'Structure', signature: 'TableHashMapC(Table table, Categorical key, Categorical value)', documentation: 'Builds a Structure(HashMapC) from Categorical keys and values in a table. In case of duplicate keys, only the first matching value is kept.' },
  { label: 'ValueAtKeyC', kind: vscode.CompletionItemKind.Function, detail: 'hash map', returnType: 'Categorical', signature: 'ValueAtKeyC(Structure(HashMapC) hashMap, Categorical key)', documentation: 'Returns the Categorical value in a HashMapC at the given key. Returns "" if not found.\n\nExample: ValueAtKeyC(HashMapC(VectorC("male","female"), VectorC("Mr","Mrs")), Sex)' },
  { label: 'HashMap', kind: vscode.CompletionItemKind.Function, detail: 'hash map', returnType: 'Structure', signature: 'HashMap(Structure(VectorC) keyVector, Structure(Vector) valueVector)', documentation: 'Builds a Structure(HashMap) of Numerical values indexed by Categorical keys. Both vectors must contain only literal values and have the same size with unique keys.' },
  { label: 'TableHashMap', kind: vscode.CompletionItemKind.Function, detail: 'hash map', returnType: 'Structure', signature: 'TableHashMap(Table table, Categorical key, Numerical value)', documentation: 'Builds a Structure(HashMap) from Categorical keys and Numerical values in a table. In case of duplicate keys, only the first matching value is kept.' },
  { label: 'ValueAtKey', kind: vscode.CompletionItemKind.Function, detail: 'hash map', returnType: 'Numerical', signature: 'ValueAtKey(Structure(HashMap) hashMap, Categorical key)', documentation: 'Returns the Numerical value in a HashMap at the given key. Returns missing if not found.\n\nExample: ValueAtKey(HashMap(VectorC("male","female"), Vector(0, 1)), Sex)' },

  // Data preparation rules — build partition/grid structures for model deployment
  { label: 'DataGrid', kind: vscode.CompletionItemKind.Function, detail: 'data preparation', returnType: 'Structure', signature: 'DataGrid(Structure(Partition) partition1, ..., Structure(Frequencies) frequencies)', documentation: 'Builds a DataGrid from partitions and cell frequencies. Cells are indexed column-first.\n\nExample:\n  DataGrid(IntervalBounds(0.75, 1.55), ValueSetC("A","B","C"), Frequencies(38,0,0, 0,33,3, 0,0,34))' },
  { label: 'IntervalBounds', kind: vscode.CompletionItemKind.Function, detail: 'data preparation', returnType: 'Structure', signature: 'IntervalBounds(Numerical bound1, ...)', documentation: 'Builds a Structure(IntervalBounds) partition into intervals. Used as dimension input to DataGrid.' },
  { label: 'ValueGroup', kind: vscode.CompletionItemKind.Function, detail: 'data preparation', returnType: 'Structure', signature: 'ValueGroup(Categorical value1, ...)', documentation: 'Builds a Structure(ValueGroup) — a group of categorical values. The special value "*" matches any value not defined elsewhere.' },
  { label: 'ValueGroups', kind: vscode.CompletionItemKind.Function, detail: 'data preparation', returnType: 'Structure', signature: 'ValueGroups(Structure(ValueGroup) group1, ...)', documentation: 'Builds a Structure(ValueGroups) partition into groups of categorical values. Exactly one group must contain "*".' },
  { label: 'ValueSetC', kind: vscode.CompletionItemKind.Function, detail: 'data preparation', returnType: 'Structure', signature: 'ValueSetC(Categorical value1, ...)', documentation: 'Builds a Structure(ValueSetC) partition into categorical values. Used as dimension input to DataGrid.' },
  { label: 'ValueSet', kind: vscode.CompletionItemKind.Function, detail: 'data preparation', returnType: 'Structure', signature: 'ValueSet(Numerical value1, ...)', documentation: 'Builds a Structure(ValueSet) partition into numerical values. Used as dimension input to DataGrid.' },
  { label: 'Frequencies', kind: vscode.CompletionItemKind.Function, detail: 'data preparation', returnType: 'Structure', signature: 'Frequencies(Numerical frequency1, ...)', documentation: 'Builds a Structure(Frequencies) — a vector of cell frequencies. Last argument to DataGrid; cells are indexed column-first.' },

  // Recoding rules — retrieve cell/part from a partition or data grid
  { label: 'InInterval', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'InInterval(Structure(IntervalBounds) interval, Numerical value)', documentation: 'Returns 1 if the value belongs to the interval (2 bounds, defining ]lower; upper]), 0 otherwise.' },
  { label: 'InGroup', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'InGroup(Structure(ValueGroup) group, Categorical value)', documentation: 'Returns 1 if the categorical value belongs to the value group, 0 otherwise.' },
  { label: 'CellIndex', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'CellIndex(Structure(DataGrid) dataGrid, SimpleType value1, ...)', documentation: 'Returns the Numerical cell index for a list of input values in a DataGrid.' },
  { label: 'CellId', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Categorical', signature: 'CellId(Structure(DataGrid) dataGrid, SimpleType value1, ...)', documentation: 'Returns the Categorical cell identifier for a list of input values in a DataGrid.' },
  { label: 'CellLabel', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Categorical', signature: 'CellLabel(Structure(DataGrid) dataGrid, SimpleType value1, ...)', documentation: 'Returns the Categorical cell label for a list of input values in a DataGrid.' },
  { label: 'ValueIndexDG', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'ValueIndexDG(Structure(DataGrid) dataGrid, SimpleType value)', documentation: 'Returns the Numerical part index for a value in a univariate DataGrid.' },
  { label: 'PartIndexAt', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'PartIndexAt(Structure(DataGrid) dataGrid, Numerical dimIndex, SimpleType value)', documentation: 'Returns the Numerical part index for a value along a given dimension (1-based) of a DataGrid.' },
  { label: 'PartIdAt', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Categorical', signature: 'PartIdAt(Structure(DataGrid) dataGrid, Numerical dimIndex, SimpleType value)', documentation: 'Returns the Categorical part identifier for a value along a given dimension (1-based) of a DataGrid.' },
  { label: 'ValueRank', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'ValueRank(Structure(DataGrid) dataGrid, Numerical value)', documentation: 'Returns the average normalized rank of a Numerical value in a univariate Numerical DataGrid.' },
  { label: 'InverseValueRank', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'InverseValueRank(Structure(DataGrid) dataGrid, Numerical rank)', documentation: 'Returns the average value for a given normalized rank in a univariate Numerical DataGrid.' },
  { label: 'DataGridStats', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Structure', signature: 'DataGridStats(Structure(DataGrid) dataGrid, SimpleType value1, ...)', documentation: 'Computes conditional probability statistics for a list of input values in a DataGrid.' },
  { label: 'SourceConditionalInfo', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'SourceConditionalInfo(Structure(DataGridStats) stats, Numerical outputIndex)', documentation: 'Returns the source conditional info (negative log of conditional probability) for the input cell and a target cell index (1-based).' },
  { label: 'IntervalId', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Categorical', signature: 'IntervalId(Structure(IntervalBounds) bounds, Numerical value)', documentation: 'Returns the Categorical part identifier of a Numerical value in an interval partition.' },
  { label: 'ValueId', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Categorical', signature: 'ValueId(Structure(ValueSet) values, Numerical value)', documentation: 'Returns the Categorical part identifier of a Numerical value in a ValueSet partition.' },
  { label: 'GroupId', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Categorical', signature: 'GroupId(Structure(ValueGroups) groups, Categorical value)', documentation: 'Returns the Categorical part identifier of a Categorical value in a ValueGroups partition.' },
  { label: 'ValueIdC', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Categorical', signature: 'ValueIdC(Structure(ValueSetC) values, Categorical value)', documentation: 'Returns the Categorical part identifier of a Categorical value in a ValueSetC partition. Returns the "*" identifier if not found (or "1" if "*" is absent).' },
  { label: 'IntervalIndex', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'IntervalIndex(Structure(IntervalBounds) bounds, Numerical value)', documentation: 'Returns the Numerical part index of a Numerical value in an interval partition.' },
  { label: 'ValueIndex', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'ValueIndex(Structure(ValueSet) values, Numerical value)', documentation: 'Returns the Numerical part index of a Numerical value in a ValueSet partition.' },
  { label: 'GroupIndex', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'GroupIndex(Structure(ValueGroups) groups, Categorical value)', documentation: 'Returns the Numerical part index of a Categorical value in a ValueGroups partition.' },
  { label: 'ValueIndexC', kind: vscode.CompletionItemKind.Function, detail: 'recoding', returnType: 'Numerical', signature: 'ValueIndexC(Structure(ValueSetC) values, Categorical value)', documentation: 'Returns the Numerical part index of a Categorical value in a ValueSetC partition. Returns the "*" index if not found (or 1 if "*" is absent).' },
  // ── Predictor rules ──────────────────────────────────────────────────────
  { label: 'NBClassifier', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Structure', signature: 'NBClassifier(Structure(DataGridStats) dataGridStats1, ...)', documentation: 'Builds a Naive Bayes `Classifier` structure from a set of data grid stats that encode the target conditional probabilities. Each data grid stats results from a preparation model (data grid) and input values.' },
  { label: 'SNBClassifier', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Structure', signature: 'SNBClassifier(Structure(Vector) variableWeights, Structure(DataGridStats) dataGridStats1, ...)', documentation: 'Builds a Selective Naive Bayes `Classifier` structure. The first parameter is a Vector of weights for the selected variables. The remaining parameters are the same as for NBClassifier.' },
  { label: 'TargetValue', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Categorical', signature: 'TargetValue(Structure(Classifier) classifier)', documentation: "Computes a `Classifier`'s most probable target value." },
  { label: 'TargetProb', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetProb(Structure(Classifier) classifier)', documentation: 'Computes the `Classifier` probability of the most probable target value.' },
  { label: 'TargetProbAt', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetProbAt(Structure(Classifier) classifier, Categorical targetValue)', documentation: 'Computes the `Classifier` probability (score) of a given target value.' },
  { label: 'BiasedTargetValue', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Categorical', signature: 'BiasedTargetValue(Structure(Classifier) classifier, Structure(Vector) biasValues)', documentation: 'Computes the `Classifier` highest score target value, after adding a bias to each initial target value score. The bias values are provided as literal values.' },
  { label: 'NBRankRegressor', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Structure', signature: 'NBRankRegressor(Structure(DataGridStats) dataGridStats1, ...)', documentation: 'Builds a Naive Bayes `RankRegressor` structure from a set of data grid stats.' },
  { label: 'SNBRankRegressor', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Structure', signature: 'SNBRankRegressor(Structure(Vector) variableWeights, Structure(DataGridStats) dataGridStats1, ...)', documentation: 'Builds a Selective Naive Bayes `RankRegressor`. The first parameter is a Vector of weights for the selected variables. The remaining parameters are the same as for NBRankRegressor.' },
  { label: 'TargetRankMean', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetRankMean(Structure(RankRegressor) rankRegressor)', documentation: 'Computes the `RankRegressor` target rank mean.' },
  { label: 'TargetRankStandardDeviation', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetRankStandardDeviation(Structure(RankRegressor) rankRegressor)', documentation: "Computes the `RankRegressor` target rank's standard deviation." },
  { label: 'TargetRankDensityAt', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetRankDensityAt(Structure(RankRegressor) rankRegressor, Numerical rank)', documentation: 'Computes the `RankRegressor` density of the target rank for a given normalized rank (between 0 and 1).' },
  { label: 'TargetRankCumulativeProbAt', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetRankCumulativeProbAt(Structure(RankRegressor) rankRegressor, Numerical rank)', documentation: 'Computes the `RankRegressor` probability that the target rank is below a given normalized rank.' },
  { label: 'NBRegressor', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Structure', signature: 'NBRegressor(Structure(RankRegressor) nbRankRegressor, Structure(DataGrid) targetValues)', documentation: 'Builds a Naive Bayes `Regressor` structure. The first parameter is a Naive Bayes `RankRegressor`. The second parameter is the distribution of numerical target values encoded as a univariate numerical data grid.' },
  { label: 'SNBRegressor', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Structure', signature: 'SNBRegressor(Structure(RankRegressor) snbRankRegressor, Structure(DataGrid) targetValues)', documentation: 'Builds a Selective Naive Bayes `Regressor` structure from a `RankRegressor`. The second parameter is the distribution of numerical target values encoded as a univariate numerical data grid.' },
  { label: 'TargetMean', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetMean(Structure(Regressor) regressor)', documentation: 'Computes the `Regressor` mean target value.' },
  { label: 'TargetStandardDeviation', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetStandardDeviation(Structure(Regressor) regressor)', documentation: 'Computes the `Regressor` standard deviation of the target value.' },
  { label: 'TargetDensityAt', kind: vscode.CompletionItemKind.Function, detail: 'predictor', returnType: 'Numerical', signature: 'TargetDensityAt(Structure(Regressor) regressor, Numerical value)', documentation: 'Computes the `Regressor` density of the target for a given value.' },
  // ── Interpretation rules ─────────────────────────────────────────────────
  { label: 'ClassifierInterpreter', kind: vscode.CompletionItemKind.Function, detail: 'interpretation', returnType: 'Structure', signature: 'ClassifierInterpreter(Structure(Classifier) classifier)', documentation: 'Builds a `ClassifierInterpreter` structure from a `Classifier`. Contains all necessary information to derive Shapley-value interpretation indicators for each classifier variable and target value.' },
  { label: 'ContributionAt', kind: vscode.CompletionItemKind.Function, detail: 'interpretation', returnType: 'Numerical', signature: 'ContributionAt(Structure(ClassifierInterpreter) interpreter, Categorical targetValue, Categorical classifierVariableName)', documentation: 'Returns the Shapley value for a given target value and classifier variable name.' },
  { label: 'ContributionVariableAt', kind: vscode.CompletionItemKind.Function, detail: 'interpretation', returnType: 'Categorical', signature: 'ContributionVariableAt(Structure(ClassifierInterpreter) interpreter, Categorical targetValue, Numerical rank)', documentation: 'Returns the name of the variable at the specified importance rank (1-based) for a target value, ordered by decreasing Shapley values.' },
  { label: 'ContributionPartAt', kind: vscode.CompletionItemKind.Function, detail: 'interpretation', returnType: 'Categorical', signature: 'ContributionPartAt(Structure(ClassifierInterpreter) interpreter, Categorical targetValue, Numerical rank)', documentation: 'Returns the label of the variable part at the specified importance rank (1-based) for a target value, ordered by decreasing Shapley values.' },
  { label: 'ContributionValueAt', kind: vscode.CompletionItemKind.Function, detail: 'interpretation', returnType: 'Numerical', signature: 'ContributionValueAt(Structure(ClassifierInterpreter) interpreter, Categorical targetValue, Numerical rank)', documentation: 'Returns the Shapley value at the specified importance rank (1-based) for a target value, ordered by decreasing Shapley values.' },
  // ── Reinforcement rules ──────────────────────────────────────────────────
  { label: 'ClassifierReinforcer', kind: vscode.CompletionItemKind.Function, detail: 'reinforcement', returnType: 'Structure', signature: 'ClassifierReinforcer(Structure(Classifier) classifier, Structure(VectorC) leverVariableNames)', documentation: 'Builds a `ClassifierReinforcer` structure from a `Classifier` and a list of lever variable names (literal values). Contains all information to compute reinforcement scores for each lever variable and target value.' },
  { label: 'ReinforcementInitialScoreAt', kind: vscode.CompletionItemKind.Function, detail: 'reinforcement', returnType: 'Numerical', signature: 'ReinforcementInitialScoreAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue)', documentation: 'Returns the initial prediction score for a given target value.' },
  { label: 'ReinforcementVariableAt', kind: vscode.CompletionItemKind.Function, detail: 'reinforcement', returnType: 'Categorical', signature: 'ReinforcementVariableAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue, Numerical rank)', documentation: 'Returns the name of the lever variable at the specified reinforcement rank (1-based) for a target value, ordered by decreasing reinforcement scores.' },
  { label: 'ReinforcementPartAt', kind: vscode.CompletionItemKind.Function, detail: 'reinforcement', returnType: 'Categorical', signature: 'ReinforcementPartAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue, Numerical rank)', documentation: 'Returns the label of the lever variable part at the specified reinforcement rank (1-based) for a target value, ordered by decreasing reinforcement scores.' },
  { label: 'ReinforcementFinalScoreAt', kind: vscode.CompletionItemKind.Function, detail: 'reinforcement', returnType: 'Numerical', signature: 'ReinforcementFinalScoreAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue, Numerical rank)', documentation: 'Returns the final score after reinforcement at the specified reinforcement rank (1-based) for a target value, ordered by decreasing reinforcement scores.' },
  { label: 'ReinforcementClassChangeTagAt', kind: vscode.CompletionItemKind.Function, detail: 'reinforcement', returnType: 'Numerical', signature: 'ReinforcementClassChangeTagAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue, Numerical rank)', documentation: 'Returns the class change tag after reinforcement at the specified rank. 0 = initial prediction was already the target; -1 = final prediction still differs; 1 = prediction changed to target.' },
  // ── Coclustering rules ───────────────────────────────────────────────────
  { label: 'DataGridDeployment', kind: vscode.CompletionItemKind.Function, detail: 'coclustering', returnType: 'Structure', signature: 'DataGridDeployment(Structure(DataGrid) dataGrid, Numerical deployedVariableIndex, ...)', documentation: 'Builds a `DataGridDeployment` structure for a given dimension variable of a DataGrid. Input values (Vector or VectorC) correspond to the distribution of input values; an optional frequency Vector may be appended.' },
  { label: 'PredictedPartIndex', kind: vscode.CompletionItemKind.Function, detail: 'coclustering', returnType: 'Numerical', signature: 'PredictedPartIndex(Structure(DataGridDeployment) deployment)', documentation: 'Computes the index of the closest part of the deployed variable in a coclustering deployment.' },
  { label: 'PredictedPartDistances', kind: vscode.CompletionItemKind.Function, detail: 'coclustering', returnType: 'Structure', signature: 'PredictedPartDistances(Structure(DataGridDeployment) deployment)', documentation: 'Computes the distance to all parts of the deployed variable in a coclustering deployment.' },
  { label: 'PredictedPartFrequenciesAt', kind: vscode.CompletionItemKind.Function, detail: 'coclustering', returnType: 'Structure', signature: 'PredictedPartFrequenciesAt(Structure(DataGridDeployment) deployment, Numerical inputVariableIndex)', documentation: 'Computes the aggregated frequencies on the parts of the specified input variable in a coclustering deployment.' },
  // ── Basic Sparse rules ───────────────────────────────────────────────────
  { label: 'CopyBlock', kind: vscode.CompletionItemKind.Function, detail: 'basic sparse', returnType: 'Structure', signature: 'CopyBlock(Block(Numerical) valueBlock)', documentation: 'Copies a block of Numerical variables. The input and output blocks must share the same VarKey type (integer or alphanumeric), and each VarKey present in both blocks is copied.' },
  { label: 'CopyBlockC', kind: vscode.CompletionItemKind.Function, detail: 'basic sparse', returnType: 'Structure', signature: 'CopyBlockC(Block(Categorical) valueBlock)', documentation: 'Copies a block of Categorical variables. The input and output blocks must share the same VarKey type.' },
  { label: 'GetBlock', kind: vscode.CompletionItemKind.Function, detail: 'basic sparse', returnType: 'Structure', signature: 'GetBlock(Block(Numerical) valueBlock)', documentation: 'Accesses a block of Numerical variables from an Entity variable, bringing it into the primary dictionary.' },
  { label: 'GetBlockC', kind: vscode.CompletionItemKind.Function, detail: 'basic sparse', returnType: 'Structure', signature: 'GetBlockC(Block(Categorical) valueBlock)', documentation: 'Accesses a block of Categorical variables from an Entity variable, bringing it into the primary dictionary.' },
  // ── Text Sparse rules ────────────────────────────────────────────────────
  { label: 'TextWords', kind: vscode.CompletionItemKind.Function, detail: 'text sparse', returnType: 'Structure', signature: 'TextWords(Text value)', documentation: 'Tokenizes a Text value into a bag of words. Separator or control characters act as delimiters; each token is a sequence of punctuation or of other characters. Each variable in the block has a VarKey equal to the word it counts.' },
  { label: 'TextNgrams', kind: vscode.CompletionItemKind.Function, detail: 'text sparse', returnType: 'Structure', signature: 'TextNgrams(Text value)', documentation: 'Tokenizes a Text value into a bag of byte n-grams (1-gram to 8-gram). Each variable in the block has a VarKey equal to the n-gram it counts.' },
  { label: 'TextTokens', kind: vscode.CompletionItemKind.Function, detail: 'text sparse', returnType: 'Structure', signature: 'TextTokens(Text value)', documentation: 'Tokenizes a Text value into a bag of tokens using the blank character as delimiter. Assumes the text has already been preprocessed (e.g. lemmatized). Each variable has a VarKey equal to the token it counts.' },
  { label: 'TextListWords', kind: vscode.CompletionItemKind.Function, detail: 'text sparse', returnType: 'Structure', signature: 'TextListWords(TextList value)', documentation: 'Applies TextWords tokenization to each Text value in a TextList, producing a combined bag of words.' },
  { label: 'TextListNgrams', kind: vscode.CompletionItemKind.Function, detail: 'text sparse', returnType: 'Structure', signature: 'TextListNgrams(TextList value)', documentation: 'Applies TextNgrams tokenization to each Text value in a TextList, producing a combined bag of n-grams.' },
  { label: 'TextListTokens', kind: vscode.CompletionItemKind.Function, detail: 'text sparse', returnType: 'Structure', signature: 'TextListTokens(TextList value)', documentation: 'Applies TextTokens tokenization to each Text value in a TextList, producing a combined bag of tokens.' },
  // ── Preparation Sparse rules ─────────────────────────────────────────────
  { label: 'DataGridBlock', kind: vscode.CompletionItemKind.Function, detail: 'preparation sparse', returnType: 'Structure', signature: 'DataGridBlock(Structure(ValueSet) varKeys, Structure(DataGrid) dataGrid1, ...)', documentation: 'Builds a `DataGridBlock` from a list of VarKeys and a corresponding list of DataGrid preparation models. The number of VarKeys must equal the number of DataGrids. VarKeys can be integers (ValueSet) or alphanumeric (ValueSetC).' },
  { label: 'DataGridStatsBlock', kind: vscode.CompletionItemKind.Function, detail: 'preparation sparse', returnType: 'Structure', signature: 'DataGridStatsBlock(Structure(DataGridBlock) dataGridBlock, Block(Numerical) valueBlock)', documentation: 'Applies each DataGrid model in a `DataGridBlock` to the corresponding block variable (matched by VarKey), producing a sparse block of preparation statistics. Equivalent to DataGridStats applied to a sparse block.' },
  { label: 'DataGridCellBlock', kind: vscode.CompletionItemKind.Function, detail: 'preparation sparse', returnType: 'Structure', signature: 'DataGridCellBlock(Structure(DataGridBlock) dataGridBlock, Block(Numerical) valueBlock)', documentation: 'Builds a sparse block of cell indices from a `DataGridBlock` and a block of variables. Equivalent to CellIndex applied to each variable in a sparse block.' },
  // ── Table Partition rules ────────────────────────────────────────────────
  { label: 'Partition', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'Partition(Structure partition1, ...)', documentation: 'Builds a multivariate `Partition` as the cross-product of univariate partitions. Parameters must be univariate partitions: IntervalBounds, ValueGroups, ValueSetC, or ValueSet.' },
  { label: 'TablePartition', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartition(Table table, Structure(Partition) partition, ...)', documentation: 'Builds a block of Table sub-parts from a secondary Table and a Partition specification. The block is potentially sparse — only non-empty parts are managed. Additional value arguments specify the partition variables from the secondary table.' },
  { label: 'TablePartitionCount', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionCount(Block(Table) tableParts)', documentation: 'Number of records per part in a block of Table parts produced by TablePartition.' },
  { label: 'TablePartitionCountDistinct', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionCountDistinct(Block(Table) tableParts, Categorical value)', documentation: 'Number of distinct values per table part for a given Categorical variable in the secondary Table.' },
  { label: 'TablePartitionEntropy', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionEntropy(Block(Table) tableParts, Categorical value)', documentation: 'Entropy of the value distribution per table part for a given Categorical variable in the secondary Table.' },
  { label: 'TablePartitionMode', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMode(Block(Table) tableParts, Categorical value)', documentation: 'Most frequent value per table part for a given Categorical variable in the secondary Table.' },
  { label: 'TablePartitionModeAt', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionModeAt(Block(Table) tableParts, Categorical value, Numerical rank)', documentation: 'Ith most frequent value per table part for a given Categorical variable in the secondary Table.' },
  { label: 'TablePartitionMean', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMean(Block(Table) tableParts, Numerical value)', documentation: 'Mean value per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionStdDev', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionStdDev(Block(Table) tableParts, Numerical value)', documentation: 'Standard deviation per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionMedian', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMedian(Block(Table) tableParts, Numerical value)', documentation: 'Median value per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionMin', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMin(Block(Table) tableParts, Numerical value)', documentation: 'Minimum value per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionMax', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMax(Block(Table) tableParts, Numerical value)', documentation: 'Maximum value per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionSum', kind: vscode.CompletionItemKind.Function, detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionSum(Block(Table) tableParts, Numerical value)', documentation: 'Sum of values per table part for a given Numerical variable in the secondary Table.' },
  // ── Table Block rules ────────────────────────────────────────────────────
  { label: 'TableBlockCountDistinct', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockCountDistinct(Table table, Block(Categorical) valueBlock)', documentation: 'Number of distinct values per variable of a Categorical block defined in the secondary Table.' },
  { label: 'TableBlockEntropy', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockEntropy(Table table, Block(Categorical) valueBlock)', documentation: 'Entropy of the value distribution per variable of a Categorical block defined in the secondary Table.' },
  { label: 'TableBlockMode', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockMode(Table table, Block(Categorical) valueBlock)', documentation: 'Most frequent value per variable of a Categorical block defined in the secondary Table.' },
  { label: 'TableBlockMean', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockMean(Table table, Block(Numerical) valueBlock)', documentation: 'Mean value per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockStdDev', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockStdDev(Table table, Block(Numerical) valueBlock)', documentation: 'Standard deviation per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockMedian', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockMedian(Table table, Block(Numerical) valueBlock)', documentation: 'Median value per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockMin', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockMin(Table table, Block(Numerical) valueBlock)', documentation: 'Minimum value per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockMax', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockMax(Table table, Block(Numerical) valueBlock)', documentation: 'Maximum value per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockSum', kind: vscode.CompletionItemKind.Function, detail: 'table block', returnType: 'Structure', signature: 'TableBlockSum(Table table, Block(Numerical) valueBlock)', documentation: 'Sum of values per variable of a Numerical block defined in the secondary Table.' },
];

// ─────────────────────────── Helper functions ────────────────────────────────

/**
 * Determines whether the cursor is inside a Dictionary block { ... }
 * by counting unmatched braces from the start of the document.
 */
function isInsideDictionaryBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
  const textUpToCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const stripped = stripLineComments(textUpToCursor)
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') { depth++; }
    else if (ch === '}') { depth = Math.max(0, depth - 1); }
  }
  return depth > 0;
}

/**
 * Returns true if the current line contains a '=' before the cursor,
 * indicating a derivation rule context.
 */
function isInDerivationContext(linePrefix: string): boolean {
  const withoutMeta = linePrefix.replace(
    /<[A-Za-z_][A-Za-z0-9_]*(?:=(?:"(?:[^"]|"")*"|[^"<>\s]*))?>/g,
    '',
  );
  return withoutMeta.includes('=');
}

/**
 * Detects if cursor is right after `Entity(` or `Table(`, to offer dict-name completions.
 */
function isAfterRelationalTypeParens(linePrefix: string): boolean {
  return /\b(?:Entity|Table)\s*\(\s*$/.test(linePrefix);
}

// ─────────────────────────── Type checking ────────────────────────────────────

// Build type maps once from DERIVATION_RULES
const { paramTypeMap: PARAM_TYPE_MAP, returnTypeMap: RETURN_TYPE_MAP } = buildTypeMaps(DERIVATION_RULES);

/**
 * Validates a .kdic document and populates the diagnostic collection.
 * Delegates to the shared `validate()` function in validator.ts and converts
 * the plain KdicDiagnostic results to vscode.Diagnostic objects.
 */
function validateDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
  const editor = vscode.window.activeTextEditor;
  const cursorLine = editor && editor.document === document ? editor.selection.active.line : undefined;
  const plainDiags = validate(document, PARAM_TYPE_MAP, RETURN_TYPE_MAP, cursorLine);
  const diags = plainDiags.map((d: KdicDiagnostic) => {
    const diag = new vscode.Diagnostic(
      new vscode.Range(new vscode.Position(d.line, d.col), new vscode.Position(d.line, d.endCol)),
      d.message,
      d.severity === Severity.Error ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    );
    diag.source = 'kdic';
    return diag;
  });
  collection.set(document.uri, diags);
}

// ─────────────────────── Khiops native validation ───────────────────────────

function isDebugTracesEnabled(): boolean {
  return vscode.workspace.getConfiguration('kdic').get<boolean>('enableDebugTraces', false);
}

function isKhiopsAutoSaveEnabled(): boolean {
  return vscode.workspace.getConfiguration('kdic').get<boolean>('runKhiopsOnAutoSave', true);
}

function logKhiopsTrace(outputChannel: vscode.OutputChannel, message: string): void {
  if (isDebugTracesEnabled()) {
    outputChannel.appendLine(message);
  }
}

/**
 * Finds the khiops binary path.
 * Priority: setting > platform-specific automatic fallback
 */
function findKhiopsBinary(log: vscode.OutputChannel): string | undefined {
  const config = vscode.workspace.getConfiguration('kdic');
  const explicit = config.get<string>('khiopsPath', '').trim();
  const binaryName = process.platform === 'win32'
    ? 'MODL.exe'
    : process.platform === 'darwin'
      ? 'MODL'
      : 'MODL_openmpi';
  logKhiopsTrace(log, `[Khiops] kdic.khiopsPath setting = "${explicit}"`);
  logKhiopsTrace(log, `[Khiops] KHIOPS_HOME env = "${process.env['KHIOPS_HOME'] || ''}"`);
  logKhiopsTrace(log, `[Khiops] Expected binary name = "${binaryName}"`);

  // If explicit setting is provided (non-empty), use it exclusively (don't fall back to KHIOPS_HOME)
  if (explicit) {
    // Accept both a direct path to the binary and a directory containing it
    if (fs.existsSync(explicit) && fs.statSync(explicit).isFile()) {
      logKhiopsTrace(log, `[Khiops] Found binary at explicit path: ${explicit}`);
      return explicit;
    }
    const bin = path.join(explicit, binaryName);
    logKhiopsTrace(log, `[Khiops] Trying: ${bin}`);
    if (fs.existsSync(bin)) {
      logKhiopsTrace(log, `[Khiops] Found binary: ${bin}`);
      return bin;
    }
    logKhiopsTrace(log, `[Khiops] Binary not found at explicit setting path (not falling back to KHIOPS_HOME)`);
    return undefined;
  }

  // No explicit setting - try KHIOPS_HOME/bin/<platform executable> on Windows.

  const khiopsHome = process.env['KHIOPS_HOME'];
  if (khiopsHome && process.platform === 'win32') {
    const bin = path.join(khiopsHome, 'bin', binaryName);
    logKhiopsTrace(log, `[Khiops] Trying KHIOPS_HOME: ${bin}`);
    if (fs.existsSync(bin)) {
      logKhiopsTrace(log, `[Khiops] Found binary: ${bin}`);
      return bin;
    }
  }

  const platformFallback = process.platform === 'darwin'
    ? '/Applications/Khiops.app/Contents/Resources/bin/MODL'
    : process.platform === 'linux'
      ? '/usr/bin/MODL_openmpi'
      : undefined;
  if (platformFallback) {
    logKhiopsTrace(log, `[Khiops] Trying ${platformFallback}`);
    if (fs.existsSync(platformFallback)) {
      logKhiopsTrace(log, `[Khiops] Found binary: ${platformFallback}`);
      return platformFallback;
    }
  }

  logKhiopsTrace(log, `[Khiops] No binary found`);
  return undefined;
}

/**
 * Generates a scenario file content that loads a dictionary and exits.
 */
function buildCheckScenario(kdicPath: string): string {
  return [
    '// Auto-generated validation scenario',
    'ClassManagement.OpenFile       // Open...',
    '',
    '// -> Open',
    `ClassFileName ${kdicPath}        // Dictionary file`,
    'OK                             // Open',
    '// <- Open',
    '',
    'ClassManagement.Quit           // Quit',
    '// <- Khiops',
    '',
    '',
    '// -> Khiops',
    'OK                             // Yes',
    '// <- Khiops',
  ].join('\n');
}

/**
 * Parses Khiops error output and returns diagnostics.
 * Handles two formats:
 *   - With line number: "error : Read dictionary file Line 7 : Missing ';'"
 *   - Without line number: "error : Variable test : Derivation rule TableCount incorrectly specified"
 */
function parseKhiopsErrors(output: string, docUri: vscode.Uri): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  const reWithLine = /error\s*:\s*.*?Line\s+(\d+)\s*:\s*(.+)$/gm;
  const reGeneral = /error\s*:\s*(.+)$/gm;
  const matched = new Set<number>(); // track character offsets already matched

  // First pass: errors with line numbers
  let m: RegExpExecArray | null;
  while ((m = reWithLine.exec(output)) !== null) {
    matched.add(m.index);
    const line = Math.max(0, parseInt(m[1], 10) - 1);
    const message = m[2].trim();
    const diag = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
      message,
      vscode.DiagnosticSeverity.Error,
    );
    diag.source = 'khiops';
    diags.push(diag);
  }

  // Second pass: errors without line numbers (placed at line 0)
  while ((m = reGeneral.exec(output)) !== null) {
    if (matched.has(m.index)) { continue; } // already captured with line number
    const message = m[1].trim();
    // Skip summary lines like "Errors detected during parsing" or "Read cancelled"
    if (/Errors detected during parsing|Read cancelled/i.test(message)) { continue; }
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, Number.MAX_SAFE_INTEGER),
      message,
      vscode.DiagnosticSeverity.Error,
    );
    diag.source = 'khiops';
    diags.push(diag);
  }

  return diags;
}

/** Active Khiops validation promise — used to serialize runs. */
let khiopsRunning: Promise<void> = Promise.resolve();

/**
 * Runs Khiops validation on the given document.
 * Waits for any previous run to finish before starting.
 */
function runKhiopsValidation(
  doc: vscode.TextDocument,
  khiopsPath: string,
  khiopsDiags: vscode.DiagnosticCollection,
  outputChannel: vscode.OutputChannel,
): void {
  if (doc.uri.scheme !== 'file') { return; }

  khiopsRunning = khiopsRunning.then(() => new Promise<void>((resolve) => {
    const kdicPath = doc.uri.fsPath;
    const scenarioContent = buildCheckScenario(kdicPath);
    const tmpDir = os.tmpdir();
    const scenarioFile = path.join(tmpDir, `kdic-check-${process.pid}.prm`);

    try {
      fs.writeFileSync(scenarioFile, scenarioContent, 'utf-8');
    } catch {
      resolve();
      return;
    }

    const outputDevice = process.platform === 'win32' ? 'CON' : '/dev/stdout';
    const args = ['-b', '-i', scenarioFile, '-e', outputDevice];
    logKhiopsTrace(outputChannel, `[Khiops] Running: ${khiopsPath} ${args.join(' ')}`);
    logKhiopsTrace(outputChannel, `[Khiops] Scenario file: ${scenarioFile}`);
    logKhiopsTrace(outputChannel, `[Khiops] Dictionary: ${kdicPath}`);

    const execOptions: cp.ExecFileOptions = {
      timeout: 30000,
      env: {
        ...process.env,
        KHIOPS_PROC_NUMBER: '1',
      },
    };
    
    // On Windows, .cmd files need shell execution, and paths with spaces must be quoted
    let commandPath = khiopsPath;
    if (process.platform === 'win32' && path.extname(khiopsPath).toLowerCase() === '.cmd') {
      execOptions.shell = true;
      // Quote the path if it contains spaces to prevent shell parsing issues
      if (khiopsPath.includes(' ')) {
        commandPath = `"${khiopsPath}"`;
      }
    }

    cp.execFile(commandPath, args, execOptions, (err, stdout, stderr) => {
      // Clean up temp scenario
      try { fs.unlinkSync(scenarioFile); } catch { /* ignore */ }

      if (err) {
        logKhiopsTrace(outputChannel, `[Khiops] Process error: ${err.message}`);
      }

      const output = `${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}`;

      if (output.trim()) {
        logKhiopsTrace(outputChannel, `[Khiops] Output:`);
        logKhiopsTrace(outputChannel, output);
      } else {
        logKhiopsTrace(outputChannel, `[Khiops] No output (exit ok, no errors)`);
      }

      const diags = parseKhiopsErrors(output, doc.uri);
      logKhiopsTrace(outputChannel, `[Khiops] Parsed ${diags.length} diagnostic(s)`);
      khiopsDiags.set(doc.uri, diags);

      resolve();
    });
  }));
}

// ─────────────────────────── Extension activation ───────────────────────────
export function activate(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'kdic' },
    {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
      ): vscode.CompletionItem[] {
        const linePrefix = document.lineAt(position).text.substring(0, position.character);

        // Skip completions inside comments
        const commentIdx = linePrefix.indexOf('//');
        if (commentIdx !== -1 && position.character > commentIdx) {
          return [];
        }

        const items: vscode.CompletionItem[] = [];

        // ── Context: right after Entity( or Table( ──────────────────────────
        if (isAfterRelationalTypeParens(linePrefix)) {
          const dictNames = extractDictionaryNames(stripLineComments(document.getText()));
          for (const name of dictNames) {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
            item.detail = 'dictionary name';
            item.documentation = new vscode.MarkdownString(`Referenced dictionary: **${name}**`);
            items.push(item);
          }
          return items;
        }

        const insideBlock = isInsideDictionaryBlock(document, position);

        // ── Context: top-level (outside dictionary block) ───────────────────
        if (!insideBlock) {
          for (const kw of KEYWORDS) {
            const item = new vscode.CompletionItem(kw.label, kw.kind);
            item.detail = kw.detail;
            item.documentation = new vscode.MarkdownString(kw.documentation);
            if (kw.insertText) {
              item.insertText = new vscode.SnippetString(kw.insertText);
            }
            items.push(item);
          }
          return items;
        }

        // ── Context: inside dictionary block ────────────────────────────────
        const inDerivation = isInDerivationContext(linePrefix);

        if (!inDerivation) {
          // Offer type keywords and Unused modifier
          for (const kw of [KEYWORDS.find(k => k.label === 'Unused')!]) {
            const item = new vscode.CompletionItem(kw.label, kw.kind);
            item.detail = kw.detail;
            item.documentation = new vscode.MarkdownString(kw.documentation);
            items.push(item);
          }
          for (const t of NATIVE_TYPES) {
            const item = new vscode.CompletionItem(t.label, t.kind);
            item.detail = t.detail;
            item.documentation = new vscode.MarkdownString(t.documentation);
            items.push(item);
          }
          for (const t of ADVANCED_TYPES) {
            const item = new vscode.CompletionItem(t.label, t.kind);
            item.detail = t.detail;
            item.documentation = new vscode.MarkdownString(t.documentation);
            if (t.insertText) {
              item.insertText = new vscode.SnippetString(t.insertText);
            }
            items.push(item);
          }
        }

        // Always offer derivation rules inside a block (for use after '=', but
        // also useful when the user types a function name on a derived variable line)
        for (const fn of DERIVATION_RULES) {
          const item = new vscode.CompletionItem(fn.label, fn.kind);
          item.detail = `${fn.returnType} · ${fn.detail}`;
          item.documentation = new vscode.MarkdownString(
            `\`\`\`\n${fn.signature}\n\`\`\`\n\n${fn.documentation}`,
          );
          item.insertText = new vscode.SnippetString(`${fn.label}($0)`);
          items.push(item);
        }

        return items;
      },
    },
    // Trigger characters
    '(', ' ', '\t',
  );

  context.subscriptions.push(provider);

  // ── Hover provider ──────────────────────────────────────────────────────
  const ALL_ENTRIES: (CompletionEntry | FunctionEntry)[] = [
    ...KEYWORDS,
    ...NATIVE_TYPES,
    ...ADVANCED_TYPES,
    ...DERIVATION_RULES,
  ];

  const hoverProvider = vscode.languages.registerHoverProvider(
    { language: 'kdic' },
    {
      provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!range) { return undefined; }
        const word = document.getText(range);
        const entry = ALL_ENTRIES.find(e => e.label === word);
        if (!entry) { return undefined; }

        const isFn = 'signature' in entry;
        const content = new vscode.MarkdownString();
        if (isFn) {
          content.appendCodeblock((entry as FunctionEntry).signature, 'kdic');
        }
        content.appendMarkdown(entry.documentation);

        return new vscode.Hover(content, range);
      },
    },
  );

  context.subscriptions.push(hoverProvider);

  // ── Diagnostic type checking ────────────────────────────────────────────
  const diagnostics = vscode.languages.createDiagnosticCollection('kdic');
  context.subscriptions.push(diagnostics);
  const khiopsDiags = vscode.languages.createDiagnosticCollection('khiops');
  context.subscriptions.push(khiopsDiags);

  // ── Khiops native validation on save ──────────────────────────────────
  const outputChannel = vscode.window.createOutputChannel('Khiops');
  context.subscriptions.push(outputChannel);
  if (isDebugTracesEnabled()) {
    outputChannel.show(true);
  }
  type RuntimeValidationState = {
    useExtension: boolean;
    useKhiops: boolean;
    khiopsEnabled: boolean;
    diagnosticSource: string;
    khiopsPath?: string;
  };

  let runtimeState: RuntimeValidationState = {
    useExtension: true,
    useKhiops: false,
    khiopsEnabled: true,
    diagnosticSource: 'both',
  };

  const refreshRuntimeState = (): void => {
    const config = vscode.workspace.getConfiguration('kdic');
    const khiopsEnabled = config.get<boolean>('enableKhiopsValidation', true);
    const diagnosticSource = config.get<string>('diagnosticSource', 'both');
    const khiopsPath = khiopsEnabled ? findKhiopsBinary(outputChannel) : undefined;

    runtimeState = {
      useExtension: diagnosticSource === 'extension' || diagnosticSource === 'both' || !khiopsPath,
      useKhiops: Boolean(khiopsPath && (diagnosticSource === 'khiops' || diagnosticSource === 'both')),
      khiopsEnabled,
      diagnosticSource,
      khiopsPath,
    };

    logKhiopsTrace(
      outputChannel,
      `[Khiops] Runtime config: enableKhiopsValidation=${khiopsEnabled}, diagnosticSource=${diagnosticSource}, useKhiops=${runtimeState.useKhiops}, useExtension=${runtimeState.useExtension}`,
    );

    if (khiopsEnabled && !khiopsPath) {
      vscode.window.showWarningMessage(
        'Khiops binary not found. Using built-in validation. Set "kdic.khiopsPath" in settings.',
      );
    }
  };

  refreshRuntimeState();

  // Always register listeners and branch on live runtime state.
  const validateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const saveReasons = new Map<string, vscode.TextDocumentSaveReason>();

  const revalidateAllOpenKdicDocuments = (): void => {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId !== 'kdic') { continue; }

      if (runtimeState.useExtension) {
        validateDocument(doc, diagnostics);
      } else {
        diagnostics.delete(doc.uri);
      }

      if (!runtimeState.useKhiops) {
        khiopsDiags.delete(doc.uri);
      }
    }
  };

  revalidateAllOpenKdicDocuments();

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument(e => {
      if (e.document.languageId === 'kdic') {
        saveReasons.set(e.document.uri.toString(), e.reason);
      }
    }),
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.languageId !== 'kdic') { return; }

      if (runtimeState.useExtension) {
        validateDocument(doc, diagnostics);
      } else {
        diagnostics.delete(doc.uri);
      }

      if (!runtimeState.useKhiops) {
        khiopsDiags.delete(doc.uri);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.languageId !== 'kdic') { return; }

      const docKey = e.document.uri.toString();
      const pendingTimer = validateTimers.get(docKey);
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        validateTimers.delete(docKey);
      }
      if (runtimeState.useExtension) {
        const timer = setTimeout(() => {
          validateTimers.delete(docKey);
          if (runtimeState.useExtension) {
            validateDocument(e.document, diagnostics);
          } else {
            diagnostics.delete(e.document.uri);
          }
        }, 300);
        validateTimers.set(docKey, timer);
      } else {
        diagnostics.delete(e.document.uri);
      }

      if (!runtimeState.useKhiops) {
        khiopsDiags.delete(e.document.uri);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.languageId !== 'kdic') { return; }

      const docKey = doc.uri.toString();
      const saveReason = saveReasons.get(docKey);
      saveReasons.delete(docKey);

      const runOnAutoSave = isKhiopsAutoSaveEnabled();

      // Run on all saves by default. Set runKhiopsOnAutoSave to false for very large dictionary files.
      if (!runOnAutoSave && saveReason !== undefined && saveReason !== vscode.TextDocumentSaveReason.Manual) {
        logKhiopsTrace(outputChannel, `[Khiops] Skip non-manual save (reason=${saveReason}) for: ${doc.fileName}`);
        return;
      }

      if (!(runtimeState.useKhiops && runtimeState.khiopsPath && doc.uri.scheme === 'file')) {
        khiopsDiags.delete(doc.uri);
        return;
      }

      logKhiopsTrace(outputChannel, `[Khiops] onDidSave: ${doc.fileName}`);
      runKhiopsValidation(doc, runtimeState.khiopsPath, khiopsDiags, outputChannel);
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      const docKey = doc.uri.toString();
      const pendingTimer = validateTimers.get(docKey);
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        validateTimers.delete(docKey);
      }
      diagnostics.delete(doc.uri);
      khiopsDiags.delete(doc.uri);
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kdic.enableDebugTraces') && isDebugTracesEnabled()) {
        outputChannel.show(true);
        logKhiopsTrace(outputChannel, '[Khiops] Debug traces enabled');
      }

      if (
        e.affectsConfiguration('kdic.enableKhiopsValidation')
        || e.affectsConfiguration('kdic.khiopsPath')
        || e.affectsConfiguration('kdic.diagnosticSource')
      ) {
        refreshRuntimeState();
        revalidateAllOpenKdicDocuments();
      }
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up
}
