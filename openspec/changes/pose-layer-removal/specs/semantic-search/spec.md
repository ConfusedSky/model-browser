## MODIFIED Requirements

### Requirement: The index's orientations reach every listing
Where the index is ready and covers the browsed location, the client SHALL be able to obtain the index's orientation for **the models a listing landed** — every shape of listing, plain, flat or name-search, and not only search results — by naming those models: through an endpoint that takes a batch of library paths and answers their poses keyed by library path, mapping and confining each path exactly as search hits are mapped and confined, and refusing nothing silently beyond leaving an unanswerable path out of its answer. A per-directory form of the same question MAY remain for a directory-shaped ask, but it SHALL NOT be what a listing's poses are obtained through: a flat listing's models live in subfolders and a name search's are drawn from a whole subtree, so a directory's direct children are neither the models on screen nor a subset of them. A listing itself SHALL NOT depend on the index: where the index's memoised state is ready the listing MAY carry the orientations the index answered within a bounded wait at emission — asked fresh for that emission, never held by the server between emissions — and the client SHALL ask the endpoint only for the models the listing did not carry; where the index is absent, warming, wedged, does not cover the location, or does not answer within the bound, the listing arrives without poses and no later than the bound, and the client asks the endpoint afterwards, treating an index that answers as it answers a search — absent, warming, or out of coverage — as "no poses", leaving every tile exactly as it renders today. Poses obtained either way SHALL flow into the same client state a search's riding poses populate, so the thumbnail sweep re-evaluates displayed tiles by value, keeps each image until its replacement exists, and re-renders only tiles whose orientation actually arrived or changed, under the recipe labels and applied-only staleness the thumbnail requirements already define.

#### Scenario: A plain listing stands its models up
- **WHEN** a directory is listed while the index is ready and covers it, and the index answers — on the listing itself within the bound, or through the poses request afterwards
- **THEN** unowned models whose cached thumbnails were drawn without the index's orientation re-render posed, each keeping its image until the replacement lands, and models with a stored camera or axis are untouched

#### Scenario: A flat listing stands its models up too
- **WHEN** a flat listing or a name search lands, its models drawn from folders below the one it was run at
- **THEN** its entries' poses are carried or asked for by path and applied exactly as a plain listing's are — the same emission-time ask, the same second wave for what it did not carry, the same merge, the same by-value re-evaluation — rather than the poses of the models sitting directly in the folder the listing was run at

#### Scenario: The index's absence costs the listing nothing
- **WHEN** a directory is listed while the index is absent, warming, or does not cover it
- **THEN** the listing renders exactly as it does today — no poses, default framing for unowned models, no error and no delay attributable to the index

#### Scenario: A pose wave does not reset the grid
- **WHEN** the poses answer arrives after a listing's tiles are already displayed
- **THEN** every tile keeps its image while any re-render it caused resolves, and a tile whose pose matches what its pixels were already drawn under issues nothing
