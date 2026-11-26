# khiops-dictionary-creation Specification

## Purpose
Let users create a Khiops dictionary (`.kdic`) from a data file selected in the IDE, using the Khiops binary, without leaving a partial or wrong result behind when something fails.

## Requirements

### Requirement: Dictionary creation entry points
The extension SHALL offer the command "Create Khiops Dictionary from This File" in the Explorer file context menu, the editor tab context menu and the Command Palette. It SHALL accept one local file other than a `.kdic` file.

#### Scenario: Data file selected
- **WHEN** the user right-clicks one local file such as `Adult.txt` in the Explorer
- **THEN** the context menu contains the command

#### Scenario: Folder, dictionary or multiple selection
- **WHEN** the user right-clicks a folder, a `.kdic` file, or a selection of several files
- **THEN** the Explorer context menu does not contain the command

#### Scenario: Editor tab
- **WHEN** the user invokes the command from the context menu of an eligible file's editor tab
- **THEN** that tab's file is used, even if another editor is active

#### Scenario: Palette with an active file
- **WHEN** the user invokes the command from the Command Palette and an eligible local file is active
- **THEN** the active file is used

#### Scenario: Palette without an active file
- **WHEN** the user invokes the command from the Command Palette and no file is active
- **THEN** the extension offers a file picker to select one local file
- **AND** cancelling the picker starts no Khiops run and creates no dictionary

#### Scenario: Ineligible input
- **WHEN** the selected or active resource is not a local file or is a `.kdic` file
- **THEN** the extension explains that an eligible local data file is required and does not run Khiops or create a dictionary

#### Scenario: Path contains a line break
- **WHEN** the source or destination path contains a carriage return or line feed
- **THEN** the extension shows an error explaining that the path cannot be used in a Khiops scenario
- **AND** Khiops is not started and the destination is unchanged

### Requirement: Dictionary destination
The extension SHALL write the dictionary in the folder of the source file, under the name of the source file with its extension replaced by `.kdic`, or with `.kdic` appended when it has none.

#### Scenario: File with an extension
- **WHEN** the user creates a dictionary from `/data/Adult.txt`
- **THEN** the dictionary is `/data/Adult.kdic`

#### Scenario: Several dots or no extension
- **WHEN** the user creates a dictionary from `/data/my.data.csv` or from `/data/census`
- **THEN** the dictionaries are `/data/my.data.kdic` and `/data/census.kdic`

### Requirement: Source header choice
For each creation, the extension SHALL ask whether the source has a header, explaining that a header supplies column names and that without one the first line is data. It SHALL pass the selected option to Khiops before building the dictionary.

#### Scenario: Source has a header
- **WHEN** the user selects the header option
- **THEN** Khiops is instructed to use the first line as column names

#### Scenario: Source has no header
- **WHEN** the user selects the no-header option
- **THEN** Khiops is instructed to treat the first line as data

#### Scenario: Header choice cancelled
- **WHEN** the user dismisses the header choice
- **THEN** Khiops is not run, no destination is created and any existing destination remains unchanged

### Requirement: Dictionary built by Khiops
The extension SHALL have Khiops build the dictionary from the source file with its "Build dictionary from data table" action, run in batch mode, and SHALL use the dictionary Khiops saves as is. The dictionary is built from that file alone: no other file is read or written by the extension besides its temporary files.

#### Scenario: Successful creation
- **WHEN** Khiops builds a dictionary from the source file without reporting any error
- **THEN** the destination file contains the dictionary saved by Khiops
- **AND** the dictionary is opened in the editor

#### Scenario: Progress
- **WHEN** Khiops is running
- **THEN** a progress notification names the source file until the run ends

### Requirement: Confirmation before overwriting
The extension SHALL ask the user to confirm before replacing an existing destination file, and SHALL NOT start Khiops if the user declines.

#### Scenario: Destination exists, user confirms
- **WHEN** the destination file exists and the user confirms the replacement
- **THEN** Khiops runs and, on success, the destination is replaced by the new dictionary

#### Scenario: Destination exists, user declines
- **WHEN** the destination file exists and the user declines or dismisses the confirmation
- **THEN** Khiops is not run and the destination file is unchanged

### Requirement: Khiops binary required
The extension SHALL locate Khiops as native validation does (`kdic.khiopsPath`, then the platform's default locations), independently of `kdic.enableKhiopsValidation`. When no binary is found, it SHALL show an error message and create nothing.

#### Scenario: Binary not found
- **WHEN** the command runs and no Khiops binary is found
- **THEN** an error message tells the user that Khiops was not found and that `kdic.khiopsPath` can be set
- **AND** no file is created and an existing destination is unchanged

#### Scenario: Native validation disabled
- **WHEN** `kdic.enableKhiopsValidation` is false and a Khiops binary is available
- **THEN** the command creates the dictionary normally

### Requirement: Khiops errors
The extension SHALL treat any `error` line in the Khiops output, including `fatal error`, as a failure, whatever the exit status. It SHALL show an error message with the first error reported and write the full Khiops output to the `Khiops` output channel. It SHALL NOT publish diagnostics.

#### Scenario: Unreadable data file
- **WHEN** Khiops reports `error : File … : Unable to open file` for the source file
- **THEN** an error message shows that error
- **AND** the full output is available in the `Khiops` output channel
- **AND** no destination file is created and no diagnostic is added to the Problems panel

#### Scenario: Error with a successful exit status
- **WHEN** Khiops reports an error such as an unwritable output file but exits with status 0
- **THEN** the run is a failure and the error is shown as above

#### Scenario: Several errors
- **WHEN** Khiops reports several errors
- **THEN** the error message contains the first and tells how many others the output channel lists

### Requirement: Failure to run Khiops
The extension SHALL report as an error, and create nothing, a Khiops process that cannot be started, ends with a non-zero status without an `error` line, exceeds the time limit, or ends without having produced a dictionary file.

#### Scenario: Abnormal end
- **WHEN** Khiops exits with a non-zero status and no `error` line, or exits without producing a dictionary
- **THEN** an error message says that Khiops did not create the dictionary and refers to the `Khiops` output channel
- **AND** no destination file is created and an existing destination is unchanged

### Requirement: No partial result
The extension SHALL let Khiops write its dictionary to a temporary location and SHALL copy it to the destination only after a run without errors. Temporary files SHALL be removed once the run ends, whatever its outcome.

#### Scenario: Failed run over an existing dictionary
- **WHEN** the user confirmed the replacement of an existing dictionary and the Khiops run fails
- **THEN** the existing dictionary is unchanged

#### Scenario: Temporary files
- **WHEN** a run ends, successfully or not
- **THEN** no temporary scenario, output or dictionary file of that run remains

#### Scenario: Destination cannot be written
- **WHEN** Khiops succeeds but the destination cannot be written (read-only folder or file)
- **THEN** an error message gives the destination and the reason, and an existing destination is unchanged

### Requirement: Debug traces
The extension SHALL write the Khiops command line, the source and destination paths and the Khiops output of each creation to the `Khiops` output channel when `kdic.enableDebugTraces` is enabled.

#### Scenario: Debug enabled
- **WHEN** debug traces are enabled and a creation runs
- **THEN** the output channel receives the command line, the paths and the output of that run
