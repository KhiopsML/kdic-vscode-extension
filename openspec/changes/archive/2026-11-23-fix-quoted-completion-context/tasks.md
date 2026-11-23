# Tasks

## 1. Quote-aware completion

- [x] 1.1 Add focused regression cases for `//` and `=` in double-quoted and backtick-quoted prefixes, doubled escapes and incomplete quotes; confirm the current behavior fails the relevant cases.
- [x] 1.2 Implement quote-aware analysis for actual comments, assignments and recognized metadata; verify lexical cases and existing comment-stripping/validator tests pass.
- [x] 1.3 Connect the analysis to the completion provider; test actual returned items for quoted markers, a later real comment, metadata plus assignment, and existing block and relation-target contexts.
- [x] 1.4 Update editor-support evidence and remove only the two resolved TODO notes; verify issue #26 and the unrelated `Unused` note remain accurately documented.

## 2. Integration verification

- [x] 2.1 Run the project's automated tests and `openspec validate fix-quoted-completion-context --strict --no-interactive`; verify compilation, regression tests and specification validation all pass.
