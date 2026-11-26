# Design

## Context

See `proposal.md` for motivation and the spec deltas for user-visible behavior. The current rule catalogue feeds completion, hover, argument typing, and operand scope lookup. Calls are parsed as comma-separated operands; a relational call can resolve at most one secondary dictionary from its first operand. Instance-building documentation adds output-name mappings after `:` and rules such as `BuildTemporalJoin` whose source expressions belong to two separate table dictionaries.

## Goals / Non-Goals

**Goals:**
- Keep one rule catalogue as the source for completion, hover, and validation metadata.
- Parse source expressions separately from target names in `:` mappings.
- Share correct source-scope resolution between diagnostics and operand completion.
- Check only behavior established by the documented signatures and the target Khiops binary.

**Non-Goals:**
- Implement a complete parser for all Khiops derivations or infer undocumented overloads.
- Require keys on target dictionaries used only to build in-memory instances; the existing relation checks already exclude derived relations from native key-length checks.
- Change the extension's general Khiops reference version as part of this rule-support change.

## Decisions

1. **Represent special call forms explicitly rather than approximating them with ordinary signatures.** Extend the call model to retain the `:` boundary and distinguish source operands from target names. Alternatives such as stripping the mapping suffix before validation or treating it as varargs would lose information and can silently misclassify operands.

2. **Describe source scopes per operand using the referenced table argument.** Preserve current-scope and unknown-scope behavior for existing rules, while allowing a rule to associate an operand with a particular `Table`/`Entity` argument. For `BuildTemporalJoin`, the source time expression resolves through the first table and the historical time expression through the third. A scope that cannot be resolved uniquely remains unchecked rather than falling back to the current dictionary.

3. **Resolve output names from the containing declaration's target dictionary.** The declared `Entity(TargetDic)` or `Table(TargetDic)` supplies the dictionary against which mapped names can be suggested and checked. These names are not source-variable operands. Rules without an output mapping keep the existing call behavior.

4. **Gate semantic diagnostics on evidence, not documentation-shaped assumptions.** Use the detailed documentation to define candidate signatures and editor descriptions, then verify diagnostics and scope semantics on the development Khiops binary. If a binary check is unavailable or inconclusive, retain completion/hover but leave the uncertain semantic check disabled; do not broaden corpus diagnostics based solely on a plausible signature.

5. **Keep integration independent of VS Code.** Put metadata and parsing/scope logic in the existing plain-TypeScript modules; the editor provider consumes the shared rule and scope information without adding `vscode` imports to validation code.

## Risks / Trade-offs

- **A partial parser could mistake target names for source operands** -> preserve the `:` delimiter in the call tree and test calls with zero, one, and multiple mapped outputs before registering rules.
- **A wrong table-scope association could create false diagnostics or suggestions** -> require a unique resolved table target and test each source operand against dictionaries with deliberately conflicting variable names.
- **Documentation may describe an in-development behavior not present in the available binary** -> keep uncertain checks unchecked and record the exact binary used for semantic validation.
- **The new rules may have overloads beyond the documented forms** -> register only measured/documented forms and leave unmatched calls unchecked.

## Migration Plan

No dictionary migration is required. Add rule metadata and parser/scope support together, then run focused unit tests, the existing test suite, and the corpus comparison. If a verified check changes corpus diagnostics, confirm every new error is rejected by the target Khiops binary before updating expectations.
