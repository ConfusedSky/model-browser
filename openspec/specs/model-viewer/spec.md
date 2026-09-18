# model-viewer Specification

## Purpose
How the browser renders a model interactively — in the grid's orbit overlay and the expanded lightbox — and everything about that rendering a viewer relies on: upright display in the file's own coordinates, a per-model turntable spindle, a camera-fixed lighting rig with contact shadows and ambient occlusion, the source credit shown beside a model, stepping between siblings, and how a model's mesh is fetched, parsed, and bounded in memory.

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
Clicking a model tile — a press released without exceeding the drag threshold — SHALL dismiss the orbit overlay and open the model in a modal lightbox with full orbit and zoom controls. There SHALL be no separate expand affordance. Esc or clicking outside SHALL close it. A close that follows a manipulation of the view in the lightbox — an orbit, a zoom, or an axis change — SHALL persist camera state and thumbnail like an orbit release; a close that follows no such manipulation SHALL write nothing — neither a camera nor a thumbnail — since the view it shows records no decision of the user's, and a camera stored by an untouched close would outlive every orientation the source later holds for the model. While open the lightbox SHALL trap keyboard focus, and on close SHALL return focus to the tile that opened it. The lightbox SHALL contain the model's orbit-axis control: three axis buttons (X/Y/Z) plus a flip toggle covering all six spindles, with the current value indicated. Changing the axis SHALL smoothly animate the camera — a brief eased rotation, not an instant snap — to the new spindle's default three-quarter view, visibly rotating the chosen axis to screen-up, and SHALL immediately persist the axis, the end-state camera, and a re-rendered thumbnail (the end state is known upfront; persistence does not wait for the animation). A drag during the transition SHALL cancel the animation and orbit from the current pose. The lightbox SHALL show an info panel beside the viewer containing the model's file name, full virtual path (including `zip!/entry` notation for zip contents), format, size, and modified time — for zip entries the available mtime is the containing archive's, and the panel SHALL label it as the archive's modified time — with an affordance to copy the full path to the clipboard. The panel's content comes from the directory entry rather than the mesh, so it SHALL be shown from the moment the lightbox opens — including while the mesh is still loading and after it has failed to load. If the clipboard write fails, the panel SHALL report the failure briefly and SHALL NOT show a copied confirmation. The panel SHALL also present the entry's own actions as affordances — the same actions and the same availability rules the context menu applies, so an action absent from the menu for this entry is absent here. They SHALL be presented after the model's metadata rather than before it, since the panel describes the model first and offers what can be done to it second, and SHALL be drawn as the context menu draws the same actions, so that one command does not wear two looks within one view. The copy affordance stays with the path it copies and is not one of them. An action that changes the view SHALL leave the lightbox through the same close every other exit takes, persisting under the same rule. Resetting the model's framing from the panel SHALL discard its stored orientation, re-frame the open view to what the model then resolves to, and SHALL NOT have that discarded orientation written back by the close that follows. The panel's controls SHALL participate in the focus trap, and pointer or wheel interaction with the panel SHALL NOT orbit or zoom the model or close the lightbox.

#### Scenario: Expanding a model
- **WHEN** the user clicks a model tile without dragging
- **THEN** a modal lightbox shows the model with orbit and zoom controls over the dimmed grid

#### Scenario: Lightbox opened before mesh is warm
- **WHEN** the user clicks a tile whose mesh has not finished loading (e.g. a fast click that beats the hover-warm linger)
- **THEN** the lightbox opens immediately with a loading indicator and becomes orbitable when the mesh is ready

#### Scenario: Closing the lightbox
- **WHEN** the user presses Esc or clicks outside the lightbox after orbiting
- **THEN** the lightbox closes and the tile's thumbnail reflects the final orientation

#### Scenario: Closing without touching writes nothing
- **WHEN** the user opens a model in the lightbox and closes it without orbiting, zooming or changing the axis — whatever the lightbox opened at, a stored camera, the source's orientation or the default
- **THEN** no camera, axis or thumbnail is written, and the tile keeps the render and the framing it had

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
- **WHEN** a copy of the path fails
- **THEN** the failure is reported briefly and no copied confirmation is shown; the panel does **not** select the path text, the fallback this scenario is named for having been retired with the move to a shared action that has no rendered path to select

