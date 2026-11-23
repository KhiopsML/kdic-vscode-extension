# Proposal

## Why

The built-in validator can report a false type error when a secondary-table operand has the same name as a differently typed variable in the current dictionary. Issue #25 also requires retaining useful checks for operands that actually belong to the current scope.

## What Changes

- Classify simple-call operands by rule and position rather than assuming every operand after a `Table` or `Entity` parameter has the same scope.
- Avoid type errors and undeclared-variable warnings based on the current dictionary for secondary-scope or unknown-scope operands. Preserve checks for verified current-scope operands.
- Add focused regression tests and update documentation to explain remaining limits. Full secondary-dictionary type resolution, nested expressions, and complete Khiops semantics remain out of scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kdic-built-in-validation`: make simple argument diagnostics respect known operand scopes and avoid unsupported scope assumptions.

## Impact

- Shared validator and rule metadata, extension integration and standalone smoke test as needed.
- Validator regression tests and built-in-validation documentation.
- Native Khiops validation remains unchanged and authoritative for complete semantics.
