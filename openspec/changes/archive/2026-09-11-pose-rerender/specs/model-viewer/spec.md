## MODIFIED Requirements

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
