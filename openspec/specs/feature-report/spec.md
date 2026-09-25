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

### Requirement: The report names the surfaces a deployment can withhold
The report SHALL carry a field per withholdable surface rather than one field standing
for several, so that a deployment states what it offers rather than which kind of
deployment it is. It SHALL carry, beside the acceptance of thumbnail writes it already
declares: whether the platform launcher is offered, whether the chat tab is offered,
whether the machine the server runs on is the viewer's concern — governing whether any
route or surface may name a location on that machine or offer a remedy only an operator
can perform — and whether maintenance operations against the library are offered. Each field SHALL
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

### Requirement: A deployment may withhold maintenance operations
Where a deployment declares that maintenance operations against the library are not
offered, every route that performs one SHALL refuse. A maintenance operation is one that
acts on the server's own derived state rather than answering a question about the library
— dropping or rebuilding caches, revalidating what was walked, generating or resetting
renders in bulk. These SHALL be refused at the routes rather than merely withheld from the
client, because each is expensive, each acts for every viewer at once, and none of them is
a thing a visitor has any standing to ask for. The client SHALL withhold the surfaces that
launch them, as it withholds any surface a capability declares off. Where a maintenance operation is performed through routes that also serve ordinary
per-entry work, the refusal that reaches it SHALL be the one governing those writes, and
the operation itself SHALL be withheld at its launcher: a bulk reset is a client's loop
over the same write a single model's reset makes, so refusing it as maintenance would
refuse that single reset too. A launcher whose work would be refused for another reason
SHALL NOT be offered at all — bulk work that fills the thumbnail cache is not offered
where thumbnail writes are refused, since it would render and discard.

#### Scenario: A reload is refused
- **WHEN** a request arrives to drop or revalidate the server's caches on such a deployment
- **THEN** it is refused and no cache is dropped and no tree re-walked

#### Scenario: The surfaces that launch them are absent
- **WHEN** a viewer opens a surface that would offer a bulk or maintenance operation
- **THEN** the offer is absent rather than present and inert

#### Scenario: A launcher whose work would be refused anyway is not offered
- **WHEN** a deployment offers maintenance but refuses thumbnail writes
- **THEN** the surface that would fill the thumbnail cache is absent rather than present and inert, since every write it made would be refused

#### Scenario: A personal installation keeps them
- **WHEN** a deployment does not declare this
- **THEN** every maintenance operation is available exactly as it is today

### Requirement: A deployment may declare its host none of the viewer's business
Where a deployment declares that the machine it runs on is not the viewer's concern, no
route and no surface SHALL name **a location on the machine the server runs on** — its
filesystem paths, its configuration and cache directories, and those of any service it
talks to — or offer a remedy only an operator can perform. Library paths are not such
locations and are unaffected: the `library` capability already draws that distinction, and
a library path names an entry within the library rather than a place on anyone's disk. This SHALL hold wherever such a detail is composed today — the library's
top, the locations named by a not-ready library state, any explanation an external
service supplies verbatim, and any instruction to start, mount or re-run something on
the host — because each of them describes a machine the viewer cannot reach and directs
them to a repair that is not theirs. It SHALL therefore also govern how the conditions of
a service the server depends on are reported, since those conditions are named by their
remedies: conditions whose repair is an operator's SHALL be presented as one
unavailability rather than told apart for someone who can act on none of them (see
`semantic-search`). The declaration SHALL default to the host being the
viewer's concern, since on a personal installation the viewer is the operator and these
details are exactly what makes the app useful.

#### Scenario: No host location reaches a viewer
- **WHEN** any route answers on a deployment declaring this
- **THEN** nothing in what it returns names the library's top, the configured root, an enclosed library's location, or a directory belonging to the server or to a service it talks to

#### Scenario: Library paths are untouched
- **WHEN** a route answers with library paths, archive virtual paths, or an error naming a library path
- **THEN** they are unchanged, since a library path names an entry rather than a place on the host

#### Scenario: A service's own words are not a way around it
- **WHEN** an external service supplies explanatory text and the deployment declares this
- **THEN** that text does not reach the client, rather than being withheld from one surface while another route still returns it

#### Scenario: No operator remedy is offered
- **WHEN** a condition arises whose repair is an operator's — a service to start, a volume to mount, a tool to re-run
- **THEN** the viewer is told the state without being told to perform that repair

#### Scenario: A personal installation is unchanged
- **WHEN** a deployment does not declare this
- **THEN** filesystem paths and operator remedies appear exactly as they do today

### Requirement: An offer whose only product is pixels the deployment would not store is withheld
Where everything an offered action produces is a render the deployment would not store, the
client SHALL withhold that offer rather than present it and let the user spend the work. This
SHALL hold whatever the scale of the action: a launcher that loops over a scope and a command
that acts on one entry are withheld by the same reason, since the reason is what the work
produces and not how much of it there is. Such an action cannot report itself honestly either:
it fetches the bytes it operates on, renders them, and the surface it acts on shows the result
until the view is next rebuilt from the deployment, so a user cannot tell it from one that was
kept.

An offer that also writes an **orientation** — one it establishes, or one it gives up — is
outside this requirement, whether that orientation reaches the deployment or is held by the
browser instead. Such an action is not reducible to its pixels: it changes where the model is
shown from, which is the whole of what it claims, and what becomes of an orientation a
deployment declines is `model-thumbnails`' question rather than this one. This requirement
SHALL NOT withhold such an offer; whether one is offered is decided by the action's own
requirement, and `entry-actions` withholds giving a framing up where the deployment does not accept
thumbnail writes (*Refreshing a model's thumbnail and its framing*), while choosing an orbit
axis stands wherever the model's menu does.

An offer SHALL be withheld likewise where the deployment has not yet said what it accepts, so
that nothing is rendered which then vanishes when the answer arrives. Withholding at the
client SHALL NOT replace refusal at the route: the route refuses whatever client asks, and
this requirement governs only what is offered.

#### Scenario: A single-entry render whose pixels would be dropped
- **WHEN** a viewer raises the actions for one entry on a deployment that would not store the render that action produces, and that action produces nothing else
- **THEN** the action is absent rather than present and inert, and no bytes are fetched for it

#### Scenario: Scale is not the reason
- **WHEN** two offers produce the same unstored render and nothing else, one over a scope and one over a single entry
- **THEN** both are absent, by the same stated reason

#### Scenario: An offer that writes an orientation stands
- **WHEN** an offer establishes an orientation for a model — choosing its orbit axis from the tile's menu — on a deployment that would not store the render it draws alongside
- **THEN** the offer stands and the action takes effect, since what it claims is where the model is shown from rather than the image; giving a stored orientation up is not withheld by this requirement either, and is absent there only by `entry-actions`' own rule

#### Scenario: Withheld until the deployment has answered
- **WHEN** a viewer raises such an action before the deployment's report has been read, or after the read failed
- **THEN** the action is absent, and it appears only once a report is known to accept the write

#### Scenario: The route still refuses
- **WHEN** the refused write arrives at its route anyway
- **THEN** the route refuses it, since withholding the offer is not what makes the declaration true

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
