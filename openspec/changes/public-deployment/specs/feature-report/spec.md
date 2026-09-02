# feature-report Delta

## ADDED Requirements

### Requirement: The report names the surfaces a deployment can withhold
The report SHALL carry a field per withholdable surface rather than one field standing
for several, so that a deployment states what it offers rather than which kind of
deployment it is. It SHALL carry, beside the acceptance of thumbnail writes it already
declares: whether the platform launcher is offered, whether the chat tab is offered, and
whether the operation of the semantic index is the viewer's concern. Each field SHALL
carry its own default rather than every field defaulting on, and the defaults together
SHALL be the configuration this project maintains (see `public-deployment`). The chat
tab's default SHALL be off while the chat has no backend, so that an unfinished surface
is absent from the maintained configuration without ceasing to be declarable.

#### Scenario: A field per surface
- **WHEN** a deployment withholds one surface
- **THEN** it declares that surface's field off and every other field keeps its own value

#### Scenario: Defaults are not all-on
- **WHEN** the report is read from a server with no configuration
- **THEN** it declares each field's own default, which for the chat tab is off

#### Scenario: A withheld surface is still declarable
- **WHEN** a deployment wants a surface whose default is off
- **THEN** it declares that field on and the surface is offered

### Requirement: A declared-off capability is refused at its routes
For every field this capability declares, the routes implementing that capability SHALL
refuse the operation when the field is off, from the same configured value the report is
built from. Withholding the client surface SHALL NOT be treated as sufficient: a request
reaching a route does not have to have come from this project's client, so refusal at
the route is what makes the declaration true. A refusal SHALL be distinguishable from a
failure, so a client can tell "this deployment does not offer that" from "that went
wrong". Refusals SHALL NOT depend on any client having read the report.

#### Scenario: A write refused where writes are declared off
- **WHEN** a thumbnail write arrives at a deployment declaring thumbnail writes off
- **THEN** the route refuses it and nothing is written, whatever client sent it

#### Scenario: A launch refused where the launcher is declared off
- **WHEN** a request to launch or to hand an entry to a chooser arrives at a deployment declaring the launcher off
- **THEN** the route refuses it and no process is spawned

#### Scenario: A refusal is not a fault
- **WHEN** a route refuses an operation its deployment declares off
- **THEN** the answer says the deployment does not offer it, distinguishably from an error

#### Scenario: The declaration and the refusal cannot disagree
- **WHEN** a deployment's configuration is read
- **THEN** the report it publishes and the refusals its routes make come from that one value
