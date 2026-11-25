# KDIC built-in validation

## Purpose

Report common structural and type problems while editing a Khiops dictionary, without depending on the native Khiops binary.

## Scope and verification

- Validation is best-effort and structural. It does not claim to be a complete parser: the native Khiops parser remains authoritative for secondary-table scopes, joins, and complex block contents.
- Language reference: [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/) and [variable blocks](https://khiops.org/api-docs/kdic/intro-block/).
- `npm test` runs `scripts/validator-test.js` (examples of every requirement below, mostly matching message fragments) plus the editor-document lifecycle tests. `scripts/smoke-test.js` validates every `.kdic` file of a directory; on the local LearningTest corpus (3,362 files) it is the regression reference, with `corpus-expectations.json` recording the known diagnostics and whether Khiops itself rejects each file.
- `scripts/vscode-host-tests/` exercises the packaged extension in a real VS Code (see `README.md`): diagnostic positions after edits, save, external changes, and files with isolated carriage returns. With `KDIC_VSCODE_CORPUS` set to a directory of real dictionaries, it also checks that each file opened shows exactly the diagnostics of the validator.

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
- **WHEN** a nonempty, non-continuation line does not match the applicable structural patterns, and is not reported as a statement that does not start with a type (below)
- **THEN** the validator reports a warning: the patterns are not a full grammar, and an error would stop Khiops from running on save

#### Scenario: Statement that does not start with a type
- **WHEN** a statement of a dictionary or of a variable block starts with a word that is not a type (a misspelled `Categorial`, `Unuset` or `numerical`, a word before the type as in `Foo Numerical x;`, a stray word), or with `Unused` followed by a word that is not a type
- **THEN** the validator reports an error on that word, and no unknown-line warning on its line
- **AND** `Root` and `Dictionary` there are left to the checks of the braces, and the first word of a derivation that continues on a following line is not a statement start

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

#### Scenario: Names used twice
- **WHEN** a name is used by two variables of a dictionary (a block member counts, `Unused` and backquotes do not matter, case does), by a variable and a variable block, or by two variable blocks; or two dictionaries have the same name
- **THEN** the validator reports an error on the second use
- **AND** the same name in two dictionaries, or names that differ by their case, are not reported

#### Scenario: Space at the end of a name
- **WHEN** a dictionary name, a variable block name or the name of the dictionary in `Table(X)` or `Entity(X)` starts or ends with a space (written between backquotes)
- **THEN** the validator reports an error; a space inside a name is accepted

#### Scenario: Keys of the multi-table schema
- **WHEN** a `Root` dictionary has no key, or a native relation (`Table(X)` or `Entity(X)`, without `[key]`, without a derivation, outside a variable block, `Unused` or not) has a root dictionary as its target
- **THEN** the validator reports an error
- **WHEN** a dictionary is a root or is reached from a root through native relations, and the dictionary of one of its native relations has no key, has a key shorter than its own, or has the same key length while the relation is a `Table` and that dictionary has native relations of its own
- **THEN** the validator reports an error on the target of the relation
- **AND** an `Entity` relation does not need the longer key, and dictionaries not reached from a root are not checked

#### Scenario: External entity
- **WHEN** a variable has a key between brackets, `Entity(X) name [key, …]`
- **THEN** the validator reports an error if it is not an `Entity`, if `X` is not a root dictionary, or if the number of keys (each of which may be a computed expression) differs from that of `X`
- **AND** an external entity is not part of the key hierarchy above

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

#### Scenario: Word after a variable name
- **WHEN** a declaration has a second word where `;` or `=` is expected, as in `Categorical bad name;` or `Date Categorical `X` ;`
- **THEN** the validator reports an error on that second word
- **AND** any word, a keyword such as `Categorical`, `Unused` or `Root` included, is a valid variable name, as for Khiops: the first word is not reported as an invalid name, and a name repeated by such declarations is not reported as used twice

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

#### Scenario: Block closing with blanks
- **WHEN** a block closes with `} Name ;`, blanks (spaces or tabs) between the name and the semicolon, with or without a derivation and with metadata after the semicolon, as Khiops writes it
- **THEN** the validator reports nothing

#### Scenario: Key of each member
- **WHEN** a member of a variable block has no `VarKey` tag, a `VarKey` that is a number outside 1 to 1,000,000,000 or not an integer, an empty string, a kind (integer or string) different from the first key of the block, or a value already used by another member of the same block
- **THEN** the validator reports an error on the member or on the value
- **AND** the same key in two different blocks, a `VarKey` outside a block, and a `<VarKey>` without a value are not reported

#### Scenario: Default value of a block
- **WHEN** the tags after the closing `;` of a block of `Numerical` variables hold `DefaultNumericalValue` with something other than a number, or `DefaultCategoricalValue`; or those of a block of `Categorical` variables hold `DefaultCategoricalValue` with a number, or `DefaultNumericalValue`
- **THEN** the validator reports an error on the tag; blocks of other or mixed types are not checked

### Requirement: Derivation type checks
The validator SHALL compare the rule calls of derivations (`= rule(arg, …)`), including the calls nested in their arguments, with registered rule types, without claiming complete derivation analysis. A variable argument SHALL be looked up in the dictionary where its scope resolves it: the current dictionary, or, for an operand documented as secondary, the dictionary that the first operand's `Table(X)` or `Entity(X)` points to. An operand whose scope is not known SHALL NOT be checked against any dictionary.

#### Scenario: Return type mismatch
- **WHEN** a call to registered `TableCount` is assigned to a `Categorical` variable
- **THEN** the validator reports a return-type error

#### Scenario: Argument mismatch
- **WHEN** a `TableCount` call uses a declared `Categorical` variable as its first argument
- **THEN** the validator reports an argument-type error

#### Scenario: Constant argument mismatch
- **WHEN** a call passes a string constant where the rule expects `Numerical`, or a number or `#Missing` where it expects `Categorical`, at any position and whatever the operand scope
- **THEN** the validator reports an error on the constant, naming its type, the rule, the expected type and the argument number
- **WHEN** the constant has the expected type, or the parameter is of another type
- **THEN** the validator reports nothing

#### Scenario: Rule with a variable number of arguments
- **WHEN** a rule ends with `...` and all its other parameters have a concrete type, such as `Sum(Numerical value1, ...)` or `Concat(Categorical value1, ...)`
- **THEN** every extra argument is checked against the type before `...`, for variables and constants alike
- **WHEN** a parameter of the rule is `any` or a structure, such as `DataGridDeployment`
- **THEN** the extra arguments are not checked

#### Scenario: Call that the signature does not describe
- **WHEN** a call has fewer arguments than the rule has parameters, as a rule that also exists in a shorter form (`ContributionValueAt` with a rank only), or more arguments than a rule without `...` has
- **THEN** its arguments are not type-checked and their scope is unknown, since their positions do not match the registered signature

#### Scenario: Missing argument variable
- **WHEN** a call has a current-scope bare identifier argument with a known expected type that is not declared in the current dictionary
- **THEN** the validator reports an undeclared-variable warning

#### Scenario: Backquoted variable argument
- **WHEN** a call has a current-scope argument written between backquotes, such as `` `Predicted class` ``
- **THEN** it is checked like a plain variable, by its name without backquotes (a doubled backquote standing for one), and the diagnostics name it that way

#### Scenario: Separators inside quoted arguments
- **WHEN** a string argument contains commas, or a backtick-quoted argument contains parentheses
- **THEN** those characters neither split the argument nor hide the call from the checks

#### Scenario: Secondary operand with a conflicting local name
- **WHEN** `TableMean(achats, montant)` uses `achats` as a table and the current dictionary declares a `Categorical montant` while the secondary dictionary declares a `Numerical montant`
- **THEN** the validator does not report an argument-type error based on the current dictionary's `montant`

#### Scenario: Secondary operand
- **WHEN** an operand documented as secondary names a variable of the dictionary that the first operand's `Table(X)` or `Entity(X)` points to, plainly or between backquotes
- **THEN** its type is compared with the expected one, and a mismatch is an error
- **WHEN** it names a variable that dictionary does not declare, including one of the current dictionary
- **THEN** the validator reports a warning naming that dictionary
- **WHEN** the operand is a nested call
- **THEN** the variables of the calls nested in it are looked up in that dictionary too, and so are those of a nested table rule's own current-scope operands

#### Scenario: Operand documented as current after the first
- **WHEN** an operand of a table rule after the first is documented as current, as the rank of `TableAt` or the keys of `TableAtKey`
- **THEN** it is checked in the current dictionary

#### Scenario: Scope operator
- **WHEN** an operand is a variable or a call written behind one or more dots, such as `.name`, `..name` or `.rule(…)`, with or without a space after them
- **THEN** it is resolved as many scopes above the one its operand is written in as it has dots: the scope the enclosing table rule is evaluated in for one dot
- **WHEN** it is a variable, its type is compared with the expected one, and a name that scope does not declare is a warning naming it
- **WHEN** it is a call, its result is compared with the expected type and its own operands, which have no dots, are resolved in that upper scope
- **WHEN** an operand has dots inside a call that is itself behind dots
- **THEN** its dots are counted from where the whole operand is written, not from the call's scope

#### Scenario: Scope operator beyond the outermost scope
- **WHEN** an operand has more dots than there are scopes above the one it is written in, as in `Sum(.Age, 1)` at the top level
- **THEN** the validator reports an error on the dots, as Khiops does
- **WHEN** the scopes above are not known, because the table of an enclosing rule is not resolved or its rule is not registered
- **THEN** the validator reports nothing

#### Scenario: Scope that cannot be resolved
- **WHEN** the first operand of the rule is not a variable of the scope, is not a table or entity, or points to a dictionary that is not declared exactly once in the file
- **THEN** the operands documented as secondary are not checked against any dictionary

#### Scenario: Later current-scope operand
- **WHEN** `TableDifference(first, second)` has `first` declared as a table and `second` declared as `Categorical` in the current dictionary
- **THEN** the validator reports an argument-type error for `second`

#### Scenario: Uncertain operand scope
- **WHEN** a recognized call has an operand whose scope cannot be determined reliably
- **THEN** the validator does not issue a type mismatch or undeclared-variable warning for that operand based on the current dictionary

#### Scenario: Nested call result
- **WHEN** a call is an argument of a registered rule whose parameter at that position is a concrete type (not `any`, a structure or a block), and the nested rule is registered with a return type that does not include that type
- **THEN** the validator reports an error on the nested rule's name, naming its return type, the enclosing rule, the expected type and the argument number
- **WHEN** the nested rule returns several possible types, one of which is the expected type, or returns `any`
- **THEN** the validator reports nothing

#### Scenario: Calls nested in a nested call
- **WHEN** a derivation nests calls at any depth
- **THEN** every call is checked against its own parameters: its constants, its nested results and, where it is in the current scope, its variables
- **WHEN** the declared variable's type differs from the type returned by the outermost rule
- **THEN** the validator reports the return-type error, however deeply the derivation is nested

#### Scenario: Scope of a nested call
- **WHEN** a call is inside an operand of a table or entity rule that lives in the secondary table, or inside the operand of a rule that is not registered
- **THEN** its variables are not checked against the current dictionary, since their scope is unknown
- **THEN** its constants and the results of the calls nested in it are still checked, which holds in any scope

#### Scenario: Call not closed
- **WHEN** a call is not closed before the end of its statement, as while it is being typed, or is nested more than 100 levels deep
- **THEN** the validator does not type-check it

### Requirement: Standalone smoke test
The smoke-test CLI SHALL validate `.kdic` files recursively using the compiled validator and rule definitions.

#### Scenario: Errors only
- **WHEN** the CLI runs with `--errors-only`
- **THEN** it omits warnings from the report and exits with status 1 if reported errors exist, otherwise 0

#### Scenario: Missing compiled validator or target
- **WHEN** the compiled validator or target directory does not exist
- **THEN** the CLI reports the problem and exits with status 2

#### Scenario: Comparison with the known diagnostics of a corpus
- **WHEN** the CLI runs with `--expected <file>`, a JSON file listing, by path relative to the directory, the exact diagnostics of each file that has some
- **THEN** it reports the files whose diagnostics differ (new, changed, no longer having any), ignores the entries of files that are not in the directory, and exits with status 1 if anything differs, otherwise 0
- **AND** `--errors-only` cannot be combined with it, nor can `--update-expected`; a missing file or option value exits with status 2

#### Scenario: Updating the known diagnostics
- **WHEN** the CLI runs with `--update-expected <file>`
- **THEN** it rewrites the file from the current diagnostics, keeping the Khiops verdict and the note of the files already listed and the entries of files that are not in the directory
- **AND** for each file it does not know yet it runs the Khiops binary and records `rejects` or `accepts` (`unknown` when Khiops is not found or takes too long), then lists the files that have an error although Khiops accepts them

## Known limitations

- Variable blocks whose members are `Table` variables, blocks derived by a rule, and the rules that read or build a block (`CopyBlock`, `DataGridBlock`, `TablePartition…`) are not checked beyond the keys above: that the rule and its input blocks agree on the `VarKey` type and values is left to Khiops.
- Joins and the complete grammar are not validated; a constant behind a dot, which Khiops rejects, is not reported; absence of a diagnostic does not establish Khiops validity.
- The `#Khiops` header line and dictionary metadata are accepted as structural patterns; their exact compatibility with native Khiops is not established.
- Rule signatures are registered one per rule: a rule that exists with different parameter lists is only checked when called with all the registered parameters. The operand scopes of a rule are registered only for the table and entity rules that were measured on Khiops (`operandScopes`); the operands of the others, such as `TableModeAt`, `TableUnion` or `GetEntity`, are not type-checked. The parameters of the rules that build structures (`DataGrid`, `ValueGroups`, `NBClassifier`, …) are declared `Structure(…)` and are registered as `any`, so the calls nested in them are not compared.
- A declaration the structure scan cannot recognize (for example junk before its type on the same line) is reported as an unknown line, and is not type-checked.
- Native Khiops checks a date or time format only loosely (length, field positions and separators), so it accepts a few garbled variants of a time or timestamp format, such as `HH:MM:Ss` or `HH.MM ` with a trailing space. The built-in check reports every string outside the documented formats, so it can flag a format that Khiops would load.
