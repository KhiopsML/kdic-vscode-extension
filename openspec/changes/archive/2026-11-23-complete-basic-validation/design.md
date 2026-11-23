# Design

## Context

See the proposal and delta specification. The validator currently combines a block scan with line-based regular expressions. Braces are checked, but parentheses mainly control continuation and are clamped at zero; brackets and metadata value types are not fully checked. Key lookup skips absent declarations and splits keys on commas even in quoted names. Some scans do not consistently consume doubled backticks. The validator is also used by the standalone smoke test.

The local Khiops reference is `../khiops-doc/docs/api-docs/kdic/dictionary-files.md`; the local native lexer and grammar in `../khiops/src/Learning/KWData/KWCLex.lex` and `KWCYac.yac` can resolve details that the reference does not specify. Existing checks and the active-line missing-semicolon suppression must remain compatible.

VS Code normalizes isolated carriage returns into editor line endings. A generated dictionary containing such a character inside a quoted value is accepted by the standalone validator, but the normalized editor document produces cascading false diagnostics. The original character cannot be recovered from the normalized document alone.

## Goals / Non-Goals

**Goals:**
- Check the specified syntax across line breaks while preserving diagnostic offsets and existing callers.
- Cover all listed forms, including escaped and quoted identifiers, nested calls, and all three metadata types.

**Non-Goals:**
- Validate all KDIC semantics, secondary operand scopes, sparse-block `VarKey` rules, or all joins.
- Replace native Khiops validation or introduce a comprehensive VS Code host test suite.

## Decisions

### Use position-preserving lexical analysis and construct-aware parsing

Scan comments, quoted strings, backtick identifiers, doubled quote escapes, numbers, and punctuation with source offsets; quoted contents and comments do not contribute delimiters. Use a stack and enough construct context to distinguish key lists, external-key brackets, metadata, dictionary and sparse-variable blocks, and nested derivations. Recover after malformed input so diagnostics remain useful. Prefer this to adding independent regexes and depth counters: the latter cannot reliably handle nested, quoted, or multiline constructs.

Integrate with the existing validator rather than changing the public `validate()` signature or VS Code/native-parser configuration. Reuse shared lexical behavior where appropriate, but preserve the public offset-preserving `stripLineComments()` behavior. Avoid duplicate or contradictory diagnostics when replacing an existing check. Retain the current active-line and last-line suppression for missing variable semicolons.

### Resolve grammar details against the local native reference

Use the official local documentation and native lexer/grammar to establish exact numeric literals, metadata keys and values, name escaping, string concatenation, and declaration placement before implementing the tests. The reference documents scientific notation, `#Missing`, and doubled quotes but is not a complete lexical grammar. Do not equate an unknown identifier in an operand with an invalid unquoted string: it may be a variable. Do not impose semantic checks on secondary scopes as a side effect.

### Reconcile editor normalization with source text

For affected documents, establish a verified correspondence between source text and the VS Code document, preserving which original isolated carriage returns belong inside quoted text. Track unsaved document changes against that correspondence and translate validation locations back to the editor's positions. Refresh or invalidate the correspondence on save, reload, external changes, and close; version-check asynchronous work so stale source or diagnostics cannot overwrite newer edits. Honor the document's encoding and filesystem provider rather than assuming a local UTF-8 file.

When the source cannot be read, decoded, or reconciled reliably, explicitly report the limitation and do not validate against stale source. Keep normal validation and unfinished-declaration behavior for unaffected documents. Do not infer the original character solely from a normalized newline: doing so would hide genuine unterminated strings.

Verify this behavior with focused extension-host tests against an installed extension, including open, unsaved edits around and inside the affected value, save/reload, genuine malformed strings, and diagnostic positions. The standalone lexer and smoke-test interfaces remain supported.

### Test observable diagnostics, not parsing internals

Extend the existing standalone validator suite with focused valid/invalid pairs, severity and location checks, and multiline and quoted edge cases. Exercise errors on both opening and closing delimiters and key lookup with quoted commas and doubled backticks. Test continued editor typing separately from completed documents. Retain existing tests and use the smoke test on representative KDIC fixtures; when available, compare ambiguous forms against a native Khiops parser without making it a test prerequisite.

## Risks / Trade-offs

- [False errors in valid but complex syntax] → Test nested and multiline cases, comments, escaped delimiters, sparse blocks, and existing sample files; avoid claiming full semantic parsing.
- [Incomplete statements cause distracting errors] → Preserve the documented semicolon suppression and test active and last lines explicitly; keep unmatched-delimiter diagnostics actionable.
- [Changes to shared scanning regress validation or smoke tests] → Preserve offsets and API, run all existing tests and compare smoke-test results.
- [Reference and native implementation differ] → Record verified accepted forms and discrepancies in the evidence; do not silently assume undocumented grammar.
- [Editor normalization destroys source information] → Maintain and verify a source-to-editor correspondence, invalidate it on conflicting changes, and surface reconciliation failures rather than masking genuine errors.
