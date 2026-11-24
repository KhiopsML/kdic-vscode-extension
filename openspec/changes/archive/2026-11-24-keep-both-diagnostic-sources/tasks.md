# Tasks

## 1. Combined diagnostics

- [x] 1.1 Remove `kdic.diagnosticSource` from configuration and runtime source selection; verify built-in diagnostics remain enabled and native availability follows its existing setting.
- [x] 1.2 Simplify the native gate and source-dependent listeners while preserving version-aware results and pending mirror handling; update the native-validation tests and verify built-in errors block native runs while warnings allow them.
- [x] 1.3 Update VS Code host tests and add focused integration cases for disabled or missing native validation and save-time error and warning gates; run the relevant tests.
- [x] 1.4 Update both READMEs and extension-maintainer instructions to remove obsolete source-selection references and describe combined behavior; inspect the updated descriptions.

## 2. Integration verification

- [x] 2.1 Run `npm test` and the relevant VS Code host tests; verify diagnostics, save handling, and configuration changes remain consistent with the combined behavior.
