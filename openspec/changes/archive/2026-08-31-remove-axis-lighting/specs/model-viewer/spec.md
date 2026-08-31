# model-viewer Delta

> Every scenario title each requirement carried is kept — the archive refuses a MODIFIED
> block that drops one — with bodies rewritten to the camera-only rig. Titles that name
> the retired mode now assert its absence. The lighting requirement is RENAMED because its
> old title promises an option its body now denies; *Shadowed model display* keeps its
> title and loses its per-mode clause.

## RENAMED Requirements

- FROM: `### Requirement: Spindle-aligned lighting with camera-relative option`
- TO: `### Requirement: Camera-fixed lighting rig`

## MODIFIED Requirements

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
