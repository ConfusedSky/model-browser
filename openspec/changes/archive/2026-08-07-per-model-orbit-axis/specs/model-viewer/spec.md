## ADDED Requirements

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

## MODIFIED Requirements

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
