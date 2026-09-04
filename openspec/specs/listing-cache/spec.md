# listing-cache Specification

## Purpose
The listing cache is what makes the first look at a library cost what the second one
does: a durable snapshot of each walked tree (and of every archive's directory) serves
flat listings and deep searches without re-walking the filesystem, revalidates by
directory mtime at a bounded cadence, and always tells the client when it is being
refreshed rather than presenting stale as fresh. On top of the snapshot ride the
derived per-entry facts — poses, contact-sheet choices, thumbnail state — attached at
emission and, when the index is ready, filled there under a budget so a first sight
arrives whole. The filesystem is always authoritative and an unhealthy index can never
slow a listing. Established by the change `listing-tree-cache` (archived 2026-09-04,
after three adversarial review rounds); the reasoning behind each requirement is in
that change's design.md (D1–D9) and the review dispositions in its tasks.md.
## Requirements
### Requirement: Walked trees are cached across restarts
The server SHALL persist what a recursive walk discovers — entry names, kinds, sizes, and modification times, keyed by the library's identity and the walked root's library path (see `library`) — to durable storage that survives process restarts, and SHALL answer subsequent flat listings and deep searches for that root from it rather than re-walking the filesystem. The cached content SHALL be metadata only; model bytes are not cached by this capability. What is cached SHALL be the traversed tree itself, independent of any query or option applied to it, so that one cached tree serves every query and every option setting against that root; a query or option SHALL be applied over the cached tree rather than forming part of what identifies it. Only a traversal that examined the whole tree SHALL be cached: a traversal that stopped early — against a work limit or otherwise — SHALL NOT be stored, since a partial tree kept as though whole is indistinguishable from a complete one. The cache SHALL live inside the existing thumbnail cache's per-library directory — `<cache>/<library-id>/` — and SHALL be bounded and swept under the same policy shape (one validated size knob, never silently unbounded; oldest-first eviction) with a bound of its own rather than a share of the thumbnail pool: metadata is three orders of magnitude smaller than pixels, and a shared pool would let thumbnail churn evict the snapshot that exists to avoid a thirty-second cold walk to reclaim a fraction of a percent of the cap. One location, one policy shape, separate bounds (the archived change's design D2 records why a literal shared sweep was destructive); a snapshot follows its library to another mount point as the thumbnails do. What a listing *contains* — its entries, ordering, caps, and truncation reporting — SHALL be unchanged by whether it was served from cache or from a walk, with two deliberate asymmetries: a complete snapshot serves the whole stored tree where a fresh browse walk would have exhausted its work budget — the budget bounds traversal work, never stored answers, the same stance the scope enumeration takes — and a file overwritten in place is served at the modification time the walk recorded, since the directory-mtime signal cannot see the overwrite (D4's stated blindness); the uncached folder view, a reload, and any name change in that directory are the heals. A listing served from the snapshot SHALL be built from copies of the cached entries, never the cached objects themselves: per-request annotation mutates emitted entries in place (`applyDisplayNames` is the precedent), and handing out the snapshot's own objects would bake one request's annotations into every later answer.

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
- **WHEN** models are added to, removed from, or renamed within a folder and that root is listed again after the revalidation cadence
- **THEN** the listing reflects the change without the user clearing a cache or restarting the app — validation is time-bounded, never once-per-process

### Requirement: Age is disclosed, and staleness converges
A listing served from the cache SHALL be marked as such in the response, so the client can present results immediately — where "immediately" is bounded by the annotation budget when a ready index is filling a first sight (a deliberate trade — whole over instant, for first sights only; the archived change's design D5 note records the pricing) — while indicating they are being refreshed rather than presenting them as freshly walked. When revalidation finds the tree changed, the corrected listing SHALL reach the client without the user re-issuing the request. Revalidation SHALL use the incremental check above; it SHALL NOT re-walk the whole tree in the background.

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
The server SHALL attach to listing entries, at emission, the derived per-entry facts its caches already hold — a model's pose, a directory's preview choice (the entries its contact sheet shows), and a model's thumbnail state (cached, stale, or absent, with the cached image's write generation) — as additive fields resolved by key lookup alone. When the index reports itself ready, emission MAY spend a bounded annotation budget filling what its layers lack — one batched pose ask for the listing's unposed models, preview derivations for its unchosen directories under a concurrency cap — so a first sight arrives whole instead of popping in through client follow-ups. Emission SHALL NOT wait beyond that budget, SHALL NOT consult an index whose memoised probe is not ready (a warming or absent index costs a listing nothing), and answers landing after the budget SHALL still be recorded in the layers so the next listing carries them. A fact neither the layers nor the budget produced is simply absent from that entry — the client's wave and peek remain the fill for exactly those. A recorded "the index has none" is a fact, not an absence: it MAY ride the wire as an explicit null pose, and a client seeing it SHALL treat the model as known-unposed rather than re-asking — the distinction that keeps a never-embedded folder from costing an ask per landing forever. Emission-time filling SHALL be single-flighted per listing path, SHALL bound the preview derivations it starts per listing (the budget bounds time; the launch bound caps work the budget cannot cancel), SHALL record the poses its derivations learn rather than discard them, and SHALL fill nothing through a layers instance that is not live — and a library with no derived-layer content and no ready index SHALL emit listings byte-identical to one where these layers do not exist. What the client does with an absent fact — asking the index directly, rendering without it — is unchanged by this capability.

#### Scenario: A revisit is one request
- **WHEN** a root whose entries' poses and thumbnail states are already cached is listed again
- **THEN** the response carries them inline and the client needs no per-entry or per-listing follow-up for what the caches knew

#### Scenario: The index being down does not slow a listing
- **WHEN** the semantic index is absent, warming, or wedged
- **THEN** the memoised probe gates emission-time filling entirely: listings emit at full speed with no index call made, carrying whatever annotations the layers already held and omitting the rest

#### Scenario: A first sight arrives whole
- **WHEN** a ready index knows poses and preview choices the layers have not yet recorded, and a listing containing those entries is emitted
- **THEN** the listing carries them, fetched within the annotation budget at emission, and the client issues no follow-up wave or peek for what arrived

#### Scenario: No layers, byte-identical
- **WHEN** a library has no cached poses, preview choices, or thumbnails, and no ready index is available to fill from
- **THEN** every listing is byte-identical to one emitted before this capability existed

### Requirement: A subtree's models are enumerable with their derived facts
The server SHALL answer, for a library path, every model beneath it — the whole subtree, archive contents included — each carrying the same derived thumbnail facts the listing annotation carries, resolved by key lookup alone, together with whether the traversal that produced the set was complete. The answer SHALL NOT be bounded by a listing's response cap: it is an enumeration, not a listing, and a scope cut to a cap would silently be a different scope. It SHALL be served from the cached tree where one exists, touching no directory or archive in that case; where none exists it SHALL traverse as a listing miss does, storing the tree only if the traversal was complete, and SHALL state incompleteness rather than refuse.

#### Scenario: A kit is enumerated from the snapshot
- **WHEN** a client asks for the models beneath a folder whose tree is cached
- **THEN** every model beneath it is answered with its thumbnail facts, none is dropped by a cap, and no directory or archive is read

#### Scenario: An incomplete traversal says so
- **WHEN** the models beneath a root with no cached tree are asked for and the traversal stops against its work limit
- **THEN** the answer carries what was found and states that it is incomplete, and nothing is cached for that root

### Requirement: Derived layers live beside the tree and die with their sources
Derived layers SHALL be stored beside the tree snapshot, never as fields within it: the snapshot remains a function of the walked root alone. Each layer entry SHALL record the identity of what it was derived from, in terms the server can itself observe: pose and preview-choice entries carry the server's layer version — a constant bumped when the derivation's meaning changes — and are dropped wholesale by the reload operation and when the index's reported collection root changes; thumbnail state carries the thumbnail store's own record, per render — presence and staleness are per occlusion variant, since the store keys renders that way. A layer entry SHALL NOT be served once its recorded identity has moved. A derived layer MAY be process-local rather than durable: with no observable index build identity to key durability on, a persisted pose could outlive a re-classification indefinitely, so outliving the process is the risky direction; the tree and archive layers alone persist, and a restart is a third drop point, not a regression (the client's wave remains the fill path). Because a preview choice depends on a directory's subtree while directory freshness signals do not propagate upward, a detected change in any directory SHALL re-derive the preview choices of that directory and of each of its ancestors.

#### Scenario: A repointed index invalidates poses, not the tree
- **WHEN** the semantic index answers from a different collection root, or a reload is requested
- **THEN** cached poses and preview choices stop being served while the tree snapshot continues to serve listings

#### Scenario: A deep change re-derives its ancestors' previews
- **WHEN** revalidation finds a directory changed several levels below the root
- **THEN** preview choices are re-derived for that directory and every directory above it, and an unchanged sibling branch keeps its cached choices

### Requirement: A persisted snapshot is revalidated at startup
When the server starts with a library that resolves ready and a snapshot exists for it, the server SHALL begin the incremental revalidation pass at once rather than waiting for the first request; a library that resolves ready only later SHALL be covered by its first request's ordinary revalidation rather than a late eager pass — the startup hook fires once at process start (`index.ts`'s eager-load precedent), and that is the shape this requirement binds. Startup SHALL NOT walk a root that has no snapshot, and SHALL NOT full-walk one that does: the pass is the same per-directory freshness check revalidation always uses.

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

