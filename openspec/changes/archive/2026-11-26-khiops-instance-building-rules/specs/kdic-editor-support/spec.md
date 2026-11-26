# Spec Delta

## ADDED Requirements

### Requirement: Instance-building rule completion and hover
The extension SHALL offer each supported instance-building rule in derivation completion and show its documented signature and description on hover.

#### Scenario: Completing a supported rule
- **WHEN** completion is requested in a derivation where rule suggestions are available
- **THEN** the supported instance-building rules are offered with their rule category

#### Scenario: Hovering a supported rule
- **WHEN** the user hovers a supported instance-building rule name
- **THEN** the hover shows its signature and documentation, including its target dictionary and output mapping when applicable

### Requirement: Instance-building operand completion
The extension SHALL suggest operands from the dictionary in which each documented source operand is evaluated, and target variables for output names after `:`.

#### Scenario: Source operands from related tables
- **WHEN** completion is requested for a source operand of a supported instance-building rule that reads one or more related tables
- **THEN** suggestions come from the corresponding source-table dictionary or dictionaries, not an unrelated dictionary

#### Scenario: Output mapping
- **WHEN** completion is requested for an output name after `:` in a supported instance-building rule
- **THEN** suggestions come from the target dictionary declared by the containing `Entity` or `Table` variable

#### Scenario: Unresolved source or target dictionary
- **WHEN** the dictionary for a source operand or output mapping cannot be determined unambiguously
- **THEN** the extension offers no variable suggestions for that operand
