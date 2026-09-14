## MODIFIED Requirements

### Requirement: Walked trees are cached across restarts
The server SHALL persist what a recursive walk discovers — entry names, kinds, sizes, and modification times, keyed by the library's identity and the walked root's library path (see `library`) — to durable storage that survives process restarts, and SHALL answer subsequent flat listings and deep searches for that root from it rather than re-walking the filesystem. The cached content SHALL be metadata only; model bytes are not cached by this capability. What is cached SHALL be the traversed tree itself, independent of any query or option applied to it, so that one cached tree serves every query and every option setting against that root; a query or option SHALL be applied over the cached tree rather than forming part of what identifies it. Only a traversal that examined the whole tree SHALL be cached: a traversal that stopped early — against a work limit or otherwise — SHALL NOT be stored, since a partial tree kept as though whole is indistinguishable from a complete one. The cache SHALL live inside the existing thumbnail cache's per-library directory — `<cache>/<library-id>/` — and SHALL be bounded and swept under the same policy shape (one validated size knob, never silently unbounded; oldest-first eviction) with a bound of its own rather than a share of the thumbnail pool: metadata is three orders of magnitude smaller than pixels, and a shared pool would let thumbnail churn evict the snapshot that exists to avoid a thirty-second cold walk to reclaim a fraction of a percent of the cap. One location, one policy shape, separate bounds (the archived change's design D2 records why a literal shared sweep was destructive); a snapshot follows its library to another mount point as the thumbnails do. What a listing *contains* — its entries, ordering, caps, and truncation reporting — SHALL be unchanged by whether it was served from cache or from a walk, with two deliberate asymmetries: a complete snapshot serves the whole stored tree where a fresh browse walk would have exhausted its work budget — the budget bounds traversal work, never stored answers, the same stance the scope enumeration takes — and a file overwritten in place is served at the modification time and size the last completed revalidation confirmed, which may be the walk's own until the next pass: the pass sees an overwrite that moved the file's modification time or size within one revalidation interval (see *An entry overwritten in place is seen by the pass*), and a reload sees it at once. The one overwrite no pass can see is one that preserved both modification time and size, which the uncached folder view and the thumbnail cache cannot see either — that blindness is the app's, not the snapshot's, and the snapshot is never blinder than the folder view. A listing served from the snapshot SHALL be built from copies of the cached entries, never the cached objects themselves: per-request annotation mutates emitted entries in place (`applyDisplayNames` is the precedent), and handing out the snapshot's own objects would bake one request's annotations into every later answer.

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

### Requirement: Revalidation is proportional to tree shape
The server SHALL detect changes by examining each recorded directory's modification time, each recorded archive's identity, and each recorded model entry's modification time and size, and SHALL re-read only the directories where one of those has moved or where a recorded entry can no longer be examined. A directory whose recorded state is confirmed SHALL NOT be read, and an archive whose identity is unchanged SHALL NOT be opened. A full re-walk SHALL NOT be performed as the routine freshness check. The examinations SHALL be charged to the same work bound a walk is charged to, one per entry examined, so that a tree which fit the bound when walked fits it when revalidated and a tree that has outgrown it is reported rather than served.

#### Scenario: An unchanged tree revalidates cheaply
- **WHEN** a cached root is revalidated and nothing beneath it has changed
- **THEN** the check costs, beyond what confirming the directories and the archives already costs, one examination per recorded model entry outside an archive — an archive's own entry is confirmed by the examination its identity check already makes — no directory is read, no archive is opened, and the stored entries and directory records are unchanged

#### Scenario: A changed folder is picked up
- **WHEN** models are added to, removed from, or renamed within a folder and that root is listed again after the revalidation cadence
- **THEN** the listing reflects the change without the user clearing a cache or restarting the app — validation is time-bounded, never once-per-process

### Requirement: Freshness on demand
The server SHALL expose an explicit reload operation that runs the incremental revalidation immediately for the library and reports what it found. A reload SHALL use the same incremental check as routine revalidation — the per-directory, per-archive and per-model-entry examination, never a full re-walk — and a listing requested after a completed reload SHALL reflect what the reload discovered, an entry overwritten in place included.

#### Scenario: The user edited the library elsewhere
- **WHEN** files were moved on disk outside the app and the user triggers a reload
- **THEN** the next listing reflects the change without a restart, and the reload's answer says whether anything moved

#### Scenario: A model re-exported over its own name is healed by a reload
- **WHEN** a model file was rewritten in place outside the app, its modification time or size moved, and the user triggers a reload
- **THEN** the reload reports that something moved, and the next flat listing or search carries the file's current modification time and size

## ADDED Requirements

