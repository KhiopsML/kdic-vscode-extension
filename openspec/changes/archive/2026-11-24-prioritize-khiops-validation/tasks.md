# Tasks

## 1. Gate native validation in `both` mode

- [x] 1.1 Evaluate built-in diagnostics for the current document on eligible saves in `both` mode; skip Khiops and clear stale native diagnostics only when errors exist, while preserving warning, source-selection, save-reason, and file-URI behavior. Verify with focused tests covering errors, warnings, and `khiops`-only mode.
- [x] 1.2 Prevent a native run started for an older document version from publishing diagnostics after the document has changed or a later save was blocked. Verify with a deterministic test for an out-of-date run.
- [x] 1.3 Update `README.md` and `README.extension.md` to explain that `both` mode runs built-in validation first and runs Khiops only when there are no built-in errors. Verify the setting descriptions and troubleshooting guidance remain consistent.

## 2. Locate native diagnostics

- [x] 2.1 Preserve explicit Khiops line locations and resolve no-line errors to a unique declaration using dictionary and variable names; retain the first-line fallback for missing, unmatched, or ambiguous names. Verify with representative output and document-text tests.
- [x] 2.2 Cover native error mapping for line-number, unique-name, and unresolved-name cases without requiring an installed Khiops executable. Verify the focused mapping tests pass.

## 3. Integration verification

- [x] 3.1 Run `npm test` and `openspec validate prioritize-khiops-validation --type change --strict`; verify compilation, existing tests, and all change artifacts pass.
