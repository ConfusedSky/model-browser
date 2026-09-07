# model-thumbnails Specification

## Purpose
TBD - created by archiving change model-browser-v1. Update Purpose after archive.
## Requirements
### Requirement: Client-side thumbnail rendering
The client SHALL render a static image thumbnail for each model file (STL, 3MF, OBJ — plain or zip entry) using the same three.js scene setup (loaders, materials, lighting) AND the same output color pipeline (color-space encoding, tone mapping) as the live viewer, so a thumbnail is pixel-comparable with a live frame of the same camera — offscreen render-target output SHALL NOT differ in brightness or color from the visible canvas. Rendering SHALL go through a limited-concurrency queue using the app's single shared WebGL renderer (see `model-viewer`), suspending while an orbit overlay or lightbox is active. The queue SHALL take pending work in order of what the user can see rather than in listing order: a model whose tile is on screen SHALL be rendered before one whose tile is not, and this ordering SHALL be re-evaluated as the view scrolls, so tiles brought into view take priority over work queued earlier for tiles now out of view. Where a model is shown only inside another tile's contents rather than as a tile of its own, its position SHALL be one step farther than the tile showing it — a folder's sheet fills after the model tiles beside that folder, never before them — and a model shown in more than one place SHALL take the nearest of those positions, so work for something on screen is never treated as far away. Position SHALL order work and never discard it: work for a tile that has scrolled far from view is deferred behind everything nearer — it SHALL NOT run while any nearer work is pending, so scrolling past uncached tiles spends nothing on them while the user is active — and it SHALL be taken when nothing nearer remains, so a listing left open keeps warming its cache in order of nearness rather than stopping at the edge of the screen. A deferred model keeps whatever its tile is showing — a placeholder, an embedded preview, or a previous render — and SHALL NOT enter the error state this requirement reserves for a model that failed to load or parse. Work with no reported position SHALL be taken after work reported on screen or near it and before deferred far work — an unreported model may be anywhere, while a far one is known to be off screen — in the order it was queued, so a view that reports nothing behaves exactly as one taken in listing order, save a render the user asked for directly; such a render — asked for by pressing a control on an on-screen surface — SHALL be taken with on-screen work rather than as unreported. A position SHALL only ever be reported, never defaulted: work whose position is unknown is unreported work, not far work; and a model hidden from the grid by a filter or kind restriction — as its own tile, or as the contents of a hidden folder — SHALL be reported far by the one layer that knows it was hidden. When the inputs to a model's pixels change — the occlusion preference, or an orientation supplied for it — its cache SHALL be consulted at once whatever its position, so a render already held under the new inputs is shown without waiting, while one the cache does not hold is queued at the position in force; work SHALL be rendered under the inputs in force when it runs, never those in force when it was queued. This governs only the order of work; the concurrency limit, the suspension rule, the cached-lookup path, and the rendered output are unaffected. The queue SHALL gate only work that touches the shared renderer — mesh load, parse, render, and upload of the result; looking up an already-cached thumbnail SHALL NOT occupy the queue, and SHALL run under its own concurrency limit, so a directory whose thumbnails are all cached fills at the speed of the cache rather than at the speed of renderer concurrency. Mesh geometry SHALL be disposed after snapshot — freeing its GPU buffers, not merely dropping the reference — unless retained by the mesh LRU. Thumbnails SHALL be square, with a transparent background, at one size and one encoding for every tile — independent of tile size and device pixel ratio — and that encoding SHALL be lossy WebP whose alpha channel is preserved losslessly, so a silhouette stays exact while its interior is compressed. The size SHALL be 256×256. A render the browser did not encode
in that format SHALL NOT be uploaded: an encoder asked for a format it does not support
answers in another one without saying so, and pixels stored under a name and served under
a type that both claim the format this app produces are a claim the store cannot check.
The client SHALL keep drawing such a render locally and leave the entry uncached — but
SHALL still send whatever that write carried besides pixels, an orientation above all,
since a write is refused for what its pixels are and not for what else it moves. The
labels that describe pixels SHALL travel only with pixels. A write whose render was
dropped SHALL say so to its caller, so that work counting renders counts this as work
not done.

