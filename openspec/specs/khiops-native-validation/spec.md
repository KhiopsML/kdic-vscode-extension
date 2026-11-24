# Native Khiops validation

## Purpose

Provide optional diagnostics from the native Khiops parser alongside or instead of built-in KDIC diagnostics.

## Evidence and scope

- **Implementation inspected:** `src/extension.ts` and the configuration contributions in `package.json`.
- **Documented intent:** `README.md`, `README.extension.md`, and `.github/instructions/kdic-extension.instructions.md`.
- **Automated verification:** the repository's validator suite does not run VS Code, execute Khiops, or test native output parsing. All scenarios below describe inspected implementation and require integration testing.
- **Language reference:** [Khiops dictionary files](https://khiops.org/api-docs/kdic/dictionary-files/). Khiops is the documented authority for complete semantic validation.

## Requirements

### Requirement: Validation configuration
The extension SHALL expose settings for enabling native validation, choosing diagnostic sources, controlling non-manual saves and debug traces, and locating Khiops.

#### Scenario: Default settings
- **WHEN** no KDIC settings are overridden
- **THEN** native validation and validation on auto-save are enabled, the diagnostic source is `both`, debug traces are disabled, and the explicit binary path is empty

#### Scenario: Source selection with an available binary
- **WHEN** `kdic.diagnosticSource` is `extension`, `khiops`, or `both` and a binary is available
- **THEN** the extension enables the selected built-in, native, or both diagnostic sources respectively

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
The extension SHALL use built-in validation when no native binary is available.

#### Scenario: Missing binary
- **WHEN** native validation is enabled and no binary is found
- **THEN** the extension warns the user and enables built-in diagnostics even if `kdic.diagnosticSource` is `khiops`

#### Scenario: Native validation disabled
- **WHEN** native validation is disabled
- **THEN** native runs are disabled and built-in validation remains enabled, including when the selected source is `khiops`

### Requirement: Run on save
The extension SHALL run native validation on eligible saves of file-backed KDIC documents when native validation is active, subject to the selected diagnostic source and the built-in-error gate in `both` mode.

#### Scenario: Manual save
- **WHEN** the user manually saves an eligible file while native validation is active and either `kdic.diagnosticSource` is `khiops` or it is `both` with no built-in errors
- **THEN** the extension queues a native validation run

#### Scenario: Built-in errors in `both` mode
- **WHEN** an eligible save occurs in `both` mode and built-in validation reports one or more errors
- **THEN** the extension does not run Khiops for that save and clears existing native diagnostics for the document

#### Scenario: Built-in warnings in `both` mode
- **WHEN** an eligible save occurs in `both` mode and built-in validation reports warnings but no errors
- **THEN** the extension queues a native validation run

#### Scenario: Native-only source
- **WHEN** the user saves an eligible file while `kdic.diagnosticSource` is `khiops` and native validation is active
- **THEN** the extension queues a native validation run without using built-in diagnostics as a prerequisite

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
- **WHEN** captured output contains a recognized non-summary error without a line number that identifies a dictionary and variable declared in the document
- **THEN** the corresponding diagnostic is placed on that variable's declaration line in that dictionary

#### Scenario: Error without a line number
- **WHEN** captured output contains a recognized non-summary error without a line number and it cannot be resolved to a unique declaration
- **THEN** the corresponding diagnostic is placed on the first line

### Requirement: Debug traces
The extension SHALL write native-validation trace messages to the Khiops output channel when `kdic.enableDebugTraces` is enabled.

#### Scenario: Debug enabled
- **WHEN** debug traces are enabled and a native validation run starts
- **THEN** the output channel receives trace information about the run

## Divergences and open questions

- Binary discovery checks existence, not successful execution. A process failure is traced only when debugging is enabled; parsed output can be empty, and the native diagnostic collection can then be cleared. The fallback above applies to a missing path, not to an executable that fails after discovery.
- A failure to write the temporary scenario ends that run without a user-visible error. Native process failures, timeouts, and output parsing need integration tests before stronger reliability guarantees can be specified.
- The code revalidates built-in diagnostics after relevant settings change, but does not immediately run native validation on all open files; the next eligible save triggers it.
- Queued native runs are serialized. Behavior for a document closed or edited while a run is in flight, and for paths containing unusual characters, is not covered by the existing tests.
- If an auto-save has no recorded save reason, the code does not skip it solely because `kdic.runKhiopsOnAutoSave` is false.
