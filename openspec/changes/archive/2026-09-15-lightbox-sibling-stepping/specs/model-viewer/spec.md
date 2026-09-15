## ADDED Requirements

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