#### Scenario: Fresh directory fills in progressively
- **WHEN** the user opens a directory containing model files with no cached thumbnails
- **THEN** tiles appear immediately as placeholders and thumbnails pop in as the render queue completes each file

#### Scenario: A deep scroll does not wait behind the whole directory
- **WHEN** the user opens a large uncached listing and immediately scrolls far down it
- **THEN** the tiles now on screen render next, rather than after every earlier tile in the listing has been rendered

#### Scenario: Scrolling past uncached tiles spends nothing on them
- **WHEN** the user scrolls quickly through a large uncached listing without stopping
- **THEN** tiles that left the viewport before their rendering began are not rendered ahead of what is on screen when scrolling settles — their work waits behind everything nearer and is taken only once nothing nearer is pending

#### Scenario: A tile scrolled away and back is never left broken
- **WHEN** a tile whose render was deferred by scrolling away comes back on screen
- **THEN** it kept whatever it was showing meanwhile — never a failure state — and its render is taken at its new position

#### Scenario: A listing left open warms itself
- **WHEN** the user stops scrolling a large uncached listing and leaves it open
- **THEN** once every on-screen and near tile is rendered, the queue goes on rendering the rest nearest-first rather than falling idle, and any scroll puts the newly visible tiles ahead of that work again

#### Scenario: A folder's sheet fills after the tiles beside it
- **WHEN** a folder tile and uncached model tiles are on screen together
- **THEN** the model tiles render before the folder's preview cells, which are ranked one step farther than the folder itself

#### Scenario: A model shown inside another tile is not treated as far away
- **WHEN** a model is shown only within another tile's contents, or is shown both as its own on-screen tile and within an off-screen tile's contents
- **THEN** it is ranked one step farther than the tile showing it, taking the nearest of its positions where there is more than one, and its work is never deferred behind far work while something showing it is on screen

#### Scenario: Hidden content is reported far
- **WHEN** a find filter or kind restriction hides model tiles, or hides a folder whose preview cells are queued
- **THEN** the hidden models — and the hidden folder's cells — are reported far and rendered only once nothing nearer is pending, while a hidden model that is also shown inside an on-screen folder keeps that folder's position

#### Scenario: A setting change reaches a far tile's cache at once
- **WHEN** the occlusion preference changes while some tiles are far off screen
- **THEN** every model's cache is consulted at once — one already held under the new setting is shown straight away — and only a model the cache does not hold under the new setting is queued at its position, taken after everything nearer

#### Scenario: Deferred work renders under the current setting
- **WHEN** a model's render is deferred far off screen, the occlusion preference or the orientation supplied for it changes, and its work is later taken
- **THEN** it is rendered under the setting and orientation in force at that moment, not the ones in force when it was queued

#### Scenario: Priority does not change the picture
- **WHEN** a thumbnail is rendered because its tile was prioritised rather than reached in listing order
- **THEN** the resulting image is identical to the one listing order would have produced, and the cached pixel-recipe version is unchanged

#### Scenario: Thumbnail matches live view color
- **WHEN** a freshly rendered thumbnail is compared with the live view of the same model at the same camera
- **THEN** brightness and color are visually indistinguishable

#### Scenario: Unparseable model file
- **WHEN** a model file fails to load or parse
- **THEN** its tile shows an error/broken state and the queue continues with remaining files

#### Scenario: Fully cached directory is not paced by render concurrency
- **WHEN** the user opens a directory of many models whose thumbnails are all cached
- **THEN** the cached thumbnails are fetched concurrently under their own limit and none of them waits on a render-queue slot

#### Scenario: Interaction still suspends rendering, not lookups
- **WHEN** an orbit overlay or lightbox is active while a directory's thumbnails are still resolving
- **THEN** cache lookups continue, while any model that needs loading, parsing, or rendering waits until the interaction ends

