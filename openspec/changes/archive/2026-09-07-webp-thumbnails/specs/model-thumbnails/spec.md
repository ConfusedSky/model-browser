# model-thumbnails Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
