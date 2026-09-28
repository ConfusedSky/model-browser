## ADDED Requirements

### Requirement: Versioned byte requests are served from a copy near the visitor
The public deployment SHALL serve a request for a thumbnail's pixels or a model's derived
mesh from a store held near the visitor, instead of from the origin, when and only when
the request names the version it is asking for — the thumbnail's generation, or the
source's modification time — as the application's own cacheability rules define them (see
`public-deployment`, *Model byte responses are cacheable by the version they name*, and
`model-thumbnails`). A version SHALL be identified by its numeric value, so that two
spellings of the same number are one entry in the store.

The store SHALL hold only answers that the origin itself declared publicly cacheable and
immutable for exactly the version the request named, stored when a request first misses
the store and the origin gives such an answer. The store SHALL NOT replace an entry it
already holds, SHALL NOT hold any answer the origin declared otherwise — an error, a
not-found, an answer for a version other than the one named, or one naming no version —
and SHALL be readable by nothing but the deployment's own edge.

An answer served from the store SHALL carry the same bytes, status and cacheability,
validator, content-type, content-sniffing and cross-origin headers as the origin's
immutable answer for that version, so that the application's guarantees about those
headers hold whichever served it. Every answer on these routes MAY additionally say which
path served it — the store, the origin with the store filled, or the origin untouched — so
that the rule can be observed from outside; that header SHALL be the only difference.

The store SHALL be partitioned by an epoch that the deployment's operator advances as the
last step of any change that can supersede a version — shipping a bake, or changing the
corpus — so that advancing it makes every entry stored before it unreachable at once. The
server's own rules answer a request naming a superseded version with the current bytes
(see the requirements cited above), and those rules are unchanged; what this rule adds is
that between such a change and the epoch advancing, the store MAY answer a request naming
a version superseded by that change with the bytes it held for that version. Nothing else
on the deployment supersedes a version — it accepts no thumbnail writes and its corpus is
read-only between changes — so that window is the only one, it is bounded by the
operator's own step, and it closes without any visitor action.

Every request the rule does not cover SHALL reach the origin exactly as it would without
this rule: one that names no version, a malformed or non-finite version, an entry inside
an archive, a ranged or conditional request, any method other than GET, a request from a
region for which the origin is itself the near copy, and any request arriving while the
store or the edge layer serving it is failing or over its limits. Removing the edge layer
SHALL restore the deployment's behaviour as it was before this rule, with no change to the
application, its configuration or its client.

#### Scenario: A versioned thumbnail is answered from the store
- **WHEN** a visitor outside the origin's region requests a thumbnail naming its current generation, and the store already holds that generation's render
- **THEN** the render is served from the store with the same bytes and headers the origin's immutable answer carries, and the origin is not asked

#### Scenario: First touch fills the store
- **WHEN** a visitor requests a model's mesh naming its current modification time, and the store holds nothing under that version
- **THEN** the visitor receives the origin's answer, and the store afterwards holds that answer so that the next request naming the same version is served from the store

#### Scenario: Nothing the origin did not pin is stored
- **WHEN** a request names a version the origin does not currently have, and the origin answers with the current bytes declared uncacheable without revalidation
- **THEN** the visitor receives that answer and the store holds nothing for that request

#### Scenario: A request naming no version is untouched
- **WHEN** a thumbnail or mesh is requested without a version
- **THEN** it reaches the origin as it does without the edge layer, and nothing is stored

#### Scenario: An archive entry is untouched
- **WHEN** a mesh is requested for an entry inside an archive
- **THEN** it reaches the origin as it does without the edge layer, whatever version it names

#### Scenario: The near copy for the origin's region is the origin
- **WHEN** a visitor in the origin's region requests a versioned thumbnail or mesh
- **THEN** the request is served by the path it takes without the edge layer, not from the store

#### Scenario: A store failure is not the visitor's
- **WHEN** the store cannot be read or written, or the edge layer is past its daily request limit
- **THEN** the visitor receives the origin's answer, as without the edge layer, and no error the origin would not have given

#### Scenario: One version, one entry
- **WHEN** two requests name the same version with two spellings of the same number
- **THEN** both are answered from the same entry in the store

#### Scenario: Advancing the epoch retires every stored version
- **WHEN** a bake is shipped, a request names a thumbnail's previous generation, and the operator has advanced the epoch
- **THEN** the request is not answered from anything stored before the advance, and receives what the origin answers for a superseded generation

#### Scenario: Before the epoch advances, a superseded version may still be stored
- **WHEN** a bake has been shipped but the epoch has not yet been advanced, and a request names a generation that shipment superseded
- **THEN** the store may answer with the render it holds for that generation, and it stops doing so once the epoch advances

#### Scenario: Removing the edge layer is the rollback
- **WHEN** the edge layer's routes are removed
- **THEN** every request reaches the origin exactly as it did before this rule, with no application, configuration or client change
