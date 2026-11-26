# Proposal

## Why

Writing a first `.kdic` by hand for an existing data table is tedious: every column must be declared with the right type. Khiops can build that dictionary from the data itself ("Build dictionary from data table"), but only through its GUI. The extension already drives the Khiops binary in batch mode to check dictionaries; the same mechanism can create one from a file selected in the IDE.

## What Changes

- Add a command **Create Khiops dictionary from this file**, offered in the Explorer file context menu, the editor tab context menu and the Command Palette. From the palette it uses the active file, or offers a file picker when there is no active file.
- For each creation, let the user indicate whether the first line contains column names or data; pass that choice to Khiops.
- The command runs Khiops in batch mode with a scenario that builds a dictionary from the selected data file, and writes it next to the source file under the same name with the extension `.kdic` (`Adult.txt` → `Adult.kdic`).
- Paths containing line breaks are rejected with a visible error before running Khiops, because they cannot be safely embedded in a scenario.
- The dictionary is created in a temporary file first and is copied to its destination only when Khiops reported no error: nothing is created, and an existing dictionary is left untouched, when Khiops is not found or reports errors.
- If the destination already exists, the user is asked to confirm before it is replaced.
- Khiops is located exactly as for native validation (`kdic.khiopsPath`, then the platform's default locations). If it is not found, an error message is shown and nothing is created.
- If Khiops prints errors, they are shown in an error message and in the `Khiops` output channel; no diagnostic is published.
- After a successful creation, the new dictionary is opened in the editor.

## Capabilities

### New Capabilities

- `khiops-dictionary-creation`: creating a `.kdic` file from a data file through the Khiops binary, from the Explorer context menu: scenario, destination, overwrite confirmation, error reporting and no partial result.

### Modified Capabilities

None. Binary discovery and the settings of `khiops-native-validation` are reused unchanged; the new capability depends on them without altering their requirements.

## Impact

- `package.json`: new command and Explorer, editor tab and Command Palette contributions; activation by command.
- New module `src/dictionary-creation.ts` (command, imports `vscode`); `src/khiops-runner.ts` gains the creation scenario and a run function that shares the process handling of the check run (no `vscode` import); `src/extension.ts` registers the command.
- Tests: a unit test of the scenario and of the output analysis, run by `npm test`; a host test with the mock Khiops of `scripts/vscode-host-tests/`.
- Documentation: `README.md`, `README.extension.md`, `.github/copilot-instructions.md` (module map) and the instructions in `.github/instructions/`.
- No new setting, no new dependency.
