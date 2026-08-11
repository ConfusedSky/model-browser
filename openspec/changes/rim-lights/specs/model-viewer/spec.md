# model-viewer Delta

## MODIFIED Requirements

### Requirement: Spindle-aligned lighting with camera-relative option
The light rig SHALL be oriented per lighting mode rather than fixed to world +Y. In `axis` mode (the default) the rig's up SHALL be the model's spindle axis, oriented by the spindle's turntable frame so the result is deterministic for all six spindles; the base rig (hemisphere, key, and fill) SHALL keep its historical parameters and, under the default `y` spindle, its historical orientation. In `camera` mode the rig SHALL be fixed in camera space (headlight): the lit side follows the viewer as the model orbits. The mode SHALL be a global client-side setting persisted across sessions (localStorage), defaulting to `axis`, switchable via an experimental control; light colors, intensities, and relative geometry SHALL NOT change between modes — only orientation. Both the orbit overlay and the lightbox SHALL honor the active mode, and in `axis` mode the lightbox axis-change animation SHALL rotate the rig smoothly in step with the camera tween (with a drag cancelling the tween snapping the rig with the camera).

The rig SHALL additionally carry two colored rim accents — red at rig-space −X, blue at +X, both modest in intensity and placed slightly behind the subject — present in both modes. Because they are part of the rig, they SHALL follow its orientation everywhere the rig does: in `camera` mode rig space is camera space, so the red accent stays at screen-left and the blue at screen-right while the model orbits; in `axis` mode both accents are fixed in the spindle frame — deterministic directions the model turns through, with no claim about which screen side they land on — and during the axis tween they rotate with the rig.

#### Scenario: Overridden-axis model is lit from its top
- **WHEN** a model whose spindle is ±X or ±Z is viewed in `axis` mode
- **THEN** it is lit as if from above relative to its spindle (key light and hemisphere sky aligned to the spindle), not from world +Y

#### Scenario: Default axis keeps the historical base-rig orientation
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
