# Spec Delta

## MODIFIED Requirements

### Requirement: Validation configuration
The extension SHALL expose settings for enabling native validation, controlling non-manual saves and debug traces, and locating Khiops. Built-in diagnostics SHALL always be enabled. Native diagnostics SHALL be available alongside them when native validation is active. The extension SHALL NOT expose a diagnostic source selector or use previously saved `kdic.diagnosticSource` values.

#### Scenario: Default settings
- **WHEN** no KDIC settings are overridden
- **THEN** native validation and validation on auto-save are enabled, built-in diagnostics are enabled, debug traces are disabled, and the explicit binary path is empty

#### Scenario: Source selection with an available binary
- **WHEN** a user or workspace has a previously saved `kdic.diagnosticSource` value and a binary is available
- **THEN** the value does not suppress either diagnostic source or bypass the built-in-error gate

### Requirement: Fallback to built-in validation
The extension SHALL use built-in validation when no native binary is available.

#### Scenario: Missing binary
- **WHEN** native validation is enabled and no binary is found
- **THEN** the extension warns the user and built-in diagnostics remain enabled

#### Scenario: Native validation disabled
- **WHEN** native validation is disabled
- **THEN** native runs are disabled and built-in validation remains enabled

### Requirement: Run on save
The extension SHALL run native validation on eligible saves of file-backed KDIC documents when native validation is active and built-in validation reports no errors.

#### Scenario: Manual save
- **WHEN** the user manually saves an eligible file while native validation is active and built-in validation reports no errors
- **THEN** the extension queues a native validation run

#### Scenario: Built-in errors in `both` mode
- **WHEN** an eligible save occurs and built-in validation reports one or more errors
- **THEN** the extension does not run Khiops for that save and clears existing native diagnostics for the document

#### Scenario: Built-in warnings in `both` mode
- **WHEN** an eligible save occurs and built-in validation reports warnings but no errors
- **THEN** the extension queues a native validation run

#### Scenario: Native-only source
- **WHEN** an eligible save occurs with native validation active, a previously saved `kdic.diagnosticSource` value of `khiops`, and built-in validation reports errors
- **THEN** the old value is ignored and the extension does not run Khiops for that save

#### Scenario: Non-manual save disabled
- **WHEN** `kdic.runKhiopsOnAutoSave` is false and the recorded save reason is non-manual
- **THEN** the extension skips the native run

#### Scenario: Non-file document
- **WHEN** a KDIC document without a `file` URI is saved
- **THEN** the extension does not run the native parser for it