#### Scenario: A browser that cannot encode the format caches no pixels
- **WHEN** a client's encoder answers with a format other than the one thumbnails are stored in
- **THEN** that render is drawn for the user who rendered it and its pixels are not stored, so the entry stays uncached for a client that can encode it rather than being filled with bytes that are not what they are labelled

#### Scenario: A dropped render is not counted as one that was made
- **WHEN** bulk work renders an entry on a client whose encoder cannot produce the stored format
- **THEN** that entry is reported as work not done rather than as a render written, so a run's count never claims a cache filled while nothing was stored in it

#### Scenario: The orientation in that same write is still saved
- **WHEN** such a render is sent together with a camera or an axis the user has just chosen
- **THEN** the orientation is stored and the pixels are not, rather than the whole write being lost with nothing said

### Requirement: Server-side thumbnail persistence
The server SHALL persist rendered thumbnails keyed by `path + mtime`, where the path is library-relative (see `library`), in a cache directory per library — named by the library's identifier, outside the browsed directories — so that a library keeps its cache wherever it is mounted and two libraries with the same layout never share an entry. For zip entries the mtime in the key SHALL be the containing zip's (see `zip-browsing`). The client SHALL upload each rendered image, and on later visits SHALL receive cached thumbnails without reloading meshes. A changed mtime SHALL invalidate the cached thumbnail. Entries written before paths were library-relative SHALL be migrated once, on the first start under the library, to their library-relative keys — cameras, axes and images in the current encoding intact — when their recorded location lies within the library; entries recorded elsewhere SHALL be left where they are.

#### Scenario: Second visit is instant
- **WHEN** the user reopens a directory whose thumbnails were previously rendered and files are unchanged
- **THEN** all thumbnails load from the server cache with no mesh downloads or rendering

#### Scenario: Modified file re-renders
- **WHEN** a model file's mtime changes after its thumbnail was cached
- **THEN** the cached thumbnail is treated as stale and the client re-renders and re-uploads it

#### Scenario: A remount keeps the cache
- **WHEN** the library is mounted at a different location and the root repointed to it
- **THEN** every cached thumbnail and camera is served exactly as before

#### Scenario: Two libraries do not share a cache
- **WHEN** two libraries hold a model at the same library-relative path with the same mtime
- **THEN** each is served its own thumbnail and camera, never the other's

#### Scenario: Legacy entries are migrated with their cameras
- **WHEN** the server first starts under a library and the cache holds entries keyed by filesystem paths within it
- **THEN** those entries are served under their library-relative keys and a model that had a saved orientation opens with it; whether its pixels are re-rendered is the recipe version's question, not the migration's

### Requirement: Camera state stored alongside thumbnails
The server SHALL store each model's camera (orientation) state and its orbit axis together alongside its thumbnail, keyed by path only, so both survive file modification, sessions, and different browsers. Thumbnail renders SHALL use the stored camera state when present, otherwise the spindle's default fit-to-bounds three-quarter view. The client SHALL be able to **discard** a model's stored orientation — its camera, its axis, or both — distinctly from writing a value over it: a request that does not mention one of them SHALL leave it as it was, while one that discards it SHALL leave the model with none. A model with no stored orientation SHALL be rendered the way a model that never had one is rendered — which, where an orientation source such as a semantic index supplies one for it, means that orientation rather than the default. Where such a source supplies an axis and angles as one orientation, a stored axis SHALL be enough to withhold it, since angles measured about one axis do not describe a view about another. Writing the default view as a stored value SHALL NOT be treated as equivalent to discarding, since a stored default is an orientation of the user's own and suppresses any such source. Camera state SHALL be stored bounds-relative — azimuth, elevation, and distance as a multiple of the bounding-sphere radius, with the target relative to the bounding box — and spindle-relative: azimuth/elevation are measured in the model's spindle frame, never in world coordinates, so orientation round-trips exactly for every axis. A missing axis SHALL be *rendered* as +Y, under which the spindle-relative representation equals the historical world-Y one (no migration) — but a read SHALL report its absence rather than substituting +Y, since whether the user has chosen an orientation is what tells a caller that the model is free to be oriented by something else. Defaulting belongs to the caller that draws; the response distinguishes none-stored from stored-as-+Y.

