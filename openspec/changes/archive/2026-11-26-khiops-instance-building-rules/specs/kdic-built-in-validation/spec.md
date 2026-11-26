# Spec Delta

## ADDED Requirements

### Requirement: Instance-building output mappings
For instance-building signatures verified on the target Khiops binary, the validator SHALL distinguish source expressions from target-variable names after `:`.

#### Scenario: Explicit target mapping
- **WHEN** a supported instance-building call maps source expressions to variables of its declared target dictionary after `:`
- **THEN** source expressions are checked in their source scope and mapped names are checked against the target dictionary, without treating target names as source operands

#### Scenario: Invalid target mapping
- **WHEN** a supported instance-building call names an undeclared target variable or maps a source expression to an incompatible target type
- **THEN** the validator reports a diagnostic at the relevant mapping

### Requirement: Multiple source-table scopes
The validator SHALL resolve each verified instance-building source operand in the dictionary of the source table it describes.

#### Scenario: Temporal join operands
- **WHEN** a `BuildTemporalJoin` call uses source and historical time expressions from its two input tables
- **THEN** each expression is checked in its respective table dictionary, and supported temporal types are checked against the rule's documented constraints

#### Scenario: Unresolved source dictionary
- **WHEN** an input table does not resolve to exactly one dictionary in the file
- **THEN** the validator does not report undeclared-variable or type-mismatch diagnostics based on an assumed current scope

### Requirement: Instance-building call placement
The validator SHALL check placement restrictions for instance-building rules that are verified on the target Khiops binary.

#### Scenario: Rule used as an operand
- **WHEN** a verified instance-building rule is nested as an operand of another rule
- **THEN** the validator reports that the instance-building rule cannot be used as a nested operand

#### Scenario: Result assigned to an incompatible declaration
- **WHEN** a verified instance-building rule is assigned to a declaration whose type is not the rule's documented `Entity` or `Table` result
- **THEN** the validator reports a return-type diagnostic
