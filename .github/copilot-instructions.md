# Khiops Dictionary Language Extension

VS Code extension providing language support for `.kdic` files (Khiops dictionary format).
**Entirely AI-maintained.** Grammar reference: <https://khiops.org/api-docs/kdic/dictionary-files/>

## Architecture

Validation logic lives in `src/validator.ts` (no VS Code dependency).
VS Code integration (completions, hover, diagnostics) lives in `src/extension.ts`.
Syntax highlighting is declarative: `syntaxes/kdic.tmLanguage.json`.
Snippets: `snippets/kdic.code-snippets`. Language config: `language-configuration.json`.
Smoke test CLI: `scripts/smoke-test.js` (uses compiled `out/validator.js`).

### `src/validator.ts` — shared validation module

Exports all validation logic with no VS Code dependency, so it can be used by both
`extension.ts` (inside VS Code) and `scripts/smoke-test.js` (standalone CLI).

| Export | Purpose |
|---|---|
| `KdicDocument` | Minimal document interface (satisfied by `vscode.TextDocument` and the smoke-test mock) |
| `KdicDiagnostic` | Plain diagnostic object (line, col, endCol, severity, message) |
| `Severity` | `Error = 0`, `Warning = 1` |
| `KDIC_TYPES` | Ordered type list for regex alternation |
| `stripLineComments(text)` | Quote/backtick-aware comment stripper (preserves offsets) |
| `extractDictionaryNames(strippedText)` | Returns `Set<string>` of dictionary names |
| `buildTypeMaps(rules)` | Builds `PARAM_TYPE_MAP` and `RETURN_TYPE_MAP` from derivation rules |
| `validate(doc, paramTypeMap, returnTypeMap)` | Full validation — returns `KdicDiagnostic[]` |

### `src/extension.ts` — VS Code integration

| Constant | Purpose |
|---|---|
| `KEYWORDS` | Completion + hover for `Dictionary`, `Root`, `Unused` |
| `NATIVE_TYPES`, `ADVANCED_TYPES` | Type completions |
| `DERIVATION_RULES` | ~300 built-in functions — `signature` drives param-type map, `returnType` drives return-type map |
| `PARAM_TYPE_MAP` / `RETURN_TYPE_MAP` | Auto-derived from `DERIVATION_RULES` via `buildTypeMaps()` — **never edit manually** |

`validateDocument()` is a thin wrapper: calls `validate()` from `validator.ts` and converts
`KdicDiagnostic[]` to `vscode.Diagnostic[]` (`source: 'kdic'`).

`activate()` registers completion + hover, then configures diagnostics from:
- built-in validator (`source: 'kdic'`) on open/change
- optional native Khiops parser (`source: 'khiops'`) on save (and on auto-save when enabled) when binary is available

Native Khiops validation is controlled by settings:
- `kdic.enableKhiopsValidation`
- `kdic.diagnosticSource` (`khiops` | `extension` | `both`)
- `kdic.runKhiopsOnAutoSave`
- `kdic.enableDebugTraces`
- `kdic.khiopsPath`

### `KDIC_TYPES` — order is significant

```ts
const KDIC_TYPES = [
  'Categorical', 'Numerical', 'TextList', 'Text',
  'Date', 'TimestampTZ', 'Timestamp', 'Time',
  'Table', 'Entity', 'Structure',
];
```

Longer / more-specific names must come before shorter ones (`TimestampTZ` before `Timestamp`,
`TextList` before `Text`). Used to build the `typeAlt` regex alternation used everywhere.
Defined in `validator.ts`.

### `validate()` — two independent passes

**Pass 1 — block loop** (`while i < text.length`): finds each `{ … }` dictionary block,
collects variable types into `vars`, then runs four checks:

1. Key-field type check (fields listed in the dictionary key must be `Categorical`)
2. Unknown-dictionary check (`Table(X)` / `Entity(X)` must reference a declared dictionary)
3. Return-type mismatch (declared type vs. derivation rule return type)
4. Argument-type mismatch (argument variables vs. `PARAM_TYPE_MAP`)
5. Undeclared argument variable warning (likely typo in current dictionary scope)

**Pass 2 — line loop** (`for li`): line-by-line grammar validation:

- Check 1: non-metadata / non-comment content after `;`
- Check 2: line matches `outsidePatterns` or `insidePatterns`
- Check 3: missing `;` at end of a complete variable declaration
- Check 4: missing `;` after dictionary closing `}`

All diagnostics use `diag.source = 'kdic'`.

## Build & run

```bash
npm install       # first time only
npm run compile   # tsc -p ./
npm run watch     # tsc -watch -p ./  (incremental)
```

Press **F5** in VS Code to launch an Extension Development Host.
Smoke test: `node scripts/smoke-test.js [directory]` (requires `npm run compile` first).
Automated validator tests: `npm test`.

## Key conventions

- Adding a derivation rule: **append to `DERIVATION_RULES`** in `extension.ts` only — maps
  rebuild automatically via `buildTypeMaps()`.
- Adding a type: add to `NATIVE_TYPES` / `ADVANCED_TYPES` in `extension.ts` **and** insert at
  the correct position in `KDIC_TYPES` in `validator.ts`.
- Adding or changing validation logic: edit `src/validator.ts` — both the extension and the
  smoke test will pick up the change after recompilation.
- Diagnostic severity: **Error** for definite violations (type mismatch, missing `;`, unknown
  reference); **Warning** for unrecognised lines and undeclared argument-variable references.
- Grammar patterns are regexes matched against the trimmed, comment-stripped line. Keep them
  focused — one concern per pattern.
