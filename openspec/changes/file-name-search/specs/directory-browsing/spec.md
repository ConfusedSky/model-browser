# directory-browsing Delta

## MODIFIED Requirements

### Requirement: Recursive flat listing
The server SHALL support a flat variant of the directory listing, requested by an explicit query flag; any other value of that flag, or its absence, SHALL yield the ordinary nested listing — except that a request carrying a file-search query without the flat flag SHALL be rejected rather than silently ignored (see the file-search capability). A flat listing SHALL return the requested root's immediate subdirectory and zip entries (top level only — deeper folders are not listed as tiles) followed by every model file recursively under the root — all of them when no file-search query narrows the walk; only matching ones when one does — the models ordered by **file name** with ties broken by the full relative path. The walk SHALL descend into subdirectories and into zip files' contents (one archive level; nested zip *file entries* are skipped, while a directory inside an archive whose name ends in `.zip` is walked normally), and SHALL skip hidden (dot-prefixed) directories and unreadable subdirectories without failing the request.

The walk SHALL enter each real directory at most once, keyed by its resolved real path. Symlink cycles therefore terminate, and a directory reachable by several routes SHALL contribute its models once — under the first route walked — rather than once per route; consequently a flat listing is not required to include models that nested browsing shows under an aliased route.

Each model entry's virtual path SHALL be identical to the path a nested browse would yield, so thumbnails and camera state are shared between the two views, and each model entry's name SHALL be its path relative to the requested root. When the requested root is a zip or a directory inside one, the same rules SHALL apply within the archive: its immediate directories are the container entries, every model under the prefix is listed with names relative to that prefix, and no further descent is attempted.

The walk SHALL be bounded by a hard budget on the work it does, charged once per directory entry examined — every filesystem entry and every archive entry the walk inspects, whether or not it is kept — independent of the cap on the number of models returned. A malformed or non-positive configured limit SHALL fall back to its default rather than disable the bound. Because the ordering is by file name rather than by walk order, the returned models SHALL be the cap's worth taken from the sorted result rather than the first ones encountered. A response SHALL carry an explicit truncation flag whenever any model was dropped, whether by the cap or by the budget.

#### Scenario: Models across subfolders in one listing
- **WHEN** the client requests a flat listing of a folder containing models nested several directories deep
- **THEN** all of them are returned as model entries named by their relative paths and ordered by file name, preceded by the folder's immediate subdirectory and zip entries — and no deeper directories appear as entries

#### Scenario: Same-named parts sort together
- **WHEN** a flat-listed folder contains `a/bracket.stl` and `z/bracket.stl`
- **THEN** the two entries are adjacent in the listing, ordered by file name rather than by containing folder

#### Scenario: Flag must be explicit
- **WHEN** the listing is requested without the flat flag, or with a value that does not enable it, and no file-search query accompanies it
- **THEN** the ordinary single-level nested listing is returned

#### Scenario: Zip contents included
- **WHEN** a flat-listed folder contains a zip with model entries
- **THEN** those models appear in the listing under their `zip!/entry` virtual paths, and any zip *file* nested inside the archive is skipped while a directory named `*.zip` inside it is walked normally

#### Scenario: Flat listing rooted inside a zip
- **WHEN** the client requests a flat listing of a zip, or of a directory inside one
- **THEN** the response contains that prefix's immediate directories as entries plus every model beneath the prefix, named relative to the prefix, with no attempt to descend into a further archive

#### Scenario: Symlink cycle
- **WHEN** a flat-listed folder contains a symlink cycle among its subdirectories
- **THEN** the request completes, listing each real directory's models once

#### Scenario: Aliased directory is listed once
- **WHEN** a flat-listed folder contains a subdirectory and a symlink to that same subdirectory
- **THEN** its models appear once, under the route walked first, and are not duplicated under the alias

#### Scenario: Oversized tree is truncated
- **WHEN** a flat-listed folder contains more models than the cap
- **THEN** the response contains the cap's worth of entries — the first of them in file-name order — and is flagged truncated

#### Scenario: Model-sparse giant tree stops at the budget
- **WHEN** a flat-listed folder contains far more directories than the walk budget allows, holding too few models to reach the model cap
- **THEN** the walk stops when the budget is exhausted, the request completes, and the response is flagged truncated

#### Scenario: Entries that are examined but not kept still cost budget
- **WHEN** a flat-listed folder holds a subdirectory of many files that are neither models nor directories
- **THEN** examining them consumes the walk budget, so the request stays bounded and reports truncation rather than scanning them all for free
