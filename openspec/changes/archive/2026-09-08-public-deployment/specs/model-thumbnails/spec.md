# model-thumbnails Delta

## ADDED Requirements

### Requirement: A deployment may refuse thumbnail writes
Where a deployment declares that it does not accept thumbnail writes (see
`feature-report`), the server SHALL refuse every write to the thumbnail cache — the
rendered image and the stored orientation alike — and SHALL serve what it holds
unchanged. Refusal SHALL be at the route, since the cache is otherwise writable by
anything that can reach it: a rendered image accepted from an anonymous client is that
client's picture of another client's model, and a stored orientation is keyed by path
alone, so accepting one would let any visitor re-frame the model every later visitor
sees.

#### Scenario: A write arrives at a deployment that refuses them
- **WHEN** a client uploads a rendered thumbnail or an orientation to such a deployment
- **THEN** the write is refused, and the cached entry is unchanged for every other client

#### Scenario: Reads are unaffected
- **WHEN** a client reads thumbnails from such a deployment
- **THEN** they are served exactly as they are where writes are accepted

### Requirement: A client whose writes are refused keeps its framings locally
Where the deployment declares thumbnail writes off, the client SHALL persist a model's
orientation in that browser's own storage instead of sending it, and SHALL resolve a
model's orientation by preferring its own stored orientation, then the one the server
holds, then whatever an orientation source supplies, then the default. A locally-held
orientation SHALL affect only the browser holding it. Where the deployment accepts writes, or where the report is unknown or could not be read,
the client SHALL continue to send orientations as it does today: not knowing SHALL NOT
relocate where a user's orientations are stored. A write kept locally SHALL report itself as one whose pixels did not reach the store, so
that anything counting renders counts it as work not done.

#### Scenario: A visitor orbits a model
- **WHEN** a visitor orbits and releases a model on a deployment that refuses writes
- **THEN** the framing is kept in that browser and is there on their next visit

#### Scenario: One visitor's framing is nobody else's
- **WHEN** one visitor has re-framed a model and another opens the same model
- **THEN** the second sees the deployment's own framing, not the first visitor's



#### Scenario: An unknown report does not move a user's orientations
- **WHEN** the report has not resolved or failed to load
- **THEN** orientations continue to be sent to the server as they are today
