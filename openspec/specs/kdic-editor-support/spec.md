# KDIC editor support

## Purpose

Provide editing assistance for Khiops dictionary files in VS Code without requiring a Khiops installation.

## Scope and verification

- Highlighting and completion are editing aids, not proof that text is valid Khiops. Language reference: [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/).
- `scripts/completion-context-test.js`, `scripts/operand-completion-test.js` and `scripts/completion-test.js` cover the completion context, the variables an operand can name, and provider results with a VS Code mock; `scripts/vscode-host-tests/` checks completion and hover in a real VS Code. Highlighting, snippets, and visual theme rendering have no automated tests.

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

#### Scenario: Missing value
- **WHEN** completion is requested inside a block, outside comments and quoted text, where an operand starts (right after `(` or `,`, also on a following line) in a call of a known rule whose parameter at that position is `Numerical`, a trailing `...` repeating the parameter before it
- **THEN** the provider also offers `#Missing`
- **WHEN** the position expects another type, is not the start of an operand, is outside any call, or the rule is unknown
- **THEN** `#Missing` is not offered
- **WHEN** the user has typed `#` or the start of `#Missing`
- **THEN** only `#Missing` is offered where it is possible, replacing what was typed, and nothing otherwise, including on a `#Khiops` header line

`#Missing` is not offered as the whole derivation of a variable, which Khiops rejects. The provider is also triggered by typing `#`.

#### Scenario: Variables as operands
- **WHEN** completion is requested where an operand starts in a call of a known rule (right after `(` or `,`, or after the scope operator `.`), in a derivation, outside comments and quoted text
- **THEN** the provider also offers the variables of the dictionary Khiops resolves that operand in: every variable of the dictionary, including those declared below and those marked `Unused`, except the variable whose derivation is being written
- **AND** the variable blocks of that dictionary, named by the `Name` after their closing `}`, are offered too, with the detail `Block`
- **AND** the operands of a table or entity rule documented as secondary (aggregations, `TableSelection`, `GetValue*`, `GetBlock*`) get the variables of the dictionary the first operand's `Table(X)` or `Entity(X)` points to, while the others get those of the current dictionary
- **AND** each `.` before the operand goes one scope up, as in a derivation; more dots than scopes offers no variable
- **AND** the variables of the type the rule expects at that position (a block, where a block is expected) come first; the others are still offered, since the rule may be overloaded or its signature incomplete
- **AND** a name that must be written between backquotes is inserted with them; when the opening backquote was typed, the name replaces it and the closing one VS Code added
- **WHEN** the rule is not registered, its first operand does not resolve to a dictionary declared exactly once in the file, or the position is not the start of an operand
- **THEN** no variable is offered
- **WHEN** the user has typed a `.` that is not before a name (after a name, a quote or a number)
- **THEN** nothing is offered

The provider is also triggered by typing `.`. Variable completion has no editor-level cache: it scans the document each time, which takes under 1 ms for the median file of a corpus of 3,300 dictionaries and 8 ms at the 99th percentile.

#### Scenario: Large documents
- **WHEN** the document holds more than 1,000,000 characters
- **THEN** completion works from the current line only: no variables, no `#Missing` and no dictionary names are offered, and a `.` offers nothing, while keywords, types, derivation rules and metadata keys are still offered

### Requirement: Hover documentation
The extension SHALL show documentation for recognized keywords, types, and registered derivation-rule names.

#### Scenario: Derivation rule
- **WHEN** the user hovers a registered derivation-rule name
- **THEN** the hover includes its signature and documentation

### Requirement: Instance-building rule completion and hover
The extension SHALL offer each supported instance-building rule in derivation completion and show its documented signature and description on hover.

#### Scenario: Completing a supported rule
- **WHEN** completion is requested in a derivation where rule suggestions are available
- **THEN** the supported instance-building rules are offered with their rule category

#### Scenario: Hovering a supported rule
- **WHEN** the user hovers a supported instance-building rule name
- **THEN** the hover shows its signature and documentation, including its target dictionary and output mapping when applicable

### Requirement: Instance-building operand completion
The extension SHALL suggest operands from the dictionary in which each documented source operand is evaluated, and target variables for output names after `:`.

#### Scenario: Source operands from related tables
- **WHEN** completion is requested for a source operand of a supported instance-building rule that reads one or more related tables
- **THEN** suggestions come from the corresponding source-table dictionary or dictionaries, not an unrelated dictionary

#### Scenario: Output mapping
- **WHEN** completion is requested for an output name after `:` in a supported instance-building rule
- **THEN** suggestions come from the target dictionary declared by the containing `Entity` or `Table` variable

#### Scenario: Unresolved source or target dictionary
- **WHEN** the dictionary for a source operand or output mapping cannot be determined unambiguously
- **THEN** the extension offers no variable suggestions for that operand

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