#### Scenario: Orientation survives re-export
- **WHEN** a model file is overwritten (new mtime) after the user saved an orientation
- **THEN** the regenerated thumbnail is rendered from the saved camera state

#### Scenario: Re-export at a different scale or origin
- **WHEN** a model is re-exported scaled, re-centred, or unit-converted after an orientation was saved
- **THEN** the regenerated thumbnail shows the same view of the model, correctly framed

#### Scenario: Orientation shared across browsers
- **WHEN** the user orbits a model in one browser and opens the app in another browser
- **THEN** the second browser shows the thumbnail in the saved orientation

#### Scenario: Non-default spindle round-trips exactly
- **WHEN** a model with an overridden axis is orbited, released, and its directory revisited
- **THEN** the thumbnail and reopened view match the released view exactly, not a world-Y approximation

#### Scenario: Pre-existing entries read as +Y
- **WHEN** a cache entry written before axis support is served
- **THEN** it behaves as axis +Y with its camera state interpreted unchanged

#### Scenario: Discarding an orientation is not writing one
- **WHEN** a model's stored camera is discarded and its thumbnail is rendered again
- **THEN** it is rendered as a model with no orientation of its own — at an orientation supplied for it by an index where one exists, and at the spindle's default otherwise — rather than at a stored default that would suppress that source

#### Scenario: Silence still preserves
- **WHEN** a request stores a thumbnail without mentioning the camera or the axis
- **THEN** both are unchanged, as they are today

#### Scenario: Discarding both hands the model to the source
- **WHEN** a model's stored camera and axis are both discarded and an index supplies an orientation for it
- **THEN** it is rendered at that orientation — its axis as well as its angles — rather than at the default about its former axis

#### Scenario: Absence is reported, not defaulted away
- **WHEN** a model with a stored thumbnail but no stored axis is read
- **THEN** the response reports no axis rather than +Y, while anything drawing it still draws it about +Y absent another source

### Requirement: Bounded, self-maintaining cache
The thumbnail cache SHALL NOT grow without bound. Superseded thumbnails (an older mtime for the same path) SHALL be deleted, entries whose source path no longer exists within the library SHALL be swept — for a virtual path, existence SHALL be tested against the containing zip rather than the entry — and when a library's total cache size exceeds a configurable cap (default 2GB, per library) least-recently-read thumbnails SHALL be evicted. Entries left in the pre-library cache directory after migration SHALL be swept for existence at each start and SHALL NOT count toward any library's cap. Camera state and the orbit axis SHALL survive size-cap eviction of their thumbnail (they are tiny and cannot be regenerated), but the existence sweep SHALL remove the entire entry — camera state and axis included — when the source path no longer exists. Entries SHALL be stored under a hash of the library-relative path rather than the path itself, since paths contain `/`, `!`, and spaces and may exceed filename length limits. The sweep SHALL NOT run while the library is `missing`: an unmounted volume is not a deleted library.

#### Scenario: Repeated edits do not accumulate
- **WHEN** a model file is modified several times, each modification generating a new thumbnail
- **THEN** only the current thumbnail is retained and superseded ones are deleted

#### Scenario: Deleted models are swept
- **WHEN** the cache is swept and a cached entry's source file no longer exists
- **THEN** that entry is removed from the cache

#### Scenario: Camera state survives thumbnail eviction
- **WHEN** a thumbnail is evicted by the size cap and the user later revisits its directory
- **THEN** it is re-rendered from the still-stored camera state, not from the default view

#### Scenario: Axis survives thumbnail eviction
- **WHEN** a thumbnail is evicted by the size cap for a model with an overridden axis
- **THEN** the axis remains stored and the re-rendered thumbnail uses the overridden spindle