### Requirement: An entry overwritten in place is seen by the pass
When revalidation finds a recorded directory's modification time unchanged, it SHALL still examine each recorded model entry in that directory — its modification time and size, following a symbolic link as the walk did — before reusing the recorded level. A recorded entry whose modification time or size has moved, or that can no longer be examined (a link whose target moved or vanished, an entry gone within the directory's modification-time granule), SHALL cause that directory to be re-read as a changed directory is, and SHALL count as a detected change in that directory for every consequence a detected change has: the corrected entry is stored in the snapshot and persisted to durable storage before the pass reports, so that a restart serves the corrected value; the directory's derived preview choice and its ancestors' are re-derived; and every later listing served from the snapshot carries the corrected modification time and size, so that the thumbnail state attached to the entry and the thumbnail the client requests follow the current file rather than the overwritten one. Directories in a reused level are covered by their own visit and SHALL NOT be examined twice. An archive's own entry SHALL be corrected from the examination its identity check already makes — no further examination per archive — and an archive whose modification time moved SHALL count as a detected change in its directory for the preview consequence above, without the directory being re-read; entries inside an archive are covered by the archive's own identity and SHALL NOT be examined individually. An overwrite that preserved both modification time and size is outside what this examination can see, and SHALL be documented as such rather than claimed.

#### Scenario: A re-exported model reaches the flat listing within an interval
- **WHEN** a model file is rewritten in place so that its modification time or size moves, nothing in its directory is renamed, and the revalidation pass next runs
- **THEN** the flat listing and the search served from the snapshot carry the file's current modification time and size, and the entry's thumbnail state reports the previous render as stale rather than current

#### Scenario: The corrected entry survives a restart
- **WHEN** a pass has corrected an overwritten entry and the server is then restarted
- **THEN** the first listing served from the persisted snapshot carries the corrected modification time and size

#### Scenario: The folder's contact sheet is re-derived
- **WHEN** a folder's preview choice was recorded before one of its models was rewritten in place, and the pass then finds the entry moved
- **THEN** that folder's preview choice and each of its ancestors' are re-derived, so no sheet cell carries the overwritten file's stamp, while an unchanged sibling folder keeps its choice

#### Scenario: An entry gone within the directory's mtime granule
- **WHEN** a recorded entry is removed and its directory's modification time reads unchanged — whether the entry was a file deleted inside the granule or a symbolic link whose target is gone
- **THEN** the pass re-reads that directory and the entry is absent from the corrected listing

#### Scenario: A rewritten archive's own tile carries its new stamp
- **WHEN** an archive is rewritten in place so that its modification time moves and nothing in its directory is renamed
- **THEN** after the pass the archive's own entry and its interior entries agree on the current modification time, the archive was examined no more times than an unchanged pass examines it, and the directory's preview choice is re-derived

#### Scenario: An unchanged tree is stored byte-identically
- **WHEN** the pass runs over a tree in which no entry's modification time or size has moved
- **THEN** the entries and the directory records the pass stores are identical to the ones it loaded — the pass's own timestamp is the one field it always rewrites

#### Scenario: The documented blindness
- **WHEN** a file is overwritten in place by a method that preserves its modification time and size
- **THEN** the pass, the reload, the folder view and the thumbnail cache all continue to treat the file as unchanged, and the capability says so rather than claiming otherwise

### Requirement: The tree cache can be switched off
The listing tree cache SHALL be switchable off by the deployment's configuration — a key in the configuration file, overridable by an environment variable named for it (see `public-deployment`) — and SHALL default to on. With the cache off, every flat listing and deep search SHALL traverse the filesystem as a request did before the cache existed: no snapshot is read or written, no listing carries a staleness marker, no revalidation runs at startup or on a cadence, and a reload reports no cached roots. The switch is a testing affordance and SHALL NOT be the way freshness is obtained in ordinary use. Off also disables the archive-directory cache, which lives in the same store: browsing or peeking a folder of archives with the cache off re-reads each archive's central directory on every request. The derived layers and the thumbnail cache are untouched by the switch.

#### Scenario: Off means every request walks
- **WHEN** the cache is switched off and a flat listing is requested twice for a root that was walked before the switch
- **THEN** both requests traverse the filesystem, neither is marked as served from a cache, no snapshot is written, and an archive met on the way is read on both requests

#### Scenario: A reload with the cache off
- **WHEN** the cache is switched off and a reload is requested
- **THEN** the reload reports zero cached roots and nothing moved, and the derived layers are still dropped

#### Scenario: On by default
- **WHEN** neither the configuration file nor the environment says anything about the cache
- **THEN** the cache is on, exactly as before the switch existed
