## MODIFIED Requirements

### Requirement: Simple derivation type checks
The validator SHALL compare recognized simple calls with registered rule types, without claiming complete derivation analysis. Argument diagnostics SHALL use the current dictionary only when the operand is known to have current scope.

#### Scenario: Return type mismatch
- **WHEN** a simple call to registered `TableCount` is assigned to a `Categorical` variable
- **THEN** the validator reports a return-type error

#### Scenario: Argument mismatch
- **WHEN** a simple `TableCount` call uses a declared `Categorical` variable as its first argument
- **THEN** the validator reports an argument-type error

#### Scenario: Missing argument variable
- **WHEN** a simple call has a current-scope bare identifier argument with a known expected type that is not declared in the current dictionary
- **THEN** the validator reports an undeclared-variable warning

#### Scenario: Secondary operand with a conflicting local name
- **WHEN** `TableMean(achats, montant)` uses `achats` as a table and the current dictionary declares a `Categorical montant` while the secondary dictionary declares a `Numerical montant`
- **THEN** the validator does not report an argument-type error based on the current dictionary's `montant`

#### Scenario: Secondary operand absent locally
- **WHEN** `TableMean(achats, montant)` refers to a secondary-table operand not declared in the current dictionary
- **THEN** the validator does not warn that `montant` is undeclared in the current dictionary

#### Scenario: Later current-scope operand
- **WHEN** `TableDifference(first, second)` has `first` declared as a table and `second` declared as `Categorical` in the current dictionary
- **THEN** the validator reports an argument-type error for `second`

#### Scenario: Uncertain operand scope
- **WHEN** a recognized simple call has an operand whose scope cannot be determined reliably
- **THEN** the validator does not issue a type mismatch or undeclared-variable warning for that operand based on the current dictionary

#### Scenario: Nested call
- **WHEN** a derivation contains nested function calls
- **THEN** the simple-call checks do not establish that the nested expression is semantically valid
