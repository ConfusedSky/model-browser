## MODIFIED Requirements

### Requirement: Entries display their stored name
A listing entry whose exact library path holds a display name in the library's
override store SHALL carry that name, attached at listing emission from the
loaded store — an exact-key lookup, never the prefix resolution, so a kit's
name labels the kit's own tile and nothing beneath it. Tiles SHALL render the
display name in place of the file-derived label wherever one is carried, in
each listing shape the seam covers — a browse, a flat or deep-search listing,
a folder tile's preview entries, and meaning and similarity answers (the
similarity answer's anchor included) alike — while the entry's real name SHALL remain in the
tile's own title and accessible name (a named directory tile's accessible name
is "folder " plus the real name — the type signal its content-derived name
would otherwise lose), and SHALL remain what find, deep search
and the flat filter match, beside the stored names that `file-search`'s *Names
match term by term* also reads. A flat or deep-search listing, and a meaning or
similarity answer, SHALL also carry on each model entry the stored name, or its
absence, of each folder and archive its relative name passes through, one per
folder in the order the name gives them — for a flat or deep-search listing,
those containing it below the listing's root; for a meaning or similarity
answer, those below the index's collection root — so the client's filter can
match the names a search matches. These SHALL NOT label the model's tile, but the
line under a model tile's name that shows where it lives SHALL show each
folder's stored name in place of its real name where one is carried, and the
real name otherwise, while the tile's title and accessible name keep the real
path. A folder tile's
preview cell is the one exception by construction: it has no visible label, so
its title IS its label surface and SHALL carry the display name where one is
stored (falling back to the entry's real name, unchanged) — the enclosing
tile's title still carries the real name. An entry with no stored
name SHALL be labelled exactly as before, and a library with no store SHALL
list and label identically to today.

#### Scenario: A kit tile shows its title
- **WHEN** the store holds a name for a directory and its tile is listed
- **THEN** the tile's label is the stored name, and its title still carries the directory's real name

#### Scenario: A kit's models keep their own names
- **WHEN** the store holds a name for `/kit` and none for `/kit/x.stl`
- **THEN** `/kit/x.stl`'s tile is labelled from its file name, not the kit's stored name

#### Scenario: Matching is untouched
- **WHEN** a directory's stored name and real name differ and the user types a fragment of each into find
- **THEN** each fragment matches the tile: the real name is matched as before, and the stored name beside it

#### Scenario: A flat listing carries the names along each path
- **WHEN** the store holds a name for `/kit` and none for `/kit/x.stl`, and a flat listing of `/` includes `/kit/x.stl`
- **THEN** that entry carries `/kit`'s stored name as a name along its path, and its tile is still labelled from its file name

#### Scenario: A model tile's folder line shows stored folder names
- **WHEN** the store holds "D&D minis" for `/DD_minis_945822` and none for `/DD_minis_945822/sub`, and a flat or search listing of `/` shows `DD_minis_945822/paladin.stl` and `DD_minis_945822/sub/paladin.stl`
- **THEN** the first tile's folder line reads "D&D minis" and the second's reads "D&D minis/sub", each tile is still labelled from its file name, and each tile's title and accessible name still carry its real path

#### Scenario: A meaning result carries its names
- **WHEN** the store holds a name for `/kit/x.stl` and one for `/kit`, and a meaning search returns `/kit/x.stl` from an index whose collection root is the library's top
- **THEN** the result's tile is labelled with `/kit/x.stl`'s stored name, and the entry carries `/kit`'s stored name as a name along its path

#### Scenario: No store, no change
- **WHEN** a library carries no override store
- **THEN** every listing and label is byte-identical to what it was before this capability existed
