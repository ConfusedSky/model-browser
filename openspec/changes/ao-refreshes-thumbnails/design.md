# Design — ao-refreshes-thumbnails

> Formerly `lighting-refreshes-thumbnails`; D1–D3 are the original's with the trigger
> renamed, D1a is unchanged.

## Context

After `ao-as-recipe-dimension`, `useThumbnails`' load effect reads `aoEnabled()` per entry,
asks the cache for that render, and accepts a hit only when the labels match
(`cached.lighting === THUMB_LIGHTING && cached.rig === RIG_VERSION && !poseStale`);
anything else falls through to the re-render tail. That rule is `model-thumbnails`'
*Recipe-labelled thumbnails* plus *A thumbnail exists per occlusion recipe*, and it works.
Note what the tail does *not* do: it holds the old object URL in a closure for the failure
path only, while the effect's opening `setThumbs(new Map(...loading))` has already reset
every tile — see D3.

What decides when it runs is the effect's dependency list, `[entries, api, lru, queue,
setThumb]`. `aoEnabled()` is called inside the effect but is not a dependency, so the sweep
runs on a listing change and not on a preference change.

The preference lives in `viewer/aoToggle.ts` and is read imperatively. `App.tsx` holds it
in state (`ao`, set by the pill — and, after `adaptive-ao-default`, by the measurement) and
passes it to the viewer, so a React-visible value already exists at the call site.

## Goals / Non-Goals

**Goals:**
- A preference change answers on the grid the user is looking at.
- One lookup rule, one render path — the trigger is the only thing added.

**Non-Goals:**
- Changing what counts as stale, or what either render looks like. No `RIG_VERSION` bump.
- Making the rig version eager (D2).
- Refreshing thumbnails outside the current listing. The cache converges lazily for
  everything else, which is what keeps a toggle proportional to what is on screen.

## Decisions

### D1: The preference becomes an input to the sweep, not a second sweep

The temptation is a separate "preference changed" path that walks the displayed thumbnails
and re-fetches them. That would be a second implementation of the lookup rule and would
drift from it — the first time an entry has neither label stored, the two disagree about
whether it is stale.

So the effective preference is passed into the hook and joins the dependency list. A change
then runs the same loop against the same lookup and the same staleness test, and every tile
whose render under the new setting is cached is a hit, while every other falls through the
same tail it would have on a later visit.

It is *not* simply "what a navigation does", and D3 is where that bites. Teardown today
cancels queued renders and releases the stale branch's URLs through `dropStale`, but it does
not release the URLs of tiles that were displaying, and it does not carry any image into the
next pass — both acceptable when the next pass is a different listing and defects when it
is the same one.

### D1a: A posed tile keeps its pose across the toggle

There is a third pixel-recipe label beside lighting and rig — `POSE_VERSION`
(`client/src/three/pose.ts`), added because the index's orientation is an input to the
pixels that the cache key does not carry. It matters here because a toggle sends every
displayed tile through the same tail that resolves orientation, and that tail reads the
*absence* of a stored camera and axis as "this model is the index's to orient". A posed tile
must therefore come back posed, and must re-declare `POSE_VERSION` on the way —
`ThumbCache.put` clears the label on any PUT carrying a PNG, and `poseStale` re-renders
anything whose label is missing. That much self-heals on the next sweep, so dropping it
costs one wasted render rather than a loop; what does not heal is a tile that comes back
*unposed*, since the index's orientation is then simply gone from the picture.

This is a property to test rather than a decision to make: the tail already does the right
thing — `poseStale` on main reads `wantsPose && cached.camera === undefined && cached.axis
=== undefined && cached.posed !== POSE_VERSION` since `28289d1`, the applied-only form —
and the change's obligation is not to break it while giving the tail a second trigger. The
original draft of this change described that predicate as a bug still to fix; it is not,
and §2b is now about stating and asserting it.

### D2: The rig version stays lazy, and the asymmetry is the point

Both labels are compared by one condition, so it would be tidy to make everything eager.
They answer to different events.

The occlusion preference changes because the user pressed a control — or the app measured
on their behalf — and the result is on screen. A rig version changes because a new build
shipped: there is no gesture, nobody is waiting, and the first thing the app would do on
startup is re-render every visible tile for a change the user did not ask for and cannot
attribute. Lazy upgrade is the correct behaviour there, and the shipped scenario ("a rig
revision refreshes stale thumbnails once") describes it.

The requirement therefore keeps one staleness rule and gains one statement about *when*
it is re-evaluated, rather than splitting into two rules.

### D3: Cost is bounded by what is displayed, and the grid must not blank

A toggle over a listing at the 500-model cap issues 500 lookups and, the first time, up to
500 renders — the toggle's own meaning. The render queue already bounds concurrency and
suspends under an active orbit or lightbox (architecture D2/D3), so the work yields to
interaction. Toggling *back* is 500 lookups and no renders, because `ao-as-recipe-dimension`
keeps both variants.

One property keeps it from being felt as a stall, and it is **work this change has to do
rather than a property it inherits**. `useThumbnails`' load effect opens with
`setThumbs(new Map(models.map(e => [e.path, { status: 'loading' }])))` — every tile drops
to a spinner, and the stale branch parks the old object URL in a closure that only the
failure path reads. Today that is invisible: the effect re-runs on a listing change, where
the old images belong to a listing that is leaving. Re-running it on a preference change
makes the entries the same, so a toggle would blank the whole grid to spinners until each
lookup or render lands — the eager refresh would look worse than the lazy one it replaces.

So the sweep must carry displayed images across a re-run and drop each only as its
replacement arrives, which also means tracking which object URLs it still owns. That is the
substance of the change; the dependency-list edit is one line of it.

## Risks / Trade-offs

- [Blanking the grid to spinners on every toggle] → D3; the sweep has to preserve displayed
  images across a re-run, which it does not do today. This is the risk that decides whether
  the change is worth having.
- [A toggle becomes expensive on a large grid] → D3; the first pass under a setting renders,
  every later one is lookups; bounded by the queue either way.
- [The sweep re-runs on an unrelated re-render] → the dependency is the effective boolean,
  not an object rebuilt per render, so equal values do not re-trigger it. Worth a test,
  since this is the failure that turns a toggle into a render loop.
- [`adaptive-ao-default` flips the preference while the user is mid-orbit] → the sweep
  queues behind the interaction as any sweep does; the overlay itself already renders
  under the new setting on its next frame. The handoff that matters — the *next* tile
  pressed — is seamless because both sides read the same store.
- [Divergence from the lazy path] → D1 keeps one rule and one tail; the trigger is all that
  differs.
