# Design — lighting-refreshes-thumbnails

## Context

`useThumbnails.ts:113-141` reads the cache for each model and accepts a hit only when
`cached.lighting === getLightingMode() && cached.rig === RIG_VERSION`; anything else falls
through to the re-render tail. That rule is `model-thumbnails`' *Lighting-mode-aware
thumbnails*, and it works. Note what the tail does *not* do: it holds the old object URL in
a closure for the failure path only (`:146-152`), while `:105` has already reset every tile
to `{ status: 'loading' }` — see D3.

What decides when it runs is the effect's dependency list, `[entries, api, lru, queue,
setThumb]` (`:235`). `getLightingMode()` is called inside the effect but is not a
dependency, so the sweep runs on a listing change and not on a mode change.

The mode itself lives in `client/src/viewer/lighting.ts` and is read imperatively. `App.tsx`
holds it in state (`lighting`, set by the mode control) and passes it to the viewer, so a
React-visible value already exists at the call site — `useThumbnails(listing, api, lru,
queue, poses)` is called from a component that re-renders when the mode changes.

## Goals / Non-Goals

**Goals:**
- A mode change answers on the grid the user is looking at.
- One staleness rule, one render path — the trigger is the only thing added.

**Non-Goals:**
- Changing what counts as stale, or what a thumbnail looks like. No `RIG_VERSION` bump.
- Making the rig version eager (D2).
- Re-rendering thumbnails outside the current listing. The cache upgrades lazily for
  everything else, which is what keeps a mode change proportional to what is on screen.

## Decisions

### D1: The mode becomes an input to the sweep, not a second sweep

The temptation is a separate "mode changed" path that walks the displayed thumbnails and
re-renders them. That would be a second implementation of the rule at `:130-131` and would
drift from it — the first time an entry has neither value stored, the two disagree about
whether it is stale.

So the mode is passed into the hook and joins the dependency list. A mode change then runs
the same loop against the same staleness test, and every tile whose stored mode now differs
falls through the same tail it would have on a later visit.

It is *not* simply "what a navigation does", and D3 is where that bites. Teardown today
cancels queued renders and releases the stale branch's URLs through `dropStale`, but it does
not release the URLs of tiles that were displaying (`:136`, `:201`), and it does not carry
any image into the next pass — both are acceptable when the next pass is a different listing
and become defects when it is the same one.

### D1a: A posed tile keeps its pose across the toggle

There is a third pixel-recipe label beside lighting and rig — `POSE_VERSION`
(`client/src/three/pose.ts:39`), added because the index's orientation is an input to the
pixels that the cache key does not carry. It matters here because a mode toggle sends every
displayed tile through the same tail that resolves orientation, and that tail reads the
*absence* of a stored camera and axis as "this model is the index's to orient". A posed tile
must therefore come back posed, and must re-declare `POSE_VERSION` on the way — `cache.ts:110`
clears the label on any PUT carrying a PNG, and `poseStale` re-renders anything whose label is
missing. That much self-heals on the next sweep, so dropping it costs one wasted render rather
than a loop; what does not heal is a tile that comes back *unposed*, since the index's
orientation is then simply gone from the picture.

This is a property to test rather than a decision to make: the tail already does the right
thing, and the change's obligation is not to break it while giving the tail a second trigger.

### D2: The rig version stays lazy, and the asymmetry is the point

Both values are compared by one condition, so it would be tidy to make both eager. They
answer to different events.

A lighting mode changes because the user pressed a control and is watching the result. A rig
version changes because a new build shipped — there is no gesture, nobody is waiting, and
the first thing the app would do on startup is re-render every visible tile for a change the
user did not ask for and cannot attribute. Lazy upgrade is the correct behavior there, and
the shipped scenario ("a rig revision refreshes stale thumbnails once") describes it.

The requirement therefore keeps one staleness rule and gains one statement about *when* it
is re-evaluated, rather than splitting into two rules.

### D3: Cost is bounded by what is displayed

A mode toggle over a listing at the 500-model cap queues 500 renders. That is the toggle's
own meaning — the user asked for every thumbnail to look different — and the render queue
already bounds concurrency and suspends under an active orbit or lightbox (architecture
D2/D3), so the work yields to interaction rather than competing with it.

One property keeps it from being felt as a stall, and it is **work this change has to do
rather than a property it inherits**. `useThumbnails.ts:105` opens the effect with
`setThumbs(new Map(models.map(e => [e.path, { status: 'loading' }])))` — every tile drops to
a spinner, and the stale branch parks the old object URL in a closure (`:146-152`) that only
the failure path reads. Today that is invisible: the effect re-runs on a listing change,
where the old images belong to a listing that is leaving. Re-running it on a mode change
makes the entries the same, so a toggle would blank the whole grid to spinners until each
render lands — the eager refresh would look worse than the lazy one it replaces, which would
be a strange thing to ship.

So the sweep must carry displayed images across a re-run and drop each only as its
replacement arrives, which also means tracking which object URLs it still owns. That is the
substance of the change; the dependency-list edit is one line of it.

## Risks / Trade-offs

- [Blanking the grid to spinners on every toggle] → D3; the sweep has to preserve displayed
  images across a re-run, which it does not do today. This is the risk that decides whether
  the change is worth having, since a toggle that empties the grid is worse than one that
  leaves it stale.
- [A mode toggle becomes expensive on a large grid] → D3; bounded by the queue, and it is
  the work the control exists to do. Someone toggling to compare modes pays it each way,
  which is the same cost they pay today by navigating away and back.
- [The sweep re-runs on an unrelated re-render] → the dependency is the mode value, not an
  object rebuilt per render, so equal values do not re-trigger it. Worth a test, since this
  is the failure that turns a toggle into a render loop.
- [Divergence from the lazy path] → D1 keeps one rule and one tail; the trigger is all that
  differs.
