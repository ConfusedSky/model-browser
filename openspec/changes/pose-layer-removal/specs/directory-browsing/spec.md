## MODIFIED Requirements

### Requirement: Folder tiles preview their contents
A directory tile SHALL show up to four thumbnails of models found within it, arranged as a contact sheet, with the directory's name beneath. The models SHALL be chosen from the index first, where it is ready and covers the location: the index is asked for the models it holds under the directory — no filesystem walk — and the sheet is the first posed ones in the index's deterministic order, unposed indexed ones filling remaining cells; each such path is confined exactly as a search hit is. When that answer names fewer models than the sheet holds, the remaining cells SHALL be filled from the walk's finds, deduplicated by path, so a sheet is never emptier than the walk alone would have made it. Only when that answer is empty, or the index is silent, SHALL the models be chosen entirely by a bounded, deterministic walk of the directory — at each level its models in sorted order before its subdirectories in sorted order, descending in that order — preferring models the index holds an orientation for: the walk runs to its entry bound, one bounded request to the index decides which finds are posed, and the sheet is the posed finds in walk order, models found without a pose filling the remaining cells in walk order. Posedness comes from the index in one bounded request over the walk's finds; when the index is absent, warming, or does not cover the location, the selection is the walk's first four models exactly as before, so the preview never waits on the index. The orientations the index answered while choosing the sheet — from its answer about the folder, or from the one request over the walk's finds — SHALL ride the sheet's cells as they ride a listing's models: a cell the index named carries its pose, a cell the index was asked about and did not name carries an explicit null, and a cell that was never asked about carries nothing, so the client asks the index about a previewed model only when the peek could not; a preview cell is an ordinary listing entry and carries what one may carry. The same directory with the same index answer previews the same models on every visit and on every machine. The walk SHALL examine no more than a fixed number of entries, counting every entry it stats at any level, so a single wide directory is bounded too, and SHALL take a level's entries in code-point name order before counting — not a locale collation — so that the bound cuts the same entries on every machine; a directory that exhausts that bound before four posed models are found SHALL preview the posed ones found, filled out with unposed finds in walk order. A peek is its own request: never served from or merged into a recursive listing, and — being bounded — run to completion rather than stopped when its tile has scrolled away. A peek SHALL be confined exactly as a listing is: an entry that resolves outside the library is neither previewed nor descended into. The preview SHALL be requested per tile, when the tile comes on screen or within the prefetch band of it — the same boundary the thumbnail queue ranks work as near by, so a sheet is usually landed before its tile is seen — through a server endpoint that returns the previewed models as ordinary listing entries; a directory listing SHALL NOT compute previews. Preview thumbnails SHALL be produced, cached and refreshed exactly as a model tile's thumbnail is, sharing an entry with the same model wherever it appears. A directory with no previewable models, an unreadable directory, a tile whose preview has not yet answered, or a tile whose preview request failed SHALL show its own icon — for a directory that icon is the folder chrome, drawn whether or not a preview has landed, so a landing preview fills it rather than replacing a different resting icon; fewer than four previews SHALL fill the sheet without empty cells.

A directory **inside** an archive SHALL be previewed like any other directory, and the tile of the **archive itself** SHALL NOT be previewed. An archive interior's models SHALL be chosen from the archive's own entries under that directory's prefix, taken in code-point name order under the same entry bound, its models before its subdirectories, so the sheet is deterministic and bounded exactly as a filesystem directory's is. The entries SHALL be read through the layer that holds them against the archive's `{mtime, size}` wherever one is available, by the listing and by the previews alike, so that browsing an archive and previewing the directories it holds do not each pay their own read of it. No filesystem descent is involved and nothing inside an archive can leave the library, so confinement is decided by the archive's own path; a nested archive is not enterable and is neither previewed nor descended into, and a path inside an archive that names a file rather than a directory SHALL be refused as a listing of that path refuses it rather than answered as an empty sheet. The index is **not** consulted for an archive interior — nothing inside an archive is embedded, and such paths are excluded structurally before the index is asked — so an interior's sheet is always the walk's own choice in walk order, no part of it waits on the index, and no interior cell carries a pose. An interior's sheet SHALL be recorded against the containing archive's modification time and SHALL be re-derived rather than served once that has moved — including a sheet that is **empty**, which has no cell of its own to disagree with the archive and would otherwise be served unchanged for as long as the server ran. A sheet held with no such record SHALL be re-derived rather than trusted. Names beginning with a dot SHALL be skipped when choosing an interior's models, as they are skipped when choosing a filesystem directory's; a listing of that interior still shows them, since what a sheet declines to draw and what a listing declines to name are different questions. This does not contradict the rule above that archive members are opaque to the hidden-entry test (`library`, *Hidden entries are unreachable*): that rule is about what a listing may name and a path may reach, and this one is about what a sheet chooses to draw out of what the listing already shows — a real library's archives carry `__MACOSX` trees whose `._name.stl` resource forks are reachable, listed, and not models.

