# feature-report Specification

## Purpose
The feature report is how the client learns what this server accepts and offers —
named capability fields, never a deployment kind — so one client build serves every
deployment and no surface ever branches on a mode it would have to be told about.
It is advisory by definition: the report shapes what the client offers, while
refusing an action stays the routes' own job, owned by whichever change turns a
field off, from one source. The client withholds gated offers until a known report
opens them (nothing flashes, nothing opens on error) and moves a behavior with an
existing default only on an explicitly declared value, so a failed read can never
silently relocate a user's data. Established by the change `server-feature-report`
(archived 2026-09-02); the reasoning behind each requirement is in that change's
design.md (D1–D4), and the launcher's report-driven withholding is the precedent
the whole capability generalizes.
## Requirements
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
The client SHALL fetch the report through its API client and hold it in one place
surfaces read. A surface gated on a capability SHALL be withheld unless a known
report declares that capability on — withheld while the report is in flight, withheld
when the read failed, and withheld when a known report declares it off, in every case
as the launcher's surfaces are withheld on an empty report, leaving no gap where a
surface stood. A report that has not resolved SHALL be retried on each navigation
until it resolves, so a server that answers late becomes fully usable without a
reload. A capability's absence of knowledge SHALL only ever withhold an
offer: a behavior with an existing default SHALL keep that default unless a known
report explicitly declares its capability off — not knowing must never silently
change what an action does or where data is stored. With a known report declaring
every capability on, the client SHALL render byte-identically to a client with no
report mechanism at all.

#### Scenario: Everything on changes nothing
- **WHEN** the report is known and declares every capability on
- **THEN** every surface renders exactly as it did before the report existed

#### Scenario: No flash of a denied surface
- **WHEN** a future consumer gates a surface on a capability a server declares off, and the report has not yet arrived
- **THEN** the surface is withheld from the first render, not shown and then withdrawn when the report lands

#### Scenario: A failed read never opens a surface
- **WHEN** the report read fails
- **THEN** gated surfaces stay withheld, and the report is retried on the next navigation rather than assumed

#### Scenario: Not knowing does not move a behavior
- **WHEN** a behavior with an existing default is tied to a capability, and the report is unknown or failed
- **THEN** the behavior keeps its existing default, changing only when a known report explicitly declares that capability off

#### Scenario: A withheld capability leaves no trace
- **WHEN** a future consumer gates a surface on a capability the report declares off
- **THEN** the surface is absent rather than disabled, and nothing else moves

