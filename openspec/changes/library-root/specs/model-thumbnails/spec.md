## MODIFIED Requirements

### Requirement: Server-side thumbnail persistence
The server SHALL persist rendered thumbnails keyed by `path + mtime`, where the path is library-relative (see `library`), in a cache directory per library — named by the library's identifier, outside the browsed directories — so that a library keeps its cache wherever it is mounted and two libraries with the same layout never share an entry. For zip entries the mtime in the key SHALL be the containing zip's (see `zip-browsing`). The client SHALL upload each rendered PNG, and on later visits SHALL receive cached thumbnails without reloading meshes. A changed mtime SHALL invalidate the cached thumbnail. Entries written before paths were library-relative SHALL be migrated once, on the first start under the library, to their library-relative keys — cameras, axes and PNGs intact — when their recorded location lies within the library; entries recorded elsewhere SHALL be left where they are.

#### Scenario: Second visit is instant
- **WHEN** the user reopens a directory whose thumbnails were previously rendered and files are unchanged
- **THEN** all thumbnails load from the server cache with no mesh downloads or rendering

#### Scenario: Modified file re-renders
- **WHEN** a model file's mtime changes after its thumbnail was cached
- **THEN** the cached thumbnail is treated as stale and the client re-renders and re-uploads it

#### Scenario: A remount keeps the cache
- **WHEN** the library is mounted at a different location and the root repointed to it
- **THEN** every cached thumbnail and camera is served exactly as before

#### Scenario: Two libraries do not share a cache
- **WHEN** two libraries hold a model at the same library-relative path with the same mtime
- **THEN** each is served its own thumbnail and camera, never the other's

#### Scenario: Legacy entries are migrated with their cameras
- **WHEN** the server first starts under a library and the cache holds entries keyed by filesystem paths within it
- **THEN** those entries are served under their library-relative keys, a model that had a saved orientation opens with it, and nothing re-renders

### Requirement: Bounded, self-maintaining cache
The thumbnail cache SHALL NOT grow without bound. Superseded thumbnails (an older mtime for the same path) SHALL be deleted, entries whose source path no longer exists within the library SHALL be swept — for a virtual path, existence SHALL be tested against the containing zip rather than the entry — and when total cache size exceeds a configurable cap (default 2GB) least-recently-read thumbnails SHALL be evicted. Camera state and the orbit axis SHALL survive size-cap eviction of their thumbnail (they are tiny and cannot be regenerated), but the existence sweep SHALL remove the entire entry — camera state and axis included — when the source path no longer exists. Entries SHALL be stored under a hash of the library-relative path rather than the path itself, since paths contain `/`, `!`, and spaces and may exceed filename length limits. The sweep SHALL NOT run while the library is `missing`: an unmounted volume is not a deleted library.

#### Scenario: Repeated edits do not accumulate
- **WHEN** a model file is modified several times, each modification generating a new thumbnail
- **THEN** only the current thumbnail is retained and superseded ones are deleted

#### Scenario: Deleted models are swept
- **WHEN** the cache is swept and a cached entry's source file no longer exists
- **THEN** that entry is removed from the cache

#### Scenario: Camera state survives thumbnail eviction
- **WHEN** a thumbnail is evicted by the size cap and the user later revisits its directory
- **THEN** it is re-rendered from the still-stored camera state, not from the default view

#### Scenario: Axis survives thumbnail eviction
- **WHEN** a thumbnail is evicted by the size cap for a model with an overridden axis
- **THEN** the axis remains stored and the re-rendered thumbnail uses the overridden spindle

#### Scenario: Sweep removes camera state with the entry
- **WHEN** a model file is deleted and the cache is swept
- **THEN** the entire cache entry — camera state and axis included — is removed; a file later appearing at that path gets the default view and axis

#### Scenario: An unmounted library is not swept
- **WHEN** maintenance is due while the library's volume is not mounted
- **THEN** no entry is removed, and the sweep runs once the library is present again
