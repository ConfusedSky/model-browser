## ADDED Requirements

### Requirement: Renders yield to a search in flight
While a search or similarity request the user asked for is in flight, the render queue SHALL
suspend as it does while an orbit overlay or lightbox is active, and SHALL resume when the
request lands, fails or is superseded by something that is not such a request. Renders for the
view about to be replaced compete with the answer for the page, the GPU and the server, and
the answer is what the user is waiting for. The suspension SHALL NOT stop a render already
started, SHALL NOT hold cached lookups, which run outside the queue, and SHALL NOT be taken by
a background revalidation of the listing on screen or by a plain navigation, whose own tiles
are what the queue would render next.

#### Scenario: A search is not queued behind pictures
- **WHEN** the user submits a search while the grid on screen still has uncached models waiting to render
- **THEN** no new render starts until the search's answer has landed, and rendering then resumes for the answer's tiles

#### Scenario: A refresh does not pause the grid
- **WHEN** a background revalidation of the listing on screen is in flight
- **THEN** the queue keeps rendering that listing's tiles
