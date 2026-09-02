# Design — thumbnail-sweep-priority

> **Rebased 2026-09-01.** Every citation below was re-checked against main at
> `62f9f2d`, and re-verified 2026-09-02 at HEAD by an opus review (~20 symbols
> checked; `App.tsx` and `entryActions.ts` moved but no cited region changed —
> that review's findings are folded in below, marked 2026-09-02).
> The pre-rebase draft's Context was written against a
> `useThumbnails` that no longer exists and a `Grid` that has since grown an
> observer; its D2 and D3 were rederived, and D3/D5 below are new. See
> proposal.md's header note for what landed underneath.

## Context

`RenderQueue` (client/src/three/queue.ts) is a FIFO with a concurrency limit:
`push` appends to `jobs`, `pump` takes `this.jobs.shift()`. It already does two
things well — `suspend`/`resume` hold it while the shared renderer is serving an
orbit overlay or lightbox (`App` drives that off `viewer`), and `push` returns a
cancel handle that sets `job.cancelled` so `pump`'s `if (job.cancelled) continue`
skips it. Nothing calls that handle for scrolling.

`useThumbnails` no longer sweeps a listing. Since `ao-refreshes-thumbnails` it
holds an `EntrySlot` per path in `slotsRef` — a ref that outlives the effect —
and the sweep effect *reconciles* `entries` against it: entries that left are
retired and revoked, entries that arrived get a fresh slot and a `start`, and a
survivor whose `ao` and `IndexPose` are unchanged is skipped by
`if (slot.ao === ao && samePose(slot.pose, pose)) continue`. `retire(slot)` bumps
`slot.generation` and fires every handle in `slot.cancels`; the work a `start`
issued compares that generation through its `alive()` closure. So the queue's
contents are still exactly the cache *misses*, but they are pushed by each slot's
`start`, in `entries` order — and `entries` is `App`'s `thumbEntries`, which is
the listing plus the similarity anchor plus every folder preview's models
appended by `folder-contact-sheets` D3. Cached thumbnails never enter the queue at
all: the lookup runs under the module-level `lookupLimit` (`makeLimiter(8)`), and
the measured cache hit is 7 ms.

Three things this change must compose with, none of which existed when it was
drafted:

- **The reconciler's cancellation seam.** `slot.cancels` is a flat, unlabelled
  `(() => void)[]` holding, in order, the lookup handle, then (registered inside
  the lookup) `dropStale` and the `queue.push` handle. Two sites fire them, both
  firing all of them: `retire`, and the unmount disposal effect, which walks the
  slots directly (`slot.generation++` then each cancel) without calling
  `retire` — any labelled render handle this change adds must be handled on
  both paths. A far-band rule needs to reach the *render* handle
  alone — and to run `dropStale`, since a cancelled job never runs and its stale
  PNG object URL would otherwise leak.
- **The retire/start seam already marks its own plug-in point.** The reconciler's
  survivor branch carries the comment "This is also where a *parked* entry — one
  cancelled unstarted by a future far-band rule — would be restarted when its
  tile comes back."
- **`Grid` has an `IntersectionObserver`.** One per grid, built in a single effect
  keyed on `[entries, onPeek]`, observing `[data-dir-tile]` (written only by the
  `dir` branch), calling `observer.unobserve(record.target)` on first intersection
  and raising `onPeek`. Model tiles already carry `data-model-tile={entry.path}`.

The measurement that motivates this: one flat listing = 500 model tiles =
20.21 GB of STL, at 120 MB/s ≈ 168s of I/O, two jobs wide (2026-08-18; relayed,
re-measure per task 6.2).

## Goals / Non-Goals

**Goals:**
- Time-to-image for the tiles the user is looking at is independent of how large
  the directory is.
- Effort follows attention: scrolling redirects the queue instead of adding to the
  back of it.

**Non-Goals:**
- Making the sweep cheaper. 20.21 GB must be read to thumbnail 20.21 GB; this
  changes the order, not the total. A directory left open still costs what it
  costs.
- Changing rendered output. No pixel changes, so no `RIG_VERSION` bump — the
  constant's rule is about the recipe, and scheduling is not the recipe.
- Changing the concurrency limit, the suspension rule, or the cached-lookup path.
- Cancelling cache lookups. The far band governs the render tail only (D5).
- Lowering the 500-model cap. That trades away results and belongs to
  `directory-browsing`.

## Decisions

### D1: The queue ranks; the grid supplies the ranking

`RenderQueue` gains a priority: `push` takes a key alongside the job, and `pump`
selects the best-ranked pending job rather than the oldest. The queue does not
know what a viewport is — it holds a rank per key and a way to replace the whole
ranking at once, which the grid drives. Keeping the visibility model out of the
queue keeps it testable without a DOM, which is how `client/test/queue.test.ts` is
written (four cells, no `@vitest-environment` pragma).

Ties keep insertion order, so behavior with no visibility information at all is
exactly today's FIFO — the fallback is the current behavior rather than something
undefined. That matters more than it did when this was drafted: `thumbEntries`
now carries preview models whose paths may never be reported by any tile. One
rank sorts *below* unranked: `far`. An unranked path merely has no tile
reporting it and could be anywhere; a far path is known to be off screen — and
far jobs are in the queue at all only through D4's warm-mesh exception, taken
when nothing better-ranked is pending.

`push` has two callers that pass no key at all, and they are not oversights to
be keyed later (2026-09-01 review): `refreshThumbnail` and `setOrbitAxis`
(`entryActions`) push renders that belong to no slot — they are registered on
no `cancels` list, so they are unparkable by construction, which is right: both
exist only because the user pressed a control, and a press is not scrolled
away. For the same reason a **keyless job ranks with `visible`**: ranking it
unranked would put a user's own re-render behind a screenful of sweep misses,
which inverts "effort follows attention" at the one moment attention is
explicit. This is the single deliberate deviation from "no visibility
information means today's FIFO": with bands in force, a pressed re-render no
longer waits behind sweep work that merely got there first.

*Alternative — a second high-priority queue:* two queues sharing one concurrency
budget reproduces the same ranking problem with more state, and the interesting
case (a tile moving between classes as it scrolls) becomes a migration between
queues rather than a number changing.

### D2: Visibility is two observers in the one effect the grid already has

`Grid` observes its tiles and reports three coarse bands (visible, near, far)
rather than a continuous distance — the queue is two wide and cannot exploit
finer resolution, and a per-pixel ranking would re-sort the pending set on every
scroll frame for no benefit.

Three bands take **two `IntersectionObserver`s**, and the count is forced, not
chosen (2026-09-01 review). One observer has one `rootMargin` and yields two
states: a tile is in or out of the *expanded* root, so a tile 1px past the
margin is indistinguishable from one three screens past it — read as `far`,
against D4's "generously beyond the prefetch margin" — and `intersectionRatio`
is measured against the expanded root too, so visible and near both report ~1.0
and a prefetched tile scrolling onto the screen never upgrades, which is the
common case, failed silently.

**Both observers take the scroller as their `root`, and the margin is dead
without it** (2026-09-02 opus review). The intersection algorithm clips the
target against every clipping ancestor between target and root *before* the
root's margin-expanded bounds are consulted — and the scroller is `App`'s
`<main>` (`overflow-auto`), so against the default viewport root a tile
scrolled out of `<main>` has an empty rect no matter how generous `rootMargin`
is: `near` silently collapses to the viewport edge, tiles park the instant they
leave it (voiding D4's oscillation reasoning), and the peek-timing change below
never happens. `rootMargin` buys a prefetch band only when `root` *is* the
scrolling container. `App` owns `<main>`, gives it a `ref`, and passes **the
`RefObject`, never its `.current`** (round-2 review): the object's identity is
stable in a dependency list, and its `.current` is populated during commit,
before passive effects run — so the effect's skip-until-populated guard is
belt-and-braces, not a state anything waits in. Passing the element instead
would hand the first render `null` with nothing ever re-rendering `Grid` to
retry: a permanent no-observer bug invisible under a stubbed observer. The park
margin itself is a named constant with a tune-then-freeze
line (task 6.2): "generous" is a decision about oscillation and peek timing,
and it gets a recorded value, not an adjective. So: the **band observer** — the
widened existing one, rooted at the scroller — carries the park margin, and its
events are exactly the far-boundary crossings (park and unpark decisions, and
`onPeek`); a **second, margin-less observer** on the same root and the same
tiles splits visible from near, and its events are the scrollport-edge
crossings that upgrade a prefetched tile the moment it appears. Every band
transition is then an observer callback — already coalesced per frame by the
platform — so there is no scroll listener, no rect math, and no throttle of
this change's own.

`onPeek` riding the band observer is a peek-timing change, made deliberately:
today's observer has no `rootMargin`, so a folder requests its peek on touching
the viewport; here it fires at the generous park boundary, screens earlier. That
is what a prefetch band is for — the peek is a cheap advisory (`/under` with its
own 2 s budget, else the bounded walk), still one per folder per listing through
`requestPeek`'s guard, and firing it early means a folder's preview cells are
usually resolved before the tile is ever seen.

What stays true from `folder-contact-sheets`' deferral is that this is one
*effect*: the joining it recorded ("whichever lands second does the joining")
happens in the existing effect, which also creates and disconnects the second
observer; nothing gains a second lifecycle. Joining means four edits to that
effect:

- widen the query from `[data-dir-tile]` to model tiles as well — model tiles
  already carry `data-model-tile={entry.path}`, so nothing in the tile markup
  changes;
- **drop `observer.unobserve(record.target)`**. A band tracker must keep watching a
  tile after it first appears, and losing the unobserve is safe because `App`'s
  `requestPeek` already refuses a repeat with
  `if (previewsRef.current.has(path) || inFlightPeeks.current.has(path)) return`
  — that guard was the backstop for a re-observed tile and becomes the only guard,
  which is why it is named here rather than left implicit;
- report bands through D3's `setBands` instead of only raising `onPeek`;
- read `previews` through a ref, not the dependency array (revised 2026-09-02;
  the 09-01 fold-in put it in the deps, and the opus review priced that
  honestly: `requestPeek`'s `land` mints a new map identity per landed peek, so
  a deps entry disconnects and rebuilds *both* observers and re-observes every
  tile once per folder that peeks — the equal-map early-exit makes the
  republish free, not the observer churn, which is the larger cost). `Grid`
  keeps `previewsRef.current = previews` fresh per render, the registration
  rule reads it at report time, and a small effect keyed on `previews` alone
  republishes the already-tracked bands — no observer is touched, and a landed
  peek's models join their folder's band immediately rather than at the next
  scroll. The seam between the two effects is a ref, because two effects
  cannot share a closure (round-2 review): the tracked `Map` lives in a
  component-level `useRef` outside both, the observer effect writes its
  publish function into a `publishRef` on each run, and the previews effect —
  declared **after** the observer effect, since setups run in declaration
  order and an earlier declaration would fire against an unset ref on mount —
  calls `publishRef.current?.()`.

A folder tile registers **its preview models' paths under its own band**, and a
path that is both a visible tile and a far folder's preview takes the *nearest*
band — a per-path max — so a far band never cancels visible work. That rule is not
invented here: `folder-contact-sheets` tasks 2.2 and its "preview renders compete
with tile renders for the queue" risk state it, having deferred only the code.
Without it a preview model has no tile of its own, so it would be unranked —
after every visible tile even while its folder sits on screen. (It could not be
parked: absent is never far, D3. The registration rule is about rank, and the
nearest-band max is what keeps a *reported* far folder from parking a preview
model that is also a visible tile.)

Bands must **never** become a `Tile` prop. `tilePropsEqual` is a keys-based
shallow compare over `TileProps` (deliberately written over the keys so a new prop
is not silently skipped), so adding a band prop would report every tile as changed
on every scroll settle and re-render all 500 — undoing the memo the grid exists
under. The observer reads paths off `data-model-tile`/`data-dir-tile` in the DOM
and reports them imperatively; no band reaches React state.

### D3: The band map reaches the hook imperatively, never as a dependency

`useThumbnails` returns `setBands(map)` alongside `setThumb`, `setPlaceholder` and
`discardThumbFraming`; `App` holds it by identity and passes it to `Grid`, exactly
as it holds `onPeek`. Its contract, documented where it is declared: **idempotent,
latest-wins per path, and safe to call at scroll-settle frequency** — it replaces
the queue's ranking wholesale, parks slots that moved to `far`, and restarts
parked slots that moved back, all without a React re-render.

Three clauses of that contract are load-bearing enough to spell out
(2026-09-01 review):

- **Idempotent means cheap when equal** — `setBands` early-exits on a map equal
  to the one in force, before touching the queue or any slot. The caller cannot
  guarantee rarity: `shownEntries`' identity changes on every find-filter
  keystroke, which re-runs the observer effect and republishes ~500 unchanged
  bands — exactly the per-keystroke walk D3 rejects as a dependency, re-imported
  through the observer unless the equal case costs nothing.
- **Absent is not far.** A path missing from the map is *unreported* — it ranks
  in the middle class (D1) and is never parked. Only an explicit `far` report
  parks. The distinction is easy to erase in a wholesale replacement — a
  `setBands` that defaulted missing paths to `far` would pass every ordering
  test while parking the world — so it is stated here and asserted (task 5.1).
- **Slots are resolved through `slotsRef` at call time, never through captured
  references.** A band map is a message from the DOM's past; a slot may have
  been retired (navigation, mtime change) between the report and this call, and
  a park or restart applied to a captured slot object would act on work the
  reconciler already ended. A path with no live slot is ignored.

**The map in force lives in a hook-held ref, and it is read, not only pushed**
(2026-09-02 opus review). `setBands` stores the accepted map (the equality
early-exit already requires keeping it); the lookup tail and the kept-job
start-time check read it (D4). Without the read side, park-ness exists only at
the moment a report is applied, and every slot created *after* the last report
slips through: StrictMode's unmount→remount clears `slotsRef` while the
observers republish an identical map — the early-exit then guarantees no
replay, so in dev nothing is ever parked — and a same-path-new-mtime entry is a
removal-then-addition whose fresh slot starts unconditionally, far or not.
Deriving "is this far?" at push time from the ref makes park-ness a property of
the moment work would be committed, and all of those orderings stop mattering.

**Filter-hidden models are reported far, by `App`** (2026-09-02 opus review —
the sharpest "effort follows attention" case, previously unmentioned). `Grid`
renders `shownEntries` while the hook sweeps `thumbEntries`, so a model hidden
by the find filter has a slot but no tile: unreported, never parked, ranked
*above* far — with a filter narrowing 500 tiles to 3, the sweep would go on
reading gigabytes for the 497 just filtered away. `Grid` cannot report what has
no DOM node, but `App` knows the difference: it wraps the `setBands` it hands
to `Grid`, adding `far` before forwarding. Two halves of that rule are
load-bearing, and the first draft of this paragraph got both wrong (round-2
review):

- **The hidden set is `entries` minus `filteredListing`** (model paths only;
  the anchor is prepended separately and so exempt) — the tiles the filter or
  a kind restriction actually hid, both deliberately. It is *not*
  "`thumbEntries` minus `shownEntries`": preview models are appended to
  `thumbEntries` precisely because they are not tiles, so that difference
  contains every folder-preview model on every report, and stamping those far
  is what task 2.3 and the delta's shown-inside-another-tile scenario forbid —
  it would park the sheet cells of a folder the user is looking at.
- **The merge never overwrites a band the incoming map reports** — the
  per-path max of D2, applied at `App`'s layer. Needed even with the scoped
  set: a filter-hidden *tile* can simultaneously be a **visible folder's
  preview cell**, and the folder's registration must win, or the model is
  parked while something showing it is on screen.

The wrapper itself is identity-stable — `useCallback` with an empty dependency
list, reading the two lists through refs kept fresh per render, the idiom
`requestPeek` already uses (`previewsRef`, `listingRef`). Built on the lists
directly it would change identity per find-filter keystroke *and* per landed
peek (`thumbEntries` memoises over `previews`, which is a new map per landing),
and anything unstable handed to `Grid`'s observer effect re-imports exactly the
rebuild churn the previews-ref decision above removed. Clearing the filter
changes `shownEntries`, re-runs the observer effect, and the fresh merged
reports unpark what comes back on screen or near it; models still off screen
now report `far` honestly and stay parked, which is the rule working, not a
gap.

The alternative — a `bands` argument beside `ao` and `poses` — is rejected and
recorded so nobody simplifies back to it: bands change on every scroll settle, and
the sweep effect's dependency array is what triggers the reconciler's walk over
every entry, so a bands dependency would pay a 500-entry reconcile per scroll for
a signal the reconciler does not read.

The corollary is that **unparking cannot ride the sweep effect at all.** A parked
slot's `ao` and `pose` are unchanged, so the survivor branch `continue`s it; and
visibility is not a dependency. `setBands` therefore restarts a parked slot
directly, which is why `EntrySlot` gains a `DirEntry` field: `start(entry, slot)`
needs the entry, and outside the effect there is no `entries` array to look it up
in. (The slot holds `mtime` today for identity; the whole entry subsumes it.)

### D4: Leaving the viewport parks work that has not started

`push` already returns a cancel handle and `pump` already honors `cancelled`; this
change finally calls it, and names the state it leaves behind.

A job that has *started* is not interrupted — it holds a renderer slot and its
mesh load is in flight, and the existing `suspend`/`whenResumed` gating is the only
safe interruption point. So the rule is precise: unstarted render work for a far
tile is parked, started work runs to completion.

**Exception — a mesh already in memory is past the expensive part** (added
2026-09-01, user review). The mesh read happens *inside* the render job
(`start`'s queued tail calls `lru.acquire`), so an unstarted job has never read
anything for itself — but the mesh can be warm from another actor: the model's
previous render under the old recipe, a lightbox session, a folder preview, a
`warm()` hover. Cancelling that job discards the cheap remainder (a GPU pass
and a PNG encode, no I/O) while the expensive part sits in a cache that will
evict it (D6), so the read risks being paid twice; finishing it makes the work
durable — a cached PNG outlives any eviction. So entering `far` parks an
unstarted render only when the mesh is neither held nor loading — `MeshLru`
gains a **held-or-loading peek** beside `has` (2026-09-02 opus review: `has`
reads only `entries`, never `loading`, so a `warm()` hover or any acquire still
in flight read as cold and their renders were parked while the read completed
anyway — the exact waste this exception exists to prevent; a kept job's
`acquire` joins the pending promise and starts no second read, so the invariant
below holds). Like `has`, the peek must never bump recency — an acquire at park
time would distort eviction toward exactly the meshes being deprioritised. A
warm-mesh render stays queued, ranked after everything else, unranked work
included: `far` is the one band *known* to be off screen, while an unranked
path merely has no tile reporting it. Kept work re-checks at start — the queue
takes it only when nothing better-ranked is pending (there is no idle notion; a
kept job can run mid-scroll-burst, bounded by everything above it going first),
and the mesh can be evicted by then. The re-check reads **the band in force
(D3's ref) first, then the mesh** (2026-09-02 opus review): a job that wakes
with its tile back on screen reads and renders — paying the read for a tile the
user is looking at is exactly right, and the unconditional mesh check written
here before stranded that tile forever: kept means never flagged, re-ranked to
visible means no unpark, so a self-park on eviction left a visible tile on
`loading` with nothing to ever restart it, against the delta's own
scrolled-away-and-back scenario. Only a job that wakes cold **and still far**
parks itself — and self-parking **sets `slot.parked`**, so the ordinary unpark
path reaches it when the tile returns. The invariant either way: **parking
never causes a mesh read** — cancelled work never reads, a withheld tail never
reads, and a job already running when its tile leaves was started by the band
it had then. The far band governs the read, not the render.

The honest bound on the exception (2026-09-02 opus review): during a fresh
sweep nearly every candidate is cold — an unstarted job has never read for
itself, and nothing else has either — so the exception mostly fires on D5's
toggle path over an already-rendered grid, and there for roughly a
`DEFAULT_BUDGET`-worth of the most recent meshes (~40 at the measured 25.1 MB
median). Task 6.2 counts kept versus parked in the real run rather than letting
"a paid read always yields a durable image" stand unmeasured.

**Parked is not finished, and not error.** `ao-refreshes-thumbnails` named this
third per-entry state and left it for whichever change landed second; this is it.
Concretely a parked slot keeps everything it is displaying — `slot.url` is
untouched, so the tile shows whatever it had: the `{ status: 'loading' }`
placeholder the reconciler wrote, an embedded-3MF preview from `setPlaceholder`, or
a previous render. It must never land in the error state `model-thumbnails`
reserves for a model that failed to load or parse.

**Parked is a slot flag, not only a queue action** (2026-09-01 review). A
cancel handle can only reach work already pushed, and the render handle and
`dropStale` are registered *inside* the lookup tail — so at the moment a park
lands, the render may not exist yet: the lookup is in flight, and this change
forbids cancelling it. Worse, this is D5's *own* path, not an edge: every
recipe or pose retirement of a parked slot runs a fresh lookup, whose tail
would push a render and read a mesh for a tile the band map already said is
far. So `EntrySlot` gains `parked: boolean`, and the lookup tail consults it
before `queue.push`: a parked slot's tail runs `dropStale` (the stale PNG it
minted would otherwise be a decoded image nothing releases) and files no
render — unless the mesh is warm, in which case the exception above applies at
the flag exactly as at the handle, and the tail pushes at the far rank. The
tail consults the flag **and the band in force** (D3's ref, 2026-09-02): a
current `far` report gates exactly as `parked` does, which is what parks work
for slots created after the last report landed — D3's StrictMode and new-mtime
cases. The gate must be the flag and the ref, never queue ranking: a
lowest-ranked job still runs eventually, and running is precisely what a parked
cold tail must not do.

The queue-side half still exists for work already pushed, and it must say what
it did: **`push`'s cancel handle reports whether the job was still pending.**
Parking fires `dropStale` only on that answer — a started job runs to
completion still owning its `staleUrl`, because its `catch` falls back to it,
and a park that revoked it out from under a render that then failed would leave
`staleUrl === undefined` with `alive()` still true: the error state this
decision forbids, written by the parking that promised not to.

Three ordering rules keep the flag coherent against the machinery that already
exists (2026-09-01 review):

- **`retire` never clears `parked`.** The flag is the band's fact; the
  generation is the recipe's. A pose wave retiring a parked slot leaves it
  parked — that is the whole of D5 — and a retire that cleared the flag would
  resurrect exactly the job the band map parked.
- **Unpark is never a bare `start`.** A parked slot's current generation can
  have a lookup in flight (a retirement just restarted it); a blind `start`
  beside it double-starts one slot under one generation — both passes hold the
  same generation, both stay `alive()`, two lookups land, two PUTs file, and
  the mesh is read twice. Unpark is *clear the flag, then `retire`, then
  `start`* — the same seam the reconciler already uses, which makes the
  in-flight pass dead before its successor exists. The cost is re-running a
  ~7 ms lookup in a race that is rare; the alternative is tracking in-flight
  state per generation, which is machinery for the same answer.
- Band-map application resolves slots at call time (D3's third clause); a park
  or unpark for a path whose slot was retired is a no-op. And restarts carry no
  mtime re-check: a parked entry that returns at a new mtime is the
  reconciler's ordinary removal-then-addition on one key — the parked slot is
  retired and replaced, never unparked into staleness.

*Risk:* fast scrolling could park and restart the same tile repeatedly. The `far`
band is defined generously (well beyond the prefetch margin) so that oscillation
needs deliberate effort, and restarting is cheap — the expensive part is the mesh
read, which a parked job never began: under the exception above, parked jobs are
exactly the cold ones (D6).

### D5: A recipe change re-looks-up a parked slot but does not un-park its render

The question this change had to answer, because it lands second: when the
occlusion preference or the index's pose changes under a slot the far band has
parked, does the parking survive?

*Recipe-labelled thumbnails* requires that a preference change "answer on the
listing in front of the user, showing a render already cached under the new
setting at once and rendering only what is not", and that a preference change
"cancels the in-flight pass whole". The second stays literally true under the
rule taken here; the first does **not** — a parked far tile with a cold mesh
renders *less* than "what is not [cached]", and that sentence's own contrast
("not only to those a subsequent visit rebuilds") scopes it to the whole
listing, not the viewport. Claiming both held was the 2026-09-02 opus review's
third finding: after archive the main spec would have carried both sentences,
contradicting each other, invisible to `openspec validate`. So the delta now
carries a second MODIFIED block qualifying that one clause — parked off-screen
work is looked up at once and rendered when its tile returns (or completed
behind on-screen work where its mesh is held) — and the rule here is what that
qualified sentence describes:

**Retirement restarts the lookup for every slot, parked or not; only the render
tail stays parked.** The lookup never touches the queue — it runs under
`lookupLimit`'s own concurrency of 8 at ~7 ms a call — so a parked far tile whose
new-recipe render is already cached repaints immediately, like every other tile. A
parked far tile whose new recipe is *not* cached does not push a render; it stays
parked and renders when its tile comes back — unless its mesh is still warm, in
which case D4's exception applies at the flag exactly as at the handle: the
cheap tail is pushed at the far rank and finishes once nothing better-ranked is
pending, making the new-recipe image durable before eviction takes the mesh.
Mechanically this is the lookup tail consulting `slot.parked` and the band in
force (D4's gate, flag and ref both — the ref half is what catches a slot
created after the last report, which a retirement's fresh lookup reaches too): the
retirement's fresh lookup runs for every slot, and it is the tail's own gate —
never queue ranking — that withholds or files the render.

A parked tail always restarts under the slot's **current** `(ao, pose)`, never the
recipe it was parked under. That falls out of the design rather than needing
enforcement: parking does not freeze a pass, it cancels one, and unparking calls
`start(entry, slot)`, which reads `slot.ao` and `slot.pose` as they are then.

*Cost, stated honestly:* a toggle over a 500-tile grid issues 500 cache lookups,
where the strictest reading of "effort follows attention" would issue only the
visible ones. At concurrency 8 and 7 ms that is the cost the cached-lookup
requirement already blesses by design — "a directory whose thumbnails are all
cached fills at the speed of the cache" — and it buys exact compliance with the
sentence above.

*Alternatives rejected:* **parking wins** (record the new recipe on the slot and
start nothing until the tile returns) is cheaper but contradicts that sentence for
far tiles, which would go on showing the old recipe's image. **Preference wins**
(un-park and start everything, today's behaviour) re-pushes ~500 far jobs that the
current band map cancels again on the next `setBands` — paying to un-decide.

### D6: The mesh LRU decides what parking may discard

A restarted job whose mesh is still held costs nothing to redo — `lru.acquire`
is a memory hit (`MeshLru` is the hook's only way in) and the job skips straight
to rendering. But that sentence has a lifetime: `MeshLru` is byte-budgeted
(`DEFAULT_BUDGET`, ~1 GB of parsed geometry) and the proposal's own measurement
puts the median model at 25.1 MB, so a few dozen meshes fit and a 500-tile sweep
churns them continuously. A parked warm-mesh tile that returns minutes later has
usually been evicted, and the read — the one irreversible cost — is paid again.
D4's warm-mesh exception is what closes that gap: work whose read is already
paid is finished while finishing is still cheap, and the PNG it files is durable
where the LRU entry is not. What parking discards is then only work that had
incurred no cost. The recheck seam is as D4 states it, not the LRU alone
(round-2 review — this sentence originally lagged the H2/M7 fold-ins): at park
time the **held-or-loading peek** says which jobs are past the expensive part,
and at start time the **band ref comes first**, with the peek behind it — the
LRU answers "is the cheap path still cheap", never "may this run".

## Risks / Trade-offs

- [Total sweep time is unchanged; a user who opens a big directory and waits sees
  no improvement] → accepted and stated in the proposal. The complaint being fixed
  is "the tiles I am looking at take minutes", not "the directory takes minutes".
- [Reordering could starve tiles that are never visible] → they are never visible;
  the queue drains them once the visible set is satisfied, in insertion order among
  themselves (D1's tie rule).
- [A preview model no tile reports is unranked, and could read as far] → D2's
  per-path max under the folder tile's band, which `folder-contact-sheets` already
  specified and left to this change to build. Its own risk note is the citation.
- [`IntersectionObserver` in tests] → happy-dom *ships* one whose `observe` and
  `disconnect` are `// TODO: Implement`, so a real one reports nothing and every
  test passes by never running. `client/test/folderSheets.test.tsx` already carries
  the `StubObserver` and `vi.stubGlobal('IntersectionObserver', StubObserver)` that
  fix this, plus an `intersect(el)` helper and an `awayAndBack()` helper —
  **extend them, don't merely reuse them** (2026-09-02 opus review): `intersect`
  delivers `isIntersecting: true` to *every* live observer watching the element,
  which with two observers per grid always reads `visible` — `near` needs one
  observer addressed and not the other, and `far` needs a `false` report,
  neither expressible today. The stub gains an observer selector and the helper
  an intersecting argument (e.g. `report(el, {inPark, inView})`), and
  `awayAndBack()`'s docstring — which credits `unobserve` for stopping a second
  report — is updated when task 2.2 drops the unobserve. D1's split keeps the
  queue's own priority tests DOM-free.
- [Scroll-driven re-ranking on a 500-tile grid could itself cost frames] → D2's
  throttling and three-band coarseness bound it, D3 keeps it out of React
  entirely, and the ranking is a map replacement, not a re-sort per tile.
- [A parked job leaving a tile visually stuck] → D4 keeps the tile exactly as it
  was, never error, and restarts on re-entry; a test pins that a scrolled-away-and-
  back tile ends up rendered.
- [Parking fights the pose wave's retirements] → it cannot: a pose wave retires and
  re-`start`s through the reconciler, and D5 makes that path park-aware rather than
  park-blind. The wave's own re-look-up still happens for every entry; only the
  render tail of a far tile is withheld.
