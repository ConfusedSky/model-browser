# listing-cache Delta

## ADDED Requirements

### Requirement: Walked trees are cached across restarts
The server SHALL persist what a recursive walk discovers — entry names, kinds, sizes, and modification times, keyed by the library's identity and the walked root's library path (see `library`) — to durable storage that survives process restarts, and SHALL answer subsequent flat listings and deep searches for that root from it rather than re-walking the filesystem. The cached content SHALL be metadata only; model bytes are not cached by this capability. What is cached SHALL be the traversed tree itself, independent of any query or option applied to it, so that one cached tree serves every query and every option setting against that root; a query or option SHALL be applied over the cached tree rather than forming part of what identifies it. Only a traversal that examined the whole tree SHALL be cached: a traversal that stopped early — against a work limit or otherwise — SHALL NOT be stored, since a partial tree kept as though whole is indistinguishable from a complete one. The cache SHALL share the storage location, size budget, and maintenance sweep of the existing thumbnail cache — the per-library directory `<cache>/<library-id>/` — rather than introducing a second policy, so a snapshot follows its library to another mount point as the thumbnails do. What a listing *contains* — its entries, ordering, caps, and truncation reporting — SHALL be unchanged by whether it was served from cache or from a walk.

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
Cached content SHALL never be served once revalidation has contradicted it, and a revalidation that cannot be completed — an unreadable root — SHALL invalidate the affected cache rather than continue serving from it. A library whose volume is not present is the `missing` state `library` defines, answered before any listing is attempted; it SHALL NOT be read as a contradiction of the cache, so a snapshot survives an unmount. The cache SHALL be keyed by the library's identity, so the same library reached by a different mount point is a hit, and two libraries with the same layout never share a snapshot.

#### Scenario: An unmounted volume does not list
- **WHEN** the library's volume is disconnected and a previously cached root is requested
- **THEN** the request answers the library's `missing` state rather than a listing of files that are not present, and the snapshot is neither served nor discarded

#### Scenario: A remount keeps the snapshot
- **WHEN** the library is mounted at a different filesystem location and the root repointed to it
- **THEN** the first search after the remount is served from the snapshot cached under the library's identity

#### Scenario: A stale entry never outlives its contradiction
- **WHEN** revalidation finds an entry no longer on disk
- **THEN** it is absent from the corrected listing and is not served from cache again

### Requirement: Derived annotations ride the listing
The server SHALL attach to listing entries, at emission, the derived per-entry facts its caches already hold — a model's pose, a directory's preview choice (the entries its contact sheet shows), and a model's thumbnail state (cached, stale, or absent, with the cached image's write generation) — as additive fields resolved by key lookup alone. Emission SHALL NOT wait on the semantic index or any other service: a fact the caches cannot answer is simply absent from that entry, and a library with no derived-layer content SHALL emit listings byte-identical to one where these layers do not exist. What the client does with an absent fact — asking the index directly, rendering without it — is unchanged by this capability.

#### Scenario: A revisit is one request
- **WHEN** a root whose entries' poses and thumbnail states are already cached is listed again
- **THEN** the response carries them inline and the client needs no per-entry or per-listing follow-up for what the caches knew

#### Scenario: The index being down does not slow a listing
- **WHEN** the semantic index is absent, warming, or wedged
- **THEN** listings emit at full speed, carrying whatever annotations the layers already held and omitting the rest

#### Scenario: No layers, byte-identical
- **WHEN** a library has no cached poses, preview choices, or thumbnails
- **THEN** every listing is byte-identical to one emitted before this capability existed

### Requirement: Derived layers live beside the tree and die with their sources
Derived layers SHALL be stored beside the tree snapshot, never as fields within it: the snapshot remains a function of the walked root alone. Each layer entry SHALL record the identity of what it was derived from — pose and preview-choice entries the index generation and pose version they were computed under, thumbnail state the thumbnail store's own record — and SHALL NOT be served once that identity has moved. Because a preview choice depends on a directory's subtree while directory freshness signals do not propagate upward, a detected change in any directory SHALL re-derive the preview choices of that directory and of each of its ancestors.

#### Scenario: An index rebuild invalidates poses, not the tree
- **WHEN** the semantic index is rebuilt under a new generation
- **THEN** cached poses and preview choices stop being served while the tree snapshot continues to serve listings

#### Scenario: A deep change re-derives its ancestors' previews
- **WHEN** revalidation finds a directory changed several levels below the root
- **THEN** preview choices are re-derived for that directory and every directory above it, and an unchanged sibling branch keeps its cached choices

### Requirement: A persisted snapshot is revalidated at startup
When a library resolves ready and a snapshot exists for it, the server SHALL begin the incremental revalidation pass at once rather than waiting for the first request. Startup SHALL NOT walk a root that has no snapshot, and SHALL NOT full-walk one that does: the pass is the same per-directory freshness check revalidation always uses.

#### Scenario: Changes made while the app was closed
- **WHEN** entries were added to the library while the server was down and the app is then started
- **THEN** revalidation is already underway at the first listing, which either reflects the change or converges to it without the user asking

#### Scenario: No snapshot, no startup cost
- **WHEN** the server starts against a library that has never been walked
- **THEN** startup does not walk it, and the first request pays the walk as it does today

### Requirement: Freshness on demand
The server SHALL expose an explicit reload operation that runs the incremental revalidation immediately for the library and reports what it found. A reload SHALL use the same per-directory check as routine revalidation — never a full re-walk — and a listing requested after a completed reload SHALL reflect what the reload discovered.

#### Scenario: The user edited the library elsewhere
- **WHEN** files were moved on disk outside the app and the user triggers a reload
- **THEN** the next listing reflects the change without a restart, and the reload's answer says whether anything moved