#### Scenario: Sweep removes camera state with the entry
- **WHEN** a model file is deleted and the cache is swept
- **THEN** the entire cache entry — camera state and axis included — is removed; a file later appearing at that path gets the default view and axis

#### Scenario: An unmounted library is not swept
- **WHEN** maintenance is due while the library's volume is not mounted
- **THEN** no entry is removed, and the sweep runs once the library is present again

### Requirement: Embedded 3MF preview as placeholder
When a 3MF package contains an embedded thumbnail image, the client SHALL display it as an immediate placeholder until its own render replaces it.

#### Scenario: 3MF with embedded thumbnail
- **WHEN** a 3MF file containing `/Metadata/thumbnail.png` is listed without a cached thumbnail
- **THEN** the embedded image is shown immediately and later replaced by the app's own render

### Requirement: Recipe-labelled thumbnails
Thumbnails SHALL be rendered with the rig fixed in the rest camera's frame — the orientation the live view uses at handoff. The server SHALL store, alongside each render, every recipe input that decides its pixels but is not carried by the cache key — the lighting label, the rig version, and where an orientation source framed the render, which version of that source's mapping was used — and SHALL return them on reads; it stores and echoes the values without interpreting them. Like the render's mtime, all of these values describe the pixels: a PUT that replaces the pixels without declaring them SHALL clear the stored values rather than keep stale labels, while a PUT that does not replace the pixels SHALL leave the stored values in place unless it declares them. All of them SHALL be returned on stale reads as well as hits. The lighting label SHALL have one producible value, the camera-fixed rig; the server SHALL refuse a PUT declaring any other, while continuing to read and echo labels stored before this. The client SHALL treat a cache hit whose stored lighting label is not the producible one, or whose stored rig version differs from the client's current rig version — including entries where either value is absent — as needing re-render: the render is replaced through the normal render queue while camera state and axis are preserved. A hit SHALL likewise need re-render when an orientation source would frame that model and the stored image was not produced under the source's current mapping — but only where the source **would actually be applied**, which is to say the model has no orientation of its own. A model the user has oriented is a hit whatever the source holds for it, since its pixels do not depend on the source; treating it as stale renders and re-uploads an image identical to the one already cached, on every visit, forever. A render made under an orientation source SHALL record the mapping version it used, so a later change to that mapping is detectable and the image is not mistaken for one drawn without a source. The lookup and this test SHALL be applied to the thumbnails already displayed when the effective ambient-occlusion preference changes — whether by the user's toggle or by an automatic decision — not only to those a subsequent visit rebuilds: a control that changes how models are drawn SHALL answer on the listing in front of the user, showing a render already cached under the new setting at once and rendering only what is not — save work deferred far off screen (see *Client-side thumbnail rendering*), whose cache is consulted at once like every other entry's and whose render is queued at its position, taken once nothing nearer is pending. A change of rig version SHALL remain lazy, taken on the next visit, since it accompanies a new build rather than a user's gesture and nothing on screen is waiting on it. Refreshing this way SHALL reuse the same lookup, the same staleness test and the same render queue a visit uses, SHALL preserve camera state and axis, and SHALL keep each existing image until its replacement exists, so the grid does not empty while it works. The same SHALL hold when the set of entries changes while some remain — an entry being the same path at the same mtime: remaining entries keep their state and images, and work in flight for them continues rather than restarting; only added entries start loading; removed entries are dropped and their work cancelled; a remaining entry whose orientation-source opinion changed in value SHALL be re-evaluated without losing its image, and one whose opinion is unchanged SHALL issue nothing. A change of the occlusion preference, by contrast, cancels the in-flight pass whole.

#### Scenario: Thumbnail matches live lighting for an overridden axis
- **WHEN** a model with a ±X/±Z spindle has its thumbnail rendered and the user then presses the tile
- **THEN** the live overlay shows the same camera-fixed lighting as the thumbnail with no brightness shift at handoff

