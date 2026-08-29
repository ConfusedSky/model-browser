## ADDED Requirements

### Requirement: A library is a tree with an identity
A library SHALL be a directory tree whose top is marked by `.model-browser/library.json` carrying a generated identifier. The server SHALL locate the library by walking upward from the configured root until a marker is found; the first marker found SHALL define the library, and the root SHALL be a location inside it. When no marker exists at or above the root, the root SHALL become a new library and the marker SHALL be written there. The marker directory SHALL be the home of every file this app keeps inside a library, and listings SHALL never show it.

#### Scenario: A subfolder of a library is picked as the root
- **WHEN** the root is set to a folder beneath an existing marker
- **THEN** the library is the marked tree, its identifier is unchanged, and the app opens at the chosen folder

#### Scenario: A folder with no marker above it becomes a library
- **WHEN** the root is set to a folder with no marker at or above it
- **THEN** a marker with a fresh identifier is written at that folder and it is the library's top

#### Scenario: The marker is invisible
- **WHEN** the library's top is listed
- **THEN** the `.model-browser` directory does not appear among its entries

### Requirement: Every path is relative to the library
Every path the server accepts or emits — listings, file bytes, thumbnails, camera state, completion, and the `<zip-path>` half of a virtual path — SHALL be the path relative to the library's top, written with a leading slash, so that the library's top is `/`. A path that does not begin with `/` SHALL be refused. The same string SHALL name the same file wherever the library is mounted and on whichever machine holds it.

#### Scenario: A remount changes nothing
- **WHEN** the library is mounted at a different filesystem location and the root is repointed to it
- **THEN** every listing, thumbnail, camera state and deep link that worked before resolves unchanged

#### Scenario: A filesystem path is refused
- **WHEN** a request names a path that does not begin with `/`, or names the library by its filesystem location
- **THEN** the request is refused with an error and no listing, file bytes or cache write occurs

### Requirement: Nothing outside the library is reachable
Every filesystem location the server derives from a request path SHALL resolve, through symlinks, to the library's top or a location beneath it, or the request SHALL be refused without naming any filesystem detail. `..` components SHALL be normalised before resolution and SHALL NOT escape. A directory reached during a recursive walk that resolves outside the library SHALL be skipped rather than listed.

#### Scenario: Dot-dot cannot escape
- **WHEN** a request path contains `..` components that would resolve above the library's top
- **THEN** the request is refused and nothing outside the library is read

#### Scenario: A symlink out of the library is refused
- **WHEN** a path inside the library is a symlink whose target lies outside it
- **THEN** listing it, fetching it or thumbnailing it is refused, and a recursive walk skips it

#### Scenario: A symlink within the library is followed
- **WHEN** a path inside the library is a symlink whose target also lies inside it
- **THEN** it is listed and served like any other entry

### Requirement: The root is configured, and its absence is a state
The root SHALL be read from the `MODEL_BROWSER_ROOT` environment variable, else from `root` in the app's configuration file (`~/.config/model-browser/config.json`, location overridable by `MODEL_BROWSER_CONFIG`), at server start. The server SHALL start whether or not a root is configured. The library's state SHALL be reported on request as one of: `ready` (identifier, top and root known), `unconfigured` (no root given), `missing` (the configured root is not present or is not a directory), or `unmarked` (no marker exists above the root and one could not be written; the identifier falls back to a hash of the root's resolved location and the library behaves as though its location were its identity). While the state is `unconfigured` or `missing`, every path route SHALL answer with that state rather than with an empty listing, and the UI SHALL show it — naming the configured root when it is missing, since mounting it is the remedy.

#### Scenario: No root configured
- **WHEN** the server starts with neither the environment variable nor a configured root
- **THEN** it serves, reports `unconfigured`, and the UI says a root must be set instead of showing an empty grid

#### Scenario: The volume is not mounted
- **WHEN** the configured root does not exist when a listing is requested
- **THEN** the response reports `missing` with the configured root, and the UI shows that the library at that location is not present

#### Scenario: A read-only library
- **WHEN** no marker exists above the root and the marker cannot be written
- **THEN** the library is served under a location-derived identifier and the state reports `unmarked`

#### Scenario: The environment overrides the file
- **WHEN** both `MODEL_BROWSER_ROOT` and a configured `root` are present
- **THEN** the environment variable is the root
