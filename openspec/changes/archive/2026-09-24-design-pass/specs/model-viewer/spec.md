## MODIFIED Requirements

### Requirement: Drag-to-orbit on grid tiles via shared overlay canvas
The client SHALL hold exactly one WebGL context for the entire app — a single renderer shared by the in-grid orbit overlay, the lightbox, and the thumbnail render queue. On a press over a model tile, the canvas SHALL overlay that tile's thumbnail image area — not the whole tile — so the file name label below remains visible throughout the interaction, and the live view SHALL match the static thumbnail's framing and color at the moment of handoff (no size jump, no brightness shift). On release the overlay persists until the pointer leaves the tile or the user scrolls/resizes, which dismisses it back to the static thumbnail — except that a finger's release SHALL end it at once, since a touch has no hover to leave and would otherwise leave the overlay standing. After an orbit drag, dismissal triggered by the pointer leaving the tile (or by the release landing outside it, or by a finger's release) SHALL hold the live view in place until the refreshed thumbnail has been applied to the tile and is ready to paint, so the overlay unmounts onto pixels matching the live view; if thumbnail persistence fails or exceeds a short timeout (~1.5s), the overlay SHALL dismiss anyway. Scroll/resize dismissal SHALL remain immediate, and any change of view — a navigation, a flat toggle, a committed or left search — SHALL remove an overlay still standing, since the tile it belongs to has gone. A held dismissal SHALL NOT interrupt or cancel a newer interaction begun before it completes. A press released without exceeding a small movement threshold (~5px) SHALL NOT be treated as an orbit; it is a click and opens the lightbox instead.

Under a finger, only the middle of a model tile's picture SHALL begin an orbit: a touch that starts in the band around it SHALL begin none, so a drag there scrolls the grid as it would anywhere else on the page, and a tap there SHALL open the lightbox as a click on the tile does. A mouse or pen press anywhere on the tile SHALL behave as before.

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

#### Scenario: A finger's release ends the overlay
- **WHEN** the user turns a model with a finger and lifts it while still over the tile
- **THEN** the overlay settles onto the refreshed thumbnail and goes, where a mouse's release inside the tile would leave it until the pointer left

#### Scenario: The band around the picture scrolls
- **WHEN** a finger presses a model tile outside the middle of its picture and drags
- **THEN** no orbit begins and the grid scrolls; the same finger pressing the middle and dragging turns the model

#### Scenario: A tap on the band opens the model
- **WHEN** a finger taps a model tile outside the middle of its picture
- **THEN** the lightbox opens for that model

#### Scenario: A new view takes a leftover overlay with its tile
- **WHEN** an orbit overlay is still standing over a tile and the user navigates, toggles flat, or commits or leaves a search
- **THEN** the overlay is gone with the tile rather than floating over the view that arrived

### Requirement: Lightbox expanded view
Clicking a model tile — a press released without exceeding the drag threshold — SHALL dismiss the orbit overlay and open the model in a modal lightbox with full orbit and zoom controls. There SHALL be no separate expand affordance. Esc SHALL close it, and so SHALL clicking outside it wherever the view leaves room outside itself. A close that follows a manipulation of the view in the lightbox — an orbit, a zoom, or an axis change — SHALL persist camera state and thumbnail like an orbit release; a close that follows no such manipulation SHALL write nothing — neither a camera nor a thumbnail — since the view it shows records no decision of the user's, and a camera stored by an untouched close would outlive every orientation the source later holds for the model. While open the lightbox SHALL trap keyboard focus, and on close SHALL return focus to the tile that opened it.

The model SHALL be drawn in the largest square the stage beside the panel allows, and the **whole stage** — not only that square — SHALL turn and zoom the model, since the stage's margins are drawn as the same surface and a press there that did nothing would read as a broken drag; presses on the stage's own controls SHALL remain theirs. Once the model has loaded, and until the first press on the stage, the stage SHALL carry a short hint saying how to turn it — in touch wording on a device whose pointer is a finger, and shortened to fit a narrow stage — clear of the axis control. The lightbox SHALL raise no context menu of its own (see `entry-actions`): its panel carries every command it can perform.

The lightbox SHALL contain the model's orbit-axis control: three axis buttons (X/Y/Z) plus a flip toggle covering all six spindles, with the current value indicated. Changing the axis SHALL smoothly animate the camera — a brief eased rotation, not an instant snap — to the new spindle's default three-quarter view, visibly rotating the chosen axis to screen-up, and SHALL immediately persist the axis, the end-state camera, and a re-rendered thumbnail (the end state is known upfront; persistence does not wait for the animation). A drag during the transition SHALL cancel the animation and orbit from the current pose.

