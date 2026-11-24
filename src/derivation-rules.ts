/**
 * Built-in Khiops derivation rules.
 *
 * This module is the single source of truth for rule completion, hover and
 * type checking. It must stay free of any VS Code dependency so the validator,
 * the tests and the smoke-test CLI can load it directly.
 *
 * To add a rule, append one entry to DERIVATION_RULES. The parameter-type,
 * return-type and operand-scope maps are rebuilt from it automatically
 * (see rule-maps.ts).
 */

/** Where an operand of a relational rule is resolved: the current dictionary, a secondary table, or unknown. */
export type OperandScope = 'current' | 'secondary' | 'unknown';

export interface DerivationRule {
  /** Rule name, e.g. `TableCount`. */
  label: string;
  /** Category shown next to the rule in the completion list. */
  detail: string;
  /** Return type; a `|`-separated union such as `Numerical|Categorical`, or `any`. */
  returnType: string;
  /** Human-readable signature; its parameter types drive argument checking. */
  signature: string;
  documentation: string;
  /** Scope of each operand for relational rules; operands without a known scope are not checked locally. */
  operandScopes?: readonly OperandScope[];
}

export const DERIVATION_RULES: DerivationRule[] = [
  // Numerical comparisons
  { label: 'EQ', detail: 'numerical comparison', returnType: 'Numerical', signature: 'EQ(Numerical value1, Numerical value2)', documentation: 'Equality test (returns 0 or 1). Missing value is treated as less than any valid value.' },
  { label: 'NEQ', detail: 'numerical comparison', returnType: 'Numerical', signature: 'NEQ(Numerical value1, Numerical value2)', documentation: 'Inequality test (returns 0 or 1).' },
  { label: 'G', detail: 'numerical comparison', returnType: 'Numerical', signature: 'G(Numerical value1, Numerical value2)', documentation: 'Greater than test (returns 0 or 1).' },
  { label: 'GE', detail: 'numerical comparison', returnType: 'Numerical', signature: 'GE(Numerical value1, Numerical value2)', documentation: 'Greater than or equal test (returns 0 or 1).' },
  { label: 'L', detail: 'numerical comparison', returnType: 'Numerical', signature: 'L(Numerical value1, Numerical value2)', documentation: 'Less than test (returns 0 or 1).' },
  { label: 'LE', detail: 'numerical comparison', returnType: 'Numerical', signature: 'LE(Numerical value1, Numerical value2)', documentation: 'Less than or equal test (returns 0 or 1).' },

  // Categorical comparisons
  { label: 'EQc', detail: 'categorical comparison', returnType: 'Numerical', signature: 'EQc(Categorical value1, Categorical value2)', documentation: 'Equality test for categorical values (returns 0 or 1).' },
  { label: 'NEQc', detail: 'categorical comparison', returnType: 'Numerical', signature: 'NEQc(Categorical value1, Categorical value2)', documentation: 'Inequality test for categorical values (returns 0 or 1).' },
  { label: 'Gc', detail: 'categorical comparison', returnType: 'Numerical', signature: 'Gc(Categorical value1, Categorical value2)', documentation: 'Lexicographic greater than test for categorical values (returns 0 or 1).' },
  { label: 'GEc', detail: 'categorical comparison', returnType: 'Numerical', signature: 'GEc(Categorical value1, Categorical value2)', documentation: 'Lexicographic greater than or equal test for categorical values (returns 0 or 1).' },
  { label: 'Lc', detail: 'categorical comparison', returnType: 'Numerical', signature: 'Lc(Categorical value1, Categorical value2)', documentation: 'Lexicographic less than test for categorical values (returns 0 or 1).' },
  { label: 'LEc', detail: 'categorical comparison', returnType: 'Numerical', signature: 'LEc(Categorical value1, Categorical value2)', documentation: 'Lexicographic less than or equal test for categorical values (returns 0 or 1).' },

  // Logical
  { label: 'And', detail: 'logical', returnType: 'Numerical', signature: 'And(Numerical value1, ...)', documentation: 'Logical AND of numerical boolean values (0 or 1).' },
  { label: 'Or', detail: 'logical', returnType: 'Numerical', signature: 'Or(Numerical value1, ...)', documentation: 'Logical OR of numerical boolean values (0 or 1).' },
  { label: 'Not', detail: 'logical', returnType: 'Numerical', signature: 'Not(Numerical value)', documentation: 'Logical NOT of a numerical boolean value (0 or 1).' },
  { label: 'If', detail: 'logical', returnType: 'Numerical|Categorical', signature: 'If(Numerical condition, value1, value2)', documentation: 'Conditional expression: returns value1 if condition != 0, else value2.' },
  { label: 'IfC', detail: 'logical', returnType: 'Categorical', signature: 'IfC(Numerical test, Categorical valueTrue, Categorical valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Categorical values, according to the condition in first operand.' },
  { label: 'IfD', detail: 'logical', returnType: 'Date', signature: 'IfD(Numerical test, Date valueTrue, Date valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Date values, according to the condition in first operand.' },
  { label: 'IfT', detail: 'logical', returnType: 'Time', signature: 'IfT(Numerical test, Time valueTrue, Time valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Time values, according to the condition in first operand.' },
  { label: 'IfTS', detail: 'logical', returnType: 'Timestamp', signature: 'IfTS(Numerical test, Timestamp valueTrue, Timestamp valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Timestamp values, according to the condition in first operand.' },
  { label: 'IfTSTZ', detail: 'logical', returnType: 'TimestampTZ', signature: 'IfTSTZ(Numerical test, TimestampTZ valueTrue, TimestampTZ valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for TimestampTZ values, according to the condition in first operand.' },
  { label: 'IfText', detail: 'logical', returnType: 'Text', signature: 'IfText(Numerical test, Text valueTrue, Text valueFalse)', documentation: 'Ternary operator returning second operand (true) or third operand (false) for Text values, according to the condition in first operand.' },
  { label: 'Switch', detail: 'logical', returnType: 'Numerical', signature: 'Switch(Numerical test, Numerical valueDefault, Numerical value1, ...)', documentation: 'Switch operator that returns the numerical value corresponding to the index given by the test operand if it is between 1 and K. The default value is returned if the index is outside the bounds.' },
  { label: 'SwitchC', detail: 'logical', returnType: 'Categorical', signature: 'SwitchC(Numerical test, Categorical valueDefault, Categorical value1, ...)', documentation: 'Switch operator that returns the categorical value corresponding to the index given by the test operand if it is between 1 and K. The default value is returned if the index is outside the bounds.' },

  // Data copy and conversion
  { label: 'Copy', detail: 'conversion', returnType: 'any', signature: 'Copy(value)', documentation: 'Copies the value of a variable. Allows to rename a variable.' },
  { label: 'CopyC', detail: 'conversion', returnType: 'Categorical', signature: 'CopyC(Categorical value)', documentation: 'Copy of a categorical value.' },
  { label: 'CopyD', detail: 'conversion', returnType: 'Date', signature: 'CopyD(Date value)', documentation: 'Copy of a date value.' },
  { label: 'CopyT', detail: 'conversion', returnType: 'Time', signature: 'CopyT(Time value)', documentation: 'Copy of a time value.' },
  { label: 'CopyTS', detail: 'conversion', returnType: 'Timestamp', signature: 'CopyTS(Timestamp value)', documentation: 'Copy of a timestamp value.' },
  { label: 'CopyTSTZ', detail: 'conversion', returnType: 'TimestampTZ', signature: 'CopyTSTZ(TimestampTZ value)', documentation: 'Copy of a TimestampTZ value.' },
  { label: 'AsNumerical', detail: 'conversion', returnType: 'Numerical', signature: 'AsNumerical(Categorical value)', documentation: 'Converts a categorical value to numerical. Returns the missing value if the input is missing or not a valid number.' },
  { label: 'AsNumericalError', detail: 'conversion', returnType: 'Categorical', signature: 'AsNumericalError(Categorical value)', documentation: 'Label of the conversion error when converting a categorical value to numerical. Useful for analysing missing or erroneous values. Possible labels: "Unconverted end of string", "Underflow", "Overflow -inf", "Overflow +inf", "Conversion OK".' },
  { label: 'RecodeMissing', detail: 'conversion', returnType: 'Numerical', signature: 'RecodeMissing(Numerical inputValue, Numerical replaceValue)', documentation: 'Returns the input value if it is different from the missing value, and the replace value otherwise.' },
  { label: 'AsCategorical', detail: 'conversion', returnType: 'Categorical', signature: 'AsCategorical(Numerical value)', documentation: 'Converts a numerical value to categorical.' },
  { label: 'AsDate', detail: 'conversion', returnType: 'Date', signature: 'AsDate(Categorical value, Categorical format)', documentation: 'Parses a string into a Date using the given format.\n\nExample: AsDate("2014-01-15", "YYYY-MM-DD")' },
  { label: 'AsTime', detail: 'conversion', returnType: 'Time', signature: 'AsTime(Categorical value, Categorical format)', documentation: 'Parses a string into a Time using the given format.' },
  { label: 'AsTimestamp', detail: 'conversion', returnType: 'Timestamp', signature: 'AsTimestamp(Categorical value, Categorical format)', documentation: 'Parses a string into a Timestamp using the given format.' },

  // Math
  { label: 'FormatNumerical', detail: 'math', returnType: 'Categorical', signature: 'FormatNumerical(Numerical value, Numerical width, Numerical precision)', documentation: 'Returns a formatted string of a numerical value.\n\nExample: FormatNumerical(3.14, 0, 2) → "3.14"' },
  { label: 'Sum', detail: 'math', returnType: 'Numerical', signature: 'Sum(Numerical value1, ...)', documentation: 'Sum of numerical values.' },
  { label: 'Minus', detail: 'math', returnType: 'Numerical', signature: 'Minus(Numerical value)', documentation: 'Opposite (negation) of a numerical value.' },
  { label: 'Diff', detail: 'math', returnType: 'Numerical', signature: 'Diff(Numerical value1, Numerical value2)', documentation: 'Difference between two numerical values.' },
  { label: 'Product', detail: 'math', returnType: 'Numerical', signature: 'Product(Numerical value1, ...)', documentation: 'Product of numerical values.' },
  { label: 'Divide', detail: 'math', returnType: 'Numerical', signature: 'Divide(Numerical value1, Numerical value2)', documentation: 'Ratio of two numerical values.' },
  { label: 'Index', detail: 'math', returnType: 'Numerical', signature: 'Index()', documentation: 'Integer index of the current record from the data file (starts at 1).' },
  { label: 'Random', detail: 'math', returnType: 'Numerical', signature: 'Random()', documentation: 'Random number between 0 and 1. Seed is fixed per database read for reproducibility.' },
  { label: 'Round', detail: 'math', returnType: 'Numerical', signature: 'Round(Numerical value)', documentation: 'Rounds to the closest integer.' },
  { label: 'Floor', detail: 'math', returnType: 'Numerical', signature: 'Floor(Numerical value)', documentation: 'Largest integer not greater than value.' },
  { label: 'Ceil', detail: 'math', returnType: 'Numerical', signature: 'Ceil(Numerical value)', documentation: 'Smallest integer not less than value.' },
  { label: 'Abs', detail: 'math', returnType: 'Numerical', signature: 'Abs(Numerical value)', documentation: 'Absolute value.' },
  { label: 'Sign', detail: 'math', returnType: 'Numerical', signature: 'Sign(Numerical value)', documentation: 'Sign: returns 1 for values >= 0, -1 for values < 0.' },
  { label: 'Mod', detail: 'math', returnType: 'Numerical', signature: 'Mod(Numerical value1, Numerical value2)', documentation: 'Modulo: value1 – value2 * Floor(value1/value2).' },
  { label: 'Log', detail: 'math', returnType: 'Numerical', signature: 'Log(Numerical value)', documentation: 'Natural logarithm.' },
  { label: 'Exp', detail: 'math', returnType: 'Numerical', signature: 'Exp(Numerical value)', documentation: 'Exponential (e^value).' },
  { label: 'Power', detail: 'math', returnType: 'Numerical', signature: 'Power(Numerical value1, Numerical value2)', documentation: 'Power: value1^value2.' },
  { label: 'Sqrt', detail: 'math', returnType: 'Numerical', signature: 'Sqrt(Numerical value)', documentation: 'Square root.' },
  { label: 'Sin', detail: 'math', returnType: 'Numerical', signature: 'Sin(Numerical value)', documentation: 'Sine function.' },
  { label: 'Cos', detail: 'math', returnType: 'Numerical', signature: 'Cos(Numerical value)', documentation: 'Cosine function.' },
  { label: 'Tan', detail: 'math', returnType: 'Numerical', signature: 'Tan(Numerical value)', documentation: 'Tangent function.' },
  { label: 'ASin', detail: 'math', returnType: 'Numerical', signature: 'ASin(Numerical value)', documentation: 'Arc-sine function.' },
  { label: 'ACos', detail: 'math', returnType: 'Numerical', signature: 'ACos(Numerical value)', documentation: 'Arc-cosine function.' },
  { label: 'ATan', detail: 'math', returnType: 'Numerical', signature: 'ATan(Numerical value)', documentation: 'Arc-tangent function.' },
  { label: 'Pi', detail: 'math', returnType: 'Numerical', signature: 'Pi()', documentation: 'Pi constant.' },
  { label: 'Mean', detail: 'math', returnType: 'Numerical', signature: 'Mean(Numerical value1, ...)', documentation: 'Mean of numerical values.' },
  { label: 'StdDev', detail: 'math', returnType: 'Numerical', signature: 'StdDev(Numerical value1, ...)', documentation: 'Standard deviation of numerical values.' },
  { label: 'Min', detail: 'math', returnType: 'Numerical', signature: 'Min(Numerical value1, ...)', documentation: 'Minimum of numerical values (non-missing).' },
  { label: 'Max', detail: 'math', returnType: 'Numerical', signature: 'Max(Numerical value1, ...)', documentation: 'Maximum of numerical values (non-missing).' },
  { label: 'ArgMin', detail: 'math', returnType: 'Numerical', signature: 'ArgMin(Numerical value1, ...)', documentation: 'Index (1-based) of the minimum value in a numerical series.' },
  { label: 'ArgMax', detail: 'math', returnType: 'Numerical', signature: 'ArgMax(Numerical value1, ...)', documentation: 'Index (1-based) of the maximum value in a numerical series.' },

  // String rules
  { label: 'Length', detail: 'string', returnType: 'Numerical', signature: 'Length(Categorical value)', documentation: 'Length of a string.' },
  { label: 'Left', detail: 'string', returnType: 'Categorical', signature: 'Left(Categorical value, Numerical charNumber)', documentation: 'Left n characters of a string.' },
  { label: 'Right', detail: 'string', returnType: 'Categorical', signature: 'Right(Categorical value, Numerical charNumber)', documentation: 'Right n characters of a string.' },
  { label: 'Middle', detail: 'string', returnType: 'Categorical', signature: 'Middle(Categorical value, Numerical startChar, Numerical charNumber)', documentation: 'Substring: charNumber characters starting at startChar (1-based).' },
  { label: 'TokenLength', detail: 'string', returnType: 'Numerical', signature: 'TokenLength(Categorical value, Categorical separators)', documentation: 'Number of tokens in a categorical value. A token is a non-empty substring containing no separator character.' },
  { label: 'TokenLeft', detail: 'string', returnType: 'Categorical', signature: 'TokenLeft(Categorical value, Categorical separators, Numerical tokenNumber)', documentation: 'Extracts the leftmost tokens from a categorical value, retaining the original separators between tokens.' },
  { label: 'TokenRight', detail: 'string', returnType: 'Categorical', signature: 'TokenRight(Categorical value, Categorical separators, Numerical tokenNumber)', documentation: 'Extracts the rightmost tokens from a categorical value, retaining the original separators between tokens.' },
  { label: 'TokenMiddle', detail: 'string', returnType: 'Categorical', signature: 'TokenMiddle(Categorical value, Categorical separators, Numerical startToken, Numerical tokenNumber)', documentation: 'Extracts middle tokens from a categorical value (startToken is 1-based), retaining the original separators between tokens.' },
  { label: 'Translate', detail: 'string', returnType: 'Categorical', signature: 'Translate(Categorical value, Structure(VectorC) searchValues, Structure(VectorC) replaceValues)', documentation: 'Replaces substrings in a categorical value using parallel search/replace VectorC literals.\n\nExample: Translate(v, VectorC("é","à"), VectorC("e","a"))' },
  { label: 'Search', detail: 'string', returnType: 'Numerical', signature: 'Search(Categorical value, Numerical startChar, Categorical searchValue)', documentation: 'Position (1-based) of first occurrence of searchValue in value, starting at startChar. Returns -1 if not found.' },
  { label: 'Replace', detail: 'string', returnType: 'Categorical', signature: 'Replace(Categorical value, Numerical startChar, Categorical searchValue, Categorical replaceValue)', documentation: 'Replaces the first occurrence of searchValue in value with replaceValue.' },
  { label: 'ReplaceAll', detail: 'string', returnType: 'Categorical', signature: 'ReplaceAll(Categorical value, Numerical startChar, Categorical searchValue, Categorical replaceValue)', documentation: 'Replaces all occurrences of searchValue in value with replaceValue.' },
  { label: 'RegexMatch', detail: 'string', returnType: 'Numerical', signature: 'RegexMatch(Categorical value, Categorical regexValue)', documentation: 'Returns 1 if the entire value matches the ECMAScript regex, 0 otherwise.' },
  { label: 'RegexSearch', detail: 'string', returnType: 'Numerical', signature: 'RegexSearch(Categorical value, Numerical startChar, Categorical regexValue)', documentation: 'Returns the position (1-based) of a regex match in a categorical value, or -1 if not found.' },
  { label: 'RegexReplace', detail: 'string', returnType: 'Categorical', signature: 'RegexReplace(Categorical value, Numerical startChar, Categorical regexValue, Categorical replaceValue)', documentation: 'Replaces the first regex match in a categorical value.' },
  { label: 'RegexReplaceAll', detail: 'string', returnType: 'Categorical', signature: 'RegexReplaceAll(Categorical value, Numerical startChar, Categorical regexValue, Categorical replaceValue)', documentation: 'Replaces all regex matches in a categorical value.' },
  { label: 'ToUpper', detail: 'string', returnType: 'Categorical', signature: 'ToUpper(Categorical value)', documentation: 'Converts a string to upper case.' },
  { label: 'ToLower', detail: 'string', returnType: 'Categorical', signature: 'ToLower(Categorical value)', documentation: 'Converts a string to lower case.' },
  { label: 'Concat', detail: 'string', returnType: 'Categorical', signature: 'Concat(Categorical value1, ...)', documentation: 'Concatenates multiple string values.' },
  { label: 'Hash', detail: 'string', returnType: 'Numerical', signature: 'Hash(Categorical value, Numerical max)', documentation: 'Hash code of a string value, between 0 and max-1.' },
  { label: 'Encrypt', detail: 'string', returnType: 'Categorical', signature: 'Encrypt(Categorical value, Categorical key)', documentation: 'Anonymizes a string using the given key. Output is alphanumeric only. Not cryptographically secure.' },

  // Date rules
  { label: 'Year', detail: 'date', returnType: 'Numerical', signature: 'Year(Date date)', documentation: 'Year of a date.' },
  { label: 'Month', detail: 'date', returnType: 'Numerical', signature: 'Month(Date date)', documentation: 'Month of a date (1–12).' },
  { label: 'Day', detail: 'date', returnType: 'Numerical', signature: 'Day(Date date)', documentation: 'Day of month of a date (1–31).' },
  { label: 'YearDay', detail: 'date', returnType: 'Numerical', signature: 'YearDay(Date date)', documentation: 'Day of year of a date (1–366).' },
  { label: 'Week', detail: 'date', returnType: 'Numerical', signature: 'Week(Date date)', documentation: 'ISO week number of a date.' },
  { label: 'WeekDay', detail: 'date', returnType: 'Numerical', signature: 'WeekDay(Date date)', documentation: 'Day of week (1=Monday … 7=Sunday).' },
  { label: 'DecimalYear', detail: 'date', returnType: 'Numerical', signature: 'DecimalYear(Date date)', documentation: 'Date expressed as a decimal year.' },
  { label: 'AbsoluteDay', detail: 'date', returnType: 'Numerical', signature: 'AbsoluteDay(Date value)', documentation: 'Total elapsed days since 2000-01-01.' },
  { label: 'DiffDate', detail: 'date', returnType: 'Numerical', signature: 'DiffDate(Date date1, Date date2)', documentation: 'Difference in days between two dates.' },
  { label: 'AddDays', detail: 'date', returnType: 'Date', signature: 'AddDays(Date value, Numerical dayNumber)', documentation: 'Adds a number of days to a date value.' },
  { label: 'IsDateValid', detail: 'date', returnType: 'Numerical', signature: 'IsDateValid(Date value)', documentation: 'Returns 1 if the date value is valid, 0 otherwise.' },
  { label: 'BuildDate', detail: 'date', returnType: 'Date', signature: 'BuildDate(Numerical year, Numerical month, Numerical day)', documentation: 'Builds a Date value from year (1–9999), month (1–12) and day (1–31, consistent with month and year).' },
  { label: 'FormatDate', detail: 'date', returnType: 'Categorical', signature: 'FormatDate(Date date, Categorical format)', documentation: 'Formats a date as a string using the given format.' },

  // Time rules
  { label: 'Hour', detail: 'time', returnType: 'Numerical', signature: 'Hour(Time time)', documentation: 'Hour of a time (0–23).' },
  { label: 'Minute', detail: 'time', returnType: 'Numerical', signature: 'Minute(Time time)', documentation: 'Minute of a time (0–59).' },
  { label: 'Second', detail: 'time', returnType: 'Numerical', signature: 'Second(Time time)', documentation: 'Second of a time (0–59.999, with millisecond precision).' },
  { label: 'DaySecond', detail: 'time', returnType: 'Numerical', signature: 'DaySecond(Time time)', documentation: 'Total seconds elapsed in a time value since 00:00:00.' },
  { label: 'DecimalTime', detail: 'time', returnType: 'Numerical', signature: 'DecimalTime(Time time)', documentation: 'Time expressed as a decimal fraction of a day (0.0 to ~23.999).' },
  { label: 'DiffTime', detail: 'time', returnType: 'Numerical', signature: 'DiffTime(Time time1, Time time2)', documentation: 'Difference in seconds between two time values.' },
  { label: 'IsTimeValid', detail: 'time', returnType: 'Numerical', signature: 'IsTimeValid(Time value)', documentation: 'Returns 1 if the time value is valid, 0 otherwise.' },
  { label: 'BuildTime', detail: 'time', returnType: 'Time', signature: 'BuildTime(Numerical hour, Numerical minute, Numerical second)', documentation: 'Builds a Time value from hour (0–23), minute (0–59) and second (0–59, with optional fraction).' },
  { label: 'FormatTime', detail: 'time', returnType: 'Categorical', signature: 'FormatTime(Time time, Categorical format)', documentation: 'Formats a time as a string using the given format.' },

  // Timestamp rules
  { label: 'GetDate', detail: 'timestamp', returnType: 'Date', signature: 'GetDate(Timestamp ts)', documentation: 'Extracts the date part of a timestamp.' },
  { label: 'GetTime', detail: 'timestamp', returnType: 'Time', signature: 'GetTime(Timestamp ts)', documentation: 'Extracts the time part of a timestamp.' },
  { label: 'DecimalYearTS', detail: 'timestamp', returnType: 'Numerical', signature: 'DecimalYearTS(Timestamp value)', documentation: 'Year in a timestamp value, including a decimal part for the day of the year and the time of day.' },
  { label: 'AbsoluteSecond', detail: 'timestamp', returnType: 'Numerical', signature: 'AbsoluteSecond(Timestamp value)', documentation: 'Total elapsed seconds since 2000-01-01 00:00:00.' },
  { label: 'DecimalWeekDay', detail: 'timestamp', returnType: 'Numerical', signature: 'DecimalWeekDay(Timestamp value)', documentation: 'Week day of the date of the timestamp value, plus decimal day of the time (WeekDay + DecimalTime/24).' },
  { label: 'DecimalTimestamp', detail: 'timestamp', returnType: 'Numerical', signature: 'DecimalTimestamp(Timestamp ts)', documentation: 'Timestamp expressed as decimal seconds since epoch.' },
  { label: 'DiffTimestamp', detail: 'timestamp', returnType: 'Numerical', signature: 'DiffTimestamp(Timestamp ts1, Timestamp ts2)', documentation: 'Difference in seconds between two timestamps.' },
  { label: 'AddSeconds', detail: 'timestamp', returnType: 'Timestamp', signature: 'AddSeconds(Timestamp value, Numerical secondNumber)', documentation: 'Adds a number of seconds to a timestamp value.' },
  { label: 'IsTimestampValid', detail: 'timestamp', returnType: 'Numerical', signature: 'IsTimestampValid(Timestamp value)', documentation: 'Returns 1 if the timestamp value is valid, 0 otherwise.' },
  { label: 'BuildTimestamp', detail: 'timestamp', returnType: 'Timestamp', signature: 'BuildTimestamp(Date dateValue, Time timeValue)', documentation: 'Builds a Timestamp from a Date and a Time value.' },
  { label: 'FormatTimestamp', detail: 'timestamp', returnType: 'Categorical', signature: 'FormatTimestamp(Timestamp ts, Categorical format)', documentation: 'Formats a timestamp as a string.' },

  // Table rules
  { label: 'TableCount', detail: 'table', returnType: 'Numerical', signature: 'TableCount(Table table)', documentation: 'Number of records in a table.\n\nExample: TableCount(sales)' },
  { label: 'TableCountDistinct', detail: 'table', returnType: 'Numerical', signature: 'TableCountDistinct(Table table, Categorical value)', documentation: 'Number of distinct categorical values in a table. Missing value counts as a distinct value.' },
  { label: 'TableEntropy', detail: 'table', returnType: 'Numerical', signature: 'TableEntropy(Table table, Categorical value)', documentation: 'Entropy of a categorical variable in a table. High when all values are equally frequent.' },
  { label: 'TableMode', detail: 'table', returnType: 'Categorical', signature: 'TableMode(Table table, Categorical value)', documentation: 'Most frequent categorical value in a table. Ties resolved by lexicographic order.' },
  { label: 'TableModeAt', detail: 'table', returnType: 'Categorical', signature: 'TableModeAt(Table table, Categorical value, Numerical rank)', documentation: 'N-th most frequent categorical value in a table.' },
  { label: 'TableMean', detail: 'table', returnType: 'Numerical', signature: 'TableMean(Table table, Numerical value)', operandScopes: ["current", "secondary"], documentation: 'Mean of numerical values in a table (non-missing only).' },
  { label: 'TableStdDev', detail: 'table', returnType: 'Numerical', signature: 'TableStdDev(Table table, Numerical value)', documentation: 'Standard deviation of numerical values in a table.' },
  { label: 'TableMedian', detail: 'table', returnType: 'Numerical', signature: 'TableMedian(Table table, Numerical value)', documentation: 'Median of numerical values in a table.' },
  { label: 'TableMin', detail: 'table', returnType: 'Numerical', signature: 'TableMin(Table table, Numerical value)', documentation: 'Minimum of numerical values in a table.' },
  { label: 'TableMax', detail: 'table', returnType: 'Numerical', signature: 'TableMax(Table table, Numerical value)', documentation: 'Maximum of numerical values in a table.' },
  { label: 'TableSum', detail: 'table', returnType: 'Numerical', signature: 'TableSum(Table table, Numerical value)', documentation: 'Sum of numerical values in a table.' },

  // Table management rules
  { label: 'TableSelection', detail: 'table management', returnType: 'Table', signature: 'TableSelection(Table table, Numerical condition)', documentation: 'Filters a table to records where condition != 0.\n\nExample: TableSelection(DNA, EQc(Char, .MostFrequentChar))' },
  { label: 'TableAt', detail: 'table management', returnType: 'Entity', signature: 'TableAt(Table table, Numerical rank)', documentation: 'Returns the record at given rank (1-based) in a table.' },
  { label: 'TableAtKey', detail: 'table management', returnType: 'Entity', signature: 'TableAtKey(Table table, Categorical keyField1, ...)', documentation: 'Returns the first entity in the table matching the given key. Returns nothing if not found. Number of key fields must match the dictionary.' },
  { label: 'TableExtraction', detail: 'table management', returnType: 'Table', signature: 'TableExtraction(Table table, Numerical firstRank, Numerical lastRank)', documentation: 'Extracts a sub-table with entities between firstRank and lastRank (inclusive). Out-of-range ranks are ignored.' },
  { label: 'TableSelectFirst', detail: 'table management', returnType: 'Entity', signature: 'TableSelectFirst(Table table, Numerical condition)', documentation: 'Returns the first entity meeting the selection criterion. Equivalent to TableAt(TableSelection(...), 1).' },
  { label: 'TableSort', detail: 'table management', returnType: 'Table', signature: 'TableSort(Table table, value1, ...)', documentation: 'Sorts a table by increasing order on one or more values (Numerical, Categorical, Date, Time, Timestamp, or TimestampTZ).' },
  { label: 'EntitySet', detail: 'table management', returnType: 'Table', signature: 'EntitySet(Entity entity1, Entity entity2, ...)', documentation: 'Builds a table from a set of entities sharing the same dictionary. Duplicate or missing entities are ignored.' },
  { label: 'TableUnion', detail: 'table management', returnType: 'Table', signature: 'TableUnion(Table table1, Table table2, ...)', documentation: 'Union of tables: contains entities belonging to any of the operands.' },
  { label: 'TableIntersection', detail: 'table management', returnType: 'Table', signature: 'TableIntersection(Table table1, Table table2, ...)', documentation: 'Intersection of tables: contains entities belonging to all operands.' },
  { label: 'TableDifference', detail: 'table management', returnType: 'Table', signature: 'TableDifference(Table table1, Table table2)', operandScopes: ["current", "current"], documentation: 'Symmetric difference of two tables: entities belonging to either operand but not both.' },
  { label: 'TableSubUnion', detail: 'table management', returnType: 'Table', signature: 'TableSubUnion(Table table, Table subTable)', documentation: 'Union of sub-tables of a table (snowflake schema). Aggregates all nested secondary tables into one flat table.' },
  { label: 'TableSubIntersection', detail: 'table management', returnType: 'Table', signature: 'TableSubIntersection(Table table, Table subTable)', documentation: 'Intersection of sub-tables of a table (snowflake schema).' },

  // TimestampTZ rules — timezone-aware timestamps (ISO 8601 offset format)
  { label: 'AsTimestampTZ', detail: 'timestampTZ', returnType: 'TimestampTZ', signature: 'AsTimestampTZ(Categorical value, Categorical format)', documentation: 'Parses a string into a TimestampTZ using the given format.\n\nExample: AsTimestampTZ("2014-01-15 18:25:00+02:00", "YYYY-MM-DD HH:MM:SSzzzzzz")' },
  { label: 'FormatTimestampTZ', detail: 'timestampTZ', returnType: 'Categorical', signature: 'FormatTimestampTZ(TimestampTZ value, Categorical format)', documentation: 'Formats a TimestampTZ value as a string using the given format.' },
  { label: 'UtcTimestamp', detail: 'timestampTZ', returnType: 'Timestamp', signature: 'UtcTimestamp(TimestampTZ value)', documentation: 'Converts a TimestampTZ to a Timestamp in UTC time zone.' },
  { label: 'LocalTimestamp', detail: 'timestampTZ', returnType: 'Timestamp', signature: 'LocalTimestamp(TimestampTZ value)', documentation: 'Converts a TimestampTZ to a Timestamp in the local time zone.' },
  { label: 'SetTimeZoneMinutes', detail: 'timestampTZ', returnType: 'TimestampTZ', signature: 'SetTimeZoneMinutes(TimestampTZ value, Numerical minutes)', documentation: 'Modifies the time zone offset of a TimestampTZ. Minutes must be between -12*60 and +14*60.' },
  { label: 'GetTimeZoneMinutes', detail: 'timestampTZ', returnType: 'Numerical', signature: 'GetTimeZoneMinutes(TimestampTZ value)', documentation: 'Returns the time zone offset in total minutes (±(hh*60 + mm)) from a TimestampTZ value.' },
  { label: 'DiffTimestampTZ', detail: 'timestampTZ', returnType: 'Numerical', signature: 'DiffTimestampTZ(TimestampTZ value1, TimestampTZ value2)', documentation: 'Difference in seconds between two TimestampTZ values.' },
  { label: 'AddSecondsTSTZ', detail: 'timestampTZ', returnType: 'Timestamp', signature: 'AddSecondsTSTZ(TimestampTZ value, Numerical secondNumber)', documentation: 'Adds a number of seconds to a TimestampTZ value.' },
  { label: 'IsTimestampTZValid', detail: 'timestampTZ', returnType: 'Numerical', signature: 'IsTimestampTZValid(TimestampTZ value)', documentation: 'Returns 1 if the TimestampTZ value is valid, 0 otherwise.' },
  { label: 'BuildTimestampTZ', detail: 'timestampTZ', returnType: 'TimestampTZ', signature: 'BuildTimestampTZ(Timestamp value, Numerical timezone)', documentation: 'Builds a TimestampTZ from a Timestamp and a time zone offset in minutes. Minutes must be between -12*60 and +14*60.' },

  // Entity rules — access fields/relations of a 0-1 related entity
  { label: 'Exist', detail: 'entity', returnType: 'Numerical', signature: 'Exist(Entity entity)', documentation: 'Returns 1 if the entity exists, 0 otherwise.\n\nExample: Exist(customerAddress)' },
  { label: 'GetValue', detail: 'entity', returnType: 'Numerical', signature: 'GetValue(Entity entity, Numerical value)', documentation: 'Returns a Numerical field from an entity. Returns missing if the entity does not exist.\n\nExample: GetValue(customerAddress, Length(street))' },
  { label: 'GetValueC', detail: 'entity', returnType: 'Categorical', signature: 'GetValueC(Entity entity, Categorical value)', documentation: 'Returns a Categorical field from an entity. Returns "" if the entity does not exist.\n\nExample: GetValueC(customerAddress, city)' },
  { label: 'GetText', detail: 'entity', returnType: 'Text', signature: 'GetText(Entity entity, Text value)', documentation: 'Returns a Text field from an entity. Returns "" if the entity does not exist.' },
  { label: 'GetValueD', detail: 'entity', returnType: 'Date', signature: 'GetValueD(Entity entity, Date value)', documentation: 'Returns a Date field from an entity. Returns missing if the entity does not exist.' },
  { label: 'GetValueT', detail: 'entity', returnType: 'Time', signature: 'GetValueT(Entity entity, Time value)', documentation: 'Returns a Time field from an entity. Returns missing if the entity does not exist.' },
  { label: 'GetValueTS', detail: 'entity', returnType: 'Timestamp', signature: 'GetValueTS(Entity entity, Timestamp value)', documentation: 'Returns a Timestamp field from an entity. Returns missing if the entity does not exist.' },
  { label: 'GetValueTSTZ', detail: 'entity', returnType: 'TimestampTZ', signature: 'GetValueTSTZ(Entity entity, TimestampTZ value)', documentation: 'Returns a TimestampTZ field from an entity. Returns missing if the entity does not exist.' },
  { label: 'GetEntity', detail: 'entity', returnType: 'Entity', signature: 'GetEntity(Entity entity, Entity value)', documentation: 'Returns a nested Entity field from an entity (snowflake schema).' },
  { label: 'GetTable', detail: 'entity', returnType: 'Table', signature: 'GetTable(Entity entity, Table value)', documentation: 'Returns a Table field from an entity (snowflake schema).' },

  // Text rules — counterpart to string rules for the Text type (up to 1,000,000 chars)
  { label: 'FromText', detail: 'text', returnType: 'Categorical', signature: 'FromText(Text value)', documentation: 'Converts a Text value to Categorical (truncated to 1,000 chars).' },
  { label: 'ToText', detail: 'text', returnType: 'Text', signature: 'ToText(Categorical value)', documentation: 'Converts a Categorical value to Text.' },
  { label: 'TextLoadFile', detail: 'text', returnType: 'Text', signature: 'TextLoadFile(Categorical filePath)', documentation: 'Loads a file as a Text variable. Supports local paths and cloud URIs (when cloud drivers are loaded).' },
  { label: 'TextLength', detail: 'text', returnType: 'Numerical', signature: 'TextLength(Text value)', documentation: 'Length in characters of a Text value.' },
  { label: 'TextLeft', detail: 'text', returnType: 'Text', signature: 'TextLeft(Text value, Numerical charNumber)', documentation: 'Extracts the left substring of a Text value.' },
  { label: 'TextRight', detail: 'text', returnType: 'Text', signature: 'TextRight(Text value, Numerical charNumber)', documentation: 'Extracts the right substring of a Text value.' },
  { label: 'TextMiddle', detail: 'text', returnType: 'Text', signature: 'TextMiddle(Text value, Numerical startChar, Numerical charNumber)', documentation: 'Extracts a substring from a Text value (startChar is 1-based).' },
  { label: 'TextTokenLength', detail: 'text', returnType: 'Numerical', signature: 'TextTokenLength(Text value, Categorical separators)', documentation: 'Number of tokens in a Text value. Tokens are non-empty substrings that contain no separator character.' },
  { label: 'TextTokenLeft', detail: 'text', returnType: 'Text', signature: 'TextTokenLeft(Text value, Categorical separators, Numerical tokenNumber)', documentation: 'Extracts the leftmost tokens from a Text value.' },
  { label: 'TextTokenRight', detail: 'text', returnType: 'Text', signature: 'TextTokenRight(Text value, Categorical separators, Numerical tokenNumber)', documentation: 'Extracts the rightmost tokens from a Text value.' },
  { label: 'TextTokenMiddle', detail: 'text', returnType: 'Text', signature: 'TextTokenMiddle(Text value, Categorical separators, Numerical startToken, Numerical tokenNumber)', documentation: 'Extracts middle tokens from a Text value (startToken is 1-based).' },
  { label: 'TextTranslate', detail: 'text', returnType: 'Text', signature: 'TextTranslate(Text value, Structure(VectorC) searchValues, Structure(VectorC) replaceValues)', documentation: 'Replaces substrings in a Text value using parallel search/replace VectorC literals.\n\nExample: TextTranslate(v, VectorC("é","à"), VectorC("e","a"))' },
  { label: 'TextSearch', detail: 'text', returnType: 'Numerical', signature: 'TextSearch(Text value, Numerical startChar, Categorical searchValue)', documentation: 'Returns the position (1-based) of a substring in a Text value, or -1 if not found.' },
  { label: 'TextReplace', detail: 'text', returnType: 'Text', signature: 'TextReplace(Text value, Numerical startChar, Categorical searchValue, Categorical replaceValue)', documentation: 'Replaces the first occurrence of a substring in a Text value.' },
  { label: 'TextReplaceAll', detail: 'text', returnType: 'Text', signature: 'TextReplaceAll(Text value, Numerical startChar, Categorical searchValue, Categorical replaceValue)', documentation: 'Replaces all occurrences of a substring in a Text value.' },
  { label: 'TextRegexMatch', detail: 'text', returnType: 'Numerical', signature: 'TextRegexMatch(Text value, Categorical regex)', documentation: 'Returns 1 if the entire Text value matches the ECMAScript regex, 0 otherwise.' },
  { label: 'TextRegexSearch', detail: 'text', returnType: 'Numerical', signature: 'TextRegexSearch(Text value, Numerical startChar, Categorical regex)', documentation: 'Returns the position of a regex match in a Text value, or -1 if not found.' },
  { label: 'TextRegexReplace', detail: 'text', returnType: 'Text', signature: 'TextRegexReplace(Text value, Numerical startChar, Categorical regex, Categorical replacement)', documentation: 'Replaces the first regex match in a Text value.' },
  { label: 'TextRegexReplaceAll', detail: 'text', returnType: 'Text', signature: 'TextRegexReplaceAll(Text value, Numerical startChar, Categorical regex, Categorical replacement)', documentation: 'Replaces all regex matches in a Text value.' },
  { label: 'TextToUpper', detail: 'text', returnType: 'Text', signature: 'TextToUpper(Text value)', documentation: 'Converts a Text value to upper case.' },
  { label: 'TextToLower', detail: 'text', returnType: 'Text', signature: 'TextToLower(Text value)', documentation: 'Converts a Text value to lower case.' },
  { label: 'TextConcat', detail: 'text', returnType: 'Text', signature: 'TextConcat(Text value1, ...)', documentation: 'Concatenates multiple Text values.' },
  { label: 'TextHash', detail: 'text', returnType: 'Numerical', signature: 'TextHash(Text value, Numerical max)', documentation: 'Hash of a Text value, between 0 and max-1.' },
  { label: 'TextEncrypt', detail: 'text', returnType: 'Text', signature: 'TextEncrypt(Text value, Categorical key)', documentation: 'Anonymizes a Text value using the given key. Output is alphanumeric only. Not cryptographically secure.' },

  // TextList rules — list of Text values, mainly for multi-table Text aggregation
  { label: 'TextList', detail: 'textlist', returnType: 'TextList', signature: 'TextList(Text value1, ...)', documentation: 'Builds a TextList from a set of Text values.' },
  { label: 'TextListSize', detail: 'textlist', returnType: 'Numerical', signature: 'TextListSize(TextList value)', documentation: 'Number of Text values in a TextList.' },
  { label: 'TextListAt', detail: 'textlist', returnType: 'Text', signature: 'TextListAt(TextList value, Numerical index)', documentation: 'Returns the Text value at given index (1-based). Returns "" if out of bounds.' },
  { label: 'TextListConcat', detail: 'textlist', returnType: 'TextList', signature: 'TextListConcat(TextList value1, ...)', documentation: 'Concatenates multiple TextList values into one.' },
  { label: 'GetTextList', detail: 'textlist', returnType: 'TextList', signature: 'GetTextList(Entity entity, TextList value)', documentation: 'Returns a TextList field from an entity. Returns empty TextList if the entity does not exist.' },
  { label: 'TableAllTexts', detail: 'textlist', returnType: 'TextList', signature: 'TableAllTexts(Table table, Text value)', documentation: 'Aggregates all Text values from a secondary table variable into a TextList.' },
  { label: 'TableAllTextLists', detail: 'textlist', returnType: 'TextList', signature: 'TableAllTextLists(Table table, TextList value)', documentation: 'Concatenates all TextList values from a secondary table variable into a single TextList.' },

  // Vector rules — typed arrays used as arguments to data preparation and text rules
  { label: 'VectorC', detail: 'vector', returnType: 'Structure', signature: 'VectorC(Categorical value1, ...)', documentation: 'Builds a Structure(VectorC) of Categorical values. Used e.g. as argument to TextTranslate.' },
  { label: 'TableVectorC', detail: 'vector', returnType: 'Structure', signature: 'TableVectorC(Table table, Categorical value)', documentation: 'Builds a Structure(VectorC) from Categorical values in a table.' },
  { label: 'ValueAtC', detail: 'vector', returnType: 'Categorical', signature: 'ValueAtC(Structure(VectorC) vector, Numerical index)', documentation: 'Returns the Categorical value at given index (1-based) in a VectorC. Returns "" if out of bounds.' },
  { label: 'Vector', detail: 'vector', returnType: 'Structure', signature: 'Vector(Numerical value1, ...)', documentation: 'Builds a Structure(Vector) of Numerical values.' },
  { label: 'TableVector', detail: 'vector', returnType: 'Structure', signature: 'TableVector(Table table, Numerical value)', documentation: 'Builds a Structure(Vector) from Numerical values in a table.' },
  { label: 'ValueAt', detail: 'vector', returnType: 'Numerical', signature: 'ValueAt(Structure(Vector) vector, Numerical index)', documentation: 'Returns the Numerical value at given index (1-based) in a Vector. Returns missing if out of bounds.' },

  // Hash map rules — key-value lookup structures
  { label: 'HashMapC', detail: 'hash map', returnType: 'Structure', signature: 'HashMapC(Structure(VectorC) keyVector, Structure(VectorC) valueVector)', documentation: 'Builds a Structure(HashMapC) of Categorical values indexed by Categorical keys. Both vectors must contain only literal values and have the same size with unique keys.' },
  { label: 'TableHashMapC', detail: 'hash map', returnType: 'Structure', signature: 'TableHashMapC(Table table, Categorical key, Categorical value)', documentation: 'Builds a Structure(HashMapC) from Categorical keys and values in a table. In case of duplicate keys, only the first matching value is kept.' },
  { label: 'ValueAtKeyC', detail: 'hash map', returnType: 'Categorical', signature: 'ValueAtKeyC(Structure(HashMapC) hashMap, Categorical key)', documentation: 'Returns the Categorical value in a HashMapC at the given key. Returns "" if not found.\n\nExample: ValueAtKeyC(HashMapC(VectorC("male","female"), VectorC("Mr","Mrs")), Sex)' },
  { label: 'HashMap', detail: 'hash map', returnType: 'Structure', signature: 'HashMap(Structure(VectorC) keyVector, Structure(Vector) valueVector)', documentation: 'Builds a Structure(HashMap) of Numerical values indexed by Categorical keys. Both vectors must contain only literal values and have the same size with unique keys.' },
  { label: 'TableHashMap', detail: 'hash map', returnType: 'Structure', signature: 'TableHashMap(Table table, Categorical key, Numerical value)', documentation: 'Builds a Structure(HashMap) from Categorical keys and Numerical values in a table. In case of duplicate keys, only the first matching value is kept.' },
  { label: 'ValueAtKey', detail: 'hash map', returnType: 'Numerical', signature: 'ValueAtKey(Structure(HashMap) hashMap, Categorical key)', documentation: 'Returns the Numerical value in a HashMap at the given key. Returns missing if not found.\n\nExample: ValueAtKey(HashMap(VectorC("male","female"), Vector(0, 1)), Sex)' },

  // Data preparation rules — build partition/grid structures for model deployment
  { label: 'DataGrid', detail: 'data preparation', returnType: 'Structure', signature: 'DataGrid(Structure(Partition) partition1, ..., Structure(Frequencies) frequencies)', documentation: 'Builds a DataGrid from partitions and cell frequencies. Cells are indexed column-first.\n\nExample:\n  DataGrid(IntervalBounds(0.75, 1.55), ValueSetC("A","B","C"), Frequencies(38,0,0, 0,33,3, 0,0,34))' },
  { label: 'IntervalBounds', detail: 'data preparation', returnType: 'Structure', signature: 'IntervalBounds(Numerical bound1, ...)', documentation: 'Builds a Structure(IntervalBounds) partition into intervals. Used as dimension input to DataGrid.' },
  { label: 'ValueGroup', detail: 'data preparation', returnType: 'Structure', signature: 'ValueGroup(Categorical value1, ...)', documentation: 'Builds a Structure(ValueGroup) — a group of categorical values. The special value "*" matches any value not defined elsewhere.' },
  { label: 'ValueGroups', detail: 'data preparation', returnType: 'Structure', signature: 'ValueGroups(Structure(ValueGroup) group1, ...)', documentation: 'Builds a Structure(ValueGroups) partition into groups of categorical values. Exactly one group must contain "*".' },
  { label: 'ValueSetC', detail: 'data preparation', returnType: 'Structure', signature: 'ValueSetC(Categorical value1, ...)', documentation: 'Builds a Structure(ValueSetC) partition into categorical values. Used as dimension input to DataGrid.' },
  { label: 'ValueSet', detail: 'data preparation', returnType: 'Structure', signature: 'ValueSet(Numerical value1, ...)', documentation: 'Builds a Structure(ValueSet) partition into numerical values. Used as dimension input to DataGrid.' },
  { label: 'Frequencies', detail: 'data preparation', returnType: 'Structure', signature: 'Frequencies(Numerical frequency1, ...)', documentation: 'Builds a Structure(Frequencies) — a vector of cell frequencies. Last argument to DataGrid; cells are indexed column-first.' },

  // Recoding rules — retrieve cell/part from a partition or data grid
  { label: 'InInterval', detail: 'recoding', returnType: 'Numerical', signature: 'InInterval(Structure(IntervalBounds) interval, Numerical value)', documentation: 'Returns 1 if the value belongs to the interval (2 bounds, defining ]lower; upper]), 0 otherwise.' },
  { label: 'InGroup', detail: 'recoding', returnType: 'Numerical', signature: 'InGroup(Structure(ValueGroup) group, Categorical value)', documentation: 'Returns 1 if the categorical value belongs to the value group, 0 otherwise.' },
  { label: 'CellIndex', detail: 'recoding', returnType: 'Numerical', signature: 'CellIndex(Structure(DataGrid) dataGrid, SimpleType value1, ...)', documentation: 'Returns the Numerical cell index for a list of input values in a DataGrid.' },
  { label: 'CellId', detail: 'recoding', returnType: 'Categorical', signature: 'CellId(Structure(DataGrid) dataGrid, SimpleType value1, ...)', documentation: 'Returns the Categorical cell identifier for a list of input values in a DataGrid.' },
  { label: 'CellLabel', detail: 'recoding', returnType: 'Categorical', signature: 'CellLabel(Structure(DataGrid) dataGrid, SimpleType value1, ...)', documentation: 'Returns the Categorical cell label for a list of input values in a DataGrid.' },
  { label: 'ValueIndexDG', detail: 'recoding', returnType: 'Numerical', signature: 'ValueIndexDG(Structure(DataGrid) dataGrid, SimpleType value)', documentation: 'Returns the Numerical part index for a value in a univariate DataGrid.' },
  { label: 'PartIndexAt', detail: 'recoding', returnType: 'Numerical', signature: 'PartIndexAt(Structure(DataGrid) dataGrid, Numerical dimIndex, SimpleType value)', documentation: 'Returns the Numerical part index for a value along a given dimension (1-based) of a DataGrid.' },
  { label: 'PartIdAt', detail: 'recoding', returnType: 'Categorical', signature: 'PartIdAt(Structure(DataGrid) dataGrid, Numerical dimIndex, SimpleType value)', documentation: 'Returns the Categorical part identifier for a value along a given dimension (1-based) of a DataGrid.' },
  { label: 'ValueRank', detail: 'recoding', returnType: 'Numerical', signature: 'ValueRank(Structure(DataGrid) dataGrid, Numerical value)', documentation: 'Returns the average normalized rank of a Numerical value in a univariate Numerical DataGrid.' },
  { label: 'InverseValueRank', detail: 'recoding', returnType: 'Numerical', signature: 'InverseValueRank(Structure(DataGrid) dataGrid, Numerical rank)', documentation: 'Returns the average value for a given normalized rank in a univariate Numerical DataGrid.' },
  { label: 'DataGridStats', detail: 'recoding', returnType: 'Structure', signature: 'DataGridStats(Structure(DataGrid) dataGrid, SimpleType value1, ...)', documentation: 'Computes conditional probability statistics for a list of input values in a DataGrid.' },
  { label: 'SourceConditionalInfo', detail: 'recoding', returnType: 'Numerical', signature: 'SourceConditionalInfo(Structure(DataGridStats) stats, Numerical outputIndex)', documentation: 'Returns the source conditional info (negative log of conditional probability) for the input cell and a target cell index (1-based).' },
  { label: 'IntervalId', detail: 'recoding', returnType: 'Categorical', signature: 'IntervalId(Structure(IntervalBounds) bounds, Numerical value)', documentation: 'Returns the Categorical part identifier of a Numerical value in an interval partition.' },
  { label: 'ValueId', detail: 'recoding', returnType: 'Categorical', signature: 'ValueId(Structure(ValueSet) values, Numerical value)', documentation: 'Returns the Categorical part identifier of a Numerical value in a ValueSet partition.' },
  { label: 'GroupId', detail: 'recoding', returnType: 'Categorical', signature: 'GroupId(Structure(ValueGroups) groups, Categorical value)', documentation: 'Returns the Categorical part identifier of a Categorical value in a ValueGroups partition.' },
  { label: 'ValueIdC', detail: 'recoding', returnType: 'Categorical', signature: 'ValueIdC(Structure(ValueSetC) values, Categorical value)', documentation: 'Returns the Categorical part identifier of a Categorical value in a ValueSetC partition. Returns the "*" identifier if not found (or "1" if "*" is absent).' },
  { label: 'IntervalIndex', detail: 'recoding', returnType: 'Numerical', signature: 'IntervalIndex(Structure(IntervalBounds) bounds, Numerical value)', documentation: 'Returns the Numerical part index of a Numerical value in an interval partition.' },
  { label: 'ValueIndex', detail: 'recoding', returnType: 'Numerical', signature: 'ValueIndex(Structure(ValueSet) values, Numerical value)', documentation: 'Returns the Numerical part index of a Numerical value in a ValueSet partition.' },
  { label: 'GroupIndex', detail: 'recoding', returnType: 'Numerical', signature: 'GroupIndex(Structure(ValueGroups) groups, Categorical value)', documentation: 'Returns the Numerical part index of a Categorical value in a ValueGroups partition.' },
  { label: 'ValueIndexC', detail: 'recoding', returnType: 'Numerical', signature: 'ValueIndexC(Structure(ValueSetC) values, Categorical value)', documentation: 'Returns the Numerical part index of a Categorical value in a ValueSetC partition. Returns the "*" index if not found (or 1 if "*" is absent).' },
  // ── Predictor rules ──────────────────────────────────────────────────────
  { label: 'NBClassifier', detail: 'predictor', returnType: 'Structure', signature: 'NBClassifier(Structure(DataGridStats) dataGridStats1, ...)', documentation: 'Builds a Naive Bayes `Classifier` structure from a set of data grid stats that encode the target conditional probabilities. Each data grid stats results from a preparation model (data grid) and input values.' },
  { label: 'SNBClassifier', detail: 'predictor', returnType: 'Structure', signature: 'SNBClassifier(Structure(Vector) variableWeights, Structure(DataGridStats) dataGridStats1, ...)', documentation: 'Builds a Selective Naive Bayes `Classifier` structure. The first parameter is a Vector of weights for the selected variables. The remaining parameters are the same as for NBClassifier.' },
  { label: 'TargetValue', detail: 'predictor', returnType: 'Categorical', signature: 'TargetValue(Structure(Classifier) classifier)', documentation: "Computes a `Classifier`'s most probable target value." },
  { label: 'TargetProb', detail: 'predictor', returnType: 'Numerical', signature: 'TargetProb(Structure(Classifier) classifier)', documentation: 'Computes the `Classifier` probability of the most probable target value.' },
  { label: 'TargetProbAt', detail: 'predictor', returnType: 'Numerical', signature: 'TargetProbAt(Structure(Classifier) classifier, Categorical targetValue)', documentation: 'Computes the `Classifier` probability (score) of a given target value.' },
  { label: 'BiasedTargetValue', detail: 'predictor', returnType: 'Categorical', signature: 'BiasedTargetValue(Structure(Classifier) classifier, Structure(Vector) biasValues)', documentation: 'Computes the `Classifier` highest score target value, after adding a bias to each initial target value score. The bias values are provided as literal values.' },
  { label: 'NBRankRegressor', detail: 'predictor', returnType: 'Structure', signature: 'NBRankRegressor(Structure(DataGridStats) dataGridStats1, ...)', documentation: 'Builds a Naive Bayes `RankRegressor` structure from a set of data grid stats.' },
  { label: 'SNBRankRegressor', detail: 'predictor', returnType: 'Structure', signature: 'SNBRankRegressor(Structure(Vector) variableWeights, Structure(DataGridStats) dataGridStats1, ...)', documentation: 'Builds a Selective Naive Bayes `RankRegressor`. The first parameter is a Vector of weights for the selected variables. The remaining parameters are the same as for NBRankRegressor.' },
  { label: 'TargetRankMean', detail: 'predictor', returnType: 'Numerical', signature: 'TargetRankMean(Structure(RankRegressor) rankRegressor)', documentation: 'Computes the `RankRegressor` target rank mean.' },
  { label: 'TargetRankStandardDeviation', detail: 'predictor', returnType: 'Numerical', signature: 'TargetRankStandardDeviation(Structure(RankRegressor) rankRegressor)', documentation: "Computes the `RankRegressor` target rank's standard deviation." },
  { label: 'TargetRankDensityAt', detail: 'predictor', returnType: 'Numerical', signature: 'TargetRankDensityAt(Structure(RankRegressor) rankRegressor, Numerical rank)', documentation: 'Computes the `RankRegressor` density of the target rank for a given normalized rank (between 0 and 1).' },
  { label: 'TargetRankCumulativeProbAt', detail: 'predictor', returnType: 'Numerical', signature: 'TargetRankCumulativeProbAt(Structure(RankRegressor) rankRegressor, Numerical rank)', documentation: 'Computes the `RankRegressor` probability that the target rank is below a given normalized rank.' },
  { label: 'NBRegressor', detail: 'predictor', returnType: 'Structure', signature: 'NBRegressor(Structure(RankRegressor) nbRankRegressor, Structure(DataGrid) targetValues)', documentation: 'Builds a Naive Bayes `Regressor` structure. The first parameter is a Naive Bayes `RankRegressor`. The second parameter is the distribution of numerical target values encoded as a univariate numerical data grid.' },
  { label: 'SNBRegressor', detail: 'predictor', returnType: 'Structure', signature: 'SNBRegressor(Structure(RankRegressor) snbRankRegressor, Structure(DataGrid) targetValues)', documentation: 'Builds a Selective Naive Bayes `Regressor` structure from a `RankRegressor`. The second parameter is the distribution of numerical target values encoded as a univariate numerical data grid.' },
  { label: 'TargetMean', detail: 'predictor', returnType: 'Numerical', signature: 'TargetMean(Structure(Regressor) regressor)', documentation: 'Computes the `Regressor` mean target value.' },
  { label: 'TargetStandardDeviation', detail: 'predictor', returnType: 'Numerical', signature: 'TargetStandardDeviation(Structure(Regressor) regressor)', documentation: 'Computes the `Regressor` standard deviation of the target value.' },
  { label: 'TargetDensityAt', detail: 'predictor', returnType: 'Numerical', signature: 'TargetDensityAt(Structure(Regressor) regressor, Numerical value)', documentation: 'Computes the `Regressor` density of the target for a given value.' },
  // ── Interpretation rules ─────────────────────────────────────────────────
  { label: 'ClassifierInterpreter', detail: 'interpretation', returnType: 'Structure', signature: 'ClassifierInterpreter(Structure(Classifier) classifier)', documentation: 'Builds a `ClassifierInterpreter` structure from a `Classifier`. Contains all necessary information to derive Shapley-value interpretation indicators for each classifier variable and target value.' },
  { label: 'ContributionAt', detail: 'interpretation', returnType: 'Numerical', signature: 'ContributionAt(Structure(ClassifierInterpreter) interpreter, Categorical targetValue, Categorical classifierVariableName)', documentation: 'Returns the Shapley value for a given target value and classifier variable name.' },
  { label: 'ContributionVariableAt', detail: 'interpretation', returnType: 'Categorical', signature: 'ContributionVariableAt(Structure(ClassifierInterpreter) interpreter, Categorical targetValue, Numerical rank)', documentation: 'Returns the name of the variable at the specified importance rank (1-based) for a target value, ordered by decreasing Shapley values.' },
  { label: 'ContributionPartAt', detail: 'interpretation', returnType: 'Categorical', signature: 'ContributionPartAt(Structure(ClassifierInterpreter) interpreter, Categorical targetValue, Numerical rank)', documentation: 'Returns the label of the variable part at the specified importance rank (1-based) for a target value, ordered by decreasing Shapley values.' },
  { label: 'ContributionValueAt', detail: 'interpretation', returnType: 'Numerical', signature: 'ContributionValueAt(Structure(ClassifierInterpreter) interpreter, Categorical targetValue, Numerical rank)', documentation: 'Returns the Shapley value at the specified importance rank (1-based) for a target value, ordered by decreasing Shapley values.' },
  // ── Reinforcement rules ──────────────────────────────────────────────────
  { label: 'ClassifierReinforcer', detail: 'reinforcement', returnType: 'Structure', signature: 'ClassifierReinforcer(Structure(Classifier) classifier, Structure(VectorC) leverVariableNames)', documentation: 'Builds a `ClassifierReinforcer` structure from a `Classifier` and a list of lever variable names (literal values). Contains all information to compute reinforcement scores for each lever variable and target value.' },
  { label: 'ReinforcementInitialScoreAt', detail: 'reinforcement', returnType: 'Numerical', signature: 'ReinforcementInitialScoreAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue)', documentation: 'Returns the initial prediction score for a given target value.' },
  { label: 'ReinforcementVariableAt', detail: 'reinforcement', returnType: 'Categorical', signature: 'ReinforcementVariableAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue, Numerical rank)', documentation: 'Returns the name of the lever variable at the specified reinforcement rank (1-based) for a target value, ordered by decreasing reinforcement scores.' },
  { label: 'ReinforcementPartAt', detail: 'reinforcement', returnType: 'Categorical', signature: 'ReinforcementPartAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue, Numerical rank)', documentation: 'Returns the label of the lever variable part at the specified reinforcement rank (1-based) for a target value, ordered by decreasing reinforcement scores.' },
  { label: 'ReinforcementFinalScoreAt', detail: 'reinforcement', returnType: 'Numerical', signature: 'ReinforcementFinalScoreAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue, Numerical rank)', documentation: 'Returns the final score after reinforcement at the specified reinforcement rank (1-based) for a target value, ordered by decreasing reinforcement scores.' },
  { label: 'ReinforcementClassChangeTagAt', detail: 'reinforcement', returnType: 'Numerical', signature: 'ReinforcementClassChangeTagAt(Structure(ClassifierReinforcer) reinforcer, Categorical targetValue, Numerical rank)', documentation: 'Returns the class change tag after reinforcement at the specified rank. 0 = initial prediction was already the target; -1 = final prediction still differs; 1 = prediction changed to target.' },
  // ── Coclustering rules ───────────────────────────────────────────────────
  { label: 'DataGridDeployment', detail: 'coclustering', returnType: 'Structure', signature: 'DataGridDeployment(Structure(DataGrid) dataGrid, Numerical deployedVariableIndex, ...)', documentation: 'Builds a `DataGridDeployment` structure for a given dimension variable of a DataGrid. Input values (Vector or VectorC) correspond to the distribution of input values; an optional frequency Vector may be appended.' },
  { label: 'PredictedPartIndex', detail: 'coclustering', returnType: 'Numerical', signature: 'PredictedPartIndex(Structure(DataGridDeployment) deployment)', documentation: 'Computes the index of the closest part of the deployed variable in a coclustering deployment.' },
  { label: 'PredictedPartDistances', detail: 'coclustering', returnType: 'Structure', signature: 'PredictedPartDistances(Structure(DataGridDeployment) deployment)', documentation: 'Computes the distance to all parts of the deployed variable in a coclustering deployment.' },
  { label: 'PredictedPartFrequenciesAt', detail: 'coclustering', returnType: 'Structure', signature: 'PredictedPartFrequenciesAt(Structure(DataGridDeployment) deployment, Numerical inputVariableIndex)', documentation: 'Computes the aggregated frequencies on the parts of the specified input variable in a coclustering deployment.' },
  // ── Basic Sparse rules ───────────────────────────────────────────────────
  { label: 'CopyBlock', detail: 'basic sparse', returnType: 'Structure', signature: 'CopyBlock(Block(Numerical) valueBlock)', documentation: 'Copies a block of Numerical variables. The input and output blocks must share the same VarKey type (integer or alphanumeric), and each VarKey present in both blocks is copied.' },
  { label: 'CopyBlockC', detail: 'basic sparse', returnType: 'Structure', signature: 'CopyBlockC(Block(Categorical) valueBlock)', documentation: 'Copies a block of Categorical variables. The input and output blocks must share the same VarKey type.' },
  { label: 'GetBlock', detail: 'basic sparse', returnType: 'Structure', signature: 'GetBlock(Block(Numerical) valueBlock)', documentation: 'Accesses a block of Numerical variables from an Entity variable, bringing it into the primary dictionary.' },
  { label: 'GetBlockC', detail: 'basic sparse', returnType: 'Structure', signature: 'GetBlockC(Block(Categorical) valueBlock)', documentation: 'Accesses a block of Categorical variables from an Entity variable, bringing it into the primary dictionary.' },
  // ── Text Sparse rules ────────────────────────────────────────────────────
  { label: 'TextWords', detail: 'text sparse', returnType: 'Structure', signature: 'TextWords(Text value)', documentation: 'Tokenizes a Text value into a bag of words. Separator or control characters act as delimiters; each token is a sequence of punctuation or of other characters. Each variable in the block has a VarKey equal to the word it counts.' },
  { label: 'TextNgrams', detail: 'text sparse', returnType: 'Structure', signature: 'TextNgrams(Text value)', documentation: 'Tokenizes a Text value into a bag of byte n-grams (1-gram to 8-gram). Each variable in the block has a VarKey equal to the n-gram it counts.' },
  { label: 'TextTokens', detail: 'text sparse', returnType: 'Structure', signature: 'TextTokens(Text value)', documentation: 'Tokenizes a Text value into a bag of tokens using the blank character as delimiter. Assumes the text has already been preprocessed (e.g. lemmatized). Each variable has a VarKey equal to the token it counts.' },
  { label: 'TextListWords', detail: 'text sparse', returnType: 'Structure', signature: 'TextListWords(TextList value)', documentation: 'Applies TextWords tokenization to each Text value in a TextList, producing a combined bag of words.' },
  { label: 'TextListNgrams', detail: 'text sparse', returnType: 'Structure', signature: 'TextListNgrams(TextList value)', documentation: 'Applies TextNgrams tokenization to each Text value in a TextList, producing a combined bag of n-grams.' },
  { label: 'TextListTokens', detail: 'text sparse', returnType: 'Structure', signature: 'TextListTokens(TextList value)', documentation: 'Applies TextTokens tokenization to each Text value in a TextList, producing a combined bag of tokens.' },
  // ── Preparation Sparse rules ─────────────────────────────────────────────
  { label: 'DataGridBlock', detail: 'preparation sparse', returnType: 'Structure', signature: 'DataGridBlock(Structure(ValueSet) varKeys, Structure(DataGrid) dataGrid1, ...)', documentation: 'Builds a `DataGridBlock` from a list of VarKeys and a corresponding list of DataGrid preparation models. The number of VarKeys must equal the number of DataGrids. VarKeys can be integers (ValueSet) or alphanumeric (ValueSetC).' },
  { label: 'DataGridStatsBlock', detail: 'preparation sparse', returnType: 'Structure', signature: 'DataGridStatsBlock(Structure(DataGridBlock) dataGridBlock, Block(Numerical) valueBlock)', documentation: 'Applies each DataGrid model in a `DataGridBlock` to the corresponding block variable (matched by VarKey), producing a sparse block of preparation statistics. Equivalent to DataGridStats applied to a sparse block.' },
  { label: 'DataGridCellBlock', detail: 'preparation sparse', returnType: 'Structure', signature: 'DataGridCellBlock(Structure(DataGridBlock) dataGridBlock, Block(Numerical) valueBlock)', documentation: 'Builds a sparse block of cell indices from a `DataGridBlock` and a block of variables. Equivalent to CellIndex applied to each variable in a sparse block.' },
  // ── Table Partition rules ────────────────────────────────────────────────
  { label: 'Partition', detail: 'table partition', returnType: 'Structure', signature: 'Partition(Structure partition1, ...)', documentation: 'Builds a multivariate `Partition` as the cross-product of univariate partitions. Parameters must be univariate partitions: IntervalBounds, ValueGroups, ValueSetC, or ValueSet.' },
  { label: 'TablePartition', detail: 'table partition', returnType: 'Structure', signature: 'TablePartition(Table table, Structure(Partition) partition, ...)', documentation: 'Builds a block of Table sub-parts from a secondary Table and a Partition specification. The block is potentially sparse — only non-empty parts are managed. Additional value arguments specify the partition variables from the secondary table.' },
  { label: 'TablePartitionCount', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionCount(Block(Table) tableParts)', documentation: 'Number of records per part in a block of Table parts produced by TablePartition.' },
  { label: 'TablePartitionCountDistinct', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionCountDistinct(Block(Table) tableParts, Categorical value)', documentation: 'Number of distinct values per table part for a given Categorical variable in the secondary Table.' },
  { label: 'TablePartitionEntropy', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionEntropy(Block(Table) tableParts, Categorical value)', documentation: 'Entropy of the value distribution per table part for a given Categorical variable in the secondary Table.' },
  { label: 'TablePartitionMode', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMode(Block(Table) tableParts, Categorical value)', documentation: 'Most frequent value per table part for a given Categorical variable in the secondary Table.' },
  { label: 'TablePartitionModeAt', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionModeAt(Block(Table) tableParts, Categorical value, Numerical rank)', documentation: 'Ith most frequent value per table part for a given Categorical variable in the secondary Table.' },
  { label: 'TablePartitionMean', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMean(Block(Table) tableParts, Numerical value)', documentation: 'Mean value per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionStdDev', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionStdDev(Block(Table) tableParts, Numerical value)', documentation: 'Standard deviation per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionMedian', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMedian(Block(Table) tableParts, Numerical value)', documentation: 'Median value per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionMin', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMin(Block(Table) tableParts, Numerical value)', documentation: 'Minimum value per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionMax', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionMax(Block(Table) tableParts, Numerical value)', documentation: 'Maximum value per table part for a given Numerical variable in the secondary Table.' },
  { label: 'TablePartitionSum', detail: 'table partition', returnType: 'Structure', signature: 'TablePartitionSum(Block(Table) tableParts, Numerical value)', documentation: 'Sum of values per table part for a given Numerical variable in the secondary Table.' },
  // ── Table Block rules ────────────────────────────────────────────────────
  { label: 'TableBlockCountDistinct', detail: 'table block', returnType: 'Structure', signature: 'TableBlockCountDistinct(Table table, Block(Categorical) valueBlock)', documentation: 'Number of distinct values per variable of a Categorical block defined in the secondary Table.' },
  { label: 'TableBlockEntropy', detail: 'table block', returnType: 'Structure', signature: 'TableBlockEntropy(Table table, Block(Categorical) valueBlock)', documentation: 'Entropy of the value distribution per variable of a Categorical block defined in the secondary Table.' },
  { label: 'TableBlockMode', detail: 'table block', returnType: 'Structure', signature: 'TableBlockMode(Table table, Block(Categorical) valueBlock)', documentation: 'Most frequent value per variable of a Categorical block defined in the secondary Table.' },
  { label: 'TableBlockMean', detail: 'table block', returnType: 'Structure', signature: 'TableBlockMean(Table table, Block(Numerical) valueBlock)', documentation: 'Mean value per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockStdDev', detail: 'table block', returnType: 'Structure', signature: 'TableBlockStdDev(Table table, Block(Numerical) valueBlock)', documentation: 'Standard deviation per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockMedian', detail: 'table block', returnType: 'Structure', signature: 'TableBlockMedian(Table table, Block(Numerical) valueBlock)', documentation: 'Median value per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockMin', detail: 'table block', returnType: 'Structure', signature: 'TableBlockMin(Table table, Block(Numerical) valueBlock)', documentation: 'Minimum value per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockMax', detail: 'table block', returnType: 'Structure', signature: 'TableBlockMax(Table table, Block(Numerical) valueBlock)', documentation: 'Maximum value per variable of a Numerical block defined in the secondary Table.' },
  { label: 'TableBlockSum', detail: 'table block', returnType: 'Structure', signature: 'TableBlockSum(Table table, Block(Numerical) valueBlock)', documentation: 'Sum of values per variable of a Numerical block defined in the secondary Table.' },
];
