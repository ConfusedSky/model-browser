## ADDED Requirements

### Requirement: A lookup may ask for no pixels
A thumbnail lookup SHALL be able to ask for an entry's answer without the render's
bytes. Notwithstanding *A thumbnail exists per occlusion recipe*'s rule that a read
receives the named render's status, pixels and labels, a read that asks for no pixels
SHALL receive that render's status, labels, camera and axis and no pixels at all. The
ask SHALL be named the way the occlusion setting is: a value meaning pixels and a value
meaning none, an absent ask meaning pixels, and any other value refused as a bad request
— so that a client written before the ask existed sends exactly the request it always
sent and receives exactly the answer it always received.

The status SHALL be decided identically for both asks: whether the render's bytes can be
served, not whether they were sent. A lookup that withholds the pixels SHALL NOT report
as a hit a render that a lookup taking the pixels would report as stale.

A withholding read SHALL advance the render's least-recently-read clock exactly as a
read taking the pixels does, and SHALL be answered under the same cache tiers — the two
asks being distinct resources, so that no cache between client and server can answer one
with the other's body.

A client asking for no pixels SHALL NOT expose a decoded image for that answer, whatever
the answer carries.

#### Scenario: The orientation costs no render
- **WHEN** a caller looks up a cached thumbnail asking for no pixels
- **THEN** it is told the render is a hit and given the entry's camera, axis and recipe labels, and no pixels are transferred or decoded

#### Scenario: Withholding does not soften the verdict
- **WHEN** an entry's recorded render cannot be served — its file is gone — and a lookup asks for no pixels
- **THEN** the answer is stale, exactly as it is for a lookup that asked for the pixels, and the caller re-renders

#### Scenario: A client that does not know the ask is unaffected
- **WHEN** a client written before the ask existed requests a thumbnail
- **THEN** its request is byte-identical to the one it always sent and the answer carries the render as before

#### Scenario: A bad ask is refused
- **WHEN** a lookup names a value for the ask that is neither of the two it defines
- **THEN** the request is refused as a bad request naming the value, and no thumbnail is read

#### Scenario: The two asks do not share a cached answer
- **WHEN** the same entry is looked up both ways by the same client
- **THEN** each ask is its own resource with its own cached answer, and neither is ever served the other's body

## MODIFIED Requirements

### Requirement: Cached thumbnails are served as images
The server SHALL answer a cached thumbnail's stored bytes as an image response — typed by the encoding those bytes are in, `image/webp`, no envelope — at an image route keyed exactly as the thumbnail lookup is keyed: path, mtime, occlusion variant, and write generation. The image route SHALL apply the same cache tiers as the lookup: an answer whose request names the entry's current generation SHALL be marked immutable; one that names none SHALL be validatable by the entry's generation; one that names a superseded generation SHALL carry the current bytes and SHALL NOT be cacheable, so a stale URL never shows stale pixels. A request for anything but a hit — a thumbnail the cache does not hold, or holds only as stale — SHALL be answered not-found and SHALL NOT be cached. The image route SHALL be confined as the lookup is, and SHALL advance the cache's least-recently-read clock as a lookup hit does; a view answered from the browser's own cache is invisible to the server and does not advance it. The lookup route SHALL answer a client that names nothing new exactly as it did before this route existed; what it may gain is an ask a client must opt into, never a change to what an unasked request receives.

#### Scenario: A revisit costs no bytes
- **WHEN** a tile references a cached thumbnail by an image URL naming the entry's current generation, and the listing is opened again in the same browser
- **THEN** the browser answers the image from its own cache without a request, and the server receives no lookup for that tile

#### Scenario: A superseded URL never shows stale pixels
- **WHEN** a tile holds an image URL naming a generation the entry has since moved past
- **THEN** the server answers the current bytes under a non-cacheable response, and the next listing names the new generation

#### Scenario: Only a hit is an image
- **WHEN** the image route is asked for an entry the cache holds only as stale, or does not hold
- **THEN** it answers not-found without caching, and the tile recovers through the lookup

#### Scenario: The lookup route is untouched
- **WHEN** a client written against the JSON lookup requests a thumbnail
- **THEN** it receives exactly the answer it received before the image route existed
