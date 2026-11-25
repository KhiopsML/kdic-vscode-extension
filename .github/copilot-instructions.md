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
| `src/language-data.ts` | `KEYWORDS`, `NATIVE_TYPES`, `ADVANCED_TYPES`, `METADATA_KEYS`, `MISSING_VALUE` (completion, hover) |
| `src/rule-maps.ts` | `buildRuleMaps()`: parameter-type, return-type and operand-scope maps built from the rules |
| `src/kdic-syntax.ts` | `KDIC_TYPES`, `FORMAT_METADATA_KEYS`, identifier/metadata regex sources, `stripLineComments`, `maskQuoted`, `extractDictionaryNames` |
| `src/kdic-lexer.ts` | `tokenizeKdic()`: tokens with offsets, comments and quote state |
| `src/completion-context.ts` | Cursor context for completion (comment? derivation? inside a dictionary? on a metadata key? which type does the open rule call expect? the operand being typed and its leading dots) |
| `src/operand-completion.ts` | `operandVariablesAt()`: the variables and variable blocks an operand can name, from the text and an offset (no `vscode`). Scans the whole text, so `language-features.ts` skips it above `MAX_ANALYZED_CHARS` |
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
3. `structure.ts` — one token walk building the **structure** (dictionaries, their headers with the `Root`
   keyword, declarations with their `[key]` and whether they are in a variable block, and the variable blocks with
   their members and the `;` of their tail); reports missing `;`, invalid variable names, a word after a name and
   a statement that does not start with a type
4. `format-metadata.ts` — `DateFormat`/`TimeFormat`/`TimestampFormat`/`TimestampTZFormat` on a variable
   of another type, without a string value, or with an unknown format
5. `variable-blocks.ts` — `VarKey` of each block member (present, integer 1 to 10⁹ or non-empty string, one kind,
   unique) and the default value of the block
6. `constants.ts` — numerical and categorical constants inside derivations
7. `dictionaries.ts` — per dictionary: name lengths, names used twice (variables and blocks), spaces at the end of
   names, dictionaries declared twice, key fields, `Table(X)`/`Entity(X)` targets
8. `relations.ts` — multi-table schema: root key, root as a component, key lengths along native relations,
   external entities (`[key]`)
9. `rule-calls.ts` — parses each derivation into a tree of calls and checks return types and argument types
   (variables, constants, and the results of nested calls), tracking the dictionary each operand is resolved in (current, or that of the table of a table/entity rule)
10. `line-grammar.ts` — line by line: variable blocks, content after `;`, unknown lines (warning)

Every rule of `variable-blocks.ts`, `relations.ts` and the name checks was measured on the Khiops binary before it
was written (a dictionary that Khiops accepts must give no error here). To keep that true, run the corpus scan
(`--update-expected` lists the files with an error that Khiops accepts; it must stay empty) after changing a check.

`diagnostics.ts` holds `KdicDocument`, `KdicDiagnostic`, `Severity` and the `DiagnosticCollector`
the checks report to. All diagnostics are published with `source = 'kdic'`.

`rule-calls.ts` and variable completion share three modules, so that both resolve an operand the same way:
`call-tree.ts` (parser of a call, which can also read a call left open at the cursor), `call-scopes.ts`
(the dictionary an operand is resolved in, from the rule's `operandScopes`, and the `.` scope operator)
and `operand-site.ts` (what is known of the operand at an offset, used by `operand-completion.ts`).

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
Smoke test: `node scripts/smoke-test.js [--errors-only] [directory]` (requires `npm run compile`). The known
diagnostics of the LearningTest corpus are in `corpus-expectations.json`: check a change against them with
`--expected corpus-expectations.json`, and accept it with `--update-expected corpus-expectations.json`
(`scripts/corpus-expectations.js`; it keeps the Khiops verdicts and notes, and asks Khiops about new files). Before
accepting a change, make sure every new *error* is a file that Khiops rejects too.
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

## Khiops version of reference

The built-in checks, the rule catalogue and the READMEs follow the documentation published on khiops.org, that is
**Khiops 11.0.2** (checked on 2026-11-25). It is the `KHIOPS_VERSION` of the web site build, "the version of the
Khiops package as documented on the web site", in `environment.env` of `KhiopsML/khiops-doc`:
`gh api repos/KhiopsML/khiops-doc/contents/environment.env --jq .content | base64 -d | grep KHIOPS_VERSION`
(the published site may lag behind `main`).

The Khiops binary, not the web site, is the authority on behavior, and the site is incomplete: measure on the binary
before writing a rule. The names, `VarKey` and multi-table schema rules were measured on Khiops 11.0.3-a.0 (a
pre-release); the corpus (`corpus-expectations.json`) was checked with the same binary.

**Before creating a tag or a new version** (`npm version`, `vsce package` or publish, a GitHub release), check that version:
1. Read the version above again. If khiops.org now documents a newer Khiops, read what changed in its dictionary pages
   (dictionary files, derivation rules, metadata, variable blocks, multi-table schemas) and update `DERIVATION_RULES`,
   the types, the metadata keys and the checks to match.
2. Run the corpus check with a Khiops binary of that version: `node scripts/smoke-test.js --expected corpus-expectations.json`,
   then `--update-expected` for what changed. No error may be reported on a file that Khiops accepts.
3. Write the new version in `README.md` (twice), `README.extension.md` and in this section.

## Temporary workarounds

- **`overrides.minimatch` in `package.json`** (added 2026-11-25): `@vscode/vsce` 4.1.1 depends on
  `minimatch@^10.2.6`, which `npm audit` flags (GHSA-g3hv-75wg-m249, fixed in 11.0.1). The override forces
  `^11.0.1`; vsce is a dev-only packaging tool, so the real exposure is nil. **Remove it** once an
  `@vscode/vsce` release depends on `minimatch` ≥ 11.0.1 (`npm view @vscode/vsce dist-tags`, `npm view
  @vscode/vsce@<version> dependencies.minimatch`): drop the `overrides` block, run `npm install`, then check
  that `npm audit` reports nothing and `npm run package` still works. Do not downgrade vsce to 3.9.x: it pulls
  `glob@11`, which brings the same vulnerable `minimatch`. When working on dependencies or packaging,
  check whether this override can go.
