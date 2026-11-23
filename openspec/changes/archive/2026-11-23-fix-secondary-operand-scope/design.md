# Design

## Context

The shared validator builds argument types from rule signatures and currently treats a table/entity first parameter as evidence that later operands may be secondary, but only skips them when no local variable exists. The same type signature can describe rules with different operand scopes: `TableMean` reads a value in the secondary dictionary, whereas `TableDifference` combines table operands in the current dictionary. The smoke-test CLI also builds its maps from the extension's rule catalog.

The official [multi-table documentation](https://khiops.org/api-docs/kdic/dictionary-files/#derivation-rules-for-multi-table-schemas) describes secondary scope and the `.` upper-scope operator; the [table management reference](https://khiops.org/api-docs/kdic/table-management-rules/) describes table-combining rules.

## Goals / Non-Goals

**Goals:**
- Keep scope classification available to both the VS Code extension and the smoke-test CLI.
- Retain useful current-scope diagnostics while avoiding guesses about secondary operands.

**Non-Goals:**
- Build a complete parser, type-check secondary dictionaries, resolve nested expressions or implement `.` scope resolution.
- Verify every derivation-rule signature or alter native Khiops diagnostics.

## Decisions

### Classify scope by rule and operand

Represent scope as current, secondary, or unknown per operand of a registered rule. Use Khiops documentation or other authoritative evidence for classifications: in particular, `TableMean`'s second operand is secondary and `TableDifference`'s second operand is current. Do not infer the scope of every later operand from the first parameter's type. For relational rules without reliable scope evidence, classify later operands as unknown, not current or secondary. Ordinary non-relational rules retain current-scope checking.

Alternatives: skipping every operand after a table/entity loses legitimate current-scope checks; looking up names in the local dictionary can produce the original false error; resolving all secondary scopes requires a broader parser.

### Check only reliable current-scope operands

For bare identifiers in simple calls, retain existing type errors and missing-variable warnings for known current-scope operands, including the first table/entity operand. Skip both local type comparison and local undeclared warnings for secondary or unknown scope; do not claim those operands are valid. Keep existing handling of constants, blocks, varargs, unrecognized rules, and nested expressions unless a specific scope classification requires otherwise.

### Share the classification with both consumers

Keep the scope information in or adjacent to the existing rule definitions, with a typed representation that can be consumed by `validate`. Ensure extension and smoke-test construction use the same information; the CLI's current line-based extraction must not silently discard it. Avoid duplicating an independent rule-scope catalog between consumers.

## Risks / Trade-offs

- [Unknown scope may suppress an existing legitimate diagnostic] → Classify documented current-scope cases explicitly and test `TableDifference` as well as ordinary rules. Leave uncertain cases to Khiops rather than report speculative errors.
- [Catalog metadata can drift from Khiops semantics] → Document the basis for classifications, and leave unsupported cases unknown. Test representative production rules through both consumers.
- [Main spec contains a TODO and limitation describing the old behavior] → During implementation update those notes to describe the actual remaining limits; synchronization of the delta alone will not update non-requirement prose.
