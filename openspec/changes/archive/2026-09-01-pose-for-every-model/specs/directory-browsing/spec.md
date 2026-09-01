# directory-browsing Delta

> MODIFIED: the preview walk prefers posed models (Masa, 2026-08-31) within its existing
> entry bound; every scenario title is carried. Written against the requirement as
> `folder-contact-sheets` archived it 2026-08-31.

## MODIFIED Requirements

### Requirement: Folder tiles preview their contents
A directory tile SHALL show up to four thumbnails of models found within it, arranged as a contact sheet, with the directory's name beneath. The models SHALL be chosen from the index first, where it is ready and covers the location: the index is asked for the models it holds under the directory — no filesystem walk — and the sheet is the first posed ones in the index's deterministic order, unposed indexed ones filling remaining cells; each such path is confined exactly as a search hit is. When that answer names fewer models than the sheet holds, the remaining cells SHALL be filled from the walk's finds, deduplicated by path, so a sheet is never emptier than the walk alone would have made it. Only when that answer is empty, or the index is silent, SHALL the models be chosen entirely by a bounded, deterministic walk of the directory — at each level its models in sorted order before its subdirectories in sorted order, descending in that order — preferring models the index holds an orientation for: the walk runs to its entry bound, one bounded request to the index decides which finds are posed, and the sheet is the posed finds in walk order, models found without a pose filling the remaining cells in walk order. Posedness comes from the index in one bounded request over the walk's finds; when the index is absent, warming, or does not cover the location, the selection is the walk's first four models exactly as before, so the preview never waits on the index. The same directory with the same index answer previews the same models on every visit and on every machine. The walk SHALL examine no more than a fixed number of entries, counting every entry it stats at any level, so a single wide directory is bounded too, and SHALL take a level's entries in code-point name order before counting — not a locale collation — so that the bound cuts the same entries on every machine; a directory that exhausts that bound before four posed models are found SHALL preview the posed ones found, filled out with unposed finds in walk order. A peek is its own request: never served from or merged into a recursive listing, and — being bounded — run to completion rather than stopped when its tile has scrolled away. A peek SHALL be confined exactly as a listing is: an entry that resolves outside the library is neither previewed nor descended into. The preview SHALL be requested per tile, when the tile is on screen, through a server endpoint that returns the previewed models as ordinary listing entries; a directory listing SHALL NOT compute previews. Preview thumbnails SHALL be produced, cached and refreshed exactly as a model tile's thumbnail is, sharing an entry with the same model wherever it appears. A directory with no previewable models, an unreadable directory, a tile whose preview has not yet answered, or a tile whose preview request failed SHALL show its own icon — for a directory that icon is the folder chrome, drawn whether or not a preview has landed, so a landing preview fills it rather than replacing a different resting icon; fewer than four previews SHALL fill the sheet without empty cells. Zip tiles SHALL NOT be previewed.

#### Scenario: A kit shows its parts
- **WHEN** a directory containing several models is on screen as a tile
- **THEN** the tile shows thumbnails of four of its models as a 2×2 sheet — the first four posed ones in name order where the index answers, its first four in name order where it does not — and its name

#### Scenario: A folder of folders shows its first kit
- **WHEN** a directory whose own level holds only subdirectories is on screen as a tile
- **THEN** the tile shows the first four models found by descending its subdirectories in order

#### Scenario: Fewer than four
- **WHEN** a directory holds one, two or three models and nothing below them
- **THEN** the tile shows that many thumbnails filling the sheet, with no empty cells

#### Scenario: Nothing to preview
- **WHEN** a directory holds no models within the walk's bound, or cannot be read, or is an archive
- **THEN** the tile shows its own icon — the directory icon for a directory, the archive icon for an archive

#### Scenario: A failed peek shows the icon
- **WHEN** a tile's preview request fails — the library not ready, or a network error
- **THEN** the tile shows its own icon and the rest of the grid is unaffected

#### Scenario: The listing is not slower for it
- **WHEN** a directory of many subdirectories is listed
- **THEN** the listing request does no preview work, and previews are requested only for tiles that come on screen

#### Scenario: A preview is an ordinary thumbnail
- **WHEN** a model previewed in a folder tile is also shown as its own tile, or the occlusion preference changes, or its thumbnail is re-rendered
- **THEN** the folder tile shows the same image the model tile shows, from the same cache entry

#### Scenario: The index sees past the walk's budget
- **WHEN** a folder-of-folders tile is previewed whose first-sorted subtree would consume a walk's entry budget, while the index holds posed models deeper in the folder
- **THEN** the sheet shows posed models from anywhere under the folder, because the selection asked the index rather than walking — and a folder the index knows nothing about falls back to the walk exactly as before

#### Scenario: Determinism
- **WHEN** the same directory is previewed twice, or on two machines holding the same library, with the index answering the same poses — or not answering — in both
- **THEN** the same models are previewed in the same order