#### Scenario: Panel is available without a mesh
- **WHEN** the lightbox is open while the mesh is still loading, or after the mesh failed to load
- **THEN** the info panel still shows the path and metadata and the copy affordance works

#### Scenario: Acting on the model from the info panel
- **WHEN** the user activates one of the panel's action affordances
- **THEN** an action that changes the view — revealing the model in its folder, or finding similar ones — closes the lightbox through the same close every exit takes, and resetting the framing discards the stored orientation, re-frames the open view to what the model then resolves to, and is not undone by the close that follows

#### Scenario: The panel describes before it offers
- **WHEN** the lightbox's info panel is shown for a model
- **THEN** the actions come after the name, path and metadata, drawn as the context menu draws them, with the copy affordance still on the path line rather than among them

#### Scenario: Panel interaction never orbits
- **WHEN** the user presses, drags, clicks, or scrolls the wheel within the info panel
- **THEN** the model neither orbits nor zooms and the lightbox stays open

### Requirement: Upright model display
Models SHALL be displayed in their file's own coordinates: no conversion SHALL be applied to geometry at parse time for any format. A model stands upright because its spindle defaults to its file format's up convention, as *Per-model orbit spindle* defines, and that default applies everywhere a model is rendered: thumbnails, orbit overlay, and lightbox.

#### Scenario: STL stands upright
- **WHEN** an STL exported from a slicer (Z-up) is thumbnailed or opened
- **THEN** the model appears standing on its print bed in the default three-quarter view, not lying on its back, with its spindle at +Z

### Requirement: Per-model orbit spindle
Every model SHALL orbit as a clamped turntable around its spindle axis: horizontal drag rotates around the spindle, vertical drag tilts toward/away from it clamped short of the poles, and the camera's up vector is locked to the spindle. The spindle SHALL be one of ±X/±Y/±Z **in the model file's own coordinates**: a model is rendered as its file describes it, with no rotation applied on load, so the spindle a user chooses, the axis a thumbnail stores and the up axis an index reports all name the same direction. The default spindle SHALL be the file format's up convention — +Z for STL and 3MF, +Y for OBJ — and every surface that draws a model with no stored axis SHALL draw it about that default, from one definition. Drag direction SHALL feel consistent across all six spindles (a rightward drag spins the same visual direction). The in-grid orbit overlay and the lightbox SHALL both honor the model's stored spindle, and the axis controls in the lightbox and on a model tile's menu SHALL name the spindle in those same file coordinates.

#### Scenario: Default spindle
- **WHEN** a model with no stored axis is orbited
- **THEN** it turns around its format's up axis — +Z for an STL or 3MF, +Y for an OBJ — and the lightbox's axis control marks that axis

#### Scenario: A print-bed model reads as Z-up
- **WHEN** an STL whose height runs along its file's Z axis is opened with no stored axis
- **THEN** it stands upright, the axis control marks Z, and the axis agrees with what an external tool reports for the file

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

### Requirement: Shadowed model display
Models SHALL be rendered with shadow mapping from the key light: the model SHALL shadow itself, and SHALL cast a soft contact shadow onto an invisible floor plane that renders nothing but received shadow (composing over the transparent background). The floor SHALL lie perpendicular to the model's spindle axis at the model's lowest extent along it, fixed in the spindle frame — it SHALL NOT follow the lighting rig's orientation — and SHALL snap to the new spindle when the orbit axis changes. Shadow direction SHALL come from the key light and therefore follow the viewer, since the rig is fixed in camera space. Only the key light casts; the hemisphere, fill, and rim lights SHALL NOT. The shadow fit (light distance, shadow frustum, bias) SHALL scale with the model's bounds so models of any physical size shadow equivalently, and shadows SHALL appear identically in the orbit overlay, the lightbox, and thumbnails. Scene composition SHALL place the model's bounds center at the scene origin; because camera state is bounds-relative, this SHALL NOT alter persisted camera state or the rendered framing.

#### Scenario: Model is grounded by a contact shadow
- **WHEN** a model is thumbnailed or viewed in the overlay or lightbox
- **THEN** a soft shadow appears beneath it on an otherwise invisible plane at its lowest extent along the spindle, and concavities on the model itself are darkened by self-shadowing

