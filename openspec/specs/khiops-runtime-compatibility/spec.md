# khiops-runtime-compatibility Specification

## Purpose
Inform users when their selected Khiops runtime differs from the documentation reference used by the extension, without preventing native validation or dictionary creation.

## Requirements

### Requirement: Documented reference version
The extension SHALL compare the runtime with the Khiops documentation version it targets, initially 11.0.2, rather than with the version used for individual behavior measurements.

#### Scenario: Measurement binary differs from documentation
- **WHEN** the installed runtime reports 11.0.3-a.0 and the documentation reference is 11.0.2
- **THEN** the comparison uses 11.0.2 as the reference

### Requirement: Probe the selected runtime
Before an eligible native validation or confirmed dictionary creation, the extension SHALL obtain the selected executable's version using `-v`. Detection SHALL finish or fail within five seconds. It SHALL use the same executable and platform launch conventions as the requested operation, without network access.

#### Scenario: First native validation
- **WHEN** a found binary is about to validate an eligible saved dictionary
- **THEN** the extension checks that binary's version before running the validation scenario

#### Scenario: Creation with validation disabled
- **WHEN** native validation is disabled and the user confirms an eligible dictionary creation
- **THEN** the extension checks the creation binary's version before running the creation scenario

#### Scenario: No native operation
- **WHEN** no binary is found, validation is skipped by its existing eligibility rules, or the user cancels creation before its scenario starts
- **THEN** that action starts no version probe

### Requirement: Exact version comparison
The extension SHALL compare the complete version identifier, ignoring the surrounding product label and whitespace but preserving prerelease and build suffixes. A different patch, minor, major or suffix SHALL count as a difference, regardless of which version is newer.

#### Scenario: Matching release
- **WHEN** the runtime returns `Khiops 11.0.2` with trailing whitespace or a CRLF terminator
- **THEN** no version mismatch warning is shown

#### Scenario: Different release
- **WHEN** the runtime version is 10.3.2, 11.0.3 or 12.0.0
- **THEN** the extension reports a mismatch with 11.0.2

#### Scenario: Prerelease or build identifier
- **WHEN** the runtime version is 11.0.2-a.0 or 11.0.2+custom
- **THEN** the extension reports a mismatch with 11.0.2

### Requirement: Non-blocking mismatch warning
For a mismatch, the extension SHALL show a warning containing the detected version and documentation reference and explaining that built-in support follows that reference. It SHALL continue the requested operation without waiting for dismissal, SHALL NOT add version diagnostics, and SHALL NOT disable or adapt built-in validation.

#### Scenario: Validation with a mismatch
- **WHEN** an eligible native validation detects a version mismatch
- **THEN** a warning shows both versions and the requested validation continues under its existing diagnostic and stale-result rules

#### Scenario: Creation with a mismatch
- **WHEN** a confirmed dictionary creation detects a version mismatch
- **THEN** a warning shows both versions and creation continues under its existing success, error and overwrite rules

### Requirement: Version detection failure
If the probe cannot start, times out, exits unsuccessfully or supplies no unambiguous supported version identifier, the extension SHALL warn that the version could not be determined. It SHALL write the executable path, reason and captured output to the Khiops output channel even with debug traces off, and SHALL continue the requested operation without waiting for dismissal.

#### Scenario: Failed version command
- **WHEN** the version command cannot start, exceeds five seconds or returns a non-zero status
- **THEN** the extension shows a detection warning, records the failure details and still attempts the requested operation

#### Scenario: Unrecognized output
- **WHEN** the version command exits successfully with empty, malformed or conflicting version output
- **THEN** the extension reports an unknown version rather than assuming a match
- **AND** the requested operation continues

### Requirement: Shared session check
During one extension activation, the extension SHALL probe and report at most once per resolved executable path across validation and creation, including concurrent requests and detection failures. A different path SHALL have an independent check. Restarting the extension SHALL allow a fresh check.

#### Scenario: Repeated and concurrent operations
- **WHEN** several eligible saves or creations use the same executable path during the same activation
- **THEN** they share a single version probe and at most one mismatch or detection-failure warning

#### Scenario: New configured path
- **WHEN** a later eligible operation uses a different executable path
- **THEN** the extension performs a separate check for that path

#### Scenario: Return to a checked path
- **WHEN** the configuration returns to a path already checked in the same activation
- **THEN** that path is not probed or warned about again

### Requirement: Version check visibility
The extension SHALL offer Show Output on version warnings and record both versions and the binary path for a mismatch in the shared Khiops output channel. With debug traces enabled it SHALL also trace the version command and its captured output. This check SHALL introduce no setting and SHALL leave binary discovery unchanged.

#### Scenario: Inspecting a warning
- **WHEN** the user selects Show Output on a version warning
- **THEN** the shared Khiops output channel is revealed with the comparison or failure details

#### Scenario: Debug traces enabled
- **WHEN** debug traces are enabled and a version probe runs
- **THEN** its command line and captured output appear in the shared Khiops output channel
