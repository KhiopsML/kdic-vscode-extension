# KDIC built-in validation

## Purpose

Report common structural and type problems while editing a Khiops dictionary, without depending on the native Khiops binary.

## Evidence and scope

- **Automated verification:** `npm test` compiles the project and runs `scripts/validator-test.js`. The suite covers examples of comments, quoting, dictionary references, keys, semicolons, name length, braces, variable blocks, multiline derivations, and argument scopes. Most diagnostic assertions match message fragments; the scope tests also check severity.
- **Additional verification:** representative return-type errors were checked directly against the compiled validator with an explicit test rule signature.
- **Implementation inspected:** `src/validator.ts`, `src/extension.ts`, and `scripts/smoke-test.js`. Other scenarios below are derived from the implementation and are not covered by the existing suite.
- **Documented intent:** `README.md`, `README.extension.md`, and `.github/instructions/kdic-extension.instructions.md` describe best-effort structural validation; they do not claim a complete parser.
- **Language reference:** [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/) and [variable blocks](https://khiops.org/api-docs/kdic/intro-block/). Native Khiops remains authoritative for complete semantics.
- **Issue #21 pre-change review:** The local native lexer and grammar recognize simple and backtick-quoted names, doubled quote escapes, numeric literals and `#Missing`, concatenated string literals, key lists, external reference operands, and boolean, numeric, or quoted-string metadata. Metadata keys are simple identifiers; the native grammar rejects duplicate metadata keys and missing numeric values. Its lexer resets quoted tokens at a newline. The public documentation describes the common forms but does not spell out all lexical rules.
- **Issue #21 observed baseline:** The built-in validator reports representative unmatched braces, missing variable and dictionary semicolons, and declared non-categorical or derived keys. It accepts representative unmatched external-key brackets, unquoted metadata values, undeclared dictionary keys, and malformed numeric operands without an error; an unfinished key parenthesis receives only a generic warning. Quoted names and representative quoted strings are accepted, but their complete syntax and multiline behavior are not comprehensively checked. Existing tests cover only selected examples, not all forms in the issue.
- **Structural and metadata tests added for issue #21:** The validator suite now exercises delimiter nesting and offsets, quoted delimiters and comments, multiline and inline declaration terminators, editing suppression, and the three metadata forms including invalid values and multiline metadata. These tests are not a complete native-parser conformance suite. The native reference fixture `ExportMetaData/IrisMetaData.kdic` intentionally contains a `#Missing` metadata value, which the native parser and the updated validator both reject.
- **Key, name, and constant tests added for issue #21:** The validator suite covers missing and invalid keys, multiline and quoted key names, invalid variable names, scientific notation, `#Missing`, escaped and concatenated categorical constants, and malformed constants in nested calls. It does not establish full validation of all nested derivation semantics or secondary-table operands.
- **Full LearningTest regression review:** Generated dictionaries exposed false errors for carriage returns inside quoted text and numeric inputs immediately before the `:` separating table-creation output operands. Both forms are covered by focused regression tests. After correction, the 3,362-file smoke test has 34 additional diagnostics versus the baseline, all on malformed fixture constructs, and two replaced metadata diagnostics; the corpus also contains pre-existing invalid files. Full derivation semantics remain outside the built-in validator's scope.
- **VS Code host verification:** Focused installed-extension tests cover original isolated carriage returns, unsaved edits and diagnostic positions, save, reload, external changes, delayed and unavailable source reads, and UTF-16. If original source cannot be reconciled, the extension warns and uses editor text rather than stale source.

## Requirements

### Requirement: Built-in diagnostics in the editor
When built-in validation is selected or used as fallback, the extension SHALL publish validator diagnostics with source `kdic`.

#### Scenario: Editing a document
- **WHEN** a KDIC document is opened or changed with built-in validation active
- **THEN** its built-in diagnostics are updated, with changes debounced by 300 milliseconds

#### Scenario: Closing a document
- **WHEN** a document closes
- **THEN** its built-in and native diagnostic collections are cleared

### Requirement: Structural diagnostics
The validator SHALL report structural errors in the constructs covered by issue #21 and warn about other unrecognized lines, while preserving the editing behavior for unfinished declarations.

#### Scenario: Missing semicolon
- **WHEN** a complete variable declaration on a previous line has no semicolon
- **THEN** the validator reports an error for the missing semicolon

#### Scenario: Closing brace
- **WHEN** a dictionary's closing brace is alone on a line without a following semicolon
- **THEN** the validator reports an error

#### Scenario: Unbalanced braces
- **WHEN** a dictionary or variable-block opening brace is unclosed, or a closing brace is unmatched
- **THEN** the validator reports an error

#### Scenario: Unknown line
- **WHEN** a nonempty, non-continuation line does not match the applicable structural patterns
- **THEN** the validator reports a warning

#### Scenario: Editing an unfinished declaration
- **WHEN** a declaration without a semicolon is on the last line or the active cursor line
- **THEN** the missing-variable-semicolon check does not report that line

#### Scenario: Unbalanced parentheses and brackets
- **WHEN** parentheses in dictionary keys or derivation calls, or brackets in an external-entity key, are unmatched or incorrectly nested
- **THEN** the validator reports a structural error at a relevant delimiter

#### Scenario: Balanced multiline forms
- **WHEN** a dictionary key, derivation with nested calls, or external-entity key spans multiple lines with balanced delimiters
- **THEN** the validator does not report an imbalance solely because of the line breaks

#### Scenario: Dictionary terminator
- **WHEN** a completed dictionary closing brace has no terminating semicolon, including when metadata or comments are present
- **THEN** the validator reports an error for the missing terminator

### Requirement: Comments, strings, and metadata
The validator SHALL distinguish quoted text and comments when checking delimiters and validate the syntax of metadata in dictionary and variable declarations.

#### Scenario: Delimiters in quoted text
- **WHEN** a derivation contains strings with `{`, `;`, or `//`, or a variable has a backtick-quoted name containing `//`
- **THEN** those characters alone do not produce structural diagnostics

#### Scenario: Metadata after a semicolon
- **WHEN** a declaration is followed by recognized metadata and a line comment
- **THEN** that trailing metadata and comment do not cause a trailing-content error

#### Scenario: Valid metadata forms
- **WHEN** metadata uses a boolean key `<key>`, a numeric value `<key=value>`, or a double-quoted string value `<key="value">` with correctly escaped quotes
- **THEN** the validator does not report a metadata syntax error for that form

#### Scenario: Invalid metadata
- **WHEN** metadata has unmatched angle brackets, an invalid key, an invalid numeric value, or an unclosed string
- **THEN** the validator reports a metadata syntax error

#### Scenario: Quoted or commented delimiters
- **WHEN** delimiter characters or comment markers occur inside a quoted string, a backtick-quoted identifier, or a comment, including after doubled quote characters
- **THEN** they do not count as structural delimiters or begin a comment inside the quoted text

### Requirement: Keys, names, and relation references
The validator SHALL validate key-field declarations and names in the constructs covered by issue #21 and check recognized relation targets.

#### Scenario: Invalid declared key
- **WHEN** a declared key field is `Numerical` or is derived from a rule
- **THEN** the validator reports the applicable key error

#### Scenario: Unknown relation
- **WHEN** a recognized `Table(Phantom)` variable references a dictionary not declared in the document
- **THEN** the validator reports an unknown-dictionary error

#### Scenario: Long name
- **WHEN** a recognized dictionary or variable name exceeds 128 characters
- **THEN** the validator reports a name-length error

#### Scenario: Missing key declaration
- **WHEN** a dictionary key names a variable that is not declared in that dictionary
- **THEN** the validator reports an error identifying the missing key field

#### Scenario: Quoted key and variable names
- **WHEN** a key or variable name contains special characters and is enclosed in backticks with internal backticks doubled
- **THEN** the validator treats the decoded name consistently when checking its declaration and does not report a name syntax error

#### Scenario: Invalid variable name
- **WHEN** a variable name uses characters requiring backticks without valid quoting, or its backtick-quoted form is unterminated
- **THEN** the validator reports a name syntax error

### Requirement: VS Code document normalization
The built-in editor validator SHALL account for VS Code line-ending normalization without losing isolated carriage returns that are part of KDIC quoted text.

#### Scenario: Open a valid file containing an isolated carriage return
- **WHEN** a valid KDIC file contains an isolated carriage return inside a quoted value and is opened in VS Code
- **THEN** the built-in validator does not report errors caused solely by normalization of that character

#### Scenario: Edit without saving
- **WHEN** the user edits such a file without saving, including before or after the quoted value
- **THEN** diagnostics reflect the current edits while retaining unaffected original carriage returns and pointing to the correct editor locations

#### Scenario: Edit an affected quoted value
- **WHEN** the user edits or removes text containing an original isolated carriage return
- **THEN** diagnostics reflect the resulting editor content without restoring removed text

#### Scenario: Save or reload
- **WHEN** the file is saved or reloaded
- **THEN** subsequent diagnostics reflect the current document and do not rely on stale pre-save or pre-reload content

#### Scenario: Preserve genuine syntax errors
- **WHEN** an actual newline leaves a quoted value unterminated or another syntax error occurs
- **THEN** the built-in validator still reports that error at the correct editor location

#### Scenario: Source text cannot be reconciled
- **WHEN** the extension cannot reliably reconcile the original source with the editor document
- **THEN** it reports that limitation explicitly and does not publish diagnostics based on stale source text

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
- **THEN** the validator reports the corresponding error

### Requirement: Simple derivation type checks
The validator SHALL compare recognized simple calls with registered rule types, without claiming complete derivation analysis. Argument diagnostics SHALL use the current dictionary only when the operand is known to have current scope.

#### Scenario: Return type mismatch
- **WHEN** a simple call to registered `TableCount` is assigned to a `Categorical` variable
- **THEN** the validator reports a return-type error

#### Scenario: Argument mismatch
- **WHEN** a simple `TableCount` call uses a declared `Categorical` variable as its first argument
- **THEN** the validator reports an argument-type error

#### Scenario: Missing argument variable
- **WHEN** a simple call has a current-scope bare identifier argument with a known expected type that is not declared in the current dictionary
- **THEN** the validator reports an undeclared-variable warning

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
The smoke-test CLI SHALL validate `.kdic` files recursively using the compiled shared validator and rule definitions.

#### Scenario: Errors only
- **WHEN** the CLI runs with `--errors-only`
- **THEN** it omits warnings from the report and exits with status 1 if reported errors exist, otherwise 0

#### Scenario: Missing compiled validator or target
- **WHEN** the compiled validator or target directory does not exist
- **THEN** the CLI reports the problem and exits with status 2

## Divergences and open questions

- The official variable-block reference requires a `VarKey` for each member. The current built-in checks do not enforce its presence, uniqueness, or validity; the regression suite accepts members without `VarKey`. Do not interpret absence of diagnostics as Khiops validity.
- Cross-table scopes, nested derivation semantics, joins, and the complete grammar are not comprehensively validated. For secondary or unknown-scope operands, local argument-type and undeclared-variable checks are skipped; this does not establish that the operand is valid.
- The regression suite covers representative local and secondary-scope argument diagnostics, but does not verify the entire production rule catalog.
- The validator accepts a `#Khiops` line and dictionary metadata as structural patterns; their precise compatibility with native Khiops is not established by the current regression tests.
- Whether every valid quoted identifier, metadata form, multiline declaration, or sparse-block form is accepted remains unverified.
