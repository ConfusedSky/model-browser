# Design — lighting-refreshes-thumbnails

## Context

`useThumbnails.ts:113-131` reads the cache for each model and accepts a hit only when
`cached.lighting === getLightingMode() && cached.rig === RIG_VERSION`; anything else falls
through to the re-render tail, which keeps the stale PNG on screen until the replacement
exists. That rule is `model-thumbnails`' *Lighting-mode-aware thumbnails*, and it works.

What decides when it runs is the effect's dependency list, `[entries, api, lru, queue,
setThumb]` (`:220`). `getLightingMode()` is called inside the effect but is not a
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
re-renders them. That would be a second implementation of the rule at `:123-124` and would
drift from it — the first time an entry has neither value stored, the two disagree about
whether it is stale.

So the mode is passed into the hook and joins the dependency list. A mode change then does
precisely what a navigation does: tear down the in-flight sweep, cancel its queue handles,
release the object URLs it minted, and run the same loop again. Every tile whose stored mode
now differs falls through the same tail it would have on a later visit.

The cleanup path is already the load-bearing part and is already exercised: navigating
mid-sweep is the common case today, and the hook releases stale URLs (`dropStale`) and
cancels queued renders on teardown. A mode change is that case with the same entries.

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

Two properties keep it from being felt as a stall: the stale PNG stays on screen until its
replacement exists, so the grid never flashes empty, and a second toggle before the first
finishes tears the sweep down rather than stacking a second one.

## Risks / Trade-offs

- [A mode toggle becomes expensive on a large grid] → D3; bounded by the queue, and it is
  the work the control exists to do. Someone toggling to compare modes pays it each way,
  which is the same cost they pay today by navigating away and back.
- [The sweep re-runs on an unrelated re-render] → the dependency is the mode value, not an
  object rebuilt per render, so equal values do not re-trigger it. Worth a test, since this
  is the failure that turns a toggle into a render loop.
- [Divergence from the lazy path] → D1 keeps one rule and one tail; the trigger is all that
  differs.
