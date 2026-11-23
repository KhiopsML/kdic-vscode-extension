# Tasks

## 1. Scope-aware argument checks

- [x] 1.1 Add focused validator regression cases for `TableMean` with a conflicting local name and a secondary-only name, `TableDifference` with a wrong-type and an undeclared second local operand, a wrong first operand, an ordinary non-relational mismatch, and an uncertain-scope operand; verify the relevant diagnostic messages and severities.
- [x] 1.2 Add typed, shared rule/operand scope information using documented classifications and conservative unknown scope for unverified relational operands; verify representative `TableMean` and `TableDifference` classifications and that extension and smoke-test map construction receive the same data.
- [x] 1.3 Apply scope classification to simple-call argument checks while preserving existing return-type and other validation behavior; run `npm test` and verify the regression cases pass.
- [x] 1.4 Update the README and existing built-in-validation spec's limitation/TODO prose to reflect the implemented behavior and remaining unknown scopes; verify the descriptions match the tests without claiming full semantic validation.

## 2. Integration verification

- [x] 2.1 Run the compiled smoke-test CLI against a small temporary KDIC fixture containing the `TableMean` collision and a current-scope `TableDifference` mismatch; verify the former produces no local mismatch and the latter does, then remove the fixture.
- [x] 2.2 Run `npm test` and `openspec validate fix-secondary-operand-scope --strict --no-interactive`; review results and confirm no unrelated changes.
