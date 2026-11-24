# Proposal

## Why

Selecting between three diagnostic modes adds configuration and conditional code. A single combined behavior makes validation simpler and consistent across installations.

## What Changes

- **BREAKING** Remove `kdic.diagnosticSource`; existing values are ignored.
- Always show built-in diagnostics and retain native Khiops diagnostics when native validation is enabled and a binary is available.
- Preserve the current combined-mode save behavior: built-in errors prevent a native run, while warnings do not.
- Keep the independent native-validation, auto-save, executable path, and debug settings.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `khiops-native-validation`: Replace selectable diagnostic sources with the existing combined behavior.

## Impact

- Extension configuration and diagnostic lifecycle, native-validation helper and tests.
- User documentation and maintainer instructions.
- Users with an existing source selection will see the combined behavior; native validation can still be disabled separately.
