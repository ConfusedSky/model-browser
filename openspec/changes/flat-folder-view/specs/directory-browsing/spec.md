# directory-browsing Delta

## ADDED Requirements

### Requirement: Recursive flat listing
The server SHALL support a flat variant of the directory listing that returns every model file recursively under the requested folder as model entries only — no directory or zip tiles. The walk SHALL descend into subdirectories and into zip files' contents (one archive level; nested zips are skipped), SHALL skip hidden (dot-prefixed) directories and unreadable subdirectories without failing the request, and SHALL terminate on symlink cycles by never entering the same real directory twice. Each entry's virtual path SHALL be identical to the path a nested browse would yield (so thumbnails and camera state are shared), and each entry's name SHALL be its path relative to the requested root. Results SHALL be capped (500 models); a capped response SHALL carry an explicit truncation flag.

#### Scenario: Models across subfolders in one listing
- **WHEN** the client requests a flat listing of a folder containing models nested several directories deep
- **THEN** all of them are returned as model entries named by their relative paths, with no directory entries

#### Scenario: Zip contents included
- **WHEN** a flat-listed folder contains a zip with model entries
- **THEN** those models appear in the listing under their `zip!/entry` virtual paths, and any zip nested inside the archive is skipped

#### Scenario: Symlink cycle
- **WHEN** a flat-listed folder contains a symlink cycle among its subdirectories
- **THEN** the request completes, listing each real directory's models once

#### Scenario: Oversized tree is truncated
- **WHEN** a flat-listed folder contains more models than the cap
- **THEN** the response contains the cap's worth of entries and is flagged truncated

### Requirement: Flat view toggle
The client SHALL offer a flat-view toggle alongside the path bar. While active, the grid SHALL show the current folder's flat listing — model tiles labeled by relative path — and hover-warm, drag-to-orbit, the lightbox, and thumbnail/camera persistence SHALL behave exactly as in the nested view for the same models. The toggle SHALL remain in effect across navigation within the session, and a truncated listing SHALL be indicated to the user.

#### Scenario: Toggling flat view
- **WHEN** the user activates the flat toggle on a folder with nested models
- **THEN** the grid re-renders showing all models recursively with relative-path labels, and deactivating it restores the nested view

#### Scenario: Orbiting from the flat view
- **WHEN** the user orbits a model tile in flat view and later browses to its containing folder in nested view
- **THEN** the saved orientation and thumbnail are the ones persisted from the flat view

#### Scenario: Flat mode follows navigation
- **WHEN** flat view is active and the user navigates to another folder
- **THEN** the new folder is also shown flat until the toggle is turned off

#### Scenario: Truncation is visible
- **WHEN** a flat listing comes back flagged as truncated
- **THEN** the UI states that only the first N models are shown
