# KDIC built-in validation

## Purpose

Report common structural and type problems while editing a Khiops dictionary, without depending on the native Khiops binary.

## Evidence and scope

- **Automated verification:** `npm test` compiles the project and runs `scripts/validator-test.js`. The suite covers examples of comments, quoting, dictionary references, keys, semicolons, name length, braces, variable blocks, multiline derivations, and argument scopes. Most diagnostic assertions match message fragments; the scope tests also check severity.
- **Additional verification:** representative return-type errors were checked directly against the compiled validator with an explicit test rule signature.
- **Implementation inspected:** `src/validator.ts`, `src/extension.ts`, and `scripts/smoke-test.js`. Other scenarios below are derived from the implementation and are not covered by the existing suite.
- **Documented intent:** `README.md`, `README.extension.md`, and `.github/instructions/kdic-extension.instructions.md` describe best-effort structural validation; they do not claim a complete parser.
- **Language reference:** [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/) and [variable blocks](https://khiops.org/api-docs/kdic/intro-block/). Native Khiops remains authoritative for complete semantics.

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
The validator SHALL report recognized structural errors and warn about unrecognized lines, subject to its line-based heuristics.

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

### Requirement: Comments, strings, and metadata
The validator SHALL distinguish recognized quoted text and comments when applying its structural checks.

#### Scenario: Delimiters in quoted text
- **WHEN** a derivation contains strings with `{`, `;`, or `//`, or a variable has a backtick-quoted name containing `//`
- **THEN** those characters alone do not produce structural diagnostics

#### Scenario: Metadata after a semicolon
- **WHEN** a declaration is followed by recognized metadata and a line comment
- **THEN** that trailing metadata and comment do not cause a trailing-content error

### Requirement: Keys, names, and relation references
The validator SHALL check recognized declarations for key-field type and derivation, name length, and relation targets.

#### Scenario: Invalid declared key
- **WHEN** a declared key field is `Numerical` or is derived from a rule
- **THEN** the validator reports the applicable key error

#### Scenario: Unknown relation
- **WHEN** a recognized `Table(Phantom)` variable references a dictionary not declared in the document
- **THEN** the validator reports an unknown-dictionary error

#### Scenario: Long name
- **WHEN** a recognized dictionary or variable name exceeds 128 characters
- **THEN** the validator reports a name-length error

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
- Missing key declarations, cross-table scopes, nested derivations, joins, and the complete grammar are not comprehensively validated. For secondary or unknown-scope operands, local argument-type and undeclared-variable checks are skipped; this does not establish that the operand is valid.
- The regression suite covers representative local and secondary-scope argument diagnostics, but does not verify the entire production rule catalog.
- The validator accepts a `#Khiops` line and dictionary metadata as structural patterns; their precise compatibility with native Khiops is not established by the current regression tests.
- Whether every valid quoted identifier, metadata form, multiline declaration, or sparse-block form is accepted remains unverified.
