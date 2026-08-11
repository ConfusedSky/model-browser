# model-thumbnails Delta

## ADDED Requirements

### Requirement: Lighting-mode-aware thumbnails
Thumbnails SHALL be rendered with the same lighting mode and rig orientation the live view would use at handoff: in `axis` mode the rig oriented to the model's spindle frame, in `camera` mode the rig fixed in the rest camera's frame. The server SHALL store, alongside each PNG, the lighting mode it was rendered with, and SHALL return it on reads; it stores and echoes the value without interpreting it. The client SHALL treat a cache hit whose stored lighting mode differs from the active mode — including entries with no stored mode (pre-lighting cache entries) — as needing re-render: the PNG is replaced through the normal render queue while camera state and axis are preserved.

#### Scenario: Thumbnail matches live lighting for an overridden axis
- **WHEN** a model with a ±X/±Z spindle has its thumbnail rendered in `axis` mode and the user then presses the tile
- **THEN** the live overlay shows the same lighting as the thumbnail with no brightness shift at handoff

#### Scenario: Mode switch invalidates only the pixels
- **WHEN** the user switches lighting mode and revisits a directory with thumbnails rendered under the other mode
- **THEN** those thumbnails re-render under the active mode via the render queue, keeping their saved camera orientation and axis

#### Scenario: Legacy cache entries are upgraded lazily
- **WHEN** a directory is visited whose cache entries predate lighting-mode storage
- **THEN** their PNGs are re-rendered under the active mode on that visit and subsequent visits are cache hits again
