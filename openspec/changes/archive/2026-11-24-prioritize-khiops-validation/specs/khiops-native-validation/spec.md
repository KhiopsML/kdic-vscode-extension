# Spec Delta

## MODIFIED Requirements

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
