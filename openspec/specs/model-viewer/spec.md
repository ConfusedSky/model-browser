# model-viewer Specification

## Purpose
TBD - created by archiving change model-browser-v1. Update Purpose after archive.
## Requirements
### Requirement: Drag-to-orbit on grid tiles via shared overlay canvas
The client SHALL hold exactly one WebGL context for the entire app — a single renderer shared by the in-grid orbit overlay, the lightbox, and the thumbnail render queue. On mousedown over a model tile, the canvas SHALL overlay that tile's thumbnail image area — not the whole tile — so the file name label below remains visible throughout the interaction, and the live view SHALL match the static thumbnail's framing and color at the moment of handoff (no size jump, no brightness shift). On release the overlay persists until the pointer leaves the tile or the user scrolls/resizes, which dismisses it back to the static thumbnail. A press released without exceeding a small movement threshold (~5px) SHALL NOT be treated as an orbit; it is a click and opens the lightbox instead.

#### Scenario: Orbiting a tile
- **WHEN** the user presses and drags on a model tile
- **THEN** the shared canvas overlays the tile's image area and the model orbits following the drag

#### Scenario: Seamless handoff
- **WHEN** the overlay opens over a tile whose thumbnail is current
- **THEN** the model's on-screen size, position, and brightness are indistinguishable from the static thumbnail until the drag moves it

#### Scenario: Label stays visible
- **WHEN** the user is mid-drag on a tile
- **THEN** the file name label remains visible beneath the live view

#### Scenario: Only one live context
- **WHEN** the user orbits several different tiles in succession while the thumbnail render queue is still working
- **THEN** at most one WebGL context exists at any time, shared by the overlay and the queue

#### Scenario: Render queue yields to interaction
- **WHEN** an orbit overlay or lightbox is active while the render queue has work pending
- **THEN** the queue suspends rendering until the interaction ends, then resumes where it left off

#### Scenario: Scroll dismisses overlay
- **WHEN** the grid scrolls or the window resizes while the overlay is active
- **THEN** the overlay is dismissed and the tile shows its static thumbnail

#### Scenario: Press and release without moving
- **WHEN** the user presses and releases on a model tile without moving beyond the movement threshold
- **THEN** no orbit is recorded, no camera state is saved, and the lightbox opens for that model

### Requirement: Hover-warmed mesh LRU
The client SHALL maintain a byte-budgeted LRU of parsed meshes. Hovering a model tile for a linger threshold (~120ms) SHALL prefetch and parse that mesh into the LRU, with a small cap on concurrent parses. Eviction SHALL be by total byte budget, not entry count, measured against parsed geometry on the JS heap. Eviction SHALL explicitly dispose the evicted geometry so its GPU buffers are freed; dropping the reference alone frees heap but leaks VRAM.

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

#### Scenario: Eviction frees GPU memory
- **WHEN** a mesh that has already been rendered is evicted from the LRU
- **THEN** its GPU buffers are released along with its heap allocation, so GPU memory does not grow across a long browsing session

### Requirement: Rotation state persists on release
When an orbit interaction ends (overlay release or lightbox close), the client SHALL save the camera state and an updated thumbnail snapshot to the server in one operation.

#### Scenario: Orientation kept for next session
- **WHEN** the user orbits a model to a new orientation and releases
- **THEN** reopening the directory later shows that model's thumbnail in the released orientation

### Requirement: Lightbox expanded view
Clicking a model tile — a press released without exceeding the drag threshold — SHALL dismiss the orbit overlay and open the model in a modal lightbox with full orbit and zoom controls. There SHALL be no separate expand affordance. Esc or clicking outside SHALL close it, persisting camera state and thumbnail like an orbit release. While open the lightbox SHALL trap keyboard focus, and on close SHALL return focus to the tile that opened it.

#### Scenario: Expanding a model
- **WHEN** the user clicks a model tile without dragging
- **THEN** a modal lightbox shows the model with orbit and zoom controls over the dimmed grid

#### Scenario: Lightbox opened before mesh is warm
- **WHEN** the user clicks a tile whose mesh has not finished loading (e.g. a fast click that beats the hover-warm linger)
- **THEN** the lightbox opens immediately with a loading indicator and becomes orbitable when the mesh is ready

#### Scenario: Closing the lightbox
- **WHEN** the user presses Esc or clicks outside the lightbox after orbiting
- **THEN** the lightbox closes and the tile's thumbnail reflects the final orientation

#### Scenario: Keyboard focus while expanded
- **WHEN** the lightbox is open and the user tabs through it, then closes it
- **THEN** focus stays within the lightbox while open and returns to the originating tile on close

