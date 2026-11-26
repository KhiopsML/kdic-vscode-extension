# Khiops Dictionary Language Extension

VS Code extension providing language support for `.kdic` files (Khiops dictionary format).
**Entirely AI-maintained.** Grammar reference: <https://khiops.org/api-docs/kdic/dictionary-files/>

## Code quality: simple to maintain

This code is read and changed far more often than it is written, by sessions that start without memory of the
previous ones. A change is not done when it works: it is done when the code is **no more complex than before**.

- **As simple as possible.** The simplest design that meets the spec. No speculative option, parameter, layer or
  abstraction; a flag or parameter that one caller uses is inlined. Prefer a table or a map to a long `if` chain,
  and early returns to deep nesting. A clever one-liner loses to three plain lines.
- **Readable.** A function does one thing, fits on a screen (about 40 lines; more only for a flat table or a flat
  sequence of steps), takes at most four parameters (past that, pass one object, as `KhiopsServices`) and has a
  name that says what it does. A long state machine is a class whose methods each handle one kind of token
  (`StructureScanner`). Names come from the domain (`declaration`, `scope`, `operand`), not `data`, `info`, `tmp`.
- **Commented.** Every module opens with a comment saying what it is for. Every function and exported type has a
  `/** … */` saying what it does or returns. Comment the *why* and the tricky step: what was measured on Khiops,
  which spec requirement a rule serves, why a case is left alone. Do not comment what the line says.
- **No duplication.** Search before writing a helper. When the same logic appears twice, move it where both can
  import it (`scanDocument`, `RULE_MAPS`, `dictionariesByName`, `withTemporaryDirectory`). One source of truth
  per fact, in code and in docs (the validation pipeline is described only at the top of `src/validator.ts`).
- **Step back after each feature.** `openspec/` adds one change at a time, each grafted onto the previous code.
  Once a change works, reread the modules it touched, and the neighbours that now do something similar, as a
  whole: merge layers that became redundant, delete what no longer applies (code, comments, docs, tests of removed
  behavior). A pure simplification keeps the behavior: unit tests and corpus check pass unchanged.
- **Keep the stack flat.** Archive an OpenSpec change (`/opsx:archive`) once it is implemented and committed, so that
  `openspec/specs/` is the one description of the behavior and `openspec/changes/` holds only work in progress.
- **Keep the docs in step.** Add, split or remove a module: update the module table here and in `README.md`.

## Architecture

Only six modules import `vscode`; everything else is plain TypeScript that the unit tests and
the smoke-test CLI load directly from `out/`.

| Module | Role |
|---|---|
| `src/extension.ts` | `activate()`: registers the language features, diagnostics controller and dictionary creation *(vscode)* |
| `src/language-features.ts` | Completion and hover providers *(vscode)* |
| `src/diagnostics-controller.ts` | Built-in diagnostics while editing, native Khiops diagnostics on save *(vscode)* |
| `src/carriage-returns.ts` | Detects files holding isolated `\r`, for which built-in diagnostics are off *(imports vscode)* |
| `src/dictionary-creation.ts` | Command UI for creating a dictionary from a data file *(vscode)* |
| `src/khiops-services.ts` | `KhiopsServices` (the `Khiops` output channel, debug traces, the version check) shared by the features that run Khiops, and `showErrorWithOutput()` *(vscode)* |
| `src/dictionary-builder.ts` | Builds the Khiops creation scenario and safely publishes the result |
| `src/kdic-text-document.ts` | `KdicTextDocument`: plain text with a line index (`KdicDocument`; used by tests, the CLI and Khiops-output parsing) |
| `src/derivation-rules.ts` | `DERIVATION_RULES`: ~300 built-in rules (completion, hover, type checking) |
| `src/date-time-formats.ts` | `formatsOf()`, `isValidFormat()`: the date, time, timestamp and timestamp-tz formats Khiops documents |
| `src/language-data.ts` | `KEYWORDS`, `NATIVE_TYPES`, `ADVANCED_TYPES`, `METADATA_KEYS`, `MISSING_VALUE` (completion, hover) |
| `src/rule-maps.ts` | `buildRuleMaps()`, and `RULE_MAPS` of the built-in rules: parameter-type, return-type, operand-scope and output (`:` target names) maps |
| `src/kdic-syntax.ts` | `KDIC_TYPES`, `FORMAT_METADATA_KEYS`, identifier/metadata regex sources, `stripLineComments`, `maskQuoted`, `extractDictionaryNames` |
| `src/kdic-lexer.ts` | `tokenizeKdic()`: tokens with offsets, comments and quote state |
| `src/completion-context.ts` | Cursor context for completion (comment? derivation? inside a dictionary? on a metadata key? which type does the open rule call expect? the operand being typed and its leading dots) |
| `src/operand-completion.ts` | `operandVariablesAt()`: the variables and variable blocks an operand can name, from the text and an offset (no `vscode`). Scans the whole text, so `language-features.ts` skips it above `MAX_ANALYZED_CHARS` |
| `src/validator.ts` | `validate(document, rules, cursorLine?)`: runs the checks listed at its top, returns `KdicDiagnostic[]` |
| `src/validation/*.ts` | The individual checks (below) |
| `src/khiops-runner.ts` | Finds the Khiops binary, runs it (`execKhiopsProcess`, batch scenarios in a temporary directory) and runs it on a dictionary file |
| `src/khiops-version.ts` | `KHIOPS_REFERENCE_VERSION`, `readKhiopsVersion()` (`-v`), `versionWarning()` |
| `src/khiops-validation.ts` | Turns Khiops output into `{ line, message }` locations |

