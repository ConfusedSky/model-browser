## Context

Poses live in mini-classify's pose cache per indexed model (`pose.load_pose_cache`,
`collection.pose_of(i)` — a dict lookup, no GPU, so none of the surface doc's GPU-lock
concerns apply). The server surface is `/status`, `/query`, `/similar`, `/reload`;
poses ride only on hits. Client-side, `poses` is `state.result?.poses` — populated only
by meaning/similar landings; `useThumbnails` captures each entry's pose per generation
and compares by value on re-runs.

## Decisions

### D1: Supply from the index, live; the store joins later as the override

Three candidate sources: a new index endpoint; the override store's pose field
(`library-overrides`, drafted); embedding at request time (absurd — poses are already
computed). The index endpoint wins for now: it follows re-indexing automatically, costs
a dict lookup, and matches the demo's always-on index. The store field is the *manual
override* when its change lands: precedence stored camera > store pose > index pose >
default, wired by whichever change lands second (recorded in both changes).

### D2: A dir-batch proxy, not per-model requests and not listing enrichment

`GET /api/semantic/poses?path=<dir>` answers `{ poses: Record<libraryPath, IndexPose> }`
for the directory's models: one round trip per listing, mapped and confined per path
exactly as `hitsToEntries` maps hits (the index speaks real paths; the wire speaks
library paths). Not folded into `/api/dir`: a listing must stay index-independent (the
capability's *The index's absence costs nothing*), and a second wave is what the
reconciler is built for. Index absent, warming, or the path outside the collection →
the same answers search gives; the client treats them all as "no poses".

**2026-08-31, review:** a directory batch is the wrong *shape* for what the client
actually needs, and D2 named the wrong set. `requestOf` calls three things a
`listing` — a plain directory, a flat walk, and a name search — and `landedListing`
fires the wave for all three, but only the first has a grid that a directory's direct
children describe. A flat listing of the library top renders up to five hundred models
gathered from subfolders and was answered about the handful of files sitting at the
top; a name search's matches come from a whole subtree and were answered about the
folder the search was run at. Both requests were spent, both answers were unusable,
and neither failed: an unmatched key is indistinguishable from "the index has no
orientation for this model", so the grid stayed un-posed exactly as it does when the
index is down. The resolution is a **paths batch** — `POST /api/semantic/poses` with
the models the landing put on screen, confined per path exactly as the directory form
confines. The directory form stays for a directory-shaped ask (the peek's ranking is
one), and the client keeps it on `ApiClient`; nothing in the client calls it any more.
Rejected: making the wave listing-shape-aware (ask by directory for a plain listing,
by path otherwise) — two supply paths for one fact, and the plain case is the one
where they agree, so the second path buys nothing but a second thing to keep true.

### D3: The client merges a second wave into the state that already exists

After a plain listing lands, the client asks for its poses and merges into the same
`poses` the reducer holds for meaning landings (a meaning landing's own poses are not
re-fetched — the hits carried them). The reconciler re-evaluates surviving entries by
value, keeps every image, and re-renders only tiles whose pose genuinely arrived or
changed; `wantsPose`/`poseStale`/`POSE_VERSION` are untouched. First arrival re-renders
each unowned cached tile once per visited variant — the same lazy convergence as every
recipe change, and the sibling-pose rule keeps the two occlusion renders coherent.