#### Scenario: A kit shows its parts
- **WHEN** a directory containing several models is on screen as a tile
- **THEN** the tile shows thumbnails of four of its models as a 2×2 sheet — the first four posed ones in name order where the index answers, its first four in name order where it does not — and its name

#### Scenario: A folder of folders shows its first kit
- **WHEN** a directory whose own level holds only subdirectories is on screen as a tile
- **THEN** the tile shows the first four models found by descending its subdirectories in order

#### Scenario: Fewer than four
- **WHEN** a directory holds one, two or three models and nothing below them
- **THEN** the tile shows that many thumbnails filling the sheet, with no empty cells

#### Scenario: A folder inside a zip shows its parts
- **WHEN** a directory inside an archive is on screen as a tile — reached by browsing into the archive, or emitted as a match by a deep search that never opened it
- **THEN** the tile shows thumbnails of the models under it, chosen from the archive's entries under that directory's prefix, exactly as a filesystem directory's tile is filled

#### Scenario: An interior's cells are the archive's own entries
- **WHEN** a model inside an archive appears both in a folder tile's sheet and as its own tile in a listing of that directory
- **THEN** both carry the same entry — the same path and the same modification time, taken from the containing archive — so both draw one cached thumbnail rather than two

#### Scenario: A path inside an archive that is not a directory
- **WHEN** a preview is asked for a path inside an archive that names a file entry or a nested archive
- **THEN** it is refused exactly as a listing of that path is refused, rather than answered as a sheet with nothing in it

#### Scenario: A zip tile keeps its icon
- **WHEN** an archive is on screen as a tile in the directory that holds it
- **THEN** the tile shows the archive icon and no archive is opened to fill it

#### Scenario: Previewing an archive's folders does not read it per tile
- **WHEN** an archive is listed and several of the directories inside it are previewed
- **THEN** the archive's entries are read through the layer that holds them rather than once for the listing and once per tile

#### Scenario: A rewritten archive drops its interiors' sheets
- **WHEN** an archive is rewritten in place and its contents are listed again, so its entries carry a modification time later than the one the held sheets were derived against
- **THEN** those sheets are re-derived rather than served from the version that is gone, and their cells never draw against a thumbnail keyed on the archive that is gone

#### Scenario: Nothing to preview
- **WHEN** a directory holds no models within the walk's bound, or cannot be read, or is an archive's own tile, or is a nested archive inside one
- **THEN** the tile shows its own icon — the directory icon for a directory, the archive icon for an archive

#### Scenario: A failed peek shows the icon
- **WHEN** a tile's preview request fails — the library not ready, or a network error
- **THEN** the tile shows its own icon and the rest of the grid is unaffected

#### Scenario: The listing is not slower for it
- **WHEN** a directory of many subdirectories is listed
- **THEN** the listing request does no preview work, and previews are requested only for tiles that come on screen or within the prefetch band of it

#### Scenario: A preview is an ordinary thumbnail
- **WHEN** a model previewed in a folder tile is also shown as its own tile, or the occlusion preference changes, or its thumbnail is re-rendered
- **THEN** the folder tile shows the same image the model tile shows, from the same cache entry

#### Scenario: The index sees past the walk's budget
- **WHEN** a folder-of-folders tile is previewed whose first-sorted subtree would consume a walk's entry budget, while the index holds posed models deeper in the folder
- **THEN** the sheet shows posed models from anywhere under the folder, because the selection asked the index rather than walking — and a folder the index knows nothing about falls back to the walk exactly as before

#### Scenario: Determinism
- **WHEN** the same directory is previewed twice, or on two machines holding the same library, with the index answering the same poses — or not answering — in both, an archive interior included
- **THEN** the same models are previewed in the same order, carrying the same poses

#### Scenario: A sheet's cells arrive posed
- **WHEN** a folder tile is previewed while the index is ready and covers it, and the index names an orientation for some of the models it chose
- **THEN** those cells carry their orientation on the preview answer itself, the cells the index was asked about and did not name carry an explicit null, and the client issues no pose request for any cell the answer settled — a cell's thumbnail re-renders posed from the preview alone
