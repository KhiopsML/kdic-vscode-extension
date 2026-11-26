# Design

## Context

See `proposal.md` for motivation and the spec for observable behavior.

- The user selected the **documented 11.0.2 reference**, an advisory warning for **any difference**, and both native validation and dictionary creation.
- Observed locally on 2026-11-26: `/Applications/Khiops.app/Contents/Resources/bin/MODL -v` exits successfully and prints `Khiops 11.0.3-a.0`.
- `khiops-runner.ts` owns discovery and process execution, without VS Code imports. `execKhiops` currently hardcodes batch arguments and preserves `.cmd` shell launching and `KHIOPS_PROC_NUMBER=1`.
- `extension.ts` already owns one output channel and trace callback shared by the diagnostics controller and creation command. It is the natural owner of a session-scoped check.
- Native runs are serialized and discard stale results; creation waits for header selection and overwrite confirmation before running. Standalone mocks currently assume every process invocation is a batch scenario, so they must distinguish `-v`.
- `create-dictionary-from-data-file` is implemented and all its tasks are checked. Do not edit that change's planning artifacts for this new behavior.

## Goals / Non-Goals

**Goals:**
- Keep the check asynchronous, bounded and shared, without another VS Code-importing module.
- Preserve existing validation gates, creation failure handling and binary discovery.
- Make detection failures visible rather than silently treating them as compatibility.

**Non-Goals:**
- SemVer ordering, a compatibility matrix, automatic rule selection or downloading documentation.
- A configurable reference version, a setting to suppress warnings, or blocking native operations.
- Detecting replacement of an executable in place during the same activation. Restarting the extension refreshes the check; path changes use independent checks.
- Changing how batch process failures, unrelated diagnostics or corpus validation are handled.

## Decisions

### One explicit documentation reference

Export `KHIOPS_REFERENCE_VERSION = '11.0.2'` from the plain runner module so runtime comparison has one code source. Extend the existing reference-version maintenance checklist in `.github/copilot-instructions.md` to update this value alongside the READMEs when the targeted documentation changes.

Do not fetch khiops.org at runtime or read Markdown to discover a version. The measurement version 11.0.3-a.0 stays documented separately and is not the comparison target.

### A bounded version probe in the existing runner

Add a plain `readKhiopsVersion(binary, trace)` helper to `khiops-runner.ts`, returning a typed success with the full version and output, or a failure with reason and output. It invokes only `-v`, with a five-second timeout and bounded captured output (64 KiB); a failed process is a detection failure even if its output contains a version.

Reuse the platform command/options preparation used by batch runs, extracting only that small piece if necessary. Preserve `.cmd` handling and quoted executable paths on Windows, environment conventions, and existing batch timeouts, log files and results. Do not route `-v` through the hardcoded batch scenario arguments or create temporary scenario/log files for it.

Parse a complete product/version line `Khiops <major>.<minor>.<patch>[suffix]`, allowing surrounding whitespace and LF/CRLF, from captured stdout/stderr. Preserve standard prerelease and build suffixes (including `-a.0` and `+custom`). Accept repeated identical product/version lines, but reject different version identifiers or unsupported output. Do not accept an unrelated number in a log or a file path as the runtime version. Compare the extracted identifier with the reference by equality, not numeric ordering.

*Alternative:* invoke a bare `MODL` from PATH. Rejected because the version must belong to the same executable chosen by existing discovery.

### One session-scoped check passed to both callers

In `activate()`, create an async `checkKhiopsVersion(binary)` function with a `Map<string, Promise<void>>`, keyed by the resolved absolute binary path. Cache the whole pending check before another caller can request it, not just its eventual result. The first caller probes and reports; later validation/creation requests await the same promise. Cache both successful comparisons and reported failures until disposal/reload. A new path gets a new probe; returning to an old path does not repeat it.

Pass the function to `DiagnosticsController` and `registerDictionaryCreation`, as with the existing trace/output dependencies:

- In the serialized native queue, await it immediately before `runKhiops`. Recheck that the document is current and the binary is still the active configured validation binary after the await; a user edit, disabling validation or path change during the probe must not start an obsolete run.
- In dictionary creation, await it inside the existing progress operation after header choice and any overwrite confirmation, immediately before the builder. Cancellation must not probe or run Khiops.
- No version checks on built-in-only edits, discovery alone, skipped saves or failed source eligibility.

The probe may delay the first operation by at most five seconds. This is separate from the existing batch timeout. Concurrent operations do not share batch runs, only version checking.

*Alternative:* separate caches in validation and creation. Rejected because it repeats work and warns twice for one installation.

### Advisory notification, not a confirmation or diagnostic

For a mismatch, append the binary path and both versions to the shared output channel regardless of debug settings, then show:

`Khiops <detected> differs from the extension's reference version <reference>. Built-in language support follows the reference documentation. The requested operation will continue.`

For a detection failure, append the path, reason and complete captured output, then warn that the version could not be determined and the operation will continue. Both warnings offer **Show Output**. Do not await dismissal or the action selection before returning from the check; handle the action asynchronously to reveal the channel. Debug traces additionally include the `-v` command and output.

Matching versions produce no notification. Version checks publish no diagnostic, and never decide the success of the later validation or creation scenario. Existing missing-binary messages remain unchanged.

*Alternative:* block on mismatch or failure. Rejected by the user's explicit non-blocking choice.

### Focused test coverage with existing tools

- Add `scripts/khiops-version-test.js` to `npm test` for parser and real child-process behavior against tiny mock executables: exact match, whitespace/CRLF, older/newer versions, prerelease/build suffixes, ambiguous/malformed output, stderr, non-zero status, start failure and timeout. Include Windows `.cmd` coverage where supported; no new dependencies.
- Update batch-only mocks in existing command/builder and host tests as needed so `-v` does not count as a validation or creation run or attempt to read scenario arguments.
- Extend the VS Code host runner to assert the warning details and that validation and creation still execute on a mismatch and detection failure; one probe/warning across repeated or concurrent calls and both features; independent probe after changing the binary path; and no probe after cancellation or built-in-error gating.
- Keep prompts mocked only for the target extension and restore them in `finally`, following the existing creation host test. Check that edits or settings changes while a probe is pending prevent stale native execution.
- Confirm with the installed binary that 11.0.3-a.0 is read intact and differs from 11.0.2, without changing the configured reference.

## Risks / Trade-offs

- [Exact matching warns about a compatible newer or prerelease version] -> Intentional user choice; wording describes a documentation difference, not proven incompatibility, and operations continue.
- [A wrapper emits another version format] -> Explicit detection warning and retained output; do not guess from arbitrary numbers.
- [A cached failure or replaced binary is not re-probed in the same activation] -> At most one warning per path; restart the extension after an in-place installation change.
- [First eligible operation waits for a slow probe] -> Five-second process bound and shared in-flight promise; preserve stale-document/configuration checks after waiting.
- [Reference code and documentation drift] -> One code constant and the existing release checklist, extended to name it.
