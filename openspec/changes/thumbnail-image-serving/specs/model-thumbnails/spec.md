# model-thumbnails Delta

> ADD-only, four distinct titles. `immutable-thumbnail-serving` ADDs *Thumbnail
> responses are cacheable by their key* to this capability — the generation
> and cache tiers below are that requirement's, reused, not redefined.
> `listing-tree-cache` ADDs *Derived annotations ride the listing* to
> `listing-cache` — the per-entry thumbnail state below is that annotation,
> extended with the labels the client's staleness test reads. Sequenced after
> both.

## ADDED Requirements

### Requirement: Cached thumbnails are served as images
The server SHALL answer a cached thumbnail's PNG bytes as an image response — `image/png`, no envelope — at an image route keyed exactly as the thumbnail lookup is keyed: path, mtime, occlusion variant, and write generation. The image route SHALL apply the same cache tiers as the lookup: an answer whose request names the entry's current generation SHALL be marked immutable; one that names none SHALL be validatable by the entry's generation; one that names a superseded generation SHALL carry the current bytes and SHALL NOT be cacheable, so a stale URL never shows stale pixels. A request for a thumbnail the cache does not hold SHALL be answered not-found and SHALL NOT be cached. The lookup route SHALL be unchanged, and remains the answer for whatever the listing cannot say.

#### Scenario: A revisit costs no bytes
- **WHEN** a tile references a cached thumbnail by an image URL naming the entry's current generation, and the listing is opened again in the same browser
- **THEN** the browser answers the image from its own cache without a request, and the server receives no lookup for that tile

#### Scenario: A superseded URL never shows stale pixels
- **WHEN** a tile holds an image URL naming a generation the entry has since moved past
- **THEN** the server answers the current bytes under a non-cacheable response, and the next listing names the new generation

#### Scenario: The lookup route is untouched
- **WHEN** a client written against the JSON lookup requests a thumbnail
- **THEN** it receives exactly the answer it received before this capability existed

### Requirement: A listing-known thumbnail is drawn without a lookup
The listing SHALL carry, per model entry the thumbnail cache knows, the facts a lookup would answer that decide whether its picture is usable: per occlusion variant, whether a render is present and current against the entry's mtime and the recipe labels it was made under; and, entry-level, the write generation and the stored camera and axis. The client SHALL apply to those facts the same usability test it applies to a lookup's answer — under the client's own recipe constants, which the server never interprets — and, where a render passes, SHALL draw the tile from the image route by URL without issuing a lookup, carrying the entry's camera and axis as a lookup would have. Where the entry carries no such facts, or the render is absent, stale, or fails the client's test, the client SHALL issue the lookup exactly as before. An image the client did not mint SHALL NOT be treated as an object URL: the client SHALL release only the object URLs it created.

#### Scenario: A cached listing issues no lookups
- **WHEN** a listing is opened whose model entries all carry a current, usable render
- **THEN** every tile draws from the image route and the client issues no thumbnail lookups

#### Scenario: The client's constants still decide
- **WHEN** the client ships a new rig version and a listing's entries carry renders labelled with the old one
- **THEN** every such tile issues a lookup and re-renders, exactly as it would have on a lookup answering the same labels, and the server was not consulted about the version

#### Scenario: An entry the cache has not seen falls back
- **WHEN** a listing entry carries no thumbnail facts
- **THEN** its tile is looked up and rendered by the existing path, unchanged

#### Scenario: A pose the entry predates is looked up
- **WHEN** an entry's render is present and current but was made under an earlier pose mapping than the one the client holds for it
- **THEN** the tile issues a lookup and re-renders rather than drawing the listing-known image

#### Scenario: Ownership follows the scheme
- **WHEN** a tile drawn from an image URL is later re-rendered and shown from an object URL, and then removed from the listing
- **THEN** the object URL is released and nothing is released for the image URL

### Requirement: Lookups are ranked with renders
The thumbnail lookups the client still issues SHALL be taken in the same position order as renders — on screen, near, unreported, then far — under the same reported bands, so that a tile on screen never waits for its answer behind lookups for tiles that are not. Lookups SHALL NOT be suspended by an orbit overlay or lightbox, as before.

#### Scenario: A visible tile's lookup is not queued behind the listing
- **WHEN** a large listing is opened and the user scrolls far down it while its lookups are still in flight
- **THEN** the lookups for the tiles now on screen are taken next, ahead of lookups queued earlier for tiles that are not

#### Scenario: Suspension does not touch lookups
- **WHEN** an orbit overlay or lightbox is active while lookups are pending
- **THEN** the lookups proceed; only render work waits

### Requirement: Far reads yield to pending lookups
While any thumbnail lookup is pending, the render queue SHALL NOT start work ranked far — the deferred work of tiles far from view — so that a cache lookup for a tile the user can see is never made to wait on a deferred tile's model read on the same storage. Work ranked nearer than far SHALL be unaffected, and deferred work SHALL resume as soon as the pending lookups settle, without waiting for another render to be queued.

#### Scenario: A deferred read does not delay a visible hit
- **WHEN** far-ranked renders are queued and a lookup for an on-screen tile is pending
- **THEN** no far render starts until that lookup has answered, while renders for on-screen and near tiles start as usual

#### Scenario: The drain resumes on its own
- **WHEN** the last pending lookup settles with far renders still queued
- **THEN** the render queue takes the next far render without a new push or a scroll
