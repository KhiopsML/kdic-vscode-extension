# KDIC editor support

## Purpose

Provide editing assistance for Khiops dictionary files in VS Code without requiring a Khiops installation.

## Scope and verification

- Highlighting and completion are editing aids, not proof that text is valid Khiops. Language reference: [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/).
- `scripts/completion-context-test.js` and `scripts/completion-test.js` cover the completion context and provider results with a VS Code mock; `scripts/vscode-host-tests/` checks completion and hover in a real VS Code. Highlighting, snippets, and visual theme rendering have no automated tests.

## Requirements

### Requirement: Language registration and highlighting
The extension SHALL register `.kdic` files as the `kdic` language and provide a TextMate grammar for dictionary syntax.

#### Scenario: Dictionary tokens
- **WHEN** VS Code tokenizes a `.kdic` document
- **THEN** the grammar provides scopes for keywords, types, dictionary declarations, function calls, strings, backtick names, comments, metadata, numbers, `#Missing`, operators, and punctuation

### Requirement: Context-sensitive completion
The extension SHALL offer completion items according to the current document position, distinguishing comments and assignments from quoted text.

#### Scenario: Outside a block
- **WHEN** completion is requested outside a brace-delimited block and not after `Entity(` or `Table(`
- **THEN** the provider returns the `Dictionary`, `Root`, and `Unused` keyword entries

#### Scenario: Inside a block
- **WHEN** completion is requested inside a block and the current line prefix contains no unquoted assignment outside recognized metadata or a comment
- **THEN** the provider offers `Unused`, native and advanced types, and the registered derivation rules

#### Scenario: Derivation context
- **WHEN** completion is requested inside a block after an unquoted assignment `=` on the current line, excluding recognized metadata and comments
- **THEN** the provider offers the registered derivation rules rather than type and `Unused` entries

#### Scenario: Relation target
- **WHEN** completion is requested immediately after `Entity(` or `Table(`, allowing whitespace
- **THEN** the provider offers dictionary names found in the current document, excluding commented-out declarations

#### Scenario: Comment marker
- **WHEN** the current line prefix contains an unquoted `//` comment marker, including after quoted text containing `//`
- **THEN** the provider returns no completion items

#### Scenario: Quoted text
- **WHEN** a `//` or `=` appears only inside a double-quoted string or backtick-quoted identifier, including strings with doubled quote characters or left unclosed at the cursor
- **THEN** it is not interpreted as a comment marker or assignment, and the normal suggestions are offered

#### Scenario: Metadata
- **WHEN** the block line prefix contains recognized metadata with `=` and no other unquoted assignment
- **THEN** the provider offers the normal non-derivation suggestions
- **WHEN** it also contains an unquoted assignment outside that metadata
- **THEN** the provider offers derivation rules rather than type and `Unused` entries

#### Scenario: Metadata key
- **WHEN** completion is requested inside a block right after an unquoted `<`, or after `<` and the start of a key, outside comments
- **THEN** the provider offers `DateFormat`, `TimeFormat`, `TimestampFormat`, and `TimestampTZFormat`, each expanding to the key with a quoted example format
- **WHEN** the line starts with a `Date`, `Time`, `Timestamp`, or `TimestampTZ` declaration, optionally after `Unused`
- **THEN** the key of that type is listed first and preselected
- **WHEN** the `<` is outside a block, or in a comment or quoted text
- **THEN** no metadata key is offered

The provider is also triggered by typing `<`.

### Requirement: Hover documentation
The extension SHALL show documentation for recognized keywords, types, and registered derivation-rule names.

#### Scenario: Derivation rule
- **WHEN** the user hovers a registered derivation-rule name
- **THEN** the hover includes its signature and documentation

### Requirement: Snippets and editing configuration
The extension SHALL contribute KDIC snippets and language editing configuration.

#### Scenario: Dictionary snippet
- **WHEN** the user expands the `dict` snippet in a KDIC document
- **THEN** VS Code inserts a dictionary template with a variable and a closing `};`

#### Scenario: Format snippets
- **WHEN** the user expands `datefmt`, `timefmt`, `tsfmt`, or `tstzfmt`
- **THEN** VS Code inserts a `Date`, `Time`, `Timestamp`, or `TimestampTZ` variable followed by its format key and an editable format

#### Scenario: Comment and bracket support
- **WHEN** VS Code applies the KDIC language configuration
- **THEN** it uses `//` for line comments and provides the configured bracket, auto-closing, and indentation behavior

## Known limitations

- The README lists `Dictionary` and `Root` as top-level completions; the provider also returns `Unused` there. The project owner confirmed that this extra suggestion is unwanted; the first scenario records the current behavior until it is corrected.
- TODO: TextMate tokenization tests for highlighting, and host tests for snippets.
