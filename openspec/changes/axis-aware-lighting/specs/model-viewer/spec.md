# model-viewer Delta

## ADDED Requirements

### Requirement: Spindle-aligned lighting with camera-relative option
The light rig SHALL be oriented per lighting mode rather than fixed to world +Y. In `axis` mode (the default) the rig's up SHALL be the model's spindle axis, oriented by the spindle's turntable frame so the result is deterministic for all six spindles and identical to the historical world-fixed rig when the spindle is `y`. In `camera` mode the rig SHALL be fixed in camera space (headlight): the lit side follows the viewer as the model orbits. The mode SHALL be a global client-side setting persisted across sessions (localStorage), defaulting to `axis`, switchable via an experimental control; light colors, intensities, and relative geometry SHALL NOT change between modes — only orientation. Both the orbit overlay and the lightbox SHALL honor the active mode, and in `axis` mode the lightbox axis-change animation SHALL rotate the rig smoothly in step with the camera tween (with a drag cancelling the tween snapping the rig with the camera).

#### Scenario: Overridden-axis model is lit from its top
- **WHEN** a model whose spindle is ±X or ±Z is viewed in `axis` mode
- **THEN** it is lit as if from above relative to its spindle (key light and hemisphere sky aligned to the spindle), not from world +Y

#### Scenario: Default axis keeps historical lighting
- **WHEN** a model with the default `y` spindle is viewed in `axis` mode
- **THEN** its lighting is identical to the pre-change world-fixed rig

#### Scenario: Camera mode keeps the lit side facing the viewer
- **WHEN** the user orbits a model in `camera` mode
- **THEN** the shading relative to the screen stays constant (the same side of the model stays lit) instead of the model rotating through fixed light

#### Scenario: Mode persists across sessions
- **WHEN** the user switches lighting mode and reloads the app
- **THEN** the chosen mode is still active

#### Scenario: Axis change animates the lighting
- **WHEN** the user changes a model's orbit axis in the lightbox while in `axis` mode
- **THEN** the rig rotates smoothly with the camera animation to the new spindle orientation, with no lighting snap
