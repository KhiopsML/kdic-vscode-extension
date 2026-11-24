# KDIC built-in validation

## Purpose

Report common structural and type problems while editing a Khiops dictionary, without depending on the native Khiops binary.

## Scope and verification

- Validation is best-effort and structural. It does not claim to be a complete parser: the native Khiops parser remains authoritative for nested derivations, secondary-table scopes, joins, and complex block contents.
- Language reference: [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/) and [variable blocks](https://khiops.org/api-docs/kdic/intro-block/).
- `npm test` runs `scripts/validator-test.js` (examples of every requirement below, mostly matching message fragments) plus the editor-document lifecycle tests. `scripts/smoke-test.js` validates every `.kdic` file of a directory; on the local LearningTest corpus (6,177 files) it is the regression reference for false positives.
- `scripts/vscode-host-tests/` exercises the packaged extension in a real VS Code (see `README.md`): diagnostic positions after edits, save, external changes, and files with isolated carriage returns.

## Requirements

### Requirement: Built-in diagnostics in the editor
The extension SHALL publish validator diagnostics with source `kdic`, whether or not native validation is available.

#### Scenario: Editing a document
- **WHEN** a KDIC document is opened or changed
- **THEN** its built-in diagnostics are updated, with changes debounced by 300 milliseconds

#### Scenario: Closing a document
- **WHEN** a document closes
- **THEN** its built-in and native diagnostic collections are cleared

### Requirement: Structural diagnostics
The validator SHALL report structural errors and warn about unrecognized lines, while preserving the editing behavior for unfinished declarations.

#### Scenario: Missing semicolon
- **WHEN** a complete variable declaration on a previous line has no semicolon
- **THEN** the validator reports an error for the missing semicolon

#### Scenario: Closing brace
- **WHEN** a dictionary's closing brace is alone on a line without a following semicolon
- **THEN** the validator reports an error

#### Scenario: Dictionary terminator
- **WHEN** a completed dictionary closing brace has no terminating semicolon, including when metadata or comments are present
- **THEN** the validator reports an error for the missing terminator

#### Scenario: Unbalanced braces
- **WHEN** a dictionary or variable-block opening brace is unclosed, or a closing brace is unmatched
- **THEN** the validator reports an error

#### Scenario: Unbalanced parentheses and brackets
- **WHEN** parentheses in dictionary keys or derivation calls, or brackets in an external-entity key, are unmatched or incorrectly nested
- **THEN** the validator reports a structural error at a relevant delimiter

#### Scenario: Balanced multiline forms
- **WHEN** a dictionary key, derivation with nested calls, or external-entity key spans multiple lines with balanced delimiters
- **THEN** the validator does not report an imbalance solely because of the line breaks

#### Scenario: Unknown line
- **WHEN** a nonempty, non-continuation line does not match the applicable structural patterns
- **THEN** the validator reports a warning

#### Scenario: Editing an unfinished declaration
- **WHEN** a declaration without a semicolon is on the last line or the active cursor line
- **THEN** the missing-semicolon check does not report that line

### Requirement: Comments, strings, and metadata
The validator SHALL distinguish quoted text and comments from code when checking delimiters, and validate the syntax of metadata in dictionary and variable declarations.

#### Scenario: Quoted or commented delimiters
- **WHEN** delimiter characters or comment markers occur inside a string, a backtick-quoted identifier, or a comment, including after doubled quote characters
- **THEN** they do not count as structural delimiters or begin a comment inside the quoted text

#### Scenario: Metadata after a semicolon
- **WHEN** a declaration is followed by recognized metadata and a line comment
- **THEN** that trailing metadata and comment do not cause a trailing-content error

#### Scenario: Valid metadata forms
- **WHEN** metadata uses a boolean key `<key>`, a numeric value `<key=value>`, or a double-quoted string value `<key="value">` with correctly escaped quotes
- **THEN** the validator does not report a metadata syntax error for that form

#### Scenario: Invalid metadata
- **WHEN** metadata has unmatched angle brackets, an invalid key, an invalid numeric value, or an unclosed string
- **THEN** the validator reports a metadata syntax error

### Requirement: Date and time format metadata
The validator SHALL check the metadata keys that give the external format of a date or time variable, as native Khiops does: `DateFormat` for `Date`, `TimeFormat` for `Time`, `TimestampFormat` for `Timestamp`, and `TimestampTZFormat` for `TimestampTZ`. The tags of a variable are those that follow the `;` ending its declaration, including on following lines. Key names are case-sensitive; other keys are not checked. The formats are those documented by Khiops: 16 date formats, 15 time formats, a date format and a time format joined by a space, `-`, `_` or `T` (or by nothing when neither has a separator) for timestamps, and a timestamp format followed by `zzzzz` or `zzzzzz` for timestamps with a time zone.

#### Scenario: Format key on its own type
- **WHEN** a variable is followed by its format key with a string value, alone or among other tags
- **THEN** the validator reports nothing for that tag

#### Scenario: Format key on another type
- **WHEN** a format key follows a variable of another type
- **THEN** the validator reports an error on the key, naming the type it applies to and the type of the variable

#### Scenario: Format key without a string
- **WHEN** a format key on a variable of its own type has no value or a numeric value
- **THEN** the validator reports an error asking for a string value

#### Scenario: Format that does not exist
- **WHEN** a format key on a variable of its own type has a string that is not one of the formats of that type, including a format of another type
- **THEN** the validator reports an error on the string, naming the format and the documentation page that lists the valid ones

#### Scenario: Malformed tag
- **WHEN** a tag is malformed
- **THEN** only the metadata syntax error is reported for it

### Requirement: Keys, names, and relation references
The validator SHALL validate key-field declarations and names, and check recognized relation targets.

#### Scenario: Invalid declared key
- **WHEN** a declared key field is `Numerical` or is derived from a rule
- **THEN** the validator reports the applicable key error

#### Scenario: Missing key declaration
- **WHEN** a dictionary key names a variable that is not declared in that dictionary
- **THEN** the validator reports an error identifying the missing key field

#### Scenario: Unknown relation
- **WHEN** a recognized `Table(Phantom)` variable references a dictionary not declared in the document
- **THEN** the validator reports an unknown-dictionary error

#### Scenario: Long name
- **WHEN** a recognized dictionary or variable name exceeds 128 characters
- **THEN** the validator reports a name-length error

#### Scenario: Quoted key and variable names
- **WHEN** a key or variable name contains special characters and is enclosed in backticks with internal backticks doubled
- **THEN** the validator treats the decoded name consistently when checking its declaration and does not report a name syntax error

#### Scenario: Invalid variable name
- **WHEN** a variable name uses characters requiring backticks without valid quoting, or its backtick-quoted form is unterminated
- **THEN** the validator reports a name syntax error

### Requirement: Files with isolated carriage returns
VS Code turns every carriage return of a file into a line break in the editor, while KDIC (like Khiops) treats only `\n` as a line break: an isolated `\r` can be part of quoted text. The editor text of such a file no longer matches the file, so the built-in validator SHALL NOT report diagnostics for it. Native Khiops, which reads the real file, remains the authority.

#### Scenario: Open a file containing an isolated carriage return
- **WHEN** a KDIC file containing a carriage return that is not part of a `\r\n` pair is opened in VS Code
- **THEN** no built-in diagnostics are published for it, whether or not it is valid

#### Scenario: Edit without saving
- **WHEN** the user edits such a file without saving
- **THEN** still no built-in diagnostics are published

#### Scenario: Save
- **WHEN** the file is saved (VS Code rewrites it with ordinary line breaks)
- **THEN** built-in validation resumes on the saved content, and reports any error that the line-break change introduced

#### Scenario: File changed on disk
- **WHEN** the file's content is replaced from disk while the document is unmodified
- **THEN** the file is checked again, and built-in diagnostics are suppressed or published accordingly

#### Scenario: Unreadable file
- **WHEN** the file cannot be read, or the document is not backed by a file
- **THEN** it is treated as having no isolated carriage return, and the editor text is validated

### Requirement: Derivation constants
The validator SHALL validate categorical and numerical constant syntax in derivation expressions, including nested calls.

#### Scenario: Categorical constants
- **WHEN** a derivation contains double-quoted categorical constants with doubled internal quotes, including valid concatenated string parts
- **THEN** the validator does not report a constant syntax error

#### Scenario: Numerical constants
- **WHEN** a derivation contains valid numeric literals, scientific notation, or `#Missing`
- **THEN** the validator does not report a constant syntax error

#### Scenario: Invalid constants
- **WHEN** a derivation contains a malformed numeric literal or an unterminated categorical constant
- **THEN** the validator reports a constant syntax error

### Requirement: Variable-block checks
The validator SHALL check recognized variable-block members and closing declarations.

#### Scenario: Mixed member types
- **WHEN** a recognized variable block contains both `Numerical` and `Categorical` members
- **THEN** the validator reports an error that block members must have the same type

#### Scenario: Derived member or unnamed block
- **WHEN** a recognized block member has an individual derivation, or the block closes without a name and semicolon
- **THEN** the validator reports the corresponding error, positioned on the offending text

### Requirement: Simple derivation type checks
The validator SHALL compare recognized simple calls (`= rule(arg, …)` without nested parentheses) with registered rule types, without claiming complete derivation analysis. Argument diagnostics SHALL use the current dictionary only when the operand is known to have current scope.

#### Scenario: Return type mismatch
- **WHEN** a simple call to registered `TableCount` is assigned to a `Categorical` variable
- **THEN** the validator reports a return-type error

#### Scenario: Argument mismatch
- **WHEN** a simple `TableCount` call uses a declared `Categorical` variable as its first argument
- **THEN** the validator reports an argument-type error

#### Scenario: Constant argument mismatch
- **WHEN** a simple call passes a string constant where the rule expects `Numerical`, or a number or `#Missing` where it expects `Categorical`, at any position and whatever the operand scope
- **THEN** the validator reports an error on the constant, naming its type, the rule, the expected type and the argument number
- **WHEN** the constant has the expected type, or the parameter is of another type
- **THEN** the validator reports nothing

#### Scenario: Rule with a variable number of arguments
- **WHEN** a rule ends with `...` and all its other parameters have a concrete type, such as `Sum(Numerical value1, ...)` or `Concat(Categorical value1, ...)`
- **THEN** every extra argument is checked against the type before `...`, for variables and constants alike
- **WHEN** a parameter of the rule is `any` or a structure, such as `DataGridDeployment`
- **THEN** the extra arguments are not checked

#### Scenario: Call with fewer arguments than parameters
- **WHEN** a simple call has fewer arguments than the rule has parameters, as a rule that also exists in a shorter form (`ContributionValueAt` with a rank only)
- **THEN** its arguments are not type-checked, since their positions do not match the registered signature

#### Scenario: Missing argument variable
- **WHEN** a simple call has a current-scope bare identifier argument with a known expected type that is not declared in the current dictionary
- **THEN** the validator reports an undeclared-variable warning

#### Scenario: Separators inside quoted arguments
- **WHEN** a string argument contains commas, or a backtick-quoted argument contains parentheses
- **THEN** those characters neither split the argument nor hide the call from the checks

#### Scenario: Secondary operand with a conflicting local name
- **WHEN** `TableMean(achats, montant)` uses `achats` as a table and the current dictionary declares a `Categorical montant` while the secondary dictionary declares a `Numerical montant`
- **THEN** the validator does not report an argument-type error based on the current dictionary's `montant`

#### Scenario: Secondary operand absent locally
- **WHEN** `TableMean(achats, montant)` refers to a secondary-table operand not declared in the current dictionary
- **THEN** the validator does not warn that `montant` is undeclared in the current dictionary

#### Scenario: Later current-scope operand
- **WHEN** `TableDifference(first, second)` has `first` declared as a table and `second` declared as `Categorical` in the current dictionary
- **THEN** the validator reports an argument-type error for `second`

#### Scenario: Uncertain operand scope
- **WHEN** a recognized simple call has an operand whose scope cannot be determined reliably
- **THEN** the validator does not issue a type mismatch or undeclared-variable warning for that operand based on the current dictionary

#### Scenario: Nested call
- **WHEN** a derivation contains nested function calls
- **THEN** the simple-call checks do not establish that the nested expression is semantically valid

### Requirement: Standalone smoke test
The smoke-test CLI SHALL validate `.kdic` files recursively using the compiled validator and rule definitions.

#### Scenario: Errors only
- **WHEN** the CLI runs with `--errors-only`
- **THEN** it omits warnings from the report and exits with status 1 if reported errors exist, otherwise 0

#### Scenario: Missing compiled validator or target
- **WHEN** the compiled validator or target directory does not exist
- **THEN** the CLI reports the problem and exits with status 2

## Known limitations

- The official variable-block reference requires a `VarKey` for each member. The built-in checks do not enforce its presence, uniqueness, or validity.
- Cross-table scopes, nested derivation semantics, joins, and the complete grammar are not validated; absence of a diagnostic does not establish Khiops validity.
- The `#Khiops` header line and dictionary metadata are accepted as structural patterns; their exact compatibility with native Khiops is not established.
- Rule signatures are registered one per rule: a rule that exists with different parameter lists is only checked when called with all the registered parameters. Arguments of nested calls are not type-checked, and neither are operands of another scope.
- A declaration the structure scan cannot recognize (for example junk before its type on the same line) is reported as an unknown line, and is not type-checked.
- Native Khiops checks a date or time format only loosely (length, field positions and separators), so it accepts a few garbled variants of a time or timestamp format, such as `HH:MM:Ss` or `HH.MM ` with a trailing space. The built-in check reports every string outside the documented formats, so it can flag a format that Khiops would load.
