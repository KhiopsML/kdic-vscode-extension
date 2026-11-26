# Proposal

## Why

The upcoming Khiops documentation describes instance-building rules in detail, but the extension does not currently register these rules. Their output mappings (`:`) and multi-table operands also exceed the assumptions of the current rule-call model, so adding signatures alone could lead to incomplete or misleading editor assistance and diagnostics.

## What Changes

- Add editor support for the instance-building rules documented in the Khiops documentation branch.
- Represent output-variable mappings and operands resolved in more than one source-table dictionary.
- Extend validation only for behavior verified against the target Khiops binary; leave uncertain cases unchecked.
- Add focused tests for completion, hover, parsing, operand scopes, and diagnostics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kdic-editor-support`: offer accurate completion, hover, and operand suggestions for documented instance-building rules.
- `kdic-built-in-validation`: parse their call forms and validate only arguments and scopes whose behavior is established.

## Impact

- `src/derivation-rules.ts`, rule-call parsing and scope resolution, and their editor consumers.
- Built-in validation and focused tests.
- No dependency or VS Code API changes are expected.
