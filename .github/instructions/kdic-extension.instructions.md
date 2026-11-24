---
description: "Use when adding derivation rules, types, grammar patterns, diagnostic checks, completions, hover docs, or any other feature to the kdic VS Code extension. Covers exact patterns for src/derivation-rules.ts, src/language-data.ts and src/validation/."
applyTo: "src/**"
---

# Extending the kdic Extension

See `.github/copilot-instructions.md` for the module map. Only `extension.ts`, `language-features.ts`,
`diagnostics-controller.ts` and `carriage-returns.ts` may import `vscode`.

## Adding a derivation rule

Append one entry to `DERIVATION_RULES` in `src/derivation-rules.ts`. **No other change is needed** —
`buildRuleMaps()` rebuilds the parameter-type, return-type and operand-scope maps.

```ts
{ label: 'MyRule', detail: 'category', returnType: 'Numerical', signature: 'MyRule(Numerical x, Categorical y)', documentation: 'What MyRule does.' },
```

- `detail` is the category shown in the completion list; `returnType` drives the return-type check
  (`Numerical|Categorical` is a union, `any` is unchecked).
- Signature parsing: `TypeName argName` → expected type; a bare `argName` → `any` (unchecked);
  a last parameter `...` → varargs (extra positions unchecked); `Block(Type) argName` → block argument (not type-checked).
- Relational rules (first parameter `Table`/`Entity`): operands after the first are treated as
  secondary-scope and unchecked, unless the rule lists `operandScopes: ['current', 'secondary', …]`.

## Adding a type

1. Add it to `NATIVE_TYPES` or `ADVANCED_TYPES` in `src/language-data.ts` (completion + hover).
2. Insert it in `KDIC_TYPES` in `src/kdic-syntax.ts` at the **correct position**: longer / more
   specific names first (`TimestampTZ` before `Timestamp`, `TextList` before `Text`).
3. Patterns built from `TYPE_ALTERNATION` pick it up automatically.

## Adding a line pattern (`src/validation/line-grammar.ts`)

Line patterns are tested against the **trimmed, comment-free** line. Add to `OUTSIDE_DICTIONARY` or
`INSIDE_DICTIONARY`, building the regex from `IDENTIFIER_PATTERN` / `METADATA_PATTERN` / `TYPE_ALTERNATION`.
Keep one concern per pattern.

## Adding a diagnostic check

Pick the module by what the check needs:

| The check needs… | Add it to |
|---|---|
| tokens only (delimiters, metadata, constants) | the matching file, or a new `src/validation/<name>.ts` |
| dictionaries / declarations / header | `dictionaries.ts` (reads the `Structure` built by `structure.ts`) |
| whole-line text | `line-grammar.ts` |

Then call it from `validate()` in `src/validator.ts`, in pipeline order. Report through the
`DiagnosticCollector`: `out.atToken(token, message)`, `out.at(offset, length, message)` or
`out.atLine(line, col, endCol, message)`; pass `Severity.Warning` as last argument for warnings.

Useful pieces: `structure.dictionaries[i].declarations` (`type`, `name`, `nameText`, `relationTarget`,
`equalsIndex`), `dictionary.header` (`name`, `keys`, `valid`), `tokenName(token)` to get a decoded name,
`maskQuoted()` to search delimiters in code while ignoring quoted text.

**Continuation lines** (multi-line derivations) must not be flagged as unknown: `line-grammar.ts` already
skips them (`isContinuation`).

## Diagnostic severity convention

| Situation | Severity |
|---|---|
| Type mismatch, missing `;`, unknown dictionary, bad key, bad name | `Error` |
| Line not matching any known grammar pattern, undeclared argument variable | `Warning` |

## Native Khiops diagnostics

Wiring lives in `src/diagnostics-controller.ts`; process handling in `src/khiops-runner.ts`; output
parsing in `src/khiops-validation.ts`. Preserve the split: collection `kdic` (built-in) vs `khiops`
(native). Native runs only after a save, only when built-in validation found no error, and are serialized.
If no binary is found, built-in diagnostics must remain available.

## Regex tips

- Names are stored **unquoted** (`decodeIdentifier` / `tokenName`); backtick escapes are doubled (`` `` ``).
- To search braces, parentheses or `;` in text, use `maskQuoted(text, resetAtNewline)` first and search the
  result: quoted text is blanked, offsets and line breaks are preserved.
- Prefer tokens (`tokenizeKdic`) over regexes when a check must not be fooled by strings or comments.
