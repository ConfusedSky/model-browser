# model-thumbnails Delta

> `thumbnail-sweep-priority` modifies a different requirement of this capability
> (*Client-side thumbnail rendering*), so the two do not collide. All four scenarios this
> requirement already carries are preserved: a MODIFIED requirement replaces prose *and*
> scenarios at archive.

## MODIFIED Requirements

### Requirement: Lighting-mode-aware thumbnails
Thumbnails SHALL be rendered with the same lighting mode and rig orientation the live view would use at handoff: in `axis` mode the rig oriented to the model's spindle frame, in `camera` mode the rig fixed in the rest camera's frame. The server SHALL store, alongside each PNG, every recipe input that decides its pixels but is not carried by the cache key — the lighting mode, the rig version, and where an orientation source framed the render, which version of that source's mapping was used — and SHALL return them on reads; it stores and echoes the values without interpreting them. Like the PNG's mtime, all of these values describe the pixels: a PUT that replaces the PNG without declaring them SHALL clear the stored values rather than keep stale labels, while a PUT that does not replace the PNG SHALL leave the stored values in place unless it declares them. All of them SHALL be returned on stale reads as well as hits. The client SHALL treat a cache hit whose stored lighting mode differs from the active mode, or whose stored rig version differs from the client's current rig version — including entries where either value is absent (pre-lighting or pre-rim cache entries) — as needing re-render: the PNG is replaced through the normal render queue while camera state and axis are preserved. A hit SHALL likewise need re-render when an orientation source would frame that model and the stored image was not produced under the source's current mapping — but only where the source **would actually be applied**, which is to say the model has no orientation of its own. A model the user has oriented is a hit whatever the source holds for it, since its pixels do not depend on the source; treating it as stale renders and re-uploads an image identical to the one already cached, on every visit, forever. A render made under an orientation source SHALL record the mapping version it used, so a later change to that mapping is detectable and the image is not mistaken for one drawn without a source. This test SHALL be applied to the thumbnails already displayed when the active lighting mode changes, not only to those a subsequent visit rebuilds: a control that changes how models are lit SHALL answer on the listing in front of the user. A change of rig version SHALL remain lazy, taken on the next visit, since it accompanies a new build rather than a user's gesture and nothing on screen is waiting on it. Refreshing this way SHALL reuse the same staleness test and the same render queue a visit uses, SHALL preserve camera state and axis, and SHALL keep each existing image until its replacement exists, so the grid does not empty while it works.

#### Scenario: Thumbnail matches live lighting for an overridden axis
- **WHEN** a model with a ±X/±Z spindle has its thumbnail rendered in `axis` mode and the user then presses the tile
- **THEN** the live overlay shows the same lighting as the thumbnail with no brightness shift at handoff

#### Scenario: Mode switch invalidates only the pixels
- **WHEN** the user switches lighting mode and revisits a directory with thumbnails rendered under the other mode
- **THEN** those thumbnails re-render under the active mode via the render queue, keeping their saved camera orientation and axis

#### Scenario: Legacy cache entries are upgraded lazily
- **WHEN** a directory is visited whose cache entries predate lighting-mode storage
- **THEN** their PNGs are re-rendered under the active mode on that visit and subsequent visits are cache hits again

#### Scenario: A rig revision refreshes stale thumbnails once
- **WHEN** the app ships a new rig version and a directory is visited whose cache entries carry the old version or none
- **THEN** their PNGs are re-rendered under the current rig via the render queue — camera state and axis preserved — and subsequent visits are cache hits again

#### Scenario: Switching the mode answers on the grid in front of you
- **WHEN** the user switches lighting mode while a listing of thumbnails rendered under the other mode is on screen
- **THEN** those thumbnails re-render under the new mode without the user navigating away and returning, each keeping its camera and axis and its previous image until the replacement is ready

#### Scenario: Switching back before the first pass finishes
- **WHEN** the user switches mode twice in quick succession
- **THEN** the grid settles under the mode chosen last, without the first pass's renders landing on top of it

#### Scenario: A model with its own orientation is not made stale by a pose
- **WHEN** a model the user has oriented is displayed in a view where an orientation source also holds a pose for it
- **THEN** its cached thumbnail is a hit and is neither re-rendered nor re-uploaded, since the source would not be applied to it and its pixels therefore do not depend on the source

#### Scenario: An image that predates the source's current mapping is re-rendered
- **WHEN** a model the source would frame is displayed, and its cached thumbnail was drawn under an earlier version of the source's mapping or before the source had any opinion about it at all
- **THEN** the thumbnail is re-rendered under the current mapping and records the version it used — a missing record and an outdated one are the same case, since neither says the pixels were drawn under the mapping in force
