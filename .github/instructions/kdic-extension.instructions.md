---
description: "Use when adding derivation rules, types, grammar patterns, diagnostic checks, completions, hover docs, or any other feature to the kdic VS Code extension. Covers exact patterns for src/extension.ts and src/validator.ts."
applyTo: "src/**"
---

# Extending the kdic Extension

## Adding a derivation rule

Append one entry to `DERIVATION_RULES`. **No other changes are needed** — `PARAM_TYPE_MAP` and
`RETURN_TYPE_MAP` rebuild automatically.

```ts
{
  label: 'MyRule',
  kind: vscode.CompletionItemKind.Function,
  detail: 'category',                          // shown in completion list
  returnType: 'Numerical',                     // drives return-type check
  signature: 'MyRule(Numerical x, Categorical y)',  // drives param-type check
  documentation: 'What MyRule does.',
}
```

**Signature parsing rules:**
- `TypeName argName` → param expected to be `TypeName`
- bare `argName` (no recognised type prefix) → `'any'` (unchecked)
- last param `...` → varargs; extra positions beyond the explicit list are unchecked
- `Block(Type) argName` → parsed as `Block(Type)` (block arguments are not type-checked like scalar args)

For documented relational operand scopes, add an `operandScopes` array to the rule using JSON-style double-quoted strings. The smoke-test CLI reads this metadata from the same rule entry. Later operands of a relational rule without a known scope are not checked against the current dictionary.

## Adding a type

1. Add to `NATIVE_TYPES` or `ADVANCED_TYPES` in `extension.ts` (completion + hover).
2. Insert into `KDIC_TYPES` in `validator.ts` at the **correct position** — longer/more-specific names must
   precede shorter ones (`TimestampTZ` before `Timestamp`, `TextList` before `Text`).
3. All regexes that use `typeAlt` pick up the new type automatically.

## Adding a grammar pattern

Patterns are tested against the **trimmed, comment-stripped** line content.
All grammar patterns live in `src/validator.ts` inside the `validate()` function.

- **Outside a dictionary block** → add to `outsidePatterns`.
- **Inside a dictionary block** → add to `insidePatterns`.

Keep each pattern focused on one concern.

## Adding a diagnostic check in the block loop

Insert code inside the `while (i < text.length)` loop in `src/validator.ts`
**after** the `vars` Map is populated.

| Variable | Meaning |
|---|---|
| `blockText` | Raw text of the block (line comments replaced by spaces) |
| `blockStart` | Char offset in `document` of the first char after `{` |
| `vars` | `Map<name, type>` of all declared variables in this block |
| `knownDicts` | `Set<string>` of all dictionary names in the file |
| `document.positionAt(blockStart + offset)` | Convert block offset → document position |

Push diagnostics via `diags.push({ line, col, endCol, severity: Severity.Error, message })`.

## Adding a diagnostic check in the line loop

Insert inside the `for (let li …)` loop in `src/validator.ts`. Useful context variables:

| Variable | Meaning |
|---|---|
| `effective` | Trimmed, comment-stripped line |
| `strippedLine` | Comment-stripped line (original column offsets preserved) |
| `lineRaw` | Original line text |
| `depthBefore` | Brace depth before processing this line (`> 0` = inside a block) |
| `lineDepth` | Brace depth after processing this line |
| `parenDepth` | Unclosed `(` count from previous lines (`0` = not a continuation) |
| `lineNetParens` | Net `(` minus `)` on this line (`0` = statement complete here) |
| `prevLineEndsWithAssign` | Previous line ended with `=` (split derivation) |
| `semiIdx` | Index of last unquoted `;` in `strippedLine` (`-1` if none) |

**Continuation lines** (multi-line derivations) must be skipped: check
`parenDepth === 0 && !prevLineEndsWithAssign` before firing any diagnostic.

## Diagnostic severity convention

| Situation | Severity |
|---|---|
| Type mismatch, missing `;`, unknown dictionary, bad key type | `Error` |
| Line not matching any known grammar pattern, undeclared argument variable | `Warning` |

## Native Khiops diagnostics (extension.ts)

When touching validation wiring in `src/extension.ts`, preserve the current split:

- Built-in diagnostics: collection `kdic`, produced by `validateDocument`
- Native diagnostics: collection `khiops`, produced by `runKhiopsValidation`

Configuration keys controlling behavior:

- `kdic.enableKhiopsValidation`
- `kdic.diagnosticSource` (`khiops` | `extension` | `both`)
- `kdic.runKhiopsOnAutoSave`
- `kdic.enableDebugTraces`
- `kdic.khiopsPath`

If no binary is found, extension diagnostics must remain available as fallback.

## Regex tips

- `text` in `validateDocument` has line comments replaced with spaces — safe for offset arithmetic.
- `typeAlt` is `KDIC_TYPES.join('|')` — use it in dynamic `RegExp` constructors for type matching.
- Backtick-quoted identifiers in source: `` `name` `` (`` `` `` escapes a literal backtick).
  Stored in `vars` and other maps in their **unquoted** form.
- To find a variable declaration position in `blockText`, reset and rerun `varDeclRe` scanning
  for the specific name in capture group 2.