#### Scenario: Shadows follow the lighting mode
- **WHEN** the user orbits a model
- **THEN** the shadow sweeps the floor in step with the camera-locked key light, while the floor itself stays fixed in the spindle frame

#### Scenario: Floor follows an axis change
- **WHEN** the user changes a model's orbit axis in the lightbox
- **THEN** the contact floor moves to the face of the model lowest along the new spindle, and the persisted thumbnail shows the shadow on that face's side

#### Scenario: Size-independent shadow quality
- **WHEN** a very small and a very large model are each thumbnailed
- **THEN** both show equivalent shadow softness and contact, with neither speckling (acne) nor a visibly detached shadow

#### Scenario: Thumbnails match the live view
- **WHEN** an orbit overlay opens over a tile whose thumbnail was rendered with shadows
- **THEN** the shadowing in the live view is indistinguishable from the thumbnail at handoff, preserving the no-shift guarantee

### Requirement: Ambient-occlusion shading
Models SHALL be rendered with screen-space ambient occlusion that darkens crevices, recesses, and contact regions, applied identically in the orbit overlay, the lightbox, and thumbnails. The effect SHALL run as a post-process chain on the app's single shared renderer — introducing no additional WebGL context — and the thumbnail path SHALL produce its image from the post-processed output, under the color-pipeline parity and transparency that `model-thumbnails` already requires of it. Occlusion parameters SHALL scale with the model's bounds so models of any physical size receive equivalent depth-cueing. Occlusion SHALL affect only model pixels, in coverage as well as in color: silhouette edges over the transparent background SHALL NOT acquire dark halos, background pixels SHALL stay fully transparent, and model-interior pixels SHALL stay fully opaque. The effect is off by default — a fresh profile renders unoccluded until its user turns it on — and the viewer SHALL offer a toggle that enables or disables occlusion, a performance preference for weaker GPUs, persisted per browser profile; a profile that stored a choice before the default changed SHALL keep that choice. Thumbnails SHALL follow that preference: a tile SHALL be rendered and looked up under the occlusion setting the live view would use at handoff, so that handoff is seamless whether occlusion is on or off, and a render under either setting SHALL be cached as its own thumbnail (see `model-thumbnails`, *A thumbnail exists per occlusion recipe*). Neither setting's pixels SHALL change because the other exists; the pixel-recipe version is bumped only when a recipe changes.

#### Scenario: Crevices read at thumbnail size
- **WHEN** a model with recesses or fine surface detail is thumbnailed with occlusion on
- **THEN** its cavities and seams are visibly darkened relative to a flat-shaded render, at both thumbnail and lightbox scale

#### Scenario: Still exactly one WebGL context
- **WHEN** the user orbits tiles while the render queue produces AO thumbnails
- **THEN** at most one WebGL context exists, shared by the post-process chain, the overlay, and the queue

#### Scenario: Handoff stays seamless
- **WHEN** an orbit overlay opens over a tile, with occlusion on or off
- **THEN** the live view's occlusion and brightness are indistinguishable from the static thumbnail at the moment of handoff, because both were rendered under the same setting

#### Scenario: Clean silhouettes over the transparent background
- **WHEN** a thumbnail rendered with ambient occlusion is composited over the app background
- **THEN** pixels just outside the model's silhouette show no occlusion darkening relative to an occlusion-free render

#### Scenario: Occlusion does not disturb transparency
- **WHEN** a thumbnail rendered with ambient occlusion is inspected pixel by pixel
- **THEN** background pixels are still fully transparent and pixels inside the model are still fully opaque, so the model composites over the app background exactly as an occlusion-free thumbnail does

#### Scenario: Toggling occlusion off for performance
- **WHEN** the user turns the occlusion toggle off, orbits with it off, and reloads the app in the same browser profile
- **THEN** the live view renders without occlusion (and faster) across sessions until toggled back on, and tiles visited meanwhile show unoccluded thumbnails that match it at handoff, while the occluded renders already cached are kept for when it is toggled back

#### Scenario: Size-independent occlusion
- **WHEN** a very small and a very large model with similar shapes are each rendered
- **THEN** both show equivalent occlusion strength and reach, scaled to their own proportions

#### Scenario: Transparency survives the encoder
- **WHEN** a thumbnail is encoded for storage under a lossy image format
- **THEN** background pixels are still fully transparent and the silhouette's edge is the one the render produced, the alpha channel having been carried losslessly while colour took the lossy path