**2026-08-31, found while implementing §3:** the reconciler's *rule* was built for this
and its *trigger* was not. `useThumbnails`' sweep effect did not depend on `poses` — a
recorded decision (1.2a, in the tail comment of that effect) taken on the premise that
poses only ever arrive *with* entries, which is the premise this change ends. A wave
changes the map alone, so nothing re-ran the sweep, the by-value compare was never
reached, and the wave was inert until the next landing; the delta's *A pose wave does not
reset the grid* scenario, which is explicitly about an answer arriving after the tiles are
displayed, could not have held. The trigger is now `poses` in that dependency list. It is
safe for the reason 1.2a's fear no longer applies: a re-run is a reconciliation, not a
reset — it keeps every image, every slot and everything in flight, and touches only what
arrived, left, or changed by value. What bounds it is reference stability rather than
absence, so `App` derives `poses` as a *stored* reference in every branch (a landing's own
map, the wave's slot, or the `NO_POSES` constant) and the reducer stores the wave's map
without copying it. The alternative — leaving the hook alone and handing it a fresh
`entries` array when the map changed — was rejected: it tells the effect the listing
changed when it did not, and reads as a redundant copy to the next person to touch it.

**2026-08-31, review (the paths batch, D2's addendum):** the wave names
`result.entries`' models rather than the directory the landing answered for, so all
three listing shapes are one case. The paths come off the landing's own `entries`
array and deliberately not off `byKind`: that selector is a *view* over the landing,
and the kinds filter moves on a click with no landing behind it, so keying the wave on
it would re-ask the index every time a name search was narrowed. The entries it hides
cost a map key each and no render at all. A listing that landed no model asks nothing
— an empty batch is a round trip spent to be told `{}`. And because a plain directory
listing has no model cap (`MODEL_BROWSER_FLAT_CAP` bounds the *flat walk*; `listDir`
bounds nothing), the request can exceed the route's `POSES_MAX`: `semanticPosesFor`
chunks and merges rather than slicing, because a slice would leave the tail of a large
folder permanently and silently un-posed — the exact defect this change exists to
remove — while `App` still makes one call per landing.

### D4: The peek stops at four posed models, inside the bound it already has

The walk today stops at four models found or the entry bound. It now stops at four
*posed* models; unposed finds accumulate as fallback and fill the sheet when the tree
or the bound runs out first. Posedness comes from one batch `/poses` call per peek on
the models the walk found (bounded by the walk's own cap). The entry bound is
unchanged, so a peek's worst case is what it already was. When the index is not
answering, the peek selects exactly as today — and the requirement's determinism
clause becomes "the same models given the same index answer": previews are cosmetic,
and a cosmetic surface may follow the index's availability where search already does.

## Risks / Trade-offs

- [A listing's pose wave re-renders many tiles at once on first arrival] → the render
  queue bounds it, tiles keep their images (reconciler), and it happens once per
  variant per model — the rig-bump shape the system already absorbs.
- [Peek cost grows by one index call] → a dict lookup per candidate over an
  already-bounded set; index down costs nothing (today's path).
- [Two sources of truth once `library-overrides` lands] → the precedence is decided
  here (D1) and recorded in both changes; the second lander wires it.
- [A pose changes on re-index while a listing is open] → the next pose wave re-arrives
  on the next listing; mid-listing divergence is the standing behaviour for hits too.

## Migration Plan

None. No stored shapes change; a client without the wave behaves exactly as today.

### D5: The peek asks the index before it walks (2026-09-01, Masa)

Found live with the index mid-build and confirmed structural: the peek's walk is
depth-first under a 64-entry budget, so a folder-of-folders whose first-sorted
subtree is deep (a "(Presupported)" tree) consumes the budget before any indexed
kit is reached — 12 of 141 folder tiles under-used posed models, every one a
folder of folders. Rationing the walk (level-fair round-robin) was weighed;
Masa's call is better: the index already knows every model under a prefix and
its pose, so the peek asks it first (`POST /under` on the index; the server
confines and maps per path, ranks posed-first, takes n) and only walks when that
answer is empty or the index is silent — the fallback is today's behaviour,
byte-identical. Cells the index fills need `DirEntry` fields the index does not
hold, so the server stats exactly the n chosen files (the `modelEntryAt` shape
search hits already use). Fewer than n from the index SHALL be filled from the
walk's finds, deduplicated — a two-cell sheet over a visibly fuller folder would
be a regression against today.
