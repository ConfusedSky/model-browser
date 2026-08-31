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
