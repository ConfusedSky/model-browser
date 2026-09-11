## MODIFIED Requirements

### Requirement: Derived annotations ride the listing
The server SHALL attach to listing entries, at emission, the derived per-entry facts it can resolve without waiting — a directory's preview choice (the entries its contact sheet shows) and a model's thumbnail state (cached, stale, or absent, with the cached image's write generation) — as additive fields resolved by key lookup alone. A model's pose is NOT held by the server: when the index's memoised probe reports it ready, emission SHALL ask the index once, in one batched request, for the orientation of every model on the listing and of every cell of the sheets the listing carries, and SHALL attach what that request answers within a bounded wait — an orientation for each model the index names, and an explicit null pose for each model it was asked about and did not name, so the client treats that model as known-unposed rather than re-asking. Emission SHALL NOT wait beyond that bound, SHALL NOT consult an index whose memoised probe is not ready (a warming or absent index costs a listing nothing), and SHALL NOT fail or slow a listing for an ask that times out or errors: the listing is then emitted with no pose on those entries, and an answer that arrives after the bound is discarded, not kept for a later listing — the next emission asks again, which is how a changed opinion of the index reaches the client at the next listing rather than after a horizon. Emission MAY also spend a bounded annotation budget deriving preview choices for the listing's unchosen directories under a concurrency cap and a launch bound (the budget bounds time; the launch bound caps work the budget cannot cancel), and a sheet derived at emission SHALL attach the poses its own derivation learned to its cells, from the same answer, without a second ask. A fact neither the layers nor the ask produced is simply absent from that entry — the client's wave and peek remain the fill for exactly those, and a listing whose every model arrived posed or known-unposed issues no wave. Emission-time filling SHALL be single-flighted per listing path, two concurrent requests for the same listing sharing one ask and one answer, and SHALL derive sheets through no layers instance that is not live — and a library with no derived-layer content and no ready index SHALL emit listings byte-identical to one where these layers do not exist. What the client does with an absent fact — asking the index directly, rendering without it — is unchanged by this capability.

#### Scenario: A revisit is one request
- **WHEN** a root whose entries' thumbnail states and preview choices are already cached is listed again while the index is ready
- **THEN** the response carries them inline together with the poses the index answered for that emission, and the client needs no per-entry or per-listing follow-up for what arrived

#### Scenario: The index being down does not slow a listing
- **WHEN** the semantic index is absent, warming, or wedged
- **THEN** the memoised probe gates emission-time asking entirely: listings emit at full speed with no index call made, carrying their thumbnail states and held preview choices and no pose on any entry

#### Scenario: A first sight arrives whole
- **WHEN** a ready index knows poses and preview choices for a folder that has never been listed, and a listing of it is emitted
- **THEN** the listing carries them, asked for and derived within the bound at emission, and the client issues no follow-up wave or peek for what arrived

#### Scenario: No layers, byte-identical
- **WHEN** a library has no cached preview choices or thumbnails, and no ready index is available to ask
- **THEN** every listing is byte-identical to one emitted before this capability existed

#### Scenario: The ask outlives its bound and the wave covers the landing
- **WHEN** the index's memoised probe reports it ready but its answer to emission's pose ask does not arrive within the bound
- **THEN** the listing is emitted with no pose on its models, no later than the bound after the ask began, the late answer is discarded, and the client's wave asks for those models exactly as it does for an unready index

#### Scenario: A changed opinion reaches the next listing
- **WHEN** the index changes the orientation it holds for a model after a listing carrying the old one was emitted
- **THEN** the next emission of a listing containing that model carries the new orientation, with no horizon, restart or reload in between

### Requirement: Derived layers live beside the tree and die with their sources
Derived layers SHALL be stored beside the tree snapshot, never as fields within it: the snapshot remains a function of the walked root alone. The one derived layer the server holds is the preview choice; a model's pose is never held — it is asked of the index at each emission and attached from that answer, so nothing about a pose can go stale between the index and the wire. Each preview-choice entry SHALL record the identity of what it was derived from, in terms the server can itself observe: the server's layer version — a constant bumped when the derivation's meaning changes — and the index's reported collection root, and entries are dropped wholesale by the reload operation and when that collection root changes; thumbnail state carries the thumbnail store's own record, per render — presence and staleness are per occlusion variant, since the store keys renders that way. A layer entry SHALL NOT be served once its recorded identity has moved. The preview layer MAY be process-local rather than durable: with no observable index build identity to key durability on, a persisted choice could outlive a re-classification indefinitely, so outliving the process is the risky direction; the tree and archive layers alone persist, and a restart is a third drop point, not a regression (the client's peek remains the fill path). Because a preview choice depends on a directory's subtree while directory freshness signals do not propagate upward, a detected change in any directory SHALL re-derive the preview choices of that directory and of each of its ancestors.

#### Scenario: A repointed index invalidates poses, not the tree
- **WHEN** the semantic index answers from a different collection root, or a reload is requested
- **THEN** cached preview choices stop being served while the tree snapshot continues to serve listings, and the poses on the next listing are whatever the index now answering reports — there is no held pose to invalidate

#### Scenario: A deep change re-derives its ancestors' previews
- **WHEN** revalidation finds a directory changed several levels below the root
- **THEN** preview choices are re-derived for that directory and every directory above it, and an unchanged sibling branch keeps its cached choices
