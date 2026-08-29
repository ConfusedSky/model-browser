# model-thumbnails Delta

> `ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`) MODIFIES this requirement under its old title; it is
> re-targeted on top of this change and must rewrite its delta under the new title.
> `thumbnail-sweep-priority` modifies *Client-side thumbnail rendering*; no collision.
> Every scenario title is kept (the archive refuses a MODIFIED block that drops one);
> the two that named the retired mode now describe a stored legacy label.

## RENAMED Requirements

- FROM: `### Requirement: Lighting-mode-aware thumbnails`
- TO: `### Requirement: Recipe-labelled thumbnails`

## MODIFIED Requirements

### Requirement: Recipe-labelled thumbnails
Thumbnails SHALL be rendered with the rig fixed in the rest camera's frame — the orientation the live view uses at handoff. The server SHALL store, alongside each PNG, the recipe inputs that decide its pixels but are not carried by the cache key — the lighting label and the rig version it was rendered with — and SHALL return both on reads; it stores and echoes the values without interpreting them. Like the PNG's mtime, both values describe the pixels: a PUT that replaces the PNG without declaring them SHALL clear the stored values rather than keep stale labels, while a PUT that does not replace the PNG SHALL leave the stored values in place unless it declares them. Both values SHALL be returned on stale reads as well as hits. The lighting label SHALL have one producible value, the camera-fixed rig; the server SHALL refuse a PUT declaring any other, while continuing to read and echo labels stored before this. The client SHALL treat a cache hit whose stored lighting label is not the producible one, or whose stored rig version differs from the client's current rig version — including entries where either value is absent — as needing re-render: the PNG is replaced through the normal render queue while camera state and axis are preserved.

#### Scenario: Thumbnail matches live lighting for an overridden axis
- **WHEN** a model with a ±X/±Z spindle has its thumbnail rendered and the user then presses the tile
- **THEN** the live overlay shows the same camera-fixed lighting as the thumbnail with no brightness shift at handoff

#### Scenario: Mode switch invalidates only the pixels
- **WHEN** a directory is visited whose cache entries carry the retired spindle-aligned lighting label
- **THEN** their PNGs are re-rendered under the camera-fixed rig via the render queue, keeping their saved camera orientation and axis, and subsequent visits are cache hits again

#### Scenario: Legacy cache entries are upgraded lazily
- **WHEN** a directory is visited whose cache entries predate label storage
- **THEN** their PNGs are re-rendered on that visit and subsequent visits are cache hits again

#### Scenario: A rig revision refreshes stale thumbnails once
- **WHEN** the app ships a new rig version and a directory is visited whose cache entries carry the old version or none
- **THEN** their PNGs are re-rendered under the current rig via the render queue — camera state and axis preserved — and subsequent visits are cache hits again

#### Scenario: A camera-lit cache needs nothing
- **WHEN** every entry in a directory's cache carries the camera-fixed label and the current rig version
- **THEN** the visit is entirely cache hits: no render and no upload
