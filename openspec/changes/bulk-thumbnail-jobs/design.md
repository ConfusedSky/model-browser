# Design — bulk-thumbnail-jobs

## Context

Thumbnails are rendered client-side only (architecture D2: one `WebGLRenderer`;
the server never renders), through `App`'s `RenderQueue` — which
`thumbnail-sweep-priority` is giving priority bands drained nearest-first (its
26dcc18 rederivation: far work is deferred at the lowest rank, never cancelled).
`ThumbCache` stores one PNG + sidecar per path and recipe;
`immutable-thumbnail-serving` adds a write generation bumped by every write;
`listing-tree-cache` §6 gives `ThumbCache` an in-memory per-path index
(presence, staleness, generation — and `framed`, added to its 6.2 alongside this
drafting) and, since this change's 2026-09-02 design pass, a scope enumeration
over the snapshot carrying those facts per model (its 6.7 — D8 below). Per-model *refresh* and *give up the orientation* actions exist in
`entry-actions`, with exact discard semantics this change reuses rather than
restates. The always-on background warmer was weighed and declined in
`docs/web-demo-notes.md` (2026-09-02): bulk work is explicit, scoped, and
preemptible, or it fights the disk the user is using.

## Goals / Non-Goals

**Goals:**
- Warm any subtree — or the library — to fully thumbnailed, and reset any
  subtree's framings, from where the need is visible.
- A launched job is cancellable at any instant, resumable after anything, and
  never in the way of interactive work or the user's own edits.
- Honest buttons: every launcher states how much work it proposes before running.

**Non-Goals:**
- Automatic/scheduled warming. Explicit launch only.
- Server-side rendering, or any new server endpoint *of this change's* — the
  scope enumeration is `listing-tree-cache`'s (its 6.7, D8), and the job is a
  client loop over per-entry operations.
- The demo's hiding of these surfaces — that is the feature report's business
  (undrafted; `web-demo-backlog` 1.3 and the notes' Defaults), declared here
  only as a seam.
- A queue of pending job scopes (v2; re-derivability makes it cheap later).

## Decisions

### D1: Jobs are derivations, not records

A job is `(operation, scope)`. Its work list is derived at launch from the
per-entry state the cache indexes already hold, delivered by the tree cache's
scope enumeration (D8) — generate: models in scope
missing or stale; reset: models in scope with a stored orientation — a camera or an
axis, the definition `framed` in `listing-tree-cache` 6.2 must share (review M4) — and
is never persisted: each completed entry's own state change removes it from any
future derivation. Resume-after-cancel, after-crash, after-app-close is
therefore "launch it again"; the second run's derivation is exactly the
remainder. Cancel + re-run *is* pause (settled with Masa, 2026-09-02). Per-entry
work is atomic (one PUT), so no partial entry exists for a derivation to
misread.

*Alternative — a persisted job journal:* survives close "properly", but it is a
second source of truth about per-entry state that the entries already carry,
and it can disagree with them; refused for the same reason the tree snapshot
refuses query-dependence (its D1).

### D2: One active job; the chip is the job's UI

Bands solve interactive preemption, not bulk-vs-bulk: two interleaved bulk jobs
double disk-head contention and make progress meaningless. One job runs at a
time; launching another surfaces the running job's chip (cancel it to proceed).
The chip is app-level — it survives navigation, shows operation, scope,
done/total/failed, and Cancel — and is the same UI whichever launcher started
the job. It is dismissible; dismissing hides it without cancelling.

### D3: Reset is the existing action, fanned out

The reset operation applies `entry-actions`' give-up-the-orientation semantics
per model — camera always discarded, axis discarded only where an
index-supplied orientation replaces it, then re-rendered at what the model
resolves to. The delta does not restate those rules; it points at them. This
keeps one definition of "reset framing" in the system (Masa: same semantics as
the existing action), and it inherits that action's edge behavior — including
what is and is not discarded when the index supplies nothing — without a second
spelling that could drift.

### D4: An entry the user touched mid-job is skipped

At launch the job snapshots each derived entry's write generation (from the
cache index). Before writing an entry, the job compares: a generation that
moved since launch means the user (or another surface) wrote it mid-job — the
job skips it and counts it as skipped, never overwriting a fresh orbit with a
reset or a re-render. Last-write-wins is the fallback only where a race slips
between check and write; the window is one queue job wide.

### D5: Counts before consent

A launcher states its cost where the surface can deliver it (review M6 narrowed the
first version, which counted everywhere): the library tab's buttons read "Generate N
missing thumbnails" / "Reset N framings" — that surface renders asynchronously
already. A context-menu entry is uncounted: `EntryCommand.labelFor` is
`(entry) => string` with no context, and `EntryMenu` measures, clamps and
focus-seeds from its command list at mount, so a late-arriving count would visibly
move the menu (the `AvailabilityContext` doc records exactly this hazard). The
count appears at the next step instead — reset's confirmation dialog carries it
before anything is discarded; generate's appears on the chip as the job starts.
Reset confirms first: it destroys the user's curated framings, which no re-run can
rederive. Counts come from the cache indexes (one lookup per entry in scope, no
filesystem walk); a scope the index cannot yet enumerate states that instead of a
number.

### D6: The `library` tab is the whole-library launcher, and the app's maintenance surface