#### Scenario: Mode switch invalidates only the pixels
- **WHEN** a directory is visited whose cache entries carry the retired spindle-aligned lighting label
- **THEN** their renders are re-rendered under the camera-fixed rig via the render queue, keeping their saved camera orientation and axis, and subsequent visits are cache hits again

#### Scenario: Legacy cache entries are upgraded lazily
- **WHEN** a directory is visited whose cache entries predate label storage
- **THEN** their renders are re-rendered on that visit and subsequent visits are cache hits again

#### Scenario: A rig revision refreshes stale thumbnails once
- **WHEN** the app ships a new rig version and a directory is visited whose cache entries carry the old version or none
- **THEN** their renders are re-rendered under the current rig via the render queue — camera state and axis preserved — and subsequent visits are cache hits again

#### Scenario: A camera-lit cache needs nothing
- **WHEN** every entry in a directory's cache carries the camera-fixed label and the current rig version
- **THEN** the visit is entirely cache hits: no render and no upload

#### Scenario: Switching occlusion answers on the grid in front of you
- **WHEN** the occlusion preference changes while a listing of thumbnails rendered under the other setting is on screen
- **THEN** those thumbnails switch to the new setting's render without the user navigating away and returning — from the cache where one exists, rendered where not — each keeping its camera and axis and its previous image until the replacement is ready

#### Scenario: Adding entries does not reset the ones already shown
- **WHEN** entries are added to a listing whose thumbnails are on screen
- **THEN** the entries already shown keep their images and issue no new lookup, and only the added entries start loading

#### Scenario: A peek lands mid-pass
- **WHEN** entries are added while some of those already listed are still loading
- **THEN** the loading ones finish without restarting, and only the added ones begin

#### Scenario: Switching back before the first pass finishes
- **WHEN** the preference changes twice in quick succession
- **THEN** the grid settles under the setting chosen last, without the first pass's renders landing on top of it

#### Scenario: A model with its own orientation is not made stale by a pose
- **WHEN** a model the user has oriented is displayed in a view where an orientation source also holds a pose for it
- **THEN** its cached thumbnail is a hit and is neither re-rendered nor re-uploaded, since the source would not be applied to it and its pixels therefore do not depend on the source

#### Scenario: An image that predates the source's current mapping is re-rendered
- **WHEN** a model the source would frame is displayed, and its cached thumbnail was drawn under an earlier version of the source's mapping or before the source had any opinion about it at all
- **THEN** the thumbnail is re-rendered under the current mapping and records the version it used — a missing record and an outdated one are the same case, since neither says the pixels were drawn under the mapping in force

### Requirement: A thumbnail exists per occlusion recipe
A model's cache entry SHALL hold up to two renders — with ambient occlusion and without — each keyed by the path and mtime that *Server-side thumbnail persistence* defines plus the occlusion setting it was rendered under — the occlusion setting is a dimension of that key, not a second key — and each carrying its own recipe labels. A thumbnail read SHALL name the occlusion setting it wants and SHALL receive that render's status, pixels and labels; a read naming no setting SHALL be served the occluded render. A thumbnail write SHALL name the setting its pixels were rendered under; a write naming none SHALL be stored as the occluded render. Camera state and orbit axis SHALL be shared by both renders of an entry and SHALL be returned on a read of either, whatever its status. Because the orientation is shared, a write that changes it SHALL invalidate the render it did not write — and, when it carries no pixels, both renders. A change is a camera the entry did not hold, or one differing from the stored camera by more than a fixed tolerance held as a named constant (a re-captured camera drifts in its last digits on every lightbox close and is not a change); an axis the entry did not hold, or one that differs from the stored axis; or a discard of one the entry held. Invalidation SHALL clear the render's recipe labels while keeping its pixels and mtime — notwithstanding *Recipe-labelled thumbnails*'s rule that a write not replacing a PNG leaves its labels alone — so that the render reads as a hit needing re-render under that requirement's label rule: its pixels are still served, and it is re-rendered at the new orientation rather than served at the old one. A write that carries only pixels and recipe labels SHALL NOT touch the other render: both renders are always drawn under the stored orientation, so pixels alone cannot desynchronise them, and toggling between settings stays a lookup — except on an entry that holds no orientation at all, neither camera nor axis after the write, where there is no stored orientation for both renders to be drawn under: each is drawn at the pose if one was applied and at the default otherwise, so a written render whose applied-pose record differs from the other render's SHALL invalidate that other render in the same way a changed orientation does. An entry that holds an orientation is exempt, its applied-pose record being a label its renders are not drawn by. A read's status SHALL be decided per render: a hit when that render's pixels are present at the requested mtime; stale when that render was written before or the entry holds a camera (the predicate the cache applies today, per render); a miss otherwise. When a write carries pixels at a newer mtime, the other render's pixels are superseded too and SHALL be deleted, as *Bounded, self-maintaining cache* requires of superseded thumbnails. Each render SHALL be evicted by the size cap on its own least-recently-read clock, leaving the other in place; the existence sweep SHALL remove the entry whole. Renders cached before this requirement SHALL be served as the occluded render without migration.

