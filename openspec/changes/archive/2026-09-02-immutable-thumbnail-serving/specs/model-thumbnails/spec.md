# model-thumbnails Delta

## ADDED Requirements

### Requirement: Thumbnail responses are cacheable by their key
Every stored thumbnail entry SHALL carry a write generation that moves on every write to
that entry — a render landing, a camera or axis set or discarded — and never regresses,
including across eviction and re-creation. A thumbnail read that names the current
generation SHALL be answered as immutable, cacheable indefinitely, since any later
change to the entry moves subsequent reads to a different key; a read that names a
generation that is no longer current SHALL be answered with the current content and
generation, marked uncacheable, so the reader re-keys. A read that names no generation
SHALL be answered with a validator derived from the generation, so an unchanged entry
costs a revalidation rather than a re-download. A response that is not a hit SHALL never
be cacheable. Reads and writes SHALL echo the entry's generation, and the server SHALL
store one copy of each render regardless of how many generations readers have cached —
the generation is a key, not a version store.

#### Scenario: A revisit re-downloads nothing
- **WHEN** a tile whose generation the client knows is fetched again and the entry has not changed
- **THEN** the browser serves it from its own cache without contacting the server

#### Scenario: An orbit is never pinned over
- **WHEN** a client caches a tile as immutable and an orbit then saves a new camera for that entry
- **THEN** the write moves the generation, the next fetch uses the new key, and the pre-orbit response is never served for it

#### Scenario: A generation-less fetch costs a revalidation, not a payload
- **WHEN** a client that does not know an entry's generation fetches an unchanged tile it has seen before
- **THEN** the answer is a not-modified revalidation rather than the full response body

#### Scenario: A miss never sticks
- **WHEN** a fetch answers a miss and a render for that entry then lands
- **THEN** the next fetch reaches the server and answers the render, not a cached miss

#### Scenario: Eviction does not resurrect old keys
- **WHEN** an entry is evicted and later re-created from a fresh render
- **THEN** its generation is above every generation previously issued for that path, and no previously cached response is served for the new content
