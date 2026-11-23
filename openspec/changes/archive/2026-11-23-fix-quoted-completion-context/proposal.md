# Proposal

## Why

The completion provider mistakes `//` and `=` inside quoted text for syntax, suppressing suggestions or selecting the wrong context. Issues #23 and #24 share the need to identify the lexical context at the cursor.

## What Changes

- Distinguish real line comments and derivation assignments from characters inside double-quoted strings and backtick-quoted identifiers, including doubled quote escapes and incomplete quoted prefixes.
- Preserve completion behavior for actual comments, assignments, recognized metadata, relation targets, and ordinary block contexts.
- Add focused regression tests for both issues and update the editor-support notes. Full VS Code host and TextMate integration testing remains separate in issue #26.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kdic-editor-support`: make comment and derivation-context completion decisions quote-aware.

## Impact

- Completion context detection in `src/extension.ts` and potentially shared lexical helpers.
- Focused automated tests and editor-support documentation.
- No change to diagnostics, highlighting, or the separately reported top-level `Unused` suggestion.