#### Scenario: Toggling back is a lookup
- **WHEN** a directory's thumbnails have been rendered under both settings and the user switches the preference
- **THEN** the next visit under either setting is served from the cache with no render and no upload

#### Scenario: The other render is not a hit, and keeps its orientation
- **WHEN** a model has an occluded thumbnail and a saved camera, and its unoccluded thumbnail is requested for the first time
- **THEN** the response is not a hit — stale, since the entry holds a camera — and carries the saved camera and axis, and the client renders the unoccluded thumbnail under that orientation

#### Scenario: Orbiting under one setting invalidates the other render
- **WHEN** a model with both renders cached is orbited and released with the preference off, and the preference is then turned on
- **THEN** the occluded render reads as a hit whose recipe labels are cleared and whose pixels are still served, and the client re-renders it at the new orientation rather than keeping it at the old one

#### Scenario: A pixel-only write leaves the other render alone
- **WHEN** a model's unoccluded render is written for the first time while its occluded render is cached, with no change to its camera or axis
- **THEN** the occluded render is still a hit

#### Scenario: A pose applied to one render is an orientation the other does not show
- **WHEN** a render of a model with no stored orientation is written with an applied-pose record differing from its sibling's
- **THEN** the sibling's recipe labels are cleared so it re-renders lazily at the orientation now in force, keeping its pixels meanwhile

#### Scenario: A discard invalidates both ways
- **WHEN** a model's stored orientation is discarded by a write that carries no pixels
- **THEN** both renders' recipe labels are cleared; each is re-rendered when next viewed, at the orientation the model now has

#### Scenario: An unmoved close invalidates nothing
- **WHEN** a model that already holds a camera, with both renders cached, is opened in the lightbox and closed without being orbited
- **THEN** the camera the close persists is within tolerance of the stored one and the other render is still a hit

#### Scenario: A snapshot follows the preference
- **WHEN** an orbit is released or the lightbox closed with the preference off
- **THEN** the thumbnail persisted from that view is the unoccluded render, matching the overlay the user was looking at

#### Scenario: A pre-existing cache is the occluded render
- **WHEN** the server starts over a cache written before renders were keyed by occlusion
- **THEN** every entry is served as the occluded render exactly as before, and nothing re-renders for a user whose preference is on

#### Scenario: Renders are evicted independently
- **WHEN** the cache exceeds its cap and a model's unoccluded render was read longer ago than its occluded one
- **THEN** the unoccluded render is evicted first and the occluded one remains a hit

#### Scenario: One entry, one existence
- **WHEN** a model with both renders cached is deleted and the cache is swept
- **THEN** both renders and the entry's camera and axis are removed together

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

