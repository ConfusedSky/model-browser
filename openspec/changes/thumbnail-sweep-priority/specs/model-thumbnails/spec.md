# model-thumbnails Delta

> Rebased 2026-09-01 against main `62f9f2d`; the warm-mesh parking exception was
> added later the same day (user review — see design.md D4/D6). MODIFIES
> *Client-side thumbnail rendering* only; no other active change touches this
> capability (`adaptive-ao-default` modifies `model-viewer`; `listing-tree-cache`
> and `search-cancellation` modify `listing-cache` and `directory-browsing`;
> `library-overrides` archived 2026-09-01). The MODIFIED block below carries
> all five of main's current scenarios unchanged, since MODIFIED replaces prose
> *and* scenarios and archive refuses a dropped title. The parked-state clauses
> are this change's to write: `ao-refreshes-thumbnails` left the naming to
> whichever of the two landed second, and this one did. The nearest-position rule
> is `folder-contact-sheets`' per-path max, which that change specified and left
> the code for.

## MODIFIED Requirements

### Requirement: Client-side thumbnail rendering
The client SHALL render a static PNG thumbnail for each model file (STL, 3MF, OBJ — plain or zip entry) using the same three.js scene setup (loaders, materials, lighting) AND the same output color pipeline (color-space encoding, tone mapping) as the live viewer, so a thumbnail is pixel-comparable with a live frame of the same camera — offscreen render-target output SHALL NOT differ in brightness or color from the visible canvas. Rendering SHALL go through a limited-concurrency queue using the app's single shared WebGL renderer (see `model-viewer`), suspending while an orbit overlay or lightbox is active. The queue SHALL take pending work in order of what the user can see rather than in listing order: a model whose tile is on screen SHALL be rendered before one whose tile is not, and this ordering SHALL be re-evaluated as the view scrolls, so tiles brought into view take priority over work queued earlier for tiles now out of view. Where a model is shown only inside another tile's contents rather than as a tile of its own, its position SHALL be that of the tile showing it; a model shown in more than one place SHALL take the nearest of those positions, so work for something on screen is never treated as far away. Render work queued for a tile that leaves the viewport before it starts SHALL be **parked** rather than run — a state distinct from both finished and failed: the model keeps whatever its tile is showing, a placeholder, an embedded preview, or a previous render, and SHALL NOT enter the error state this requirement reserves for a model that failed to load or parse; the work SHALL be restarted when the tile returns. Parking SHALL apply only to work that would still have to read its model into memory: work whose model is already held in memory SHALL be kept and completed after all other pending work instead, so a read already paid yields a lasting cached image rather than being discarded — and where the model is no longer held by the time that work would begin, the work SHALL be parked at that point rather than the model read again. Work for a tile far from view SHALL never begin reading a model into memory. Parking SHALL govern rendering alone and SHALL NOT stop a cache lookup. When the inputs to a model's pixels change while its work is parked — the occlusion preference, or an orientation supplied for it — its cache SHALL be consulted again at once, so that a render already held under the new inputs is shown without waiting for the tile to return, while one the cache does not hold stays parked; restarted work SHALL be rendered under the inputs in force when it restarts, never those in force when it was parked. Work with no reported position SHALL be taken after work reported on screen or near it and before work kept at a far position — an unreported model may be anywhere, while a far one is known to be off screen — in the order it was queued, so a view that reports nothing behaves exactly as one taken in listing order. This governs only the order and abandonment of work; the concurrency limit, the suspension rule, the cached-lookup path, and the rendered output are unaffected. The queue SHALL gate only work that touches the shared renderer — mesh load, parse, render, and upload of the result; looking up an already-cached thumbnail SHALL NOT occupy the queue, and SHALL run under its own concurrency limit, so a directory whose thumbnails are all cached fills at the speed of the cache rather than at the speed of renderer concurrency. Mesh geometry SHALL be disposed after snapshot — freeing its GPU buffers, not merely dropping the reference — unless retained by the mesh LRU. Thumbnails SHALL be 512×512 PNGs with a transparent background, independent of tile size and device pixel ratio.

#### Scenario: Fresh directory fills in progressively
- **WHEN** the user opens a directory containing model files with no cached thumbnails
- **THEN** tiles appear immediately as placeholders and thumbnails pop in as the render queue completes each file

#### Scenario: A deep scroll does not wait behind the whole directory
- **WHEN** the user opens a large uncached listing and immediately scrolls far down it
- **THEN** the tiles now on screen render next, rather than after every earlier tile in the listing has been rendered

#### Scenario: Scrolling past uncached tiles wastes no rendering
- **WHEN** the user scrolls quickly through a large uncached listing without stopping
- **THEN** tiles that left the viewport before their rendering began are not rendered — save any whose mesh was already in memory, which costs nothing more to finish and is taken after everything on screen — and the work goes to whatever is on screen when scrolling settles

#### Scenario: A tile scrolled away and back is never left broken
- **WHEN** a tile whose render was parked by scrolling away comes back on screen
- **THEN** it kept whatever it was showing meanwhile — never a failure state — and its render is taken up again and lands

#### Scenario: A model shown inside another tile is not treated as far away
- **WHEN** a model is shown only within another tile's contents, or is shown both as its own on-screen tile and within an off-screen tile's contents
- **THEN** it is ranked by the position of the tile showing it, taking the nearest where there is more than one, and is never parked while something showing it is on screen

#### Scenario: A setting change reaches a parked tile's cache, not its renderer
- **WHEN** the occlusion preference changes while some tiles' renders are parked off screen
- **THEN** every parked model's cache is consulted at once — one already held under the new setting is shown straight away — and only a model the cache does not hold under the new setting stays parked until its tile returns, unless its mesh is still in memory, in which case its render is taken last, behind all on-screen work, without waiting for the tile

#### Scenario: A read already paid is finished, not discarded
- **WHEN** a model's mesh is already held in memory as its tile leaves the viewport before its render starts
- **THEN** the render is kept and completes behind all on-screen work, filing the cached image — and if the mesh has been evicted by the time its turn comes, the work is parked at that point without the model being read again

#### Scenario: Parked work resumes under the current setting
- **WHEN** a model's render is parked, the occlusion preference or the orientation supplied for it changes, and its tile then comes back on screen
- **THEN** it is rendered under the setting and orientation in force at that moment, not the ones in force when it was parked

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
