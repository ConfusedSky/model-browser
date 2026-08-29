## MODIFIED Requirements

### Requirement: Virtual path addressing
Zip entries SHALL be addressed with the scheme `<zip-path>!/<entry-path>` (e.g. `/models/foo.zip!/parts/lid.stl`) across all APIs (listing, file bytes, thumbnails, camera state), so the rest of the system treats zip entries as ordinary paths. The `<zip-path>` half SHALL be the archive's library-relative path (see `library`), and the archive SHALL be subject to the same confinement as any other path. The scheme SHALL support at most one `!/` level: a zip nested inside a zip is listed but not enterable.

#### Scenario: Entry thumbnail cached by virtual path
- **WHEN** a thumbnail is rendered for a model inside a zip
- **THEN** it is cached under the entry's virtual path and reused on later visits

#### Scenario: Nested folder inside a zip
- **WHEN** the user navigates into a folder within a zip
- **THEN** the path bar shows the virtual path and navigation up returns through the zip hierarchy

#### Scenario: Zip inside a zip
- **WHEN** the user activates a zip entry that is itself a zip
- **THEN** the UI reports that nested zips are unsupported and the current view is unchanged

#### Scenario: An archive outside the library is unreachable
- **WHEN** a virtual path's archive half resolves outside the library
- **THEN** the request is refused like any other path outside it
