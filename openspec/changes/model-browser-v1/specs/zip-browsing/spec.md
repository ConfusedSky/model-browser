## ADDED Requirements

### Requirement: Zip listed as virtual folder
Activating a zip tile SHALL navigate into it like a directory. The server SHALL list zip contents by reading only the zip central directory, decompressing nothing, and writing nothing into the browsed directory.

#### Scenario: Entering a zip
- **WHEN** the user clicks a zip tile
- **THEN** the grid shows the zip's internal folders and model files without any extraction to disk

#### Scenario: Browsed directory untouched
- **WHEN** the user browses into a zip and views thumbnails
- **THEN** no new files appear in the directory containing the zip

#### Scenario: Corrupt zip
- **WHEN** a zip's central directory cannot be read
- **THEN** the server returns an error and the UI surfaces it without crashing

### Requirement: Virtual path addressing
Zip entries SHALL be addressed with the scheme `<zip-path>!/<entry-path>` (e.g. `models/foo.zip!/parts/lid.stl`) across all APIs (listing, file bytes, thumbnails, camera state), so the rest of the system treats zip entries as ordinary paths.

#### Scenario: Entry thumbnail cached by virtual path
- **WHEN** a thumbnail is rendered for a model inside a zip
- **THEN** it is cached under the entry's virtual path and reused on later visits

#### Scenario: Nested folder inside a zip
- **WHEN** the user navigates into a folder within a zip
- **THEN** the path bar shows the virtual path and navigation up returns through the zip hierarchy

### Requirement: On-demand entry decompression
The server SHALL decompress an individual zip entry only when its bytes are requested, and SHALL NOT persist decompressed model bytes; the persisted thumbnail is the durable artifact.

#### Scenario: Revisiting a zip with cached thumbnails
- **WHEN** the user re-enters a zip whose entries' thumbnails are cached and the zip is unchanged
- **THEN** thumbnails load from cache and no entries are decompressed