The lightbox SHALL show an info panel beside the viewer — below it on a narrow screen — led by the model's **file name**, with, for a model named by a relative path, a line naming the nearest folders that tell its kit apart (generic folder names such as sizes, support states or formats passed over, an archive named without its marker). Where the model's type has associated applications, the panel SHALL next carry the launch choices as its primary action (see `entry-actions`, *A model entry offers its associated applications as open-in choices*), above everything that describes the model. The panel SHALL then carry the model's full virtual path (including `zip!/entry` notation for zip contents), format, size, and modified time — for zip entries the available mtime is the containing archive's, and the panel SHALL label it as the archive's modified time — with an affordance to copy the full path to the clipboard. The panel's content comes from the directory entry rather than the mesh, so it SHALL be shown from the moment the lightbox opens — including while the mesh is still loading and after it has failed to load. If the clipboard write fails, the panel SHALL report the failure briefly and SHALL NOT show a copied confirmation; a copy that succeeds SHALL also be announced to assistive technology. The panel SHALL also present the entry's own actions as affordances — the same actions and the same availability rules the model's menu applies, less opening the model, copying its path, redrawing its thumbnail and choosing its axis, which the view already carries or cannot perform while it holds the renderer. They SHALL be presented after the model's metadata rather than before it, since the panel describes the model first and offers what can be done to it second — the launch choices being the one exception, as the decision the viewer exists to inform — and SHALL be drawn as the menu draws the same actions, everyday ones before a divider and maintenance after it, so that one command does not wear two looks within one view. The copy affordance stays with the path it copies and is not one of them. An action that changes the view SHALL leave the lightbox through the same close every other exit takes, persisting under the same rule. Resetting the model's framing from the panel, where it is offered, SHALL discard its stored orientation, re-frame the open view to what the model then resolves to, and SHALL NOT have that discarded orientation written back by the close that follows. The panel's controls SHALL participate in the focus trap, and pointer or wheel interaction with the panel SHALL NOT orbit or zoom the model or close the lightbox.

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
- **THEN** the model's full virtual path is placed on the clipboard and brief feedback confirms it, announced as well as shown

#### Scenario: Copy failure falls back to selection
- **WHEN** a copy of the path fails
- **THEN** the failure is reported briefly and no copied confirmation is shown, and the panel does **not** select the path text

#### Scenario: Panel is available without a mesh
- **WHEN** the lightbox is open while the mesh is still loading, or after the mesh failed to load
- **THEN** the info panel still shows the path and metadata and the copy affordance works

#### Scenario: Acting on the model from the info panel
- **WHEN** the user activates one of the panel's action affordances
- **THEN** an action that changes the view — revealing the model in its folder, or finding similar ones — closes the lightbox through the same close every exit takes, and resetting the framing, where offered, discards the stored orientation, re-frames the open view to what the model then resolves to, and is not undone by the close that follows

#### Scenario: The panel describes before it offers
- **WHEN** the lightbox's info panel is shown for a model whose type has associated applications
- **THEN** the file name leads, "Open in \<default\>" follows as the panel's primary action above the path and metadata, and every other action comes after the name, path and metadata, drawn as the menu draws them, with the copy affordance still on the path line rather than among them

#### Scenario: Panel interaction never orbits
- **WHEN** the user presses, drags, clicks, or scrolls the wheel within the info panel
- **THEN** the model neither orbits nor zooms and the lightbox stays open

#### Scenario: The stage's margins turn the model
- **WHEN** the stage is wider than the square the model is drawn in and the user drags in the margin beside the square
- **THEN** the model turns as it would from the square, while a press on the stepping arrows or the axis control is left to that control

#### Scenario: The hint goes at the first press
- **WHEN** the user opens a model and presses the stage to turn it
- **THEN** the hint saying how to turn it is shown until that press and not after

#### Scenario: A result names its kit
- **WHEN** the user opens a search result named `Kit/32mm/Supported/knight.stl`
- **THEN** the panel's title is `knight.stl` with a line naming `Kit` beneath it, the generic folders passed over, and the full path in the path row

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
first model there SHALL be no previous step and the previous control SHALL be disabled and not
drawn, and at the last model no next step and the next control disabled and not drawn; a
control not drawn SHALL take no presses, which fall through to the stage and turn the model.
A step SHALL
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
- **THEN** nothing happens in each case — the lightbox stays open on the same model — and the corresponding on-screen control is disabled and not drawn, a press where it would stand turning the model instead

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

## ADDED Requirements

### Requirement: A lost graphics context is announced
When the app's one WebGL context is lost — a driver reset, the GPU running out of memory —
the client SHALL say so in an alert that assistive technology announces, stating that models
and thumbnails will not draw until it is back and offering to reload the page, rather than
leaving the viewer and every waiting tile to look merely slow. The alert SHALL go when the
context is restored. While the context is lost, the lightbox SHALL NOT invite the user to turn
the model, since nothing turns.

#### Scenario: The GPU drops the page
- **WHEN** the renderer's context is lost while the grid is on screen
- **THEN** an alert says graphics have stopped and offers a Reload, which reloads the page

#### Scenario: The hint does not promise a drag that does nothing
- **WHEN** the context is lost while a model is open in the lightbox
- **THEN** the gesture hint is withdrawn
