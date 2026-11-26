# Tasks

## 1. Parse instance-building call forms

- [x] 1.1 Extend the rule-call representation to preserve the `:` boundary and distinguish source operands from output names; add focused parser/validator tests for zero, one, and multiple mapped outputs and run `npm test`.

## 2. Resolve source and target scopes

- [x] 2.1 Generalize rule operand-scope metadata to identify the relevant input table for each source operand; add tests with conflicting variable names in the current, source, and historical dictionaries and verify both diagnostics and completion use the documented scope.
- [x] 2.2 Resolve output names after `:` against the target dictionary of the containing `Entity` or `Table` declaration; add target-variable completion and validation tests and run `npm test`.

## 3. Register documented instance-building rules

- [x] 3.1 Add the documented instance-building rule definitions, signatures, categories, and concise hover documentation to the shared catalogue; verify completion and hover coverage for each supported rule with the focused editor tests.

## 4. Verify semantic checks and regressions

- [x] 4.1 Measure argument types, result types, output mappings, and placement restrictions on the development Khiops binary; add validator tests only for confirmed behavior and leave inconclusive cases unchecked.
- [x] 4.2 Run `npm test`, `npm run compile`, and `node scripts/smoke-test.js --expected corpus-expectations.json`; verify no newly reported built-in error disagrees with the target Khiops binary and update expectations only for confirmed behavior changes.
