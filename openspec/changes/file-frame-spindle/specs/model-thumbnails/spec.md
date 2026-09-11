## MODIFIED Requirements

### Requirement: Camera state stored alongside thumbnails
The server SHALL store each model's camera (orientation) state and its orbit axis together alongside its thumbnail, keyed by path only, so both survive file modification, sessions, and different browsers. Thumbnail renders SHALL use the stored camera state when present, otherwise the spindle's default fit-to-bounds three-quarter view. The client SHALL be able to **discard** a model's stored orientation — its camera, its axis, or both — distinctly from writing a value over it: a request that does not mention one of them SHALL leave it as it was, while one that discards it SHALL leave the model with none. A model with no stored orientation SHALL be rendered the way a model that never had one is rendered — which, where an orientation source such as a semantic index supplies one for it, means that orientation rather than the default. Where such a source supplies an axis and angles as one orientation, a stored axis SHALL be enough to withhold it, since angles measured about one axis do not describe a view about another. Writing the default view as a stored value SHALL NOT be treated as equivalent to discarding, since a stored default is an orientation of the user's own and suppresses any such source. Camera state SHALL be stored bounds-relative — azimuth, elevation, and distance as a multiple of the bounding-sphere radius, with the target relative to the bounding box — and spindle-relative: azimuth/elevation are measured in the model's spindle frame, never in world coordinates, so orientation round-trips exactly for every axis. The stored axis SHALL be a file axis — the model's own coordinates, as the viewer's *Per-model orbit spindle* defines them — so a sidecar reads without a mapping. A missing axis SHALL be *rendered* as the model's format default, but a read SHALL report its absence rather than substituting the default, since whether the user has chosen an orientation is what tells a caller that the model is free to be oriented by something else. Defaulting belongs to the caller that draws; the response distinguishes none-stored from stored-as-default. Entries written before axes were file axes stored a scene axis (the file's axis turned a quarter turn about X for STL, the one format that was turned; the file's own axis for OBJ and 3MF, which never were) and SHALL be migrated exactly once by a one-shot tool: an STL axis is relabelled to the file axis it named, its camera untouched, since the spindle frames were redefined so that the same angles draw the same view; an OBJ or 3MF camera at a spindle whose frame moved is re-expressed by that frame's azimuth offset. A migrated sidecar SHALL carry a frame label naming the convention its axis is in — `frame: 2` for a file axis; an absent label means the scene convention that preceded it (convention 1, never written) — and the label SHALL be written only by a write that carries a camera or an axis, and SHALL be preserved by every other write, so the tool can tell a migrated entry from one it has not seen and never migrates twice. The tool SHALL record its run in the cache directory, SHALL refuse a directory in which a framed entry is unlabelled and its sidecar was modified after the record's timestamp — the signature of a server without the label having written there since; a directory copied without preserving modification times is refused the same way and the refusal SHALL say so — and SHALL be able to undo its own run by inverting the transform and removing the record. Browsers holding framings locally, where server writes are withheld, SHALL apply the same transform once on read under the same label.

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
- **THEN** the thumbnail and reopened view match the released view exactly, not an approximation about another axis

#### Scenario: Pre-existing entries read as +Y
- **WHEN** a cache entry written before axis support is served, holding a camera and no axis
- **THEN** the +Y such an entry was written against is the frame the format's default now carries, so it renders about that default with its camera interpreted unchanged; it keeps no axis — a stored axis would withhold an index orientation the entry never suppressed — and the migration tool only stamps the frame label

#### Scenario: A stored scene axis is relabelled, not reinterpreted
- **WHEN** a cache entry written before axes were file axes holds axis `-z` on an STL with a stored camera
- **THEN** the migration tool relabels it `y`, leaves the camera as it was, stamps the frame label, and the re-rendered thumbnail shows the same view it did before

#### Scenario: An un-rotated format's camera is re-expressed
- **WHEN** a cache entry written before axes were file axes holds a camera on an OBJ or 3MF at spindle `z`
- **THEN** the migration tool keeps the axis, adds the frame swap's azimuth offset to the camera, stamps the label, and the re-rendered thumbnail shows the same view it did before

#### Scenario: A pixels-only write does not claim migration
- **WHEN** a thumbnail is written for an entry holding an unlabelled stored axis, mentioning neither camera nor axis
- **THEN** the axis and the absence of the label are both preserved, so the migration tool still finds the entry

#### Scenario: A framing write after migration keeps the label
- **WHEN** a migrated entry's model is orbited and its camera written
- **THEN** the label is still present and the axis is not migrated again

#### Scenario: Migration is idempotent
- **WHEN** the migration tool runs over a directory it has already migrated
- **THEN** every labelled entry is left untouched and the run reports zero changes

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
- **THEN** the response reports no axis rather than the default, while anything drawing it still draws it about the format's default absent another source
