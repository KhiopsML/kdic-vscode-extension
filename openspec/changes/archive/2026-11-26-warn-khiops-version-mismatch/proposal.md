# Proposal

## Why

The extension's dictionary rules follow the documentation of Khiops 11.0.2, but native validation and dictionary creation use whatever Khiops the user installed. A visible comparison makes potential differences understandable without preventing users from using another version.

## What Changes

- Read the selected executable's version with `-v` before its first actual use for native validation or dictionary creation.
- Compare the complete reported version with the documentation reference, **11.0.2**, not with the 11.0.3-a.0 binary used for some behavior measurements.
- Warn on any difference, older or newer, including prerelease suffixes. Display both versions and explain that built-in support follows the reference documentation.
- Continue the requested operation without waiting for the user to dismiss the warning. Publish no version diagnostic.
- Share the check between both features, avoiding repeated probes and warnings for the same executable path during an extension session.
- If version detection fails, show an explicit non-blocking warning and put the reason and captured output in the shared Khiops output channel.
- Keep binary discovery and settings unchanged. No network request, new setting or dependency.

## Capabilities

### New Capabilities

- `khiops-runtime-compatibility`: compare the selected Khiops runtime with the extension's documented reference and report differences or detection failures across native operations.

### Modified Capabilities

None. Existing validation eligibility, diagnostic mapping and dictionary creation outcomes remain unchanged; the shared compatibility check is additive.

## Impact

- `src/khiops-runner.ts`: bounded `-v` execution and version parsing, preserving platform launch handling.
- `src/extension.ts`: one session-scoped check and notification function shared by `DiagnosticsController` and dictionary creation.
- `src/diagnostics-controller.ts`, `src/dictionary-creation.ts`: invoke the shared check before an eligible operation.
- Focused version tests, command mocks and the VS Code host runner: version output, failures, duplicate suppression and continued operation.
- `README.md`, `README.extension.md`, `.github/copilot-instructions.md`: describe the warning and keep the code's reference version in the existing reference-version update checklist.
- Depends on the implemented `create-dictionary-from-data-file` change, which already supplies the shared output channel and creation command; that change is complete but not yet archived.
