# model-viewer Delta

## MODIFIED Requirements

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