### Requirement: STL shading normals derive from winding
When parsing an STL model, the client SHALL derive shading normals from triangle winding and SHALL NOT use the file's stored facet normals, so an exporter that wrote its normal field in a different axis convention than its vertices — or wrote zero-length, inverted, or otherwise inconsistent normals — cannot corrupt lighting. Recomputed normals SHALL be flat facet normals — no smoothing is introduced — so a file whose stored normals agree with its winding renders as before, up to the precision the file itself stored them at. This applies identically to thumbnails, the orbit overlay, and the lightbox; other model formats keep their format-native vertex normals.

#### Scenario: A convention-mismatched STL shades correctly
- **WHEN** a binary STL whose stored facet normals disagree with its triangle winding (e.g. rotated 90° about X by a Z-up/Y-up export mismatch) is thumbnailed or viewed
- **THEN** lighting, self-shadowing detail, and ambient occlusion read against the geometry's true orientation, indistinguishable in character from a well-formed export of the same mesh

#### Scenario: A well-formed STL is unchanged
- **WHEN** an STL whose stored normals agree with its winding is parsed
- **THEN** the derived normals reproduce the stored ones to within the precision they were stored at, and the rendered output is unchanged

#### Scenario: Isolated bad facets in an otherwise healthy file
- **WHEN** a file whose normal field is broadly correct carries a few facets whose stored normals disagree with their winding (an inverted or stale facet normal)
- **THEN** those facets shade from their winding like every other facet, correcting them rather than preserving the file's claim

#### Scenario: Zero-length stored normals
- **WHEN** an STL stores `0 0 0` as a facet's normal, as some exporters do
- **THEN** the facet shades from its winding rather than rendering unlit

#### Scenario: Cached thumbnails refresh to the corrected shading
- **WHEN** a model was thumbnailed under the previous recipe and its tile is next displayed
- **THEN** the thumbnail re-renders once under the bumped pixel-recipe version and is cached thereafter

### Requirement: Camera-fixed lighting rig
The light rig SHALL be fixed in camera space (headlight): the lit side follows the viewer as the model orbits, in the orbit overlay, the lightbox, and thumbnails alike, whatever the model's spindle axis. The base rig (hemisphere, key, and fill) SHALL keep its historical parameters; light colors, intensities, and relative geometry SHALL NOT vary with the view — only the rig's orientation follows the camera. There SHALL be no lighting-mode setting: nothing about lighting is chosen, stored, or shown per profile. During the lightbox axis-change animation the rig SHALL follow the camera through the tween, so lighting stays continuous with no snap.

