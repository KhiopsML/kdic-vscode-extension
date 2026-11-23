# Design

## Context

The provider checks the current line prefix for `//` with a raw substring search, then detects derivation context with `includes('=')` after removing recognized metadata. The validator already has a comment stripper, but its output alone is insufficient to identify unquoted assignments and it must retain its existing offset-preserving behavior.

## Goals / Non-Goals

**Goals:**
- Base both completion decisions on lexical context up to the cursor, including partially typed lines.
- Preserve existing suggestion lists and context priority outside the two reported defects.

**Non-Goals:**
- Implement a full KDIC parser or change validation, grammar highlighting, or the top-level `Unused` suggestion.
- Implement the broader extension-host and TextMate test infrastructure tracked by issue #26.

## Decisions

### Analyze the line prefix with shared quote-aware logic

Use one focused, testable analysis of the prefix to distinguish normal text, double-quoted strings, backtick identifiers, doubled quote escapes, and a real `//` comment. Recognize metadata only outside quoted text and exclude the `=` in recognized metadata from assignment detection. Handle unclosed quotes as still quoted at the cursor. Reuse existing lexical helpers where appropriate without changing their public behavior; avoid separate ad hoc searches for each marker.

Keep the provider's relation-target and block-context logic in place; replace only the comment and assignment decisions. Do not remove metadata-like text inside a string before processing quotes. A literal `//` in quoted content must not hide a later real comment.

### Verify the provider decision as well as lexical cases

Add focused automated tests that exercise the resulting context decisions and the completion provider's returned items, using existing tooling or a minimal VS Code mock if necessary. Test true comments, real assignments, recognized metadata, relation targets, quoted and incomplete text, doubled quotes, and a real comment after quoted text. Do not equate mocked-provider tests with an extension-host integration suite.

## Risks / Trade-offs

- [Editing in partially typed strings can end at a quote escape boundary] → Test cursor prefixes inside and after doubled quotes in both quoting styles.
- [Metadata detection may accidentally consume text inside quotes or hide a real assignment] → Test quoted metadata-looking text, metadata followed by an assignment, and metadata containing quoted delimiters.
- [A shared helper change could affect diagnostics] → Preserve offset and comment-stripping behavior and run existing validator regression tests.
- [The main spec contains TODO prose separate from its requirement] → Remove only the two addressed TODOs during implementation and retain issue #26 and the unrelated `Unused` note.
