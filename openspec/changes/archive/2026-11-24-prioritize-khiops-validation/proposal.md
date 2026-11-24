# Proposal

## Why

With both diagnostic sources enabled, the extension currently runs Khiops on save even when its built-in validator has already found errors, producing redundant messages. Native errors without a line number are also placed at the start of the file, although Khiops often identifies the dictionary and variable involved.

## What Changes

- In `both` mode, use built-in errors as the first validation step and run Khiops on an eligible save only when that validation reports no errors.
- When native validation is skipped because built-in errors exist, clear any stale Khiops diagnostics for the document.
- Improve native diagnostic locations: keep line-number locations and use dictionary/variable names from Khiops output to locate the corresponding variable declaration when no line number is available.
- Preserve the explicit behavior of `extension`-only and `khiops`-only modes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `khiops-native-validation`: gate native validation on built-in errors in `both` mode and improve locations for native diagnostics without line numbers.

## Impact

- `src/extension.ts`: validation coordination on save and native output-to-diagnostic mapping.
- Native validation specs and focused tests for gating, stale diagnostics, and location mapping.
- No setting names or defaults change; explicit single-source modes retain their current behavior.
