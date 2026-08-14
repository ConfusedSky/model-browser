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
Clicking a model tile — a press released without exceeding the drag threshold — SHALL dismiss the orbit overlay and open the model in a modal lightbox with full orbit and zoom controls. There SHALL be no separate expand affordance. Esc or clicking outside SHALL close it, persisting camera state and thumbnail like an orbit release. While open the lightbox SHALL trap keyboard focus, and on close SHALL return focus to the tile that opened it. The lightbox SHALL contain the model's orbit-axis control: three axis buttons (X/Y/Z) plus a flip toggle covering all six spindles, with the current value indicated. Changing the axis SHALL smoothly animate the camera — a brief eased rotation, not an instant snap — to the new spindle's default three-quarter view, visibly rotating the chosen axis to screen-up, and SHALL immediately persist the axis, the end-state camera, and a re-rendered thumbnail (the end state is known upfront; persistence does not wait for the animation). A drag during the transition SHALL cancel the animation and orbit from the current pose. The lightbox SHALL show an info panel beside the viewer containing the model's file name, full virtual path (including `zip!/entry` notation for zip contents), format, size, and modified time — for zip entries the available mtime is the containing archive's, and the panel SHALL label it as the archive's modified time — with an affordance to copy the full path to the clipboard. The panel's content comes from the directory entry rather than the mesh, so it SHALL be shown from the moment the lightbox opens — including while the mesh is still loading and after it has failed to load. If the clipboard is unavailable or the write fails, the panel SHALL select the path text for manual copying and SHALL NOT show a copied confirmation. The panel's controls SHALL participate in the focus trap, and pointer or wheel interaction with the panel SHALL NOT orbit or zoom the model or close the lightbox.

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
- **THEN** focus stays within the lightbox while open, cycling through the viewer, axis, info-panel, and close controls, and returns to the originating tile on close

#### Scenario: Changing the orbit axis
- **WHEN** the user selects a different axis (or toggles flip) in the lightbox
- **THEN** the view smoothly rotates the chosen axis to screen-up, settling at the new spindle's default three-quarter view, and the axis, end-state camera, and updated thumbnail are persisted immediately

#### Scenario: Dragging during the axis transition
- **WHEN** the user starts an orbit drag while the axis-change animation is in flight
- **THEN** the animation is cancelled and the drag orbits around the new spindle from the current pose

#### Scenario: Axis override survives sessions and browsers
- **WHEN** the user overrides a model's axis and later opens the app in another browser
- **THEN** the model orbits around the overridden spindle there too

#### Scenario: Info panel shows the full path
- **WHEN** the user opens a model in the lightbox — a plain file or a zip entry
- **THEN** the info panel shows its name, full virtual path, format, size, and modified time — labeled as the containing archive's modified time when the model is a zip entry

#### Scenario: Copying the path
- **WHEN** the user activates the copy affordance and the clipboard write succeeds
- **THEN** the model's full virtual path is placed on the clipboard and brief feedback confirms it

#### Scenario: Copy failure falls back to selection
- **WHEN** the user activates the copy affordance and the clipboard is unavailable or the write fails
- **THEN** the path text is selected for manual copying and no copied confirmation is shown

#### Scenario: Panel is available without a mesh
- **WHEN** the lightbox is open while the mesh is still loading, or after the mesh failed to load
- **THEN** the info panel still shows the path and metadata and the copy affordance works

#### Scenario: Panel interaction never orbits
- **WHEN** the user presses, drags, clicks, or scrolls the wheel within the info panel
- **THEN** the model neither orbits nor zooms and the lightbox stays open

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

### Requirement: Spindle-aligned lighting with camera-relative option
The light rig SHALL be oriented per lighting mode rather than fixed to world +Y. In `axis` mode (the default) the rig's up SHALL be the model's spindle axis, oriented by the spindle's turntable frame so the result is deterministic for all six spindles; the base rig (hemisphere, key, and fill) SHALL keep its historical parameters and, under the default `y` spindle, its historical orientation. In `camera` mode the rig SHALL be fixed in camera space (headlight): the lit side follows the viewer as the model orbits. The mode SHALL be a global client-side setting persisted across sessions (localStorage), defaulting to `axis`, switchable via an experimental control; light colors, intensities, and relative geometry SHALL NOT change between modes — only orientation. Both the orbit overlay and the lightbox SHALL honor the active mode, and in `axis` mode the lightbox axis-change animation SHALL rotate the rig smoothly in step with the camera tween (with a drag cancelling the tween snapping the rig with the camera).

