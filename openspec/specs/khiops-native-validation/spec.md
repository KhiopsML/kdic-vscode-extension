# Native Khiops validation

## Purpose

Provide diagnostics from the native Khiops parser alongside the built-in KDIC diagnostics.

## Scope and verification

- Khiops is the authority for complete semantic validation. Language reference: [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/).
- `scripts/khiops-validation-test.js` covers the parsing of Khiops output. The save-time behavior (gating on built-in errors, serialized runs, stale documents, settings changes) is covered by `scripts/vscode-host-tests/`, which uses a mock Khiops executable. With `KDIC_VSCODE_CORPUS` set, the host tests also run the real Khiops on fixtures, to check that the errors for unknown variables land on the lines that use them and that a dictionary Khiops accepts clears them. Process failures, timeouts, and unusual paths are not covered.

## Requirements

### Requirement: Validation configuration
The extension SHALL expose settings for enabling native validation, controlling non-manual saves and debug traces, and locating Khiops. Built-in diagnostics SHALL always be enabled, and native diagnostics SHALL be available alongside them when native validation is active. The extension SHALL NOT expose a diagnostic source selector or use previously saved `kdic.diagnosticSource` values.

#### Scenario: Default settings
- **WHEN** no KDIC settings are overridden
- **THEN** native validation and validation on auto-save are enabled, debug traces are disabled, and the explicit binary path is empty

#### Scenario: Legacy source setting
- **WHEN** a user or workspace has a previously saved `kdic.diagnosticSource` value
- **THEN** the value does not suppress either diagnostic source or bypass the built-in-error gate

### Requirement: Binary discovery
The extension SHALL discover the native binary from an explicit path or platform-specific locations.

#### Scenario: Explicit setting
- **WHEN** `kdic.khiopsPath` names an existing file or a directory containing the platform binary
- **THEN** the extension uses that path for native validation

#### Scenario: No explicit setting
- **WHEN** `kdic.khiopsPath` is empty
- **THEN** discovery checks `KHIOPS_HOME/bin/MODL.exe` on Windows, `/Applications/Khiops.app/Contents/Resources/bin/MODL` on macOS, or `/usr/bin/MODL_openmpi` on Linux

#### Scenario: Explicit path not found
- **WHEN** a nonempty explicit path does not resolve to a binary
- **THEN** discovery does not try the automatic platform locations

### Requirement: Fallback to built-in validation
The extension SHALL keep built-in validation when no native binary is available.

#### Scenario: Missing binary
- **WHEN** native validation is enabled and no binary is found
- **THEN** the extension warns the user and built-in diagnostics remain enabled

#### Scenario: Native validation disabled
- **WHEN** native validation is disabled
- **THEN** native runs are disabled, existing native diagnostics are cleared, and built-in validation remains enabled

### Requirement: Run on save
The extension SHALL run native validation on eligible saves of file-backed KDIC documents when native validation is active and built-in validation reports no errors.

#### Scenario: Manual save
- **WHEN** the user manually saves an eligible file while native validation is active
- **THEN** once the saved file has been checked and validated by the built-in validator, the extension queues a native validation run unless that validation reports errors

#### Scenario: Built-in errors
- **WHEN** an eligible save occurs and built-in validation reports one or more errors
- **THEN** the extension does not run Khiops for that save and clears existing native diagnostics for the document

#### Scenario: Built-in warnings
- **WHEN** an eligible save occurs and built-in validation reports warnings but no errors
- **THEN** the extension queues a native validation run

#### Scenario: Edit before the run starts
- **WHEN** the document is edited after the save and before its native run starts or finishes
- **THEN** that run is not started, or its result is discarded

#### Scenario: Non-manual save disabled
- **WHEN** `kdic.runKhiopsOnAutoSave` is false and the recorded save reason is non-manual
- **THEN** the extension skips the native run

#### Scenario: Non-file document
- **WHEN** a KDIC document without a `file` URI is saved
- **THEN** the extension does not run the native parser for it

### Requirement: Native diagnostic mapping
The extension SHALL turn recognized native error output into VS Code error diagnostics with source `khiops`, placing each diagnostic at the reported line or at the declaration it identifies.

#### Scenario: Error with a line number
- **WHEN** captured output contains a recognized `error` line with a Khiops line number
- **THEN** the corresponding diagnostic is placed on that line using zero-based editor indexing

#### Scenario: Error identifies a dictionary and variable
- **WHEN** captured output contains a recognized non-summary error without a line number that identifies a dictionary and variable declared exactly once in the document
- **THEN** the corresponding diagnostic is placed on that variable's declaration line in that dictionary

#### Scenario: Error names a variable that is not declared
- **WHEN** captured output contains an error `Variable v not found (in dictionary D)` without a line number
- **THEN** the corresponding diagnostic is placed on the line of the use of `v` that Khiops looks up in dictionary `D`, the n-th such error of `v` going to its n-th use
- **AND** that is a use in a derivation of `D`, or in a derivation of another dictionary where a table or entity rule's operand is in the table `D` (an aggregation, `TableSelection`, `GetValue*`…), as the built-in validator resolves operands; a `.` before the operand sends it back to the dictionary above

#### Scenario: Error without a line number
- **WHEN** captured output contains a recognized non-summary error without a line number and it cannot be resolved to a declaration or a use
- **THEN** the corresponding diagnostic is placed on the first line

### Requirement: Debug traces
The extension SHALL write native-validation trace messages to the Khiops output channel when `kdic.enableDebugTraces` is enabled.

#### Scenario: Debug enabled
- **WHEN** debug traces are enabled and a native validation run starts
- **THEN** the output channel receives trace information about the run

## Known limitations

- Binary discovery checks existence, not successful execution. A process failure is traced only when debugging is enabled; parsed output can be empty, and the native diagnostic collection can then be cleared.
- A failure to write the temporary scenario file ends that run without a user-visible error.
- After a settings change, built-in diagnostics are revalidated immediately but native validation runs only on the next eligible save.
- If an auto-save has no recorded save reason, it is not skipped even when `kdic.runKhiopsOnAutoSave` is false.
