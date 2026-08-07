# directory-browsing Delta

## ADDED Requirements

### Requirement: Recursive flat listing
The server SHALL support a flat variant of the directory listing, requested by an explicit query flag; any other value of that flag, or its absence, SHALL yield the ordinary nested listing. A flat listing SHALL return the requested root's immediate subdirectory and zip entries (top level only — deeper folders are not listed as tiles) followed by every model file recursively under the root, the models ordered by **file name** with ties broken by the full relative path. The walk SHALL descend into subdirectories and into zip files' contents (one archive level; nested zip *file entries* are skipped, while a directory inside an archive whose name ends in `.zip` is walked normally), and SHALL skip hidden (dot-prefixed) directories and unreadable subdirectories without failing the request.

The walk SHALL enter each real directory at most once, keyed by its resolved real path. Symlink cycles therefore terminate, and a directory reachable by several routes SHALL contribute its models once — under the first route walked — rather than once per route; consequently a flat listing is not required to include models that nested browsing shows under an aliased route.

Each model entry's virtual path SHALL be identical to the path a nested browse would yield, so thumbnails and camera state are shared between the two views, and each model entry's name SHALL be its path relative to the requested root. When the requested root is a zip or a directory inside one, the same rules SHALL apply within the archive: its immediate directories are the container entries, every model under the prefix is listed with names relative to that prefix, and no further descent is attempted.

The walk SHALL be bounded by a hard budget on the work it does — entering a directory and scanning a model each counting against one budget — independent of the cap on the number of models returned. Because the ordering is by file name rather than by walk order, the returned models SHALL be the cap's worth taken from the sorted result rather than the first ones encountered. A response SHALL carry an explicit truncation flag whenever any model was dropped, whether by the cap or by the budget.

#### Scenario: Models across subfolders in one listing
- **WHEN** the client requests a flat listing of a folder containing models nested several directories deep
- **THEN** all of them are returned as model entries named by their relative paths and ordered by file name, preceded by the folder's immediate subdirectory and zip entries — and no deeper directories appear as entries

#### Scenario: Same-named parts sort together
- **WHEN** a flat-listed folder contains `a/bracket.stl` and `z/bracket.stl`
- **THEN** the two entries are adjacent in the listing, ordered by file name rather than by containing folder

#### Scenario: Flag must be explicit
- **WHEN** the listing is requested without the flat flag, or with a value that does not enable it
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

### Requirement: Flat view toggle
The client SHALL offer a flat-view toggle alongside the path bar. While active, the grid SHALL show the current folder's flat listing — the top-level folder and zip tiles first, navigable exactly as in the nested view, then model tiles labeled by relative path — and hover-warm, drag-to-orbit, the lightbox, and thumbnail/camera persistence SHALL behave exactly as in the nested view for the same models. The toggle SHALL remain in effect across navigation within the session, including navigation into a zip, and a truncated listing SHALL be indicated to the user.

#### Scenario: Toggling flat view
- **WHEN** the user activates the flat toggle on a folder with nested models
- **THEN** the grid re-renders showing the folder's top-level containers followed by all models recursively with relative-path labels, and deactivating it restores the nested view

#### Scenario: Navigating down while flat
- **WHEN** flat view is active and the user clicks one of the top-level folder tiles
- **THEN** the grid shows that folder's flat listing (its own top-level containers and recursive models)

#### Scenario: Entering a zip while flat
- **WHEN** flat view is active and the user clicks a zip tile
- **THEN** the grid shows the archive's flat listing rather than falling back to a nested one

#### Scenario: Orbiting from the flat view
- **WHEN** the user orbits a model tile in flat view and later browses to its containing folder in nested view
- **THEN** the saved orientation and thumbnail are the ones persisted from the flat view

#### Scenario: Flat mode follows navigation
- **WHEN** flat view is active and the user navigates to another folder
- **THEN** the new folder is also shown flat until the toggle is turned off

#### Scenario: Truncation is visible
- **WHEN** a flat listing comes back flagged as truncated
- **THEN** the UI states that the listing is incomplete, reporting the number of models actually shown rather than a fixed cap