The rig SHALL additionally carry two colored rim accents — red at rig-space −X, blue at +X, placed slightly behind the subject and tuned as perceptually balanced accents (raw intensities may differ to compensate for the base lighting's cool tint). Because rig space is camera space, the red accent SHALL stay at screen-left and the blue at screen-right while the model orbits.

#### Scenario: Overridden-axis model is lit from its top
- **WHEN** a model whose spindle is ±X or ±Z is viewed
- **THEN** it is lit from the viewer's side exactly as a `y`-spindle model is — never from a fixed world direction, and never from the side because of its spindle

#### Scenario: Default axis keeps historical lighting
- **WHEN** a model with the default `y` spindle is viewed
- **THEN** the hemisphere, key, fill and rim accents carry their historical parameters, oriented to the camera

#### Scenario: Camera mode keeps the lit side facing the viewer
- **WHEN** the user orbits a model
- **THEN** the shading relative to the screen stays constant (the same side of the model stays lit) instead of the model rotating through fixed light

#### Scenario: Rim accents follow the screen in camera mode
- **WHEN** the user orbits a model
- **THEN** the red accent remains on the screen-left edge and the blue accent on the screen-right edge throughout the orbit

#### Scenario: Rim accents stay with the model in axis mode
- **WHEN** the user looks for a lighting arrangement in which the accents turn with the model
- **THEN** none exists: the accents are screen-fixed in every view, because the rig has one orientation

#### Scenario: Mode persists across sessions
- **WHEN** the user reloads the app in any browser profile
- **THEN** lighting is camera-fixed with nothing stored or read for it, and no lighting control is offered

#### Scenario: Axis change animates the lighting
- **WHEN** the user changes a model's orbit axis in the lightbox
- **THEN** the rig — rim accents included — follows the camera through the animation, with no lighting snap

### Requirement: The panel credits the model's source
When the viewed entry resolves credits from the library's override store, the
lightbox side panel SHALL show an attribution block: the author (linked to the
author URL when one is stored), the license (linked to the license URL when
one is stored, plain text otherwise), a link to the source, and — when the
store holds a modified phrase — a modified row carrying that phrase verbatim,
which is the notice that the served copy is not the author's file, labelled
distinctly from the panel's own file-date row so that the two cannot be read as one. The
block SHALL sit among the model's metadata, before the panel's actions — the
existing "describes before it offers" rule, which appending after the action
strip would break. Because credits arrive from a read rather than from the
directory entry, the block MAY appear after the panel is first shown; no
placeholder and no loading state SHALL stand in for it meanwhile. When the
entry resolves no credits — no store, no covering key, or the overrides read
failed — the panel SHALL show no attribution block and no placeholder for it;
and a kit without a modified phrase SHALL draw no modified row: attribution is
displayed where it exists, never advertised as missing, and a copy served
unchanged is not labelled. The
overrides read SHALL follow the viewer subject — asked when it changes,
its answer ignored once the subject has moved on.

#### Scenario: A credited model
- **WHEN** the lightbox opens on a model beneath a kit whose key holds credits
- **THEN** the panel shows the author, license and source link for that kit, among the metadata and before the actions

#### Scenario: A license with a stored URL
- **WHEN** the resolved credits hold a license URL
- **THEN** the license label is a link to that URL, opening in a new tab like the author and source links

#### Scenario: A license without a URL
- **WHEN** the resolved credits hold a license and no license URL
- **THEN** the license label draws as plain text

#### Scenario: A modified copy
- **WHEN** the resolved credits hold a modified phrase
- **THEN** the panel shows a modified row carrying the phrase, within the attribution block

#### Scenario: A copy served unchanged
- **WHEN** the resolved credits hold no modified phrase
- **THEN** the panel shows no modified row and nothing in its place

#### Scenario: An uncredited model
- **WHEN** the lightbox opens on a model no key covers
- **THEN** the panel shows no attribution block

#### Scenario: A failed read is silent
- **WHEN** the overrides request fails while the lightbox is open
- **THEN** the panel renders as it does for an uncredited model, and nothing else in the viewer is affected

#### Scenario: The subject moves on
- **WHEN** the viewer subject changes before the previous subject's overrides answer arrives
- **THEN** the late answer is not rendered for the new subject

### Requirement: Lightbox steps between sibling models
While a model is open in the lightbox, the user SHALL be able to step to the previous or the
next model in the shown listing without the lightbox closing. `ArrowLeft` and `ArrowRight`
pressed without a modifier key SHALL step, and two on-screen affordances — a previous control
and a next control beside the model — SHALL step the same way; a key and a control SHALL take
one path. Stepping SHALL walk the models the grid is showing, in the grid's order — the shown
listing narrowed to model entries — so that a find filter or a similarity anchor in effect is
honoured and non-model entries (folders, zip tiles) between two models are skipped rather than
opened. When the open model is not present in the shown listing, stepping SHALL be inert
rather than jumping to another model. Stepping SHALL stop at the ends without wrapping: at the
first model there SHALL be no previous step and the previous control SHALL be present but
disabled, and at the last model no next step and the next control disabled. A step SHALL
persist the leaving model's view under the same rule a close applies (the manipulation rule of
*Lightbox expanded view*): a step that follows an orbit, a zoom or an axis change SHALL write
that model's camera, axis and thumbnail — under that model's own path — before the view swaps,
and a step that follows no manipulation SHALL write nothing. If the lightbox is closed while a
step's persistence is still in flight, the step SHALL NOT re-open the lightbox nor leave the
model parameter naming the neighbour. On a step the lightbox SHALL re-derive every per-model
surface — the mesh, the camera, the axis, the info panel and the credits — for the model
stepped to, showing a loading indicator (not the previous model's last frame) while its mesh
is not yet warm. The on-screen controls SHALL participate in the focus trap, SHALL NOT lose
focus to the dialog on each step, and SHALL NOT orbit, zoom, or close the lightbox when used.
A close after any number of steps SHALL return focus to the tile of the model that was on
screen when it closed.

#### Scenario: Arrow keys step to the neighbour
- **WHEN** the user opens a model in the lightbox and presses ArrowRight, then ArrowLeft
- **THEN** the lightbox stays open and shows the next model, then the model it started on, re-deriving the viewer and info panel each time

#### Scenario: On-screen arrows match the keys
- **WHEN** the user clicks the next control, then the previous control
- **THEN** the lightbox steps forward then back exactly as the arrow keys do, and neither click orbits, zooms, or closes the view

#### Scenario: Stepping skips non-model tiles
- **WHEN** the open model is followed in the grid by a folder or zip tile and then another model, and the user steps forward
- **THEN** the lightbox shows the next model, the intervening folder or zip having been skipped

#### Scenario: Stepping honours the shown listing
- **WHEN** a find filter is narrowing the grid and the user steps through the lightbox
- **THEN** the steps visit only the models the filtered grid is showing, in that order

#### Scenario: The ends stop
- **WHEN** the first model is open, the user presses ArrowLeft; and when the last model is open, the user presses ArrowRight
- **THEN** nothing happens in each case — the lightbox stays open on the same model — and the corresponding on-screen control is shown disabled

#### Scenario: A step after an orbit persists the leaving model
- **WHEN** the user orbits the open model and then steps to the next model
- **THEN** the leaving model's camera, axis and thumbnail are persisted under the leaving model's own path, and the new model is shown

#### Scenario: A step without touching writes nothing
- **WHEN** the user opens a model and steps through several siblings without orbiting, zooming or changing an axis
- **THEN** no camera, axis or thumbnail is written for any of them, and each tile keeps the render and framing it had

#### Scenario: Closing during a step's persist does not re-open
- **WHEN** the user orbits a model, steps to the next while the thumbnail write is still in flight, and closes the lightbox before it completes
- **THEN** the lightbox stays closed and the URL names no model — the pending step neither re-opens the view nor leaves the neighbour's parameter behind

#### Scenario: A cold neighbour shows a spinner, not the last frame
- **WHEN** the user steps to a model whose mesh is not yet loaded
- **THEN** the viewer shows a loading indicator rather than the previous model's frozen frame, and becomes orbitable when the mesh is ready

### Requirement: STL viewer meshes served as cached GLB
An STL model's geometry SHALL be delivered to the viewer as an indexed binary GLB derived from the source STL, not as the raw STL bytes. The server SHALL convert on demand and cache the result per library, keyed by the model's library path, stale when the source's mtime changes — the same staleness contract as thumbnails: a cached GLB SHALL be served only while its recorded mtime matches the source's current mtime, otherwise it SHALL be regenerated. On a cache miss the server SHALL convert the STL and return the GLB in the same response; the whole STL SHALL NOT be streamed to the browser for viewing. This SHALL hold for an STL inside a zip archive as for a plain file, with the archive's mtime standing for the entry's.

The GLB SHALL carry vertex positions and triangle indices only, and SHALL NOT carry normals: shading normals stay derived on the client from winding (see *STL shading normals derive from winding*). Vertex coordinates SHALL be bit-identical to the source STL's and triangles SHALL keep the source's order and winding, so the geometry the client shades from is the same it would have parsed from the STL, and the model displays in its file's own coordinates exactly as before (see *Upright model display*): conversion welds vertices with identical coordinates but SHALL NOT move, rotate, or rescale them.

The source STL file SHALL remain untouched on disk and SHALL stay the file that the search index, the directory listing, `MODEL_EXT`, and slicer/app association all operate on — the GLB SHALL exist only on the delivery path from server to viewer, never as a listed entry, an openable file, or a stored sibling of the model. This delivery SHALL apply to the STL format only; `obj` and `3mf` SHALL continue to be delivered and parsed as their own bytes.

When the source cannot be read, the delivery SHALL answer as `/api/file` does for a missing model; when it exists but cannot be parsed as STL, the delivery SHALL answer with an error status. Either way the viewer SHALL show the model-load failure it already renders (see *Missing-model error feedback*), not a silent empty result. A cache directory that cannot be written SHALL NOT fail the request: the server SHALL convert and serve without persisting.

#### Scenario: STL delivered as GLB, source untouched
- **WHEN** an STL model is opened in the orbit overlay or lightbox
- **THEN** the viewer downloads an indexed GLB derived from that STL, the source `.stl` file on disk is unchanged, and it is still the entry the listing shows and the slicer opens

#### Scenario: Miss converts, hit is served from cache
- **WHEN** a model's GLB is requested and no fresh cached GLB exists
- **THEN** the server converts the STL and returns the GLB in that response, and a subsequent request for the same unchanged file is served the cached GLB without reconverting

#### Scenario: Edited source invalidates the cached GLB
- **WHEN** the source STL is modified so its mtime changes and its GLB is requested again
- **THEN** the previously cached GLB is not served and the GLB is regenerated from the new bytes

#### Scenario: Whole STL is never sent for viewing
- **WHEN** the viewer loads an STL model, whether the GLB is a hit or a miss
- **THEN** the browser receives GLB bytes, never the raw STL file

#### Scenario: STL inside a zip is delivered as GLB
- **WHEN** an STL entry of a zip archive is opened in the viewer
- **THEN** it is delivered as a GLB derived from the extracted entry, cached under the entry's virtual path, and a later open of the unchanged archive is served from the cache without opening the zip

#### Scenario: Other formats are unaffected
- **WHEN** an `obj` or `3mf` model is opened
- **THEN** it is delivered and parsed as its own format's bytes, with no GLB conversion

#### Scenario: Coordinates and winding preserved through conversion
- **WHEN** an STL and its derived GLB are compared triangle for triangle
- **THEN** every GLB vertex position is bit-identical to the STL's, the triangles come in the same order with the same winding, the GLB carries no normals, and the client's recomputed normals equal those it computes from the STL directly

#### Scenario: Unreadable source surfaces as a load error
- **WHEN** the GLB for a model whose source file no longer exists, or cannot be parsed as STL, is requested
- **THEN** the viewer shows its normal missing-model error rather than an empty or silently missing mesh

#### Scenario: Read-only cache still serves
- **WHEN** the cache directory cannot be written and a GLB is requested on a miss
- **THEN** the server converts and returns the GLB without persisting it, and the request does not fail

#### Scenario: Cached thumbnails are not disturbed
- **WHEN** a model already thumbnailed under the current pixel recipe is displayed after this change ships
- **THEN** its thumbnail is a cache hit and is not re-rendered, because the client shades the delivered GLB from the same vertices as it shaded the STL

### Requirement: The panel's links are in the lightbox's focus ring

Every link the lightbox's side panel renders — the author, the license and the source of the
model's attribution — SHALL participate in the lightbox's focus trap alongside the panel's
controls, so that a visitor using the keyboard alone can reach one and follow it. The links
SHALL take their place in the ring in the order they are read on screen, among the controls
they sit between, rather than being appended after them: the attribution is part of what the
panel says about the model, and a ring that reordered it would not match what a screen reader
announces. Advancing SHALL step forward through that sequence and retreating SHALL step
backward through the same sequence, and both SHALL stay inside the lightbox, wrapping as the
trap already wraps.

Adding links to the ring SHALL NOT admit anything that cannot take focus: a disabled control
SHALL continue to be skipped. A model for which the library holds no attribution renders no
such links, and its ring SHALL be exactly the ring of controls it was.

#### Scenario: The attribution links are reachable

- **WHEN** the lightbox is open on a model whose library holds an author URL, a license URL
  and a source URL, and the visitor tabs forward through the dialog
- **THEN** each of the three links is focused in turn, in the order the panel draws them, and
  the dialog and its controls are focused in the same pass

#### Scenario: Retreating walks the same ring

- **WHEN** the visitor holds shift and tabs backward from a focused attribution link
- **THEN** focus moves to whatever precedes it in the forward order, and continuing backward
  reaches the same members in reverse without leaving the lightbox

#### Scenario: A disabled control is still skipped

- **WHEN** the lightbox is open on the first model of its listing, where the previous-model
  control is disabled, and the visitor tabs forward
- **THEN** focus advances past the disabled control to the next member of the ring rather
  than stopping on it

#### Scenario: An uncredited model's ring is unchanged

- **WHEN** the lightbox is open on a model the library holds no attribution for and the
  visitor tabs through it
- **THEN** the ring is the dialog and its controls, with no additional stops
