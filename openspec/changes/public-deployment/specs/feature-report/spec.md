# feature-report Delta

## ADDED Requirements

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
launch them, as it withholds any surface a capability declares off. A surface SHALL be
governed by the capability that describes what it does rather than by whichever capability
existed when it was written: bulk work that destroys derived state is a maintenance
operation, while bulk work that fills the thumbnail cache is governed by the capability for
writing thumbnails, since with those writes refused it would render and discard.

#### Scenario: A reload is refused
- **WHEN** a request arrives to drop or revalidate the server's caches on such a deployment
- **THEN** it is refused and no cache is dropped and no tree re-walked

#### Scenario: The surfaces that launch them are absent
- **WHEN** a viewer opens a surface that would offer a bulk or maintenance operation
- **THEN** the offer is absent rather than present and inert

#### Scenario: Bulk work is gated by what it does
- **WHEN** a deployment accepts thumbnail writes but withholds maintenance
- **THEN** the surface that fills the thumbnail cache is offered and the one that destroys stored framings is not, and the reverse configuration offers the reverse pair

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
