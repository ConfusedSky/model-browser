# model-viewer Delta

## ADDED Requirements

### Requirement: Shadowed model display
Models SHALL be rendered with shadow mapping from the key light: the model SHALL shadow itself, and SHALL cast a soft contact shadow onto an invisible floor plane that renders nothing but received shadow (composing over the transparent background). The floor SHALL lie perpendicular to the model's spindle axis at the model's lowest extent along it, fixed in the spindle frame — it SHALL NOT follow the lighting rig's per-mode orientation — and SHALL snap to the new spindle when the orbit axis changes. Shadow direction SHALL come from the key light and therefore inherit the active lighting-mode semantics: fixed in the spindle frame in `axis` mode, following the viewer in `camera` mode. Only the key light casts; the hemisphere, fill, and rim lights SHALL NOT. The shadow fit (light distance, shadow frustum, bias) SHALL scale with the model's bounds so models of any physical size shadow equivalently, and shadows SHALL appear identically in the orbit overlay, the lightbox, and thumbnails. Scene composition SHALL place the model's bounds center at the scene origin; because camera state is bounds-relative, this SHALL NOT alter persisted camera state or the rendered framing.

#### Scenario: Model is grounded by a contact shadow
- **WHEN** a model is thumbnailed or viewed in the overlay or lightbox
- **THEN** a soft shadow appears beneath it on an otherwise invisible plane at its lowest extent along the spindle, and concavities on the model itself are darkened by self-shadowing

#### Scenario: Shadows follow the lighting mode
- **WHEN** the user orbits a model in `camera` mode
- **THEN** the shadow sweeps the floor in step with the camera-locked key light, while in `axis` mode the shadow stays fixed in the spindle frame as the model turns

#### Scenario: Floor follows an axis change
- **WHEN** the user changes a model's orbit axis in the lightbox
- **THEN** the contact floor moves to the face of the model lowest along the new spindle, and the persisted thumbnail shows the shadow on that face's side

#### Scenario: Size-independent shadow quality
- **WHEN** a very small and a very large model are each thumbnailed
- **THEN** both show equivalent shadow softness and contact, with neither speckling (acne) nor a visibly detached shadow

#### Scenario: Thumbnails match the live view
- **WHEN** an orbit overlay opens over a tile whose thumbnail was rendered with shadows
- **THEN** the shadowing in the live view is indistinguishable from the thumbnail at handoff, preserving the no-shift guarantee