The root is not a tile, so subtree actions cannot reach "everything" — the new
fourth `SidePanel` tab (`library`, joining `chat`/`search`/`similar`) hosts the
whole-library buttons. It is the natural later home for `listing-tree-cache`'s
reload affordance (its 6.6) and cache statistics; this change creates the tab
with its two buttons and leaves the rest to their owners. On the demo the
feature report empties it (every occupant is a write action), and an empty tab
is not shown — the launcher empty-report precedent.

### D7: One per-entry body, three callers (added 2026-09-02 — review M5)

`refreshThumbnail` (`entryActions.ts`) is the body both per-model thumbnail
commands run, and D3 wanted to fan it out. Two things in it are the *command's*,
not the operation's: it reports every failure to the user
(`host.report(RENDER_FAILED)` — one sentence per failed model, which fanned over a
kit is a wall of them), and it resolves the model's orientation from `host.poses`,
the current landing's answer — populated by a meaning or similarity landing only,
so a reset launched from a plain folder would take the no-pose branch for every
model in it, discarding cameras and rendering at the default where the index would
have framed them.

So the body is split, not shared. A core — `renderEntryThumbnail(entry, deps,
{ discardFraming, pose, expectGen })` — does the lookup, the resolution
(`framingAfterDiscard` on discard, the sweep's rule otherwise), the render, the
PUT and the `setThumb`; it takes the pose as a parameter, answers
`'done' | 'skipped'`, and throws on failure. The command's wrapper is what
`refreshThumbnail` keeps: the queue push, the pose read from `host.poses`, the
one-line report. The job's wrapper passes its own pose (D8's wave) and the `gen`
it snapshotted at launch — the core's existing cache read compares and answers
`skipped` when it moved, so D4 costs no second lookup — and counts a throw instead
of saying it. One resolution rule, one PUT shape, and D3's promise (the same
semantics as the per-model action) is true by construction rather than by two
bodies agreeing.

*Alternative — call the command and catch its report:* the report goes through
the host, not a return value, and the pose would still be the landing's. A flag on
the command would be the second reading of "same body" that drifts.

### D8: The tree cache enumerates the scope; the job derives (added 2026-09-02 — review S2, settled with Masa)

Nothing the app had could enumerate a scope: `/api/dir?flat=true` is a listing —
capped at 500 models, budgeted for a browse — and `listing-tree-cache`'s
annotation rides listings only. Two shapes were weighed. A route of this change's
own — walk the subtree over `walkFlat`'s collector, uncapped, join each model
against its sidecar — lands now and waits on nothing. An enumeration read on the
tree cache — its 6.7: every model beneath a path from the snapshot, each with its
6.2/6.3 facts, no cap, completeness stated — waits for §6. The second was taken.
The first pays the cold walk the tree cache exists to remove — on every launch,
and on every opening of the library tab for its counts, against a volume the notes
measured at ~32 s cold — and is rewritten the day §6 lands; the second makes the
tab's count a memory read, which is what "honest counts, no walk" (D5) meant all
along. The price is ordering, and this change pays it: nothing starts before 6.7
is on main.

The join stays where the constants are. The server states facts per model —
presence and labels per variant, `gen`, `framed`, camera/axis, the one annotation
shape `thumbnail-image-serving` D2 names — and the client judges: generate keeps a
model whose recipe-in-force variant fails the hook's own hit test (`lighting`,
`rig`, and `posed` against the pose the job holds); reset keeps `framed`. That
predicate is extracted from `useThumbnails`' hit branch rather than restated, so
the job and the sweep cannot disagree about what is stale. And because the test
reads a pose, the job runs its own orientation wave over the enumerated models
first — `semanticPosesFor`, chunked, failure is silence: the listing wave's
contract — which is also what D7's core renders unowned models under, so a
generate over a plain folder frames them as a visit would and a reset restores
index framings rather than defaults. The library tab's counts are the same
derivation, run when the tab opens, over the app's root — `LibraryState.root`,
the viewpoint the app opens at, which is what "the library" means on screen.

An enumeration that reports itself incomplete (a root with no snapshot whose walk
stopped against its budget) is still a job, over what was found; the chip says the
scope was cut, and the next launch — over a tree the walk may since have completed
— picks up the rest. Consistent with D1: the derivation is a launch-time snapshot.

## Risks / Trade-offs

- [A job over a huge scope holds meshes through the LRU] → per-entry work goes
  through the same queue and LRU as ordinary renders; eviction disposes
  geometry (D5 of the architecture). The job adds no retention of its own.
- [Zip interiors: reading a member re-reads the archive tail repeatedly during
  a bulk job] → the archive-directory cache (`listing-tree-cache` D3) covers
  directory reads; member extraction is per-render as today. Accepted: bulk
  generate over a zip-heavy tree is I/O-heavy — the chip's failure/progress
  reporting makes the cost visible, and cancel is instant.
- [The derivation races a listing revalidation (entries appear/disappear
  mid-job)] → a vanished entry's render fails per-entry and is counted; an
  appeared entry is simply not in this job's derivation — the next launch picks
  it up. Consistent with D1: the derivation is a launch-time snapshot, not a
  live query.
- [Feature report does not exist yet] → until it lands, the surfaces exist
  unconditionally in the main app, which is correct there; only the demo needs
  them withheld, and the demo does not exist yet either. The seam is declared
  in the delta so 1.3 can gate without modifying this capability.
