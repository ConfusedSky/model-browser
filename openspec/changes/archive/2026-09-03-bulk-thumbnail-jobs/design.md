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
over the snapshot carrying those facts per model (its 6.7 — D8 below).
Per-model *refresh* and *give up the orientation* actions exist in
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
  (`server-feature-report`, archived 2026-09-02; the `maintenance` capability
  `public-deployment` adds to it), declared here only as a seam.
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
done/total/failed, and Cancel, and since 5.2 says when its next entry has waited
more than a moment behind what is on screen — and is the same UI whichever
launcher started the job. It is dismissible; dismissing hides it without cancelling.

### D3: Reset is the existing discard, fanned out — and the pixels go with it (revised 2026-09-02)

The reset operation applies `entry-actions`' give-up-the-orientation semantics
per model — camera always discarded, axis discarded only where an
index-supplied orientation replaces it — and then, where the per-model action
redraws the thumbnail in place, the job **deletes** the cached renders instead:
both occlusion variants, since both were drawn under the orientation just given
up. Nothing is rendered. A reset over a library is a few thousand small writes
rather than a few thousand mesh loads and renders (settled with Masa,
2026-09-02: this one should be quick; redrawing is what *generate* is for, and
it is the next button). The redraw is left to whatever next looks at the model —
the ordinary visit's sweep for a tile on screen, a generate job for the rest —
both of which resolve a model with nothing stored exactly as the redraw would
have. The job sends the writes one at a time — cancel lands between two — and a
few thousand small writes at loopback latency is still seconds.

The discard rule is the per-model action's, pointed at rather than restated
(Masa: same semantics), so the two cannot drift on *what* is discarded; the
axis half needs the index's opinion, which is why the job's orientation wave
(D8) runs for reset too. The per-model *Reset framing* keeps its
redraw-in-place under the same name: on one tile, the old picture staying until
the new one lands feels better than a placeholder, and one name for "give up
the framing" was preferred to two spellings of it. The delta records the
difference as what each does *after* the discard.

*Alternative — the per-model action also deletes and lets the sweep refill:*
one definition end to end; declined for the asymmetry that actually holds. One
tile can be redrawn in place at once, so keeping the old picture until the new
one lands costs nothing there; a scope cannot be redrawn quickly at all. The
bulk reset therefore knowingly blanks any on-screen tile in its scope until the
sweep refills it, and the delta says so — beside, not against, the thumbnails
capability's keep-until-replaced rule, which governs refreshes and is not
modified.

### D4: An entry the user touched mid-job is skipped

At launch the job snapshots each derived entry's write generation (from the
enumeration, D8). Every job write carries it: the PUT's `ifGen` makes the
server refuse a write to an entry whose generation has moved since (412,
nothing written), and the job counts the refusal as skipped — the user (or
another surface) wrote it mid-job, and a fresh orbit is never overwritten by a
reset or a re-render. Server-side rather than compare-then-write on the client
(the first version): the window shrinks from a client round trip to `put`'s own
read-modify-write — the unserialized span between its `readMeta` and its
`writeMeta`, which its doc comment already records as accepted — and nothing
narrower exists without locking.

One consequence, found by the implementing worker: every accepted write moves
the generation, so a job that wrote one entry twice under its launch snapshot
would refuse its own second write and count it as the user's. Each op here
writes once; an op that ever writes twice must re-key from the PUT's answered
`gen`, never from the snapshot.

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
rederive. Counts come from one enumeration of the scope (D8): a memory read
where the tree is cached, and a walk exactly where it is not — the same walk a
first listing of that root pays. The tab says "Counting…" until it lands and
never blocks on it.

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
commands run. The first draft's D3 wanted to fan it out for reset; since D3's
revision reset renders nothing, so the split serves *generate*, whose per-entry
op is exactly the redraw. Two things in it are the *command's*, not the
operation's: it reports every failure to the user (`host.report(RENDER_FAILED)`
— one sentence per failed model, which fanned over a kit is a wall of them), and
it resolves the model's orientation from `host.poses`, which covers the **landed
listing** only — `App` hands it the merged `poses` memo, the listing wave's
answer folded with the previews' — while a job's scope is mostly *not* on
screen: a subtree launched from a tile's menu, or the library. Every model
outside the listing would take the no-pose branch, rendering at the default
where the index would have framed it. (The first version of this paragraph, and
`ActionHost.poses`' own doc comment still, say the map is filled by a meaning or
similarity landing only; the review checked the code — `listingPoses` is filled
for plain listings by the second wave — and 1.3 corrects the comment.)

