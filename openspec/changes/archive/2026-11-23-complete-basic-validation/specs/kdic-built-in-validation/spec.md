## MODIFIED Requirements

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

## ADDED Requirements

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
