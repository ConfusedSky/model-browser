# model-thumbnails Delta

> ADDED only. *Server-side thumbnail persistence* (MODIFIED by `library-root`),
> *Bounded, self-maintaining cache* (same) and *Recipe-labelled thumbnails* (RENAMED and
> MODIFIED by `remove-axis-lighting`) are untouched: occlusion is a key dimension, not a
> label, so the label rule and the keying rule stand as written.

## ADDED Requirements

### Requirement: A thumbnail exists per occlusion recipe
A model's cache entry SHALL hold up to two renders — with ambient occlusion and without — each keyed by the path, the mtime, and the occlusion setting it was rendered under, and each carrying its own recipe labels. A thumbnail read SHALL name the occlusion setting it wants and SHALL receive that render's status, pixels and labels; a read naming no setting SHALL be served the occluded render. A thumbnail write SHALL name the setting its pixels were rendered under; a write naming none SHALL be stored as the occluded render. Camera state and orbit axis SHALL be shared by both renders of an entry and SHALL be returned on a read of either, including a miss. Each render SHALL be evicted by the size cap on its own least-recently-read clock, leaving the other in place; the existence sweep SHALL remove the entry whole. Renders cached before this requirement SHALL be served as the occluded render without migration.

#### Scenario: Toggling back is a lookup
- **WHEN** a directory's thumbnails have been rendered under both settings and the user switches the preference
- **THEN** the next visit under either setting is served from the cache with no render and no upload

#### Scenario: The other render is a miss that keeps its orientation
- **WHEN** a model has an occluded thumbnail and a saved camera, and its unoccluded thumbnail is requested for the first time
- **THEN** the response is a miss carrying the saved camera and axis, and the client renders the unoccluded thumbnail under that orientation

#### Scenario: A pre-existing cache is the occluded render
- **WHEN** the server starts over a cache written before renders were keyed by occlusion
- **THEN** every entry is served as the occluded render exactly as before, and nothing re-renders for a user whose preference is on

#### Scenario: Renders are evicted independently
- **WHEN** the cache exceeds its cap and a model's unoccluded render was read longer ago than its occluded one
- **THEN** the unoccluded render is evicted first and the occluded one remains a hit

#### Scenario: One entry, one existence
- **WHEN** a model with both renders cached is deleted and the cache is swept
- **THEN** both renders and the entry's camera and axis are removed together
