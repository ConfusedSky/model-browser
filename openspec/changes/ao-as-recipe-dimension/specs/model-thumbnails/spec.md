# model-thumbnails Delta

> ADDED only. *Server-side thumbnail persistence* (MODIFIED by `library-root`) and *Bounded,
> self-maintaining cache* (same) are untouched: occlusion is a key dimension, not a label.
> *Recipe-labelled thumbnails* (RENAMED and MODIFIED by `remove-axis-lighting`, MODIFIED again
> by `ao-refreshes-thumbnails`) is not modified here either, but the requirement below states
> one exception to its rule that a write not replacing a PNG leaves that render's labels alone
> — sibling invalidation clears them — and says so, rather than carrying a carve-out through
> two later rewrites.

## ADDED Requirements

### Requirement: A thumbnail exists per occlusion recipe
A model's cache entry SHALL hold up to two renders — with ambient occlusion and without — each keyed by the path and mtime that *Server-side thumbnail persistence* defines plus the occlusion setting it was rendered under — the occlusion setting is a dimension of that key, not a second key — and each carrying its own recipe labels. A thumbnail read SHALL name the occlusion setting it wants and SHALL receive that render's status, pixels and labels; a read naming no setting SHALL be served the occluded render. A thumbnail write SHALL name the setting its pixels were rendered under; a write naming none SHALL be stored as the occluded render. Camera state and orbit axis SHALL be shared by both renders of an entry and SHALL be returned on a read of either, whatever its status. Because the orientation is shared, a write that changes it SHALL invalidate the render it did not write — and, when it carries no pixels, both renders. A change is a camera the entry did not hold, or one differing from the stored camera by more than a fixed tolerance held as a named constant (a re-captured camera drifts in its last digits on every lightbox close and is not a change); an axis the entry did not hold, or one that differs from the stored axis; or a discard of one the entry held. Invalidation SHALL clear the render's recipe labels while keeping its pixels and mtime — notwithstanding *Recipe-labelled thumbnails*'s rule that a write not replacing a PNG leaves its labels alone — so that the render reads as a hit needing re-render under that requirement's label rule: its pixels are still served, and it is re-rendered at the new orientation rather than served at the old one. A write that carries only pixels and recipe labels SHALL NOT touch the other render: both renders are always drawn under the stored orientation, so pixels alone cannot desynchronise them, and toggling between settings stays a lookup. A read's status SHALL be decided per render: a hit when that render's pixels are present at the requested mtime; stale when that render was written before or the entry holds a camera (the predicate the cache applies today, per render); a miss otherwise. When a write carries pixels at a newer mtime, the other render's pixels are superseded too and SHALL be deleted, as *Bounded, self-maintaining cache* requires of superseded thumbnails. Each render SHALL be evicted by the size cap on its own least-recently-read clock, leaving the other in place; the existence sweep SHALL remove the entry whole. Renders cached before this requirement SHALL be served as the occluded render without migration.

#### Scenario: Toggling back is a lookup
- **WHEN** a directory's thumbnails have been rendered under both settings and the user switches the preference
- **THEN** the next visit under either setting is served from the cache with no render and no upload

#### Scenario: The other render is not a hit, and keeps its orientation
- **WHEN** a model has an occluded thumbnail and a saved camera, and its unoccluded thumbnail is requested for the first time
- **THEN** the response is not a hit — stale, since the entry holds a camera — and carries the saved camera and axis, and the client renders the unoccluded thumbnail under that orientation

#### Scenario: Orbiting under one setting invalidates the other render
- **WHEN** a model with both renders cached is orbited and released with the preference off, and the preference is then turned on
- **THEN** the occluded render reads as a hit whose recipe labels are cleared and whose pixels are still served, and the client re-renders it at the new orientation rather than keeping it at the old one

#### Scenario: A pixel-only write leaves the other render alone
- **WHEN** a model's unoccluded render is written for the first time while its occluded render is cached, with no change to its camera or axis
- **THEN** the occluded render is still a hit

#### Scenario: A discard invalidates both ways
- **WHEN** a model's stored orientation is discarded by a write that carries no pixels
- **THEN** both renders' recipe labels are cleared; each is re-rendered when next viewed, at the orientation the model now has

#### Scenario: An unmoved close invalidates nothing
- **WHEN** a model that already holds a camera, with both renders cached, is opened in the lightbox and closed without being orbited
- **THEN** the camera the close persists is within tolerance of the stored one and the other render is still a hit

#### Scenario: A snapshot follows the preference
- **WHEN** an orbit is released or the lightbox closed with the preference off
- **THEN** the thumbnail persisted from that view is the unoccluded render, matching the overlay the user was looking at

#### Scenario: A pre-existing cache is the occluded render
- **WHEN** the server starts over a cache written before renders were keyed by occlusion
- **THEN** every entry is served as the occluded render exactly as before, and nothing re-renders for a user whose preference is on

#### Scenario: Renders are evicted independently
- **WHEN** the cache exceeds its cap and a model's unoccluded render was read longer ago than its occluded one
- **THEN** the unoccluded render is evicted first and the occluded one remains a hit

#### Scenario: One entry, one existence
- **WHEN** a model with both renders cached is deleted and the cache is swept
- **THEN** both renders and the entry's camera and axis are removed together