The rig SHALL additionally carry two colored rim accents — red at rig-space −X, blue at +X, placed slightly behind the subject and tuned as perceptually balanced accents (raw intensities may differ to compensate for the base lighting's cool tint) — present in both modes. Because they are part of the rig, they SHALL follow its orientation everywhere the rig does: in `camera` mode rig space is camera space, so the red accent stays at screen-left and the blue at screen-right while the model orbits; in `axis` mode both accents are fixed in the spindle frame — deterministic directions the model turns through, with no claim about which screen side they land on — and during the axis tween they rotate with the rig.

#### Scenario: Overridden-axis model is lit from its top
- **WHEN** a model whose spindle is ±X or ±Z is viewed in `axis` mode
- **THEN** it is lit as if from above relative to its spindle (key light and hemisphere sky aligned to the spindle), not from world +Y

#### Scenario: Default axis keeps historical lighting
- **WHEN** a model with the default `y` spindle is viewed in `axis` mode
- **THEN** the hemisphere, key, and fill lights light it exactly as the historical world-fixed rig did, with only the rim accents added

#### Scenario: Camera mode keeps the lit side facing the viewer
- **WHEN** the user orbits a model in `camera` mode
- **THEN** the shading relative to the screen stays constant (the same side of the model stays lit) instead of the model rotating through fixed light

#### Scenario: Rim accents follow the screen in camera mode
- **WHEN** the user orbits a model in `camera` mode
- **THEN** the red accent remains on the screen-left edge and the blue accent on the screen-right edge throughout the orbit

#### Scenario: Rim accents stay with the model in axis mode
- **WHEN** the user orbits a model in `axis` mode
- **THEN** the accents stay fixed in the spindle frame — the reddened and blued sides of the model turn with it rather than sticking to the screen

#### Scenario: Mode persists across sessions
- **WHEN** the user switches lighting mode and reloads the app
- **THEN** the chosen mode is still active

#### Scenario: Axis change animates the lighting
- **WHEN** the user changes a model's orbit axis in the lightbox while in `axis` mode
- **THEN** the rig — rim accents included — rotates smoothly with the camera animation to the new spindle orientation, with no lighting snap

### Requirement: Shadowed model display
Models SHALL be rendered with shadow mapping from the key light: the model SHALL shadow itself, and SHALL cast a soft contact shadow onto an invisible floor plane that renders nothing but received shadow (composing over the transparent background). The floor SHALL lie perpendicular to the model's spindle axis at the model's lowest extent along it, fixed in the spindle frame — it SHALL NOT follow the lighting rig's per-mode orientation — and SHALL snap to the new spindle when the orbit axis changes. Shadow direction SHALL come from the key light and therefore inherit the active lighting-mode semantics: fixed in the spindle frame in `axis` mode, following the viewer in `camera` mode. Only the key light casts; the hemisphere, fill, and rim lights SHALL NOT. The shadow fit (light distance, shadow frustum, bias) SHALL scale with the model's bounds so models of any physical size shadow equivalently, and shadows SHALL appear identically in the orbit overlay, the lightbox, and thumbnails. Scene composition SHALL place the model's bounds center at the scene origin; because camera state is bounds-relative, this SHALL NOT alter persisted camera state or the rendered framing.

#### Scenario: Model is grounded by a contact shadow
- **WHEN** a model is thumbnailed or viewed in the overlay or lightbox
- **THEN** a soft shadow appears beneath it on an otherwise invisible plane at its lowest extent along the spindle, and concavities on the model itself are darkened by self-shadowing

#### Scenario: Shadows follow the lighting mode
- **WHEN** the user orbits a model in `camera` mode
- **THEN** the shadow sweeps the floor in step with the camera-locked key light, while in `axis` mode the shadow stays fixed in the spindle frame as the model turns

#### Scenario: Floor follows an axis change
- **WHEN** the user changes a model's orbit axis in the lightbox
- **THEN** the contact floor moves to the face of the model lowest along the new spindle, and the persisted thumbnail shows the shadow on that face's side

#### Scenario: Size-independent shadow quality
- **WHEN** a very small and a very large model are each thumbnailed
- **THEN** both show equivalent shadow softness and contact, with neither speckling (acne) nor a visibly detached shadow

#### Scenario: Thumbnails match the live view
- **WHEN** an orbit overlay opens over a tile whose thumbnail was rendered with shadows
- **THEN** the shadowing in the live view is indistinguishable from the thumbnail at handoff, preserving the no-shift guarantee