So the body is split, not shared. A core — `renderEntryThumbnail(entry, deps,
{ discardFraming, pose, ifGen })` — does the lookup (kept, deliberately: the
orientation rendered from is the one in force when the render runs, not when
the scope was enumerated — one small GET per model against a render-bound job),
the resolution (`framingAfterDiscard` on discard, the sweep's rule otherwise),
the render, the PUT (forwarding `ifGen`) and the `setThumb`; it takes the pose as a parameter,
answers `'done' | 'skipped' | 'current'` (a 412 is `skipped`; `'current'` is the
`skipIfCurrent` answer, added at implementation — the job's derivation read an
annotation that may be older than the cache, so the core's own fresh read is the
last word and a current entry costs one GET and no render), and throws on
failure. The
command's wrapper is what `refreshThumbnail` keeps: the queue push, the pose read
from `host.poses`, the one-line report. The job's wrapper passes its own pose
(D8's wave) and the `gen` it snapshotted at launch, and counts a throw instead
of saying it. One resolution rule, one PUT shape, and the generate job renders
exactly what the re-render command would.

Reset's per-entry op is not a render and shares none of this: one PUT with
`camera: null`, `axis: null` exactly where `framingAfterDiscard` — the shared
reading of the discard rule, the one the lightbox's live reset uses too — says a
usable pose replaced it, `png: null`, and `ifGen`. Then the in-memory half: a
tile on screen drops its image and re-looks-up, which needs a per-path restart
the hook does not have yet (`refetch(path)` beside `setThumb`; nothing restarts
a slot on a server-side write — the sweep effect restarts one only on add,
mtime, `ao` or a pose change by value).

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
reads a pose, the job runs its own orientation wave first — over only the
enumerated models whose annotation carries no pose, since the tree cache's pose
layer rides the enumeration as it rides a listing (its 6.4 rule: ask the index
about the unknowns, not the library); `semanticPosesFor`, chunked, failure is
silence: the listing wave's contract — which is also what D7's core renders
unowned models under, so a generate over a plain folder frames them as a visit
would, and a reset discards the axis exactly where the per-model action would
(D3). The library tab's counts are the same derivation, run when the tab opens —
"Counting…" until it lands, "Count failed" if it cannot — and a launch
re-derives, over the app's root — `LibraryState.root`, the viewpoint the app
opens at, which is what "the library" means on screen. Both counts come from
**one** scan (`BulkJobs.count`): the review found the first version paying the
walk and the wave twice for two filters over one answer. The seam is keyed on
the scope and the runner alone — never on the action host, which is rebuilt on
every pose landing — or every landing re-enumerated the library.

**A recount is expensive here, so it happens at two moments only (settled
with Masa, 2026-09-02).** Measured on the real library: 18,737 models, a 7.8 MB
enumeration in 0.47 s, and 15,357 of them with no pose in it — a full wave is
sixteen index requests. So: the tab re-derives when it opens and when a job
that *wrote something* ends (a launch passing through `deriving` and
`confirming`, or a reset cancelled at its confirmation, changed nothing and
recounts nothing). "Ends" is the runner's `settled`, not its phase: Cancel sets
`cancelled` while the entry in flight may still land and be the job's only
write, so the recount waits for the loop to finish and fires when `wrote > 0` —
a generate that found every entry current on its own lookup wrote nothing and
recounts nothing (the review's two findings). The user's own framing changes —
a persisted orbit, a chosen axis, a framing given up from a tile or the viewer —
move the reset count by **arithmetic**: each site reports the write in the PUT's
own three states (`ActionHost.framingChanged`), with the before-state where the
site read it (the discard's own lookup); otherwise App reads the tile's *ready*
state, else says nothing — a loading tile carries no framing, and reading it as
"unframed" counted an orbit on a framed model +1 (one review's finding); the
listing's annotation was tried as a third source and dropped, since after a
reset's own refetch it still names a camera the server no longer holds (the
next review's). Where this session holds no pose for the model, an axis-only
state cannot be judged and the change stays silent rather than guess — which,
on a library with no semantic index running, means an orbit on a model that
held only an axis moves nothing until the next derivation counts it; the
derivation reads "no pose" as "not resettable" and so counts the new camera +1.
The recount is keyed on the run (`JobState.runId`), never on the state object,
since every patch — a Dismiss included — is a new object.
App turns the pair into ±1 through the one rule (`resettable`), and the tab
shows its derived count plus the change since that count was *asked for* — the
server counted then, so a change made while the answer was in flight is added,
not swallowed; the next derivation absorbs the sum, which is where any drift
from a concurrent writer heals. The wave is sized to the question: a *count*
asks the index only about axis-only models, a *reset* launch about every model
with a stored axis (the pose decides whether the axis goes with the camera), and
only a *generate* launch about every unowned model, since only generate's
staleness test reads a pose — pressing the tab's Reset was sixteen requests
before this. The count may miss a pose-stale render the layer has not learned,
which a generate launch's full wave still finds.

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
- [The report's field for these surfaces is another change's] → the report
  exists (`server-feature-report`, archived 2026-09-02) but its one field today
  is `thumbWrites`, so the surfaces gate on that until `public-deployment` lands
  `maintenance` — "operations on the server's own derived state", the field
  `POST /api/reload` gates under, which is the same question these surfaces ask.
  They join that field rather than adding one (two fields for one question
  would collide at archive); the rebase is tasks 5.1, and the ordering with
  that change is declared in its tasks as well as here.
