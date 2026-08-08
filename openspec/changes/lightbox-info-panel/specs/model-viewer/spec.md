# model-viewer Delta

## MODIFIED Requirements

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
