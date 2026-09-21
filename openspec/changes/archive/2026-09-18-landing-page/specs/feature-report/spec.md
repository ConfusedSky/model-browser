## MODIFIED Requirements

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
change what an action does or where data is stored. With a known report declaring on
every capability that gates a surface the client had before the report existed, the
client SHALL render byte-identically to a client with no report mechanism at all. A
field whose on state offers a surface the report itself introduced — the visitor
introduction is the first — SHALL be off in that comparison, since there was nothing
before the report for it to be identical to; such a field SHALL move only what it
names, and only on a known report declaring it on.

#### Scenario: Everything on changes nothing
- **WHEN** the report is known and declares on every capability that gates a pre-existing surface, and off every field that offers a surface the report introduced
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

## ADDED Requirements

### Requirement: A deployment may offer a visitor introduction
The report SHALL carry a field declaring whether the visitor introduction — the banner
over the grid, its example queries and surprise action, the header's persistent About
affordance, the placeholder examples and the meaning-mode start (see `visitor-intro`)
— is offered. Its default SHALL be off: the introduction speaks to a visitor who does
not know what the app is, and a personal installation has none. The field names a
surface, not a deployment kind: a deployment that offers the introduction declares this
field on and every other field keeps its own value, and nothing in the report or the
client infers the introduction from any other field. The client SHALL withhold every
surface of the introduction unless a known report declares the field on — withheld
while the report is in flight, when the read failed and when a known report declares
it off — and SHALL withhold the introduction alone, moving no other behaviour. The field
is an offer the client draws or withholds in every surface but one: the introduction's
own document, the About page, is served by the deployment itself, so where a known
configuration declares the field off the deployment SHALL NOT serve that document —
answering the request as not found rather than serving it or falling back to the
client's entry document — and a build that carries the page therefore does not publish
it. A deployment declares the introduction in its configuration, never by what its
build ships.

#### Scenario: Off by default
- **WHEN** the report is read from a server with no configuration
- **THEN** it declares the introduction off

#### Scenario: What the shipped public configuration declares
- **WHEN** the shipped public configuration is loaded
- **THEN** its report declares the introduction **off** — the field is stated in the file, and set off while the introduction and its About page await a reading on the live host — and the configuration's other fields are as they were

#### Scenario: The introduction's document follows the field
- **WHEN** a request names the About page on a deployment whose known configuration declares the introduction off, in any spelling that reaches the file
- **THEN** the deployment answers not found, neither serving the page nor falling back to the client's entry document

#### Scenario: Not inferred
- **WHEN** a deployment declares thumbnail writes and host details off but says nothing about the introduction
- **THEN** no introduction surface is drawn

#### Scenario: Withheld until known
- **WHEN** the report has not resolved, or the read failed
- **THEN** no introduction surface is drawn, and nothing else about the client moves
