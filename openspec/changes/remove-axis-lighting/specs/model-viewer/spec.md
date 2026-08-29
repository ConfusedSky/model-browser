# model-viewer Delta

> Every scenario title the requirement carried is kept — the archive refuses a MODIFIED
> block that drops one — with bodies rewritten to the camera-only rig. Titles that name
> the retired mode now assert its absence.

## MODIFIED Requirements

### Requirement: Spindle-aligned lighting with camera-relative option
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
