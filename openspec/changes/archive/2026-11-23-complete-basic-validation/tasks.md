# Tasks

## 1. Reference and lexical foundation

- [x] 1.1 Review each check listed in issue #21 against the current validator and the local Khiops documentation and native lexer/grammar; record the supported forms, confirmed gaps, and any reference discrepancies in the validation evidence.
- [x] 1.2 Implement position-preserving lexical analysis for comments, strings, backtick names, doubled escapes and tokens; add focused valid/invalid tests and verify existing comment-stripping behavior and offsets remain unchanged.

## 2. Structural validation

- [x] 2.1 Check balanced and correctly nested dictionary/block braces, key and derivation parentheses, and external-entity key brackets across lines; test unmatched openers and closers, nested calls, quoted delimiters, comments, and diagnostic locations.
- [x] 2.2 Check variable and dictionary terminators across supported layouts; test metadata and comments, multiline declarations, active cursor and last-line suppression, and retain existing semicolon regressions.
- [x] 2.3 Validate boolean, numeric, and quoted-string metadata including angle brackets; test valid forms, escaped quotes, malformed values and delimiters, comments, and multiline declarations against the verified grammar.
- [x] 2.4 Update structural and metadata validation evidence as checks land, distinguishing automated coverage from remaining limitations.

## 3. Names, keys, and constants

- [x] 3.1 Validate names and match every dictionary key against its declaration, including categorical and non-derived constraints; test absent keys, quoted commas, doubled backticks, invalid names, name length, and multiline keys.
- [x] 3.2 Validate categorical and numerical derivation constants in nested and multiline calls according to the verified grammar; test scientific notation, `#Missing`, doubled quotes, string concatenation, malformed literals, and bare variable operands.
- [x] 3.3 Update key, name, and constant validation evidence and limitations, retaining the separate sparse-block `VarKey` and cross-table semantic limitations.

## 4. Integration verification

- [x] 4.1 Run `npm test` and the smoke test on representative KDIC fixtures; compare with the baseline for unintended diagnostic changes and resolve regressions.
- [x] 4.2 Run `openspec validate complete-basic-validation --strict --no-interactive` and verify all scenarios and documentation are consistent with the implemented behavior.

## 5. VS Code normalization

- [x] 5.1 Preserve and reconcile isolated carriage returns from source text with VS Code documents, including unsaved edits and diagnostic locations; add focused tests for valid and genuinely malformed quoted values.
- [x] 5.2 Handle save, reload, document closure, asynchronous races, encodings, and unavailable or unreconciled source without stale diagnostics; test these paths and document any explicit limitations.
- [x] 5.3 Test the installed extension in a VS Code host using the affected real fixture and editing scenarios, rerun `npm test` and representative smoke tests, and validate the change with `openspec validate complete-basic-validation --strict --no-interactive`.
