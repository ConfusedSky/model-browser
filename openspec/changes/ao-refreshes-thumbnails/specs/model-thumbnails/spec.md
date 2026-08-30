# model-thumbnails Delta

> Written against `remove-axis-lighting`'s delta, which RENAMES *Lighting-mode-aware
> thumbnails* to *Recipe-labelled thumbnails* and rewrites it. Hard ordering: archive after
> it. All five scenario titles that delta leaves on the requirement are carried here
> (the archive refuses a MODIFIED block that drops one); six are added.
> `thumbnail-sweep-priority` modifies *Client-side thumbnail rendering* and
> `ao-as-recipe-dimension` ADDs *A thumbnail exists per occlusion recipe* — no collision.

## MODIFIED Requirements

### Requirement: Recipe-labelled thumbnails
Thumbnails SHALL be rendered with the rig fixed in the rest camera's frame — the orientation the live view uses at handoff. The server SHALL store, alongside each PNG, every recipe input that decides its pixels but is not carried by the cache key — the lighting label, the rig version, and where an orientation source framed the render, which version of that source's mapping was used — and SHALL return them on reads; it stores and echoes the values without interpreting them. Like the PNG's mtime, all of these values describe the pixels: a PUT that replaces the PNG without declaring them SHALL clear the stored values rather than keep stale labels, while a PUT that does not replace the PNG SHALL leave the stored values in place unless it declares them. All of them SHALL be returned on stale reads as well as hits. The lighting label SHALL have one producible value, the camera-fixed rig; the server SHALL refuse a PUT declaring any other, while continuing to read and echo labels stored before this. The client SHALL treat a cache hit whose stored lighting label is not the producible one, or whose stored rig version differs from the client's current rig version — including entries where either value is absent — as needing re-render: the PNG is replaced through the normal render queue while camera state and axis are preserved. A hit SHALL likewise need re-render when an orientation source would frame that model and the stored image was not produced under the source's current mapping — but only where the source **would actually be applied**, which is to say the model has no orientation of its own. A model the user has oriented is a hit whatever the source holds for it, since its pixels do not depend on the source; treating it as stale renders and re-uploads an image identical to the one already cached, on every visit, forever. A render made under an orientation source SHALL record the mapping version it used, so a later change to that mapping is detectable and the image is not mistaken for one drawn without a source. The lookup and this test SHALL be applied to the thumbnails already displayed when the effective ambient-occlusion preference changes — whether by the user's toggle or by an automatic decision — not only to those a subsequent visit rebuilds: a control that changes how models are drawn SHALL answer on the listing in front of the user, showing a render already cached under the new setting at once and rendering only what is not. A change of rig version SHALL remain lazy, taken on the next visit, since it accompanies a new build rather than a user's gesture and nothing on screen is waiting on it. Refreshing this way SHALL reuse the same lookup, the same staleness test and the same render queue a visit uses, SHALL preserve camera state and axis, and SHALL keep each existing image until its replacement exists, so the grid does not empty while it works. The same SHALL hold when the set of entries changes while some remain — an entry being the same path at the same mtime: remaining entries keep their state and images, and work in flight for them continues rather than restarting; only added entries start loading; removed entries are dropped and their work cancelled; a remaining entry whose orientation-source opinion changed in value SHALL be re-evaluated without losing its image, and one whose opinion is unchanged SHALL issue nothing. A change of the occlusion preference, by contrast, cancels the in-flight pass whole.

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

#### Scenario: Switching occlusion answers on the grid in front of you
- **WHEN** the occlusion preference changes while a listing of thumbnails rendered under the other setting is on screen
- **THEN** those thumbnails switch to the new setting's render without the user navigating away and returning — from the cache where one exists, rendered where not — each keeping its camera and axis and its previous image until the replacement is ready

#### Scenario: Adding entries does not reset the ones already shown
- **WHEN** entries are added to a listing whose thumbnails are on screen
- **THEN** the entries already shown keep their images and issue no new lookup, and only the added entries start loading

#### Scenario: A peek lands mid-pass
- **WHEN** entries are added while some of those already listed are still loading
- **THEN** the loading ones finish without restarting, and only the added ones begin

#### Scenario: Switching back before the first pass finishes
- **WHEN** the preference changes twice in quick succession
- **THEN** the grid settles under the setting chosen last, without the first pass's renders landing on top of it

#### Scenario: A model with its own orientation is not made stale by a pose
- **WHEN** a model the user has oriented is displayed in a view where an orientation source also holds a pose for it
- **THEN** its cached thumbnail is a hit and is neither re-rendered nor re-uploaded, since the source would not be applied to it and its pixels therefore do not depend on the source

#### Scenario: An image that predates the source's current mapping is re-rendered
- **WHEN** a model the source would frame is displayed, and its cached thumbnail was drawn under an earlier version of the source's mapping or before the source had any opinion about it at all
- **THEN** the thumbnail is re-rendered under the current mapping and records the version it used — a missing record and an outdated one are the same case, since neither says the pixels were drawn under the mapping in force
