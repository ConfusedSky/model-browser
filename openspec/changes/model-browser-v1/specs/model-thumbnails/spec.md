## ADDED Requirements

### Requirement: Client-side thumbnail rendering
The client SHALL render a static PNG thumbnail for each model file (STL, 3MF, OBJ — plain or zip entry) using the same three.js scene setup (loaders, materials, lighting) as the live viewer, so thumbnails match the orbit view. Rendering SHALL go through a limited-concurrency queue, and mesh geometry SHALL be released after snapshot unless retained by the mesh LRU.

#### Scenario: Fresh directory fills in progressively
- **WHEN** the user opens a directory containing model files with no cached thumbnails
- **THEN** tiles appear immediately as placeholders and thumbnails pop in as the render queue completes each file

#### Scenario: Unparseable model file
- **WHEN** a model file fails to load or parse
- **THEN** its tile shows an error/broken state and the queue continues with remaining files

### Requirement: Server-side thumbnail persistence
The server SHALL persist rendered thumbnails keyed by `path + mtime` in a cache directory outside the browsed directories. The client SHALL upload each rendered PNG, and on later visits SHALL receive cached thumbnails without reloading meshes. A changed mtime SHALL invalidate the cached thumbnail.

#### Scenario: Second visit is instant
- **WHEN** the user reopens a directory whose thumbnails were previously rendered and files are unchanged
- **THEN** all thumbnails load from the server cache with no mesh downloads or rendering

#### Scenario: Modified file re-renders
- **WHEN** a model file's mtime changes after its thumbnail was cached
- **THEN** the cached thumbnail is treated as stale and the client re-renders and re-uploads it

### Requirement: Camera state stored alongside thumbnails
The server SHALL store each model's camera (orientation) state alongside its thumbnail, keyed by path only, so orientation survives file modification, sessions, and different browsers. Thumbnail renders SHALL use the stored camera state when present, otherwise a default fit-to-bounds three-quarter view.

#### Scenario: Orientation survives re-export
- **WHEN** a model file is overwritten (new mtime) after the user saved an orientation
- **THEN** the regenerated thumbnail is rendered from the saved camera state

#### Scenario: Orientation shared across browsers
- **WHEN** the user orbits a model in one browser and opens the app in another browser
- **THEN** the second browser shows the thumbnail in the saved orientation

### Requirement: Embedded 3MF preview as placeholder
When a 3MF package contains an embedded thumbnail image, the client SHALL display it as an immediate placeholder until its own render replaces it.

#### Scenario: 3MF with embedded thumbnail
- **WHEN** a 3MF file containing `/Metadata/thumbnail.png` is listed without a cached thumbnail
- **THEN** the embedded image is shown immediately and later replaced by the app's own render
