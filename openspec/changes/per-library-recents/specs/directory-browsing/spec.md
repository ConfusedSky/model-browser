## MODIFIED Requirements

### Requirement: Recent directories
The client SHALL persist recently visited library-relative directories in localStorage and
offer them as suggestions when the path bar is focused. The persisted list SHALL be scoped
to the library it was recorded under, identified by the library id the server reports, so
that a client opened against a different library offers none of the previous library's
paths — a library-relative path names a location only within the library it was recorded
in, and offering one across libraries suggests a directory that is not there. While no library id is
known the client SHALL offer no recents, rather than falling back to a shared list, and
SHALL hold a directory visited in that window and record it under the library's own list
once the id is known — the first listing may land before the library is identified, and a
directory the user actually visited is not lost to that race. Recents recorded before paths were library-relative, and
recents recorded before they were scoped to a library, SHALL NOT be offered.

#### Scenario: Revisiting a recent directory
- **WHEN** the user focuses the path bar after previously visiting directories
- **THEN** recent directories are listed as library-relative paths and selecting one navigates there

#### Scenario: Recents do not cross libraries
- **WHEN** the client is opened against a library other than the one whose directories were visited
- **THEN** none of the other library's recents are offered, and directories visited here are recorded separately from them

#### Scenario: A directory visited before the library is identified
- **WHEN** a directory listing lands before the client knows which library it is browsing
- **THEN** that directory is recorded under that library's recents once its identity is known

#### Scenario: Old recents are not offered
- **WHEN** the app first runs with a library after recents were stored as filesystem paths, or after they were stored unscoped
- **THEN** those recents are not offered and the list starts empty
