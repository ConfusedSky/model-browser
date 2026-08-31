# semantic-search Delta

> ADDED only. *A pose orients the model without becoming its stored camera* governs what
> a supplied pose does and is untouched; this requirement is about supply. The
> `library-overrides` change (drafted) ships a store pose field; the precedence seam is
> recorded in both designs and wired by whichever lands second.

## ADDED Requirements

### Requirement: The index's orientations reach every listing
Where the index is ready and covers the browsed location, the client SHALL be able to obtain the index's orientation for every model in a listing — not only for search results — through a server endpoint that answers a directory's models' poses keyed by library path, mapping and confining each path exactly as search hits are mapped and confined. A listing itself SHALL NOT depend on the index: the listing request carries no poses and waits for none, poses arrive as their own request afterwards, and an index that is absent, warming, or does not cover the location answers as it answers a search — which the client SHALL treat as "no poses", leaving every tile exactly as it renders today. Poses obtained this way SHALL flow into the same client state a search's riding poses populate, so the thumbnail sweep re-evaluates displayed tiles by value, keeps each image until its replacement exists, and re-renders only tiles whose orientation actually arrived or changed, under the recipe labels and applied-only staleness the thumbnail requirements already define.

#### Scenario: A plain listing stands its models up
- **WHEN** a directory is listed while the index is ready and covers it, and the poses request answers
- **THEN** unowned models whose cached thumbnails were drawn without the index's orientation re-render posed, each keeping its image until the replacement lands, and models with a stored camera or axis are untouched

#### Scenario: The index's absence costs the listing nothing
- **WHEN** a directory is listed while the index is absent, warming, or does not cover it
- **THEN** the listing renders exactly as it does today — no poses, default framing for unowned models, no error and no delay attributable to the index

#### Scenario: A pose wave does not reset the grid
- **WHEN** the poses answer arrives after a listing's tiles are already displayed
- **THEN** every tile keeps its image while any re-render it caused resolves, and a tile whose pose matches what its pixels were already drawn under issues nothing
