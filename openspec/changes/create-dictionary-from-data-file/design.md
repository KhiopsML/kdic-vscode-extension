# Design

## Context

See `proposal.md` for motivation and `specs/khiops-dictionary-creation/spec.md` for the behavior.

Observed on Khiops 11.0.3-a.0 (macOS binary), with the scenario `create_dictionary._kh` (open "Build dictionary from data table", set `DatabaseName`, build, save under `ClassFileName`):

- Run with `MODL -b -i scenario -e /dev/stdout`, as native validation does. Output lines are prefixed `Khiops.log<TAB>`; errors read `error : …` and `fatal error : …`.
- A missing data file gives errors and exit status 1, but an unwritable `ClassFileName` gives `error : … Unable to open output file (Permission denied)` with **exit status 0**: failures must be read from the output, not from the status.
- An existing dictionary is overwritten silently. An empty data file gives an empty dictionary and no error.
- Paths with spaces work in both scenario lines.
- Khiops **appends `.kdic`** to a `ClassFileName` that lacks the extension (`x.tmp` → `x.tmp.kdic`), and the dictionary name comes from the data file's name (`` Dictionary `my data` ``), not from the output file.
- Adding `SourceDataTable.DatabaseSpec.Data.HeaderLineUsed true` or `false` before `BuildClassDef` selects whether the first line supplies names. In a test on the same binary, `true` produced `Name` and `Age` from the header; `false` produced `Var1` and `Var2` and treated the first line as data.
- A source filename containing a line feed splits the scenario into multiple commands; a test on the same binary produced an `Invalid command` error.

Existing code: `src/khiops-runner.ts` finds the binary (`findKhiopsBinary`) and runs the check scenario (`runKhiops`: scenario in the temp folder, `KHIOPS_PROC_NUMBER=1`, 30 s limit, Windows reads the log from a file and wraps `.cmd` files in a shell). `src/khiops-validation.ts` reads `error :` lines. `DiagnosticsController` owns the `Khiops` output channel and the debug `trace` function; nothing in `extension.ts` registers a command yet.

## Goals / Non-Goals

**Goals:**
- Reuse the process handling of the check run (Windows log file, `.cmd` shell, environment) rather than copy it.
- Keep what does not need `vscode` out of the one new `vscode` module, so it can be unit-tested with a mock executable.
- Leave nothing behind on failure, including the previous dictionary.

**Non-Goals:**
- Cancelling a run, or processing several files at once (the menu entry is hidden for a multiple selection).
- Choosing the destination, the dictionary name or other Khiops analysis options (separator, sampling): Khiops defaults apply.
- Guarding against two concurrent creations of the same destination: the last one wins.
- A new setting; the time limit is a constant.

## Decisions

### Split: a plain module for the run, one `vscode` module for the command
- `src/dictionary-builder.ts` (no `vscode`): `dictionaryPathFor(source)`, the scenario text, and `createDictionary(binary, source, destination, headerLineUsed, trace)`, which returns `{ ok, errors, output, reason }` and never throws. It writes nothing to the destination unless the run is clean.
- `src/dictionary-creation.ts` (imports `vscode`): command registration and every user interaction (overwrite confirmation, progress, error messages, opening the result).
- `src/khiops-runner.ts`: the process part of `runKhiops` is extracted into a function that both runs use (`execKhiops(binary, scenarioFile, logFile, timeoutMs, trace)` returning the output and, when it failed, why: not started, timeout, exit status). `runKhiops` keeps its signature and result, so native validation does not change.
- `src/khiops-validation.ts`: a new exported `khiopsErrorMessages(output)` next to the existing `ERROR` pattern.

*Alternative*: add the creation to `khiops-runner.ts` and the UI to `diagnostics-controller.ts`. Rejected: the controller is already 250 lines and about diagnostics; the command has no state in common with it. The module map gains a fifth `vscode` module (docs updated).

### The dictionary goes through a temporary folder
`createDictionary` makes a unique folder with `fs.mkdtempSync` in the OS temp directory, holding the scenario, the Windows log and the dictionary, and removes it in a `finally`. Khiops saves to `<folder>/dictionary.kdic` (the `.kdic` extension is required, see Context). Only after a run with no `error` line and with that file present is it copied to a sibling of the destination and renamed over it, so that the destination is replaced atomically or not at all.

*Alternative*: let Khiops write to the destination. Rejected: an error after the file is opened would leave a partial or truncated dictionary and destroy the one the user agreed to replace.
*Alternative*: a fixed name per process like the check run. Rejected: unique folders make concurrent runs (and a creation during a validation) safe without a queue.