Syntax highlighting is declarative (`syntaxes/kdic.tmLanguage.json`); snippets are in
`snippets/kdic.code-snippets`; language configuration in `language-configuration.json`.

### Built-in validation pipeline (`validator.ts`)

`validate()` tokenizes once, then runs ten checks in order, each a focused function of `src/validation/`.
The ordered list, with what each check reports, is at the top of `src/validator.ts`: keep it there, and
up to date when a check is added, moved or removed.

Every rule of `variable-blocks.ts`, `relations.ts` and the name checks was measured on the Khiops binary before it
was written (a dictionary that Khiops accepts must give no error here). To keep that true, run the corpus scan
(`--update-expected` lists the files with an error that Khiops accepts; it must stay empty) after changing a check.

`diagnostics.ts` holds `KdicDocument`, `KdicDiagnostic`, `Severity` and the `DiagnosticCollector`
the checks report to. All diagnostics are published with `source = 'kdic'`.

`structure.ts` builds the structure (`StructureScanner`) that most checks read; `scan-document.ts` builds it
without checking anything, for the code that only needs what a document declares (completion, Khiops output).

`rule-calls.ts` and variable completion share three modules, so that both resolve an operand the same way:
`call-tree.ts` (parser of a call, which can also read a call left open at the cursor, and the target names after the
`:` of the rules that build instances), `call-scopes.ts` (the dictionary an operand is resolved in, from the rule's
`operandScopes`, and the `.` scope operator; the dictionary of a target name) and `operand-site.ts` (what is known of
the operand at an offset, used by `operand-completion.ts`).

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
- Dictionary creation is available from the Explorer, editor tab and Command Palette; it asks whether
  the data has a header, uses `kdic.khiopsPath` independently of validation settings, and reports
  errors in a notification, with failed run output in the shared `Khiops` output channel.
- `khiops-services.ts` shares an in-flight version-check cache between both features, once per resolved
  executable path per activation. Before an eligible batch run, `readKhiopsVersion()` invokes `-v`
  with a five-second timeout and compares the full version with `KHIOPS_REFERENCE_VERSION`
  (`khiops-version.ts`).
  Any difference or detection failure warns without awaiting dismissal or publishing diagnostics;
  details and Show Output use the shared channel even with debug traces off. Checks are not retried
  until the next activation for that path. Native validation rechecks document/configuration currency
  after waiting; cancelled creation never probes.

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
- Keep modules free of `vscode` unless they need it; the rules above ("Code quality") apply to every change.

## Khiops version of reference

The built-in checks, the rule catalogue and the READMEs follow the documentation published on khiops.org, that is
**Khiops 11.0.2** (checked on 2026-11-26). The documented version is the latest release of Khiops, which the project
owner confirms: the release marked `Latest` (not a pre-release) by
`gh release list -R KhiopsML/khiops --limit 5`. Do not read `environment.env` of `KhiopsML/khiops-doc` (the
`KHIOPS_VERSION` of the site build): it may be unavailable to the assistant, and the release list gives the same answer.

The Khiops binary, not the web site, is the authority on behavior, and the site is incomplete: measure on the binary
before writing a rule. The names, `VarKey` and multi-table schema rules were measured on Khiops 11.0.3-a.0 (a
pre-release); the corpus (`corpus-expectations.json`) was checked with the same binary.

**Before creating a tag or a new version** (`npm version`, `vsce package` or publish, a GitHub release), check that version:
1. Compare the version above with the `Latest` release. If it is newer, read what changed in its dictionary pages
   (dictionary files, derivation rules, metadata, variable blocks, multi-table schemas) and update `DERIVATION_RULES`,
   the types, the metadata keys and the checks to match.
2. Run the corpus check with a Khiops binary of that version: `node scripts/smoke-test.js --expected corpus-expectations.json`,
   then `--update-expected` for what changed. No error may be reported on a file that Khiops accepts.
3. Write the new version in `README.md` (twice), `README.extension.md`, in this section and in
   `KHIOPS_REFERENCE_VERSION` in `src/khiops-version.ts`. This constant targets the documented version,
   not the binary used for individual behavior measurements.

## Temporary workarounds

- **`overrides.minimatch` in `package.json`** (added 2026-11-25): `@vscode/vsce` 4.1.1 depends on
  `minimatch@^10.2.6`, which `npm audit` flags (GHSA-g3hv-75wg-m249, fixed in 11.0.1). The override forces
  `^11.0.1`; vsce is a dev-only packaging tool, so the real exposure is nil. **Remove it** once an
  `@vscode/vsce` release depends on `minimatch` ≥ 11.0.1 (`npm view @vscode/vsce dist-tags`, `npm view
  @vscode/vsce@<version> dependencies.minimatch`): drop the `overrides` block, run `npm install`, then check
  that `npm audit` reports nothing and `npm run package` still works. Do not downgrade vsce to 3.9.x: it pulls
  `glob@11`, which brings the same vulnerable `minimatch`. When working on dependencies or packaging,
  check whether this override can go.
