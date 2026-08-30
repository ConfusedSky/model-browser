## MODIFIED Requirements

### Requirement: Results are assembled from this app's own view of the tree
The server SHALL build tiles for meaning results from its own listing data rather than from the index's description of a model, resolving each hit by its path relative to the collection root and naming the tile by the resulting library-relative path (see `library`). A hit that resolves to nothing on disk SHALL be omitted from the results without failing the search, since the index and this app maintain independent views of the same removable volume and a moved or deleted file is an expected difference rather than an error. A collection root that lies outside the library SHALL be treated as covering nothing: no scope within the library is offered to it, and the UI SHALL state that the index covers a location outside the library rather than naming a path the user cannot navigate to. Resolution work SHALL be bounded by the number of hits returned, never by the size of the tree: no filesystem walk SHALL be performed to answer a meaning search.

#### Scenario: Tiles carry what tiles need
- **WHEN** meaning results are rendered
- **THEN** each tile has the metadata an ordinary listing entry has, is addressed by a library-relative path, and its thumbnail resolves from the cache exactly as it would in a directory listing

#### Scenario: A stale hit is dropped, not raised
- **WHEN** the index returns a model that has since been moved or deleted
- **THEN** the remaining results are shown normally and no error is presented

#### Scenario: No walk behind a query
- **WHEN** a meaning search runs over a large collection on slow media
- **THEN** the response does not depend on walking the tree, and its cost does not grow with the size of the collection

#### Scenario: The index covers a subtree of the library
- **WHEN** the index's collection root is a directory beneath the library's top
- **THEN** hits are named by their library-relative paths, and the UI names the covered subtree as a library path

#### Scenario: The index covers something outside the library
- **WHEN** the index's collection root resolves outside the library
- **THEN** meaning search is unavailable at every location, and the UI says the index covers a location outside the library
