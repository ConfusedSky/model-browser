# model-viewer Specification

## Purpose
TBD - created by archiving change model-browser-v1. Update Purpose after archive.
## Requirements
### Requirement: Drag-to-orbit on grid tiles via shared overlay canvas
The client SHALL hold exactly one WebGL context for the entire app — a single renderer shared by the in-grid orbit overlay, the lightbox, and the thumbnail render queue. On mousedown over a model tile, the canvas SHALL overlay that tile's thumbnail image area — not the whole tile — so the file name label below remains visible throughout the interaction, and the live view SHALL match the static thumbnail's framing and color at the moment of handoff (no size jump, no brightness shift). On release the overlay persists until the pointer leaves the tile or the user scrolls/resizes, which dismisses it back to the static thumbnail. After an orbit drag, dismissal triggered by the pointer leaving the tile (or by the release landing outside it) SHALL hold the live view in place until the refreshed thumbnail has been applied to the tile and is ready to paint, so the overlay unmounts onto pixels matching the live view; if thumbnail persistence fails or exceeds a short timeout (~1.5s), the overlay SHALL dismiss anyway. Scroll/resize dismissal SHALL remain immediate. A held dismissal SHALL NOT interrupt or cancel a newer interaction begun before it completes. A press released without exceeding a small movement threshold (~5px) SHALL NOT be treated as an orbit; it is a click and opens the lightbox instead.

#### Scenario: Orbiting a tile
- **WHEN** the user presses and drags on a model tile
- **THEN** the shared canvas overlays the tile's image area and the model orbits following the drag

#### Scenario: Seamless handoff
- **WHEN** the overlay opens over a tile whose thumbnail is current
- **THEN** the model's on-screen size, position, and brightness are indistinguishable from the static thumbnail until the drag moves it

#### Scenario: Release lands on the refreshed thumbnail
- **WHEN** the user orbits a tile to a new orientation and the overlay is then dismissed by the pointer leaving the tile or the release landing outside it
- **THEN** the live view remains visible until the tile's thumbnail shows the new orientation, and the swap to the static thumbnail shows no flash of the previous orientation

#### Scenario: Slow or failed thumbnail persistence
- **WHEN** an orbit drag is released and the thumbnail snapshot or upload fails or takes longer than the timeout
- **THEN** the overlay dismisses after at most the timeout, falling back to whatever thumbnail the tile currently has

#### Scenario: Held dismissal yields to a new interaction
- **WHEN** the user releases an orbit drag and, before its held dismissal completes, presses the same or another model tile
- **THEN** the new interaction proceeds normally and is not dismissed or interrupted by the earlier pending dismissal

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
- **THEN** the overlay is dismissed immediately and the tile shows its static thumbnail

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
Clicking a model tile — a press released without exceeding the drag threshold — SHALL dismiss the orbit overlay and open the model in a modal lightbox with full orbit and zoom controls. There SHALL be no separate expand affordance. Esc or clicking outside SHALL close it, persisting camera state and thumbnail like an orbit release. While open the lightbox SHALL trap keyboard focus, and on close SHALL return focus to the tile that opened it. The lightbox SHALL contain the model's orbit-axis control: three axis buttons (X/Y/Z) plus a flip toggle covering all six spindles, with the current value indicated. Changing the axis SHALL smoothly animate the camera — a brief eased rotation, not an instant snap — to the new spindle's default three-quarter view, visibly rotating the chosen axis to screen-up, and SHALL immediately persist the axis, the end-state camera, and a re-rendered thumbnail (the end state is known upfront; persistence does not wait for the animation). A drag during the transition SHALL cancel the animation and orbit from the current pose.

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

#### Scenario: Changing the orbit axis
- **WHEN** the user selects a different axis (or toggles flip) in the lightbox
- **THEN** the view smoothly rotates the chosen axis to screen-up, settling at the new spindle's default three-quarter view, and the axis, end-state camera, and updated thumbnail are persisted immediately

#### Scenario: Dragging during the axis transition
- **WHEN** the user starts an orbit drag while the axis-change animation is in flight
- **THEN** the animation is cancelled and the drag orbits around the new spindle from the current pose

#### Scenario: Axis override survives sessions and browsers
- **WHEN** the user overrides a model's axis and later opens the app in another browser
- **THEN** the model orbits around the overridden spindle there too

### Requirement: Upright model display
Models SHALL be displayed print-bed-up: STL geometry SHALL be converted from its Z-up convention to the scene's Y-up at parse time (baked into the geometry), 3MF via its loader's built-in conversion, and OBJ (conventionally Y-up) loaded as-is. The conversion applies everywhere a model is rendered — thumbnails, orbit overlay, and lightbox.

#### Scenario: STL stands upright
- **WHEN** an STL exported from a slicer (Z-up) is thumbnailed or opened
- **THEN** the model appears standing on its print bed in the default three-quarter view, not lying on its back

### Requirement: Per-model orbit spindle
Every model SHALL orbit as a clamped turntable around its spindle axis: horizontal drag rotates around the spindle, vertical drag tilts toward/away from it clamped short of the poles, and the camera's up vector is locked to the spindle. The spindle SHALL be one of ±X/±Y/±Z, defaulting to +Y. Drag direction SHALL feel consistent across all six spindles (a rightward drag spins the same visual direction). The in-grid orbit overlay and the lightbox SHALL both honor the model's stored spindle.

#### Scenario: Default spindle
- **WHEN** a model with no stored axis is orbited
- **THEN** it turns around +Y — its natural up after upright display conversion

#### Scenario: Overridden spindle honored everywhere
- **WHEN** a model's axis has been overridden and the user orbits it from the grid overlay
- **THEN** the turntable spins around the overridden spindle, same as in the lightbox

### Requirement: Missing-model error feedback
When the mesh for an orbit overlay or lightbox fails to load — the file no longer exists, its zip entry is gone, or the model cannot be parsed — the viewer SHALL display an explicit error in place of the model rather than silently dismissing: the orbit overlay SHALL show a compact error indicator in the tile box, and the lightbox SHALL show the file name and the failure reason, keeping its normal close paths (Esc, outside click, close button). The same failure SHALL mark the model's grid tile with the error state so the stale cached thumbnail is no longer presented as a healthy model. An errored viewer SHALL NOT persist camera state, orbit axis, or a thumbnail, and dismissing it SHALL skip the settle/persist path. Clicking an errored orbit overlay SHALL still open the lightbox, where the full reason is readable.

#### Scenario: Opening the lightbox for a deleted model
- **WHEN** the user clicks a tile whose model file has been deleted since the thumbnail was cached
- **THEN** the lightbox opens and shows the file name with an explicit error (e.g. "no such file") instead of a spinner that silently vanishes, and closes only via the normal close paths

#### Scenario: Orbiting a deleted model
- **WHEN** the user presses and drags on a tile whose model file no longer exists
- **THEN** the orbit overlay shows an error indicator instead of the loading spinner, and the tile is marked with the error state after the overlay is dismissed

#### Scenario: No persistence from an errored viewer
- **WHEN** an errored lightbox is closed
- **THEN** no camera state, axis, or thumbnail is written to the server

#### Scenario: Errored overlay promotes to lightbox
- **WHEN** the user clicks (press-and-release without drag) on an errored orbit overlay
- **THEN** the lightbox opens showing the full error message

#### Scenario: Transient failure recovers on refresh
- **WHEN** a tile was marked errored and the user re-enters the directory after the failure cause is resolved
- **THEN** the thumbnail pipeline runs again and the tile returns to its normal rendering

