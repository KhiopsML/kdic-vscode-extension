# Proposal

## Why

Issue #21 asks for a review of basic KDIC checks when Khiops is unavailable. The built-in validator covers some cases but does not consistently validate delimiters, metadata, names, constants, and keys across the constructions listed in the issue.

## What Changes

- Review and complete validation of dictionary and variable-block braces, key and derivation parentheses, external-entity key brackets, and metadata angle brackets.
- Validate the three metadata forms, declaration terminators, key-field declarations and constraints, quoted names, categorical constants, and numerical constants including `#Missing`.
- Support valid multiline and nested forms, quoting, escaped quotes, and comments without mistaking their contents for syntax; preserve the existing unfinished-declaration editing behavior.
- Preserve the meaning of isolated carriage returns in quoted text when VS Code normalizes line endings, including while editing without saving.
- Add regression tests for valid and invalid forms and update the validation evidence and limitations.
- Include focused tests in a VS Code extension host for the affected editing behavior. Limit completeness to the constructions in issue #21; native Khiops remains authoritative for other syntax and semantics. A prompt-based maintenance approach and a comprehensive VS Code host test suite are outside this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kdic-built-in-validation`: complete basic structural and lexical checks for the constructs listed in issue #21.

## Impact

- Shared validator and its standalone and editor consumers, including VS Code document integration.
- Validator regression tests and validation documentation.
- More built-in diagnostics for malformed inputs; no change to native Khiops integration.
