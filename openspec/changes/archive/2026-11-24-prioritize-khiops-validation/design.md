# Design

## Context

`src/extension.ts` maintains separate `kdic` and `khiops` diagnostic collections. Built-in validation runs on open/change with a debounce, while native validation is queued on eligible saves. Native output already maps line-number errors to their source line; errors without a line number currently go to line 0. See `proposal.md` and the `khiops-native-validation` delta for motivation and user-visible requirements.

## Goals / Non-Goals

**Goals:**
- Make the save-time gate use the saved document's current built-in validation result, independent of debounce timing.
- Preserve the existing save eligibility rules, diagnostic collections, and single-source configuration modes.
- Resolve a native error to a declaration only when the dictionary and variable identify a unique location.

**Non-Goals:**
- Expand the built-in validator's grammar or semantic coverage.
- Change settings, run timing, or the behavior of `extension`-only and `khiops`-only modes.
- Require a Khiops executable for tests.

## Decisions

- In `both` mode, calculate or refresh built-in diagnostics from the current document before deciding whether to enqueue Khiops. Do not use the diagnostic collection alone as the gate: its contents can lag behind edits because validation is debounced, and save handling clears diagnostics while refreshing source text. Only built-in errors block a run; warnings do not.
- Apply this decision after the existing save-reason and file-URI checks. If errors block a run, clear that document's `khiops` diagnostics so results from an earlier save do not remain visible. Otherwise use the existing serialized native runner. In `khiops`-only mode, retain native validation without a built-in prerequisite; in `extension`-only mode, do not run Khiops.
- For native error locations, keep explicit Khiops line numbers authoritative. When absent, extract dictionary and variable names from the error and resolve them against declarations in the document. Use a declaration line only for a unique match; retain the current first-line fallback when names are missing, unmatched, or ambiguous. This avoids jumping to a potentially incorrect declaration.
- Keep parsing and gating testable without launching Khiops: cover the decision and location-resolution logic with deterministic tests using representative output and document text. Do not make an installed native binary a test prerequisite.

## Risks / Trade-offs

- Built-in validation at save time can add work to saves, but it is required to avoid a stale or missing gate result; it runs only as part of the existing validation flow.
- Native output wording may not consistently expose dictionary and variable names. Unresolvable cases retain the current first-line location rather than suppressing the error.
- A native run already in flight when a later save is blocked could publish results for older content. Before publishing queued results, verify they still correspond to the current document version; otherwise discard them.

## Migration Plan

No settings or persisted data change. Release the extension with the updated validation flow; rollback consists of reverting the code change.
