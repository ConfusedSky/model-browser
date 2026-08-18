# listing-cache Delta

## ADDED Requirements

### Requirement: Walked trees are cached across restarts
The server SHALL persist what a recursive walk discovers — entry names, kinds, sizes, and modification times, keyed by the walked root — to durable storage that survives process restarts, and SHALL answer subsequent flat listings and deep searches for that root from it rather than re-walking the filesystem. The cached content SHALL be metadata only; model bytes are not cached by this capability. What is cached SHALL be the traversed tree itself, independent of any query or option applied to it, so that one cached tree serves every query and every option setting against that root; a query or option SHALL be applied over the cached tree rather than forming part of what identifies it. Only a traversal that examined the whole tree SHALL be cached: a traversal that stopped early — against a work limit or otherwise — SHALL NOT be stored, since a partial tree kept as though whole is indistinguishable from a complete one. The cache SHALL share the storage location, size budget, and maintenance sweep of the existing thumbnail cache rather than introducing a second policy. What a listing *contains* — its entries, ordering, caps, and truncation reporting — SHALL be unchanged by whether it was served from cache or from a walk.

#### Scenario: A cold search costs what a warm one costs
- **WHEN** the user searches a large library for the first time after starting the app, having previously walked that root
- **THEN** results arrive at warm-walk speed rather than paying the cold filesystem cost again

#### Scenario: A cached listing is indistinguishable in content
- **WHEN** the same query is answered from the cache and from a full walk of an unchanged tree
- **THEN** the two responses hold the same entries in the same order with the same truncation reporting

#### Scenario: One cached tree serves every query
- **WHEN** a user searches a root, then searches it again for something else, then changes a search option
- **THEN** each answer is filtered from the one cached tree and none of them re-traverses the filesystem

#### Scenario: A partial traversal is not cached
- **WHEN** a traversal stops early against a work limit
- **THEN** nothing is cached for that root, and the next request traverses rather than inheriting a tree that was never fully examined

### Requirement: Archive directories are cached against the archive
The server SHALL cache each archive's directory listing keyed on that archive's own identity — its modification time and size — and SHALL re-read an archive's directory only when that identity changes. An archive whose identity is unchanged SHALL NOT be opened during a walk.

#### Scenario: Unchanged archives are not re-opened
- **WHEN** a walk crosses archives whose modification times are unchanged since they were last read
- **THEN** their contents come from the cache and the archives are not opened

#### Scenario: A rewritten archive is re-read
- **WHEN** an archive is modified and the tree is walked again
- **THEN** its directory is re-read and the listing reflects its new contents

### Requirement: Revalidation is proportional to tree shape
The server SHALL detect changes by checking each directory's modification time rather than by re-examining every entry, and SHALL re-read only the directories whose modification time has moved. A full re-walk SHALL NOT be performed as the routine freshness check.

#### Scenario: An unchanged tree revalidates cheaply
- **WHEN** a cached root is revalidated and nothing beneath it has changed
- **THEN** the check costs one examination per directory, not one per entry, and no archive is opened

#### Scenario: A changed folder is picked up
- **WHEN** models are added to, removed from, or renamed within a folder and that root is listed again
- **THEN** the listing reflects the change without the user clearing a cache or restarting the app

### Requirement: Age is disclosed, and staleness converges
A listing served from the cache SHALL be marked as such in the response, so the client can present results immediately while indicating they are being refreshed rather than presenting them as freshly walked. When revalidation finds the tree changed, the corrected listing SHALL reach the client without the user re-issuing the request. Revalidation SHALL use the incremental check above; it SHALL NOT re-walk the whole tree in the background.

#### Scenario: Results now, correction after
- **WHEN** a cached listing is served and revalidation then finds the tree has changed
- **THEN** the user sees results immediately, is told they are being refreshed, and the grid updates to the corrected listing on its own

#### Scenario: A fresh walk is not marked stale
- **WHEN** a listing is produced by an actual walk rather than from the cache
- **THEN** it carries no staleness marker

### Requirement: The filesystem is authoritative
Cached content SHALL never be served once revalidation has contradicted it, and a revalidation that cannot be completed — an unreadable or unmounted root — SHALL invalidate the affected cache rather than continue serving from it. The cache SHALL be keyed such that the same library reached by a different path is a miss rather than a hit.

#### Scenario: An unmounted volume does not list
- **WHEN** the library's volume is disconnected and a previously cached root is requested
- **THEN** the request fails as an unreadable path rather than returning a listing of files that are not present

#### Scenario: A stale entry never outlives its contradiction
- **WHEN** revalidation finds an entry no longer on disk
- **THEN** it is absent from the corrected listing and is not served from cache again
