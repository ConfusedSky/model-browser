## ADDED Requirements

### Requirement: The environment overrides single keys
Beside the root, the environment SHALL be able to override each capability field the feature report declares and the listing tree cache switch, one environment variable per key, each named for the key it overrides under one mechanical rule so that a capability added to the report is overridable the moment it has a default. An override SHALL replace that one key alone — the file's other settings, and the other fields of the same capability object, SHALL remain in force — and SHALL be applied where the file is read, so that everything downstream reads one resolved configuration rather than re-applying the precedence. A boolean override SHALL accept exactly the spellings `1`, `true`, `0` and `false`; an unset or blank variable SHALL mean no override; any other value SHALL be a startup failure naming the variable and the accepted spellings, since a switch silently read as its default would run what the operator meant to turn off. An override SHALL never mint a name already read by this server for another purpose.

#### Scenario: One field from the environment, the rest from the file
- **WHEN** the file declares several capabilities and the environment overrides one of them
- **THEN** that one field takes the environment's value and every other declared field, and every other key of the file, takes effect as written

#### Scenario: The cache switch from the environment
- **WHEN** the environment turns the listing tree cache off and the file says nothing about it, or says on
- **THEN** the server runs with the cache off

#### Scenario: A misspelled boolean stops the server
- **WHEN** an override variable carries a value that is none of the four accepted spellings
- **THEN** startup fails naming that variable and the spellings it accepts, and the server does not run on the default

#### Scenario: Blank is not an override
- **WHEN** an override variable is present but empty
- **THEN** the file's value, or the default, is used exactly as if the variable were unset
