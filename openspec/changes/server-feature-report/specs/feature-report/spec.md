# feature-report Delta

## ADDED Requirements

### Requirement: The server reports its capabilities
The server SHALL serve a feature report declaring what this server accepts and offers,
as named capability fields — beginning with whether thumbnail writes are accepted —
never as a mode name. The report SHALL be constructed once at server start, SHALL be
answerable in every library state, and SHALL be truthful: a capability the report
declares on SHALL NOT be refused by the routes it describes, and one it declares off is
expected to be refused there — the change that turns a field off owns setting both from
one source. The report SHALL be advisory, shaping what the client offers; it SHALL
never be the enforcement of anything.

#### Scenario: Answerable before the library is
- **WHEN** the client asks for the report while the server is unconfigured
- **THEN** the report answers normally rather than a not-ready envelope

#### Scenario: No mode is named
- **WHEN** the report is read on any server, however configured
- **THEN** it contains capability fields only, and nothing identifies a deployment kind

### Requirement: The client resolves the report once and shapes surfaces by it
The client SHALL fetch the report once per session through its API client and hold it
in one place surfaces read. A surface gated on a capability SHALL be withheld when the
report declares it off — withheld as the launcher's surfaces are withheld on an empty
report, leaving no gap where it stood. A read that fails SHALL resolve to a report with
every capability on: the report shapes surfaces, the server enforces, so a failed read
costs nothing but the shaping. With every capability on, the client SHALL render
byte-identically to a client with no report mechanism at all.

#### Scenario: Everything on changes nothing
- **WHEN** the report declares every capability on — including by defaulting after a failed read
- **THEN** every surface renders exactly as it did before the report existed

#### Scenario: A withheld capability leaves no trace
- **WHEN** a future consumer gates a surface on a capability the report declares off
- **THEN** the surface is absent rather than disabled, and nothing else moves
