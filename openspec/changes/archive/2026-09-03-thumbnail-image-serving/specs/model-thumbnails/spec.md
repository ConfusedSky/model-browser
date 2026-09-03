# model-thumbnails Delta

> ADD-only, four distinct titles, checked against main and every active
> delta. `immutable-thumbnail-serving` ADDs *Thumbnail responses are cacheable
> by their key* here — the generation and cache tiers below are that
> requirement's, reused. `listing-tree-cache` ADDs *Derived annotations ride
> the listing* to `listing-cache` — the per-entry thumbnail state below is
> that annotation, consumed and extended, not redefined. *Far reads yield to
> pending lookups* qualifies *Client-side thumbnail rendering*'s deferral rule
> and says so in its own text.

## ADDED Requirements

### Requirement: Cached thumbnails are served as images
The server SHALL answer a cached thumbnail's PNG bytes as an image response — `image/png`, no envelope — at an image route keyed exactly as the thumbnail lookup is keyed: path, mtime, occlusion variant, and write generation. The image route SHALL apply the same cache tiers as the lookup: an answer whose request names the entry's current generation SHALL be marked immutable; one that names none SHALL be validatable by the entry's generation; one that names a superseded generation SHALL carry the current bytes and SHALL NOT be cacheable, so a stale URL never shows stale pixels. A request for anything but a hit — a thumbnail the cache does not hold, or holds only as stale — SHALL be answered not-found and SHALL NOT be cached. The image route SHALL be confined as the lookup is, and SHALL advance the cache's least-recently-read clock as a lookup hit does; a view answered from the browser's own cache is invisible to the server and does not advance it. The lookup route SHALL be unchanged.

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

### Requirement: A listing-known thumbnail is drawn without a lookup
Where a listing entry carries the thumbnail facts a lookup would answer — per occlusion variant, whether a render is present and current against the entry's mtime and the recipe labels it was made under; and, entry-level, the write generation and the stored camera and axis — the client SHALL apply to them the same usability test it applies to a lookup's answer, under the client's own recipe constants, which the server never interprets. Where a render passes, the client SHALL draw the tile from the image route by URL without issuing a lookup, carrying the entry's camera, axis and generation as a lookup would have, and SHALL seed that state in the same step that seeds a new tile's placeholder rather than as a later write that step could overwrite. Where the entry carries no such facts, or the render is absent, stale, or fails the client's test, the client SHALL issue the lookup exactly as before. A listing that later carries a generation the client has not already seen for the same entry — neither one a lookup or the client's own write taught it, nor one a previous listing carried — SHALL be re-evaluated, not ignored; a listing that carries no facts for an entry the client has already drawn is not a new fact and SHALL NOT restart it. An image the client did not mint SHALL NOT be treated as an object URL: the client SHALL release only the object URLs it created. An image that fails to arrive SHALL demote its entry to the lookup path, once per generation, without the tile entering the error state.

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

#### Scenario: A newer generation on a later listing is seen
- **WHEN** a tile drawn from the listing at one generation receives a later listing naming a newer one for the same entry
- **THEN** the tile is re-evaluated against the new facts and draws the newer image, rather than keeping the older one from the browser's cache

#### Scenario: An evicted image recovers
- **WHEN** a tile drawn from the listing fetches its image and the entry has been evicted since the listing was emitted
- **THEN** the tile is looked up and rendered by the existing path, never shows the error state, and is not asked for the same missing image again for that generation

#### Scenario: A pressed tile has a box before its image loads
- **WHEN** the user presses a listing-drawn tile whose lazily loaded image has not yet arrived
- **THEN** the orbit overlay opens at the tile's image box, not at an empty rect

#### Scenario: Ownership follows the scheme
- **WHEN** a tile drawn from an image URL is later re-rendered and shown from an object URL, and then removed from the listing
- **THEN** the object URL is released and nothing is released for the image URL

### Requirement: Lookups are ranked with renders
The thumbnail lookups the client still issues SHALL be taken in the same position order as renders — on screen, near, unreported, then far — under the same reported bands, so that a tile on screen never waits for its answer behind lookups for tiles that are not. A lookup ranked far SHALL still be taken once nothing nearer is pending: a change to a model's pixel inputs consults its cache at once whatever its position, as *Client-side thumbnail rendering* requires, and a held lookup would leave a far tile showing the old inputs until approached. Lookups SHALL NOT be suspended by an orbit overlay or lightbox, as before. A change of listing SHALL reset the lookups' ranking exactly as it resets the renders'.

#### Scenario: A visible tile's lookup is not queued behind the listing
- **WHEN** a large listing is opened and the user scrolls far down it while its lookups are still in flight
- **THEN** the lookups for the tiles now on screen are taken next, ahead of lookups queued earlier for tiles that are not

#### Scenario: A far tile is looked up last, not never
- **WHEN** a large cached listing is opened and left at its top
- **THEN** the tiles on screen and near it are looked up first, and a tile far down the listing is looked up after them without the user scrolling toward it

#### Scenario: A new listing forgets the old ranking for lookups too
- **WHEN** the user navigates to a listing sharing paths with the previous one
- **THEN** no lookup in the new listing is ordered by a verdict the previous listing reported

### Requirement: Far reads yield to pending lookups
This requirement qualifies *Client-side thumbnail rendering*'s rule that deferred far work is taken when nothing nearer is pending: while a thumbnail lookup for a tile ranked nearer than far is pending, the render queue SHALL NOT start work ranked far, so that a cache lookup for a tile the user can see or is near to seeing is never made to wait on a deferred tile's model read on the same storage. Work ranked nearer than far SHALL be unaffected. The hold SHALL be bounded in time: a lookup that does not settle within the bound SHALL NOT keep far work waiting, so a listing left open still warms itself as that rule promises. Deferred work SHALL resume as soon as the pending lookups settle, without waiting for another render to be queued.

#### Scenario: A deferred read does not delay a visible hit
- **WHEN** far-ranked renders are queued and a lookup for an on-screen tile is pending
- **THEN** no far render starts until that lookup has answered, while renders for on-screen and near tiles start as usual

#### Scenario: Far lookups do not hold the drain
- **WHEN** the only pending lookups are for tiles ranked far — the far-ranked remainder of an occlusion toggle's storm once the nearer ones have answered, or a far-only set from the start
- **THEN** far renders are not held for them

#### Scenario: A wedged lookup cannot freeze the drain
- **WHEN** a lookup never settles while far renders are queued
- **THEN** far renders resume once the bound has passed, and a listing left open goes on warming itself

#### Scenario: The drain resumes on its own
- **WHEN** the last pending lookup settles with far renders still queued
- **THEN** the render queue takes the next far render without a new push or a scroll