### Failure is decided by the output, then by the process
Order: process could not start or timed out → failure; any line matching `^(Khiops.log<ws>)?(fatal )?error :` → failure with the messages; non-zero exit status without such line → failure; no dictionary file → failure. The pattern is anchored (unlike `ERROR` in `khiops-validation.ts`, which is searched anywhere on the line) so that the `Database <path> : Recognized variable types` line cannot match when the path contains `error :`. The first message is the root cause (Khiops then prints secondary errors such as `Invalid command (OK)` and `Batch mode failure`), hence "the first error and how many others".

### Errors are shown as a message, not as diagnostics
The user asked that errors not be placed on a file: the source is usually not a text file, and no dictionary exists when Khiops fails. The extension shows `vscode.window.showErrorMessage` with the first error and a "Show Output" button that reveals the `Khiops` channel, where the full output is appended (always on failure, not only with debug traces). No diagnostic collection is added.

### One shared output channel and trace function
`activate()` creates the `Khiops` output channel and the `trace` function (writes only when `kdic.enableDebugTraces` is true) and passes them to `DiagnosticsController` and to the command, instead of the controller creating them itself. Two channels named `Khiops` would otherwise appear in the Output list.

### Binary lookup is independent of `kdic.enableKhiopsValidation`
The command calls `findKhiopsBinary(kdic.khiopsPath, trace)` at each run. Native validation can be turned off (for example to avoid runs on save) without disabling an explicit user action. When it finds nothing, the error message offers "Open Settings" on `kdic.khiopsPath`. Discovery stays the same as for validation (no `PATH` search), as chosen with the user.

### Menu contribution and source selection
In `package.json`, contribute `kdic.createDictionaryFromFile`, titled "Create Khiops Dictionary from This File", to `explorer/context`, `editor/title/context` and the Command Palette. Keep the Explorer limited to a single local non-`.kdic` file, and restrict the tab menu to eligible resources. No `activationEvents` entry is needed: the engine is ^1.79, which activates on a contributed command.

The handler uses the URI passed by a context menu, including an inactive editor tab, rather than the active editor. When invoked without a URI from the palette, it uses the active editor's file; if there is no active editor, it offers a single-file picker. Cancelling the picker does nothing. Validate the URI before running: explain an ineligible active or selected resource to the user rather than silently ignoring it. Apply the same validation regardless of entry point.

### Header selection
For every invocation, show a VS Code Quick Pick with two described choices: with a header (first line contains column names) and without one (first line contains data). Cancelling ends the operation without starting Khiops or changing the destination. Pass the selected boolean into the scenario as `SourceDataTable.DatabaseSpec.Data.HeaderLineUsed true` or `false`, before `BuildClassDef`. This one command keeps the menus concise while making the choice explicit for each source file.

### Scenario path safety
Reject source or destination paths containing a carriage return or line feed before writing or running the scenario. Report the reason visibly; these characters would otherwise split scenario lines into unintended commands. This restriction is specific to dictionary creation and does not change existing validation.

### Time limit and progress
The 30 s of the check run is too short for a large data table: creation uses a separate 120 s constant. A non-cancellable `withProgress` notification names the file. A timeout is reported like any failure.

### Tests
- `scripts/dictionary-creation-test.js`, added to `npm test`: destination naming, scenario text including both header choices before `BuildClassDef` (checked against the example `create_dictionary._kh` lines), `khiopsErrorMessages` (prefix, `fatal error`, warnings ignored, path containing `error :`), and `createDictionary` against a mock executable (POSIX shell script, skipped on Windows) for: success, error with exit 0, error with exit 1, exit 1 without error, no dictionary produced, existing destination preserved on failure, unwritable destination, temporary folder removed.
- Host test (`scripts/vscode-host-tests/run.js`) with the existing mock Khiops style: the command is registered and creating from a file writes the `.kdic` and opens it; exercise explicit context URIs, active-editor selection, ineligible input, picker selection/cancellation and header choices/cancellation through suitable mocks. Check the actual menu placement, modal confirmation and error messages by hand with F5.
- Manual check with the real Khiops on a data file (success, missing Khiops, unreadable source, read-only destination folder).

## Risks / Trade-offs

- [The scenario depends on Khiops's GUI action names (`BuildClassDefButton`, `BuildClassDef`, `ClassFileName`, …), which could change in a later Khiops] → the scenario is one function covered by a test and by the manual check against the real binary; a change shows up as `error :` lines (`Invalid command`), reported to the user.
- [A very large data file exceeds 120 s] → reported as a timeout failure with the output channel; the constant is easy to raise. Khiops samples the file to recognize types, so this is expected to be rare; confirm on a large file during manual checks.
- [The destination is open and modified in an editor when it is replaced] → VS Code reloads a clean document and reports a conflict for a modified one; no extra handling.
- [Error messages quote Khiops, in English, with temp or user paths] → acceptable: they are the authority and are copied from the output unchanged.
