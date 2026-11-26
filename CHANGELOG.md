# Changelog

Notable changes to the Khiops Dictionary extension are documented here.

## 0.3.0 - 2026-11-26

- Add completion and hover documentation for instance-building derivation rules. They belong to the next Khiops release, still in development, and are not known to Khiops 11.0.2.
- Check supported instance-building mappings, operand scopes, and call placement against the target dictionary and verified Khiops behavior. `BuildTemporalJoin` is offered for editing, but its semantic checks are not yet enabled.
- Add a command to create a dictionary from a data file using Khiops.

## 0.2.1

- Add checks for dictionary and variable names, variable-block keys and defaults, multi-table schema keys, and invalid statement starts.
- Update the packaging dependency override for a minimatch security advisory.

## 0.2.0

- Check constants, variables, nested calls, secondary-table operands, and scope operators in derivations.
- Complete variables and variable blocks in the appropriate operand scope, and offer `#Missing` for numerical operands.
- Validate and complete date and time format metadata.
- Improve the positioning of native Khiops diagnostics for table-rule operands.
