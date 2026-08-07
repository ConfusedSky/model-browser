## ADDED Requirements

### Requirement: Drag-to-orbit on grid tiles via shared overlay canvas
The client SHALL use exactly one live WebGL canvas for in-grid orbiting. On mousedown over a model tile, the canvas SHALL overlay that tile and drag SHALL orbit the model; on release the overlay persists until the pointer leaves the tile or the user scrolls/resizes, which dismisses it back to the static thumbnail.

#### Scenario: Orbiting a tile
- **WHEN** the user presses and drags on a model tile
- **THEN** the shared canvas overlays the tile and the model orbits following the drag

#### Scenario: Only one live context
- **WHEN** the user orbits several different tiles in succession
- **THEN** at most one WebGL context exists at any time

#### Scenario: Scroll dismisses overlay
- **WHEN** the grid scrolls or the window resizes while the overlay is active
- **THEN** the overlay is dismissed and the tile shows its static thumbnail

### Requirement: Hover-warmed mesh LRU
The client SHALL maintain a byte-budgeted LRU of parsed meshes. Hovering a model tile for a linger threshold (~120ms) SHALL prefetch and parse that mesh into the LRU, with a small cap on concurrent parses. Eviction SHALL be by total byte budget, not entry count.

#### Scenario: Warm orbit starts instantly
- **WHEN** the user hovers a tile long enough for the warm to complete, then presses to orbit
- **THEN** orbiting starts immediately with no load delay

#### Scenario: Orbit before warm completes
- **WHEN** the user presses a tile whose mesh is still loading
- **THEN** the overlay shows a loading indicator until the mesh is ready, then becomes orbitable

#### Scenario: Sweeping the cursor across the grid
- **WHEN** the cursor moves across many tiles faster than the linger threshold
- **THEN** no prefetches are triggered for tiles that were only transiently crossed

#### Scenario: Byte budget eviction
- **WHEN** warming a new mesh would exceed the LRU byte budget
- **THEN** least-recently-used meshes are evicted until the new mesh fits

### Requirement: Rotation state persists on release
When an orbit interaction ends (overlay release or lightbox close), the client SHALL save the camera state and an updated thumbnail snapshot to the server in one operation.

#### Scenario: Orientation kept for next session
- **WHEN** the user orbits a model to a new orientation and releases
- **THEN** reopening the directory later shows that model's thumbnail in the released orientation

### Requirement: Lightbox expanded view
Activating a tile's expand affordance SHALL open the model in a modal lightbox with full orbit and zoom controls. Esc or clicking outside SHALL close it, persisting camera state and thumbnail like an orbit release.

#### Scenario: Expanding a model
- **WHEN** the user expands a model tile
- **THEN** a modal lightbox shows the model with orbit and zoom controls over the dimmed grid

#### Scenario: Closing the lightbox
- **WHEN** the user presses Esc or clicks outside the lightbox after orbiting
- **THEN** the lightbox closes and the tile's thumbnail reflects the final orientation
