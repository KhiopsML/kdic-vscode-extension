## MODIFIED Requirements

### Requirement: Context-sensitive completion
The extension SHALL offer completion items according to the current document position, distinguishing comments and assignments from quoted text.

#### Scenario: Outside a block
- **WHEN** completion is requested outside a brace-delimited block and not after `Entity(` or `Table(`
- **THEN** the provider returns the `Dictionary`, `Root`, and `Unused` keyword entries

#### Scenario: Inside a block
- **WHEN** completion is requested inside a block and the current line prefix contains no unquoted assignment outside recognized metadata or a comment
- **THEN** the provider offers `Unused`, native and advanced types, and its registered derivation rules

#### Scenario: Derivation context
- **WHEN** completion is requested inside a block after an unquoted assignment `=` on the current line, excluding recognized metadata and comments
- **THEN** the provider offers its registered derivation rules rather than type and `Unused` entries

#### Scenario: Relation target
- **WHEN** completion is requested immediately after `Entity(` or `Table(`, allowing whitespace
- **THEN** the provider offers dictionary names found in the current document, excluding commented-out declarations

#### Scenario: Line containing a comment marker
- **WHEN** the current line prefix contains an unquoted `//` comment marker
- **THEN** the provider returns no completion items

#### Scenario: Comment marker in quoted text
- **WHEN** completion is requested after `//` inside a double-quoted string or backtick-quoted identifier, without an actual comment before the cursor
- **THEN** the provider does not suppress suggestions because of that marker

#### Scenario: Comment after quoted text
- **WHEN** the current line prefix contains quoted `//` followed by an unquoted `//` comment marker
- **THEN** the provider returns no completion items

#### Scenario: Equals in quoted text
- **WHEN** a block line prefix contains `=` only inside a double-quoted string or backtick-quoted identifier and contains no unquoted assignment outside recognized metadata
- **THEN** the provider offers the normal non-derivation suggestions

#### Scenario: Metadata without assignment
- **WHEN** the block line prefix contains recognized metadata with `=` and no unquoted assignment outside that metadata
- **THEN** the provider offers the normal non-derivation suggestions

#### Scenario: Metadata and real assignment
- **WHEN** the block line prefix contains recognized metadata and an unquoted assignment outside that metadata
- **THEN** the provider offers derivation-rule suggestions rather than type and `Unused` entries

#### Scenario: Escaped and incomplete quoted text
- **WHEN** a string or backtick identifier includes doubled quote characters or remains unclosed at the cursor
- **THEN** `//` and `=` inside that quoted text are not interpreted as a comment marker or assignment
