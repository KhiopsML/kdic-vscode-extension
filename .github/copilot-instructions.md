# Khiops Dictionary Language Extension

VS Code extension providing language support for `.kdic` files (Khiops dictionary format).
**Entirely AI-maintained.** Grammar reference: <https://khiops.org/api-docs/kdic/dictionary-files/>

## Architecture

Only four modules import `vscode`; everything else is plain TypeScript that the unit tests and
the smoke-test CLI load directly from `out/`.

| Module | Role |
|---|---|
| `src/extension.ts` | `activate()`: registers the language features and the diagnostics controller *(vscode)* |
| `src/language-features.ts` | Completion and hover providers *(vscode)* |
| `src/diagnostics-controller.ts` | Built-in diagnostics while editing, native Khiops diagnostics on save *(vscode)* |
| `src/carriage-returns.ts` | Detects files holding isolated `\r`, for which built-in diagnostics are off *(imports vscode)* |
| `src/kdic-text-document.ts` | `KdicTextDocument`: plain text with a line index (`KdicDocument`; used by tests, the CLI and Khiops-output parsing) |
| `src/derivation-rules.ts` | `DERIVATION_RULES`: ~300 built-in rules (completion, hover, type checking) |
| `src/date-time-formats.ts` | `formatsOf()`, `isValidFormat()`: the date, time, timestamp and timestamp-tz formats Khiops documents |
| `src/language-data.ts` | `KEYWORDS`, `NATIVE_TYPES`, `ADVANCED_TYPES`, `METADATA_KEYS` (completion, hover) |
| `src/rule-maps.ts` | `buildRuleMaps()`: parameter-type, return-type and operand-scope maps built from the rules |
| `src/kdic-syntax.ts` | `KDIC_TYPES`, `FORMAT_METADATA_KEYS`, identifier/metadata regex sources, `stripLineComments`, `maskQuoted`, `extractDictionaryNames` |
| `src/kdic-lexer.ts` | `tokenizeKdic()`: tokens with offsets, comments and quote state |
| `src/completion-context.ts` | Cursor context for completion (comment? derivation? inside a dictionary? on a metadata key?) |
| `src/validator.ts` | `validate(document, rules, cursorLine?)`: runs the checks below, returns `KdicDiagnostic[]` |
| `src/validation/*.ts` | The individual checks (below) |
| `src/khiops-runner.ts` | Finds the Khiops binary and runs it on a dictionary file |
| `src/khiops-validation.ts` | Turns Khiops output into `{ line, message }` locations |

Syntax highlighting is declarative (`syntaxes/kdic.tmLanguage.json`); snippets are in
`snippets/kdic.code-snippets`; language configuration in `language-configuration.json`.

### Built-in validation pipeline (`validator.ts`)

`validate()` tokenizes once, then runs these checks in order. Each is a focused function in `src/validation/`:

1. `delimiters.ts` — unclosed / unmatched / wrongly nested `()`, `[]`, `{}`
2. `metadata.ts` — locates `<key>`, `<key=value>` tags and reports malformed ones
3. `structure.ts` — one token walk building the **structure** (dictionaries, their headers and declarations);
   reports missing `;` and invalid variable names
4. `format-metadata.ts` — `DateFormat`/`TimeFormat`/`TimestampFormat`/`TimestampTZFormat` on a variable
   of another type, without a string value, or with an unknown format
5. `constants.ts` — numerical and categorical constants inside derivations
6. `dictionaries.ts` — per dictionary: name lengths, key fields, `Table(X)`/`Entity(X)` targets,
   rule return types and argument types
7. `line-grammar.ts` — line by line: variable blocks, content after `;`, unknown lines (warning)

`diagnostics.ts` holds `KdicDocument`, `KdicDiagnostic`, `Severity` and the `DiagnosticCollector`
the checks report to. All diagnostics are published with `source = 'kdic'`.

### VS Code integration (`diagnostics-controller.ts`)

- Built-in diagnostics (collection `kdic`) are recomputed 300 ms after each edit, directly on the
  editor document (`vscode.TextDocument` satisfies `KdicDocument`).
- A file holding an isolated `\r` (not part of `\r\n`) gets **no** built-in diagnostics: VS Code
  turns every `\r` into a line break, so the editor text no longer matches the file (a `\r` inside
  quoted text is legal KDIC). `carriage-returns.ts` reads the file when the document opens, is saved,
  or has its content replaced from disk; a save rewrites the file with ordinary line breaks, so
  diagnostics then resume.
- Native diagnostics (collection `khiops`, `source = 'khiops'`): after a save of a file-backed
  document, once it has been checked and validated, and only if built-in validation found
  no *error* (warnings do not block). Runs are serialized; the result of a run on an outdated
  version is discarded.
- If no Khiops binary is found, built-in diagnostics remain the fallback.

Settings: `kdic.enableKhiopsValidation`, `kdic.runKhiopsOnAutoSave`, `kdic.enableDebugTraces`, `kdic.khiopsPath`.

## Build & run

```bash
npm install       # first time only
npm run compile   # tsc -p ./
npm run watch     # tsc -watch -p ./  (incremental)
```

Press **F5** in VS Code to launch an Extension Development Host.
Smoke test: `node scripts/smoke-test.js [--errors-only] [directory]` (requires `npm run compile`).
Automated tests: `npm test`. VS Code host tests: see `README.md`.

## Key conventions

- Adding a derivation rule: **append to `DERIVATION_RULES`** in `src/derivation-rules.ts` only.
- Adding a type: add it to `NATIVE_TYPES` / `ADVANCED_TYPES` in `src/language-data.ts` **and** insert it
  at the correct position in `KDIC_TYPES` in `src/kdic-syntax.ts` (longer names first).
- Adding or changing validation: edit the matching file in `src/validation/`; the extension and the
  smoke test pick it up after recompiling.
- Diagnostic severity: **Error** for definite violations (type mismatch, missing `;`, unknown
  reference); **Warning** for unrecognised lines and undeclared argument-variable references.
- Keep modules free of `vscode` unless they need it, and every function short and commented.