### Requirement: A stored render can be deleted, and a write can be conditional
The server SHALL accept, on the thumbnail write, an explicit instruction to delete an
entry's cached renders — every occlusion variant's pixels and recipe labels — distinct
from omitting the pixels (which keeps them) and from replacing them. The instruction
SHALL be a third state of the pixel field, as the orientation fields already have one,
and the entry's stored orientation SHALL be governed by the same write's orientation
fields, never by the deletion. A deleted render SHALL carry no pixels thereafter, so the
next visit renders it; an entry whose camera the same write did not discard keeps
answering with that camera and no pixels. The write SHALL also accept the generation the
writer last saw: when given and no longer the entry's current generation, the server
SHALL refuse the write without changing anything and SHALL say so distinctly from a
malformed request, so a bulk job can skip an entry the user touched mid-job without a
client-side read-then-write. Every accepted write, a deletion included, SHALL move the
generation as any write does.

#### Scenario: A reset job empties a model's renders
- **WHEN** a write discards a model's camera and deletes its renders
- **THEN** both occlusion variants read as absent, the orientation is discarded exactly as the write's orientation fields say, and the generation has moved

#### Scenario: A stale writer is refused
- **WHEN** a write names a generation the entry has since moved past
- **THEN** nothing is written, the refusal is distinguishable from a malformed request, and the entry's generation is unchanged

### Requirement: Cached thumbnails are served as images
The server SHALL answer a cached thumbnail's stored bytes as an image response — typed by the encoding those bytes are in, `image/webp`, no envelope — at an image route keyed exactly as the thumbnail lookup is keyed: path, mtime, occlusion variant, and write generation. The image route SHALL apply the same cache tiers as the lookup: an answer whose request names the entry's current generation SHALL be marked immutable; one that names none SHALL be validatable by the entry's generation; one that names a superseded generation SHALL carry the current bytes and SHALL NOT be cacheable, so a stale URL never shows stale pixels. A request for anything but a hit — a thumbnail the cache does not hold, or holds only as stale — SHALL be answered not-found and SHALL NOT be cached. The image route SHALL be confined as the lookup is, and SHALL advance the cache's least-recently-read clock as a lookup hit does; a view answered from the browser's own cache is invisible to the server and does not advance it. The lookup route SHALL be unchanged.

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

### Requirement: A superseded encoding leaves no stored bytes behind
A render whose stored bytes are in an encoding this app no longer produces SHALL be removed
from the cache rather than left beside its replacement. The recipe version already makes such
a render stale — it is re-rendered on the visit that finds it (see *Recipe-labelled
thumbnails*) — but staleness alone frees no disk: a file the store can no longer name is a
file nothing will ever evict, since the bounded cache measures and evicts only the renders it
can find. Removal SHALL happen wherever the store already has that entry in hand — when it is
written, when a stale render is replaced, when the sweep that follows a deleted model
reaches it, and when an entry is re-filed under a new key — and SHALL NOT require a pass
of its own over libraries nothing has asked for. Re-filing SHALL leave no superseded render behind at the
key it moved from: those pixels SHALL NOT be carried across, since the recipe version
that accompanies an encoding change has already made them unserveable, and re-filing
garbage under a new key is not what *Server-side thumbnail persistence* means by keeping
images intact — the orientation it moves is.

#### Scenario: A re-render reclaims what it replaced
- **WHEN** an entry whose stored bytes are in the superseded encoding is re-rendered under the current recipe
- **THEN** the superseded file is gone from the cache directory, the current one is served, and the cache's measured size counts only the current one

#### Scenario: Re-filing leaves nothing at the key it moved from
- **WHEN** an entry whose stored render is in a superseded encoding is re-filed under a new key
- **THEN** no file of it remains at the old key, its stored orientation arrives at the new one, and its pixels are re-rendered there rather than moved

#### Scenario: A superseded render does not outlive its model
- **WHEN** the model behind an entry holding a superseded render is deleted and the store's maintenance sweep reaches it
- **THEN** the superseded render is removed with the rest of the entry, rather than left as a file the store can no longer name

