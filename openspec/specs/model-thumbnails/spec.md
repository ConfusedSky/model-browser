# model-thumbnails Specification

## Purpose
TBD - created by archiving change model-browser-v1. Update Purpose after archive.
## Requirements
### Requirement: Client-side thumbnail rendering
The client SHALL render a static PNG thumbnail for each model file (STL, 3MF, OBJ — plain or zip entry) using the same three.js scene setup (loaders, materials, lighting) AND the same output color pipeline (color-space encoding, tone mapping) as the live viewer, so a thumbnail is pixel-comparable with a live frame of the same camera — offscreen render-target output SHALL NOT differ in brightness or color from the visible canvas. Rendering SHALL go through a limited-concurrency queue using the app's single shared WebGL renderer (see `model-viewer`), suspending while an orbit overlay or lightbox is active. Mesh geometry SHALL be disposed after snapshot — freeing its GPU buffers, not merely dropping the reference — unless retained by the mesh LRU. Thumbnails SHALL be 512×512 PNGs with a transparent background, independent of tile size and device pixel ratio.

#### Scenario: Fresh directory fills in progressively
- **WHEN** the user opens a directory containing model files with no cached thumbnails
- **THEN** tiles appear immediately as placeholders and thumbnails pop in as the render queue completes each file

#### Scenario: Thumbnail matches live view color
- **WHEN** a freshly rendered thumbnail is compared with the live view of the same model at the same camera
- **THEN** brightness and color are visually indistinguishable

#### Scenario: Unparseable model file
- **WHEN** a model file fails to load or parse
- **THEN** its tile shows an error/broken state and the queue continues with remaining files

### Requirement: Server-side thumbnail persistence
The server SHALL persist rendered thumbnails keyed by `path + mtime` in a cache directory outside the browsed directories; for zip entries the mtime in the key SHALL be the containing zip's (see `zip-browsing`). The client SHALL upload each rendered PNG, and on later visits SHALL receive cached thumbnails without reloading meshes. A changed mtime SHALL invalidate the cached thumbnail.

#### Scenario: Second visit is instant
- **WHEN** the user reopens a directory whose thumbnails were previously rendered and files are unchanged
- **THEN** all thumbnails load from the server cache with no mesh downloads or rendering

#### Scenario: Modified file re-renders
- **WHEN** a model file's mtime changes after its thumbnail was cached
- **THEN** the cached thumbnail is treated as stale and the client re-renders and re-uploads it

### Requirement: Camera state stored alongside thumbnails
The server SHALL store each model's camera (orientation) state and its orbit axis together alongside its thumbnail, keyed by path only, so both survive file modification, sessions, and different browsers. Thumbnail renders SHALL use the stored camera state when present, otherwise the spindle's default fit-to-bounds three-quarter view. Camera state SHALL be stored bounds-relative — azimuth, elevation, and distance as a multiple of the bounding-sphere radius, with the target relative to the bounding box — and spindle-relative: azimuth/elevation are measured in the model's spindle frame, never in world coordinates, so orientation round-trips exactly for every axis. A missing axis SHALL read as +Y, under which the spindle-relative representation equals the historical world-Y one (no migration).

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

### Requirement: Bounded, self-maintaining cache
The thumbnail cache SHALL NOT grow without bound. Superseded thumbnails (an older mtime for the same path) SHALL be deleted, entries whose source path no longer exists SHALL be swept — for a virtual path, existence SHALL be tested against the containing zip rather than the entry — and when total cache size exceeds a configurable cap (default 2GB) least-recently-read thumbnails SHALL be evicted. Camera state and the orbit axis SHALL survive size-cap eviction of their thumbnail (they are tiny and cannot be regenerated), but the existence sweep SHALL remove the entire entry — camera state and axis included — when the source path no longer exists. Entries SHALL be stored under a hash of the path rather than the path itself, since paths contain `/`, `!`, and spaces and may exceed filename length limits.

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

### Requirement: Embedded 3MF preview as placeholder
When a 3MF package contains an embedded thumbnail image, the client SHALL display it as an immediate placeholder until its own render replaces it.

#### Scenario: 3MF with embedded thumbnail
- **WHEN** a 3MF file containing `/Metadata/thumbnail.png` is listed without a cached thumbnail
- **THEN** the embedded image is shown immediately and later replaced by the app's own render

