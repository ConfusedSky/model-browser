# model-thumbnails Delta

> No other active change modifies this requirement (`lighting-refreshes-thumbnails` modifies
> *Lighting-mode-aware thumbnails*, `thumbnail-sweep-priority` modifies *Client-side
> thumbnail rendering*), so there is no collision. All five scenarios this requirement
> already carries are preserved: a MODIFIED requirement replaces prose *and* scenarios at
> archive.

## MODIFIED Requirements

### Requirement: Camera state stored alongside thumbnails
The server SHALL store each model's camera (orientation) state and its orbit axis together alongside its thumbnail, keyed by path only, so both survive file modification, sessions, and different browsers. Thumbnail renders SHALL use the stored camera state when present, otherwise the spindle's default fit-to-bounds three-quarter view. The client SHALL be able to **discard** a model's stored orientation — its camera, its axis, or both — distinctly from writing a value over it: a request that does not mention one of them SHALL leave it as it was, while one that discards it SHALL leave the model with none. A model with no stored orientation SHALL be rendered the way a model that never had one is rendered — which, where an orientation source such as a semantic index supplies one for it, means that orientation rather than the default. Where such a source supplies an axis and angles as one orientation, a stored axis SHALL be enough to withhold it, since angles measured about one axis do not describe a view about another. Writing the default view as a stored value SHALL NOT be treated as equivalent to discarding, since a stored default is an orientation of the user's own and suppresses any such source. Camera state SHALL be stored bounds-relative — azimuth, elevation, and distance as a multiple of the bounding-sphere radius, with the target relative to the bounding box — and spindle-relative: azimuth/elevation are measured in the model's spindle frame, never in world coordinates, so orientation round-trips exactly for every axis. A missing axis SHALL be *rendered* as +Y, under which the spindle-relative representation equals the historical world-Y one (no migration) — but a read SHALL report its absence rather than substituting +Y, since whether the user has chosen an orientation is what tells a caller that the model is free to be oriented by something else. Defaulting belongs to the caller that draws; the response distinguishes none-stored from stored-as-+Y.

#### Scenario: Orientation survives re-export
- **WHEN** a model file is overwritten (new mtime) after the user saved an orientation
- **THEN** the regenerated thumbnail is rendered from the saved camera state

#### Scenario: Re-export at a different scale or origin
- **WHEN** a model is re-exported scaled, re-centred, or unit-converted after an orientation was saved
- **THEN** the regenerated thumbnail shows the same view of the model, correctly framed

#### Scenario: Orientation shared across browsers
- **WHEN** the user orbits a model in one browser and opens the app in another browser
- **THEN** the second browser shows the thumbnail in the saved orientation

#### Scenario: Non-default spindle round-trips exactly
- **WHEN** a model with an overridden axis is orbited, released, and its directory revisited
- **THEN** the thumbnail and reopened view match the released view exactly, not a world-Y approximation

#### Scenario: Pre-existing entries read as +Y
- **WHEN** a cache entry written before axis support is served
- **THEN** it behaves as axis +Y with its camera state interpreted unchanged

#### Scenario: Discarding an orientation is not writing one
- **WHEN** a model's stored camera is discarded and its thumbnail is rendered again
- **THEN** it is rendered as a model with no orientation of its own — at an orientation supplied for it by an index where one exists, and at the spindle's default otherwise — rather than at a stored default that would suppress that source

#### Scenario: Silence still preserves
- **WHEN** a request stores a thumbnail without mentioning the camera or the axis
- **THEN** both are unchanged, as they are today

#### Scenario: Discarding both hands the model to the source
- **WHEN** a model's stored camera and axis are both discarded and an index supplies an orientation for it
- **THEN** it is rendered at that orientation — its axis as well as its angles — rather than at the default about its former axis

#### Scenario: Absence is reported, not defaulted away
- **WHEN** a model with a stored thumbnail but no stored axis is read
- **THEN** the response reports no axis rather than +Y, while anything drawing it still draws it about +Y absent another source
