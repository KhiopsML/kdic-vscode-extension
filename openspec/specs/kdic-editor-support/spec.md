# KDIC editor support

## Purpose

Provide editing assistance for Khiops dictionary files in VS Code without requiring a Khiops installation.

## Evidence and scope

- **Implementation inspected:** `package.json`, `src/extension.ts`, `syntaxes/kdic.tmLanguage.json`, `snippets/kdic.code-snippets`, and `language-configuration.json`.
- **Documented intent:** `README.md` and `README.extension.md`.
- **Automated verification:** the repository's validator suite does not exercise VS Code completions, hovers, highlighting, or snippets. The scenarios below describe the inspected implementation, not integration-test results.
- **Language reference:** [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/). Highlighting and completion are editing aids, not proof that text is valid Khiops.

## Requirements

### Requirement: Language registration and highlighting
The extension SHALL register `.kdic` files as the `kdic` language and provide a TextMate grammar for dictionary syntax.

#### Scenario: Dictionary tokens
- **WHEN** VS Code tokenizes a `.kdic` document
- **THEN** the grammar provides scopes for keywords, types, dictionary declarations, function calls, strings, backtick names, comments, metadata, numbers, `#Missing`, operators, and punctuation

### Requirement: Context-sensitive completion
The extension SHALL offer completion items according to the current document position.

#### Scenario: Outside a block
- **WHEN** completion is requested outside a brace-delimited block and not after `Entity(` or `Table(`
- **THEN** the provider returns the `Dictionary`, `Root`, and `Unused` keyword entries

#### Scenario: Inside a block
- **WHEN** completion is requested inside a block and the current line prefix contains no `=` outside recognized metadata
- **THEN** the provider offers `Unused`, native and advanced types, and its registered derivation rules

#### Scenario: Derivation context
- **WHEN** completion is requested inside a block after `=` on the current line, excluding recognized metadata
- **THEN** the provider offers its registered derivation rules rather than type and `Unused` entries

#### Scenario: Relation target
- **WHEN** completion is requested immediately after `Entity(` or `Table(`, allowing whitespace
- **THEN** the provider offers dictionary names found in the current document, excluding commented-out declarations

#### Scenario: Line containing a comment marker
- **WHEN** the current line prefix contains `//`
- **THEN** the provider returns no completion items

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

#### Scenario: Comment and bracket support
- **WHEN** VS Code applies the KDIC language configuration
- **THEN** it uses `//` for line comments and provides the configured bracket, auto-closing, and indentation behavior

## Divergences and open questions

- The README lists `Dictionary` and `Root` as top-level completions; the provider also returns `Unused` there. The project owner confirmed that this extra suggestion is unwanted. The scenario above records the current behavior until it is corrected.
- **TODO:** Make completion comment detection quote-aware: it currently suppresses suggestions after a literal `//` even inside a quoted string or identifier, unlike the validator's comment stripper.
- **TODO:** Make derivation-context detection quote-aware: it currently looks for `=` in the line prefix after removing recognized metadata and can treat an `=` in a quoted value or identifier as a derivation.
- **TODO:** Add automated VS Code host tests for completions, hovers, snippets, and diagnostics, and TextMate tokenization tests for highlighting. Current tests do not establish these behaviors across editing contexts or verify visual theme rendering.
