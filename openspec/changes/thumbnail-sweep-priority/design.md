# Design — thumbnail-sweep-priority

> **Rebased 2026-09-01.** Every citation below was re-checked against main at
> `62f9f2d`. The pre-rebase draft's Context was written against a
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
  the lookup) `dropStale` and the `queue.push` handle. Only `retire` fires them,
  and it fires all of them. A far-band rule needs to reach the *render* handle
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
far jobs are in the queue at all only through D4's warm-mesh exception, as
idle-time work.

*Alternative — a second high-priority queue:* two queues sharing one concurrency
budget reproduces the same ranking problem with more state, and the interesting
case (a tile moving between classes as it scrolls) becomes a migration between
queues rather than a number changing.

### D2: Visibility extends the observer the grid already has

`Grid` observes its tiles and reports which are intersecting, plus a margin so the
next screenful is already warm. Reporting is throttled and coarse — three bands
(visible, near, far) rather than a continuous distance — because the queue is two
wide and cannot exploit finer resolution, and because a per-pixel ranking would
re-sort the pending set on every scroll frame for no benefit.

This is not a new observer. `folder-contact-sheets` landed one as the *standalone*
observer precisely because this change had not landed, and recorded that
"whichever lands second does the joining". Joining means three edits to the
existing effect:

- widen the query from `[data-dir-tile]` to model tiles as well — model tiles
  already carry `data-model-tile={entry.path}`, so nothing in the tile markup
  changes;
- **drop `observer.unobserve(record.target)`**. A band tracker must keep watching a
  tile after it first appears, and losing the unobserve is safe because `App`'s
  `requestPeek` already refuses a repeat with
  `if (previewsRef.current.has(path) || inFlightPeeks.current.has(path)) return`
  — that guard was the backstop for a re-observed tile and becomes the only guard,
  which is why it is named here rather than left implicit;
- report bands through D3's `setBands` instead of only raising `onPeek`.

A folder tile registers **its preview models' paths under its own band**, and a
path that is both a visible tile and a far folder's preview takes the *nearest*
band — a per-path max — so a far band never cancels visible work. That rule is not
invented here: `folder-contact-sheets` tasks 2.2 and its "preview renders compete
with tile renders for the queue" risk state it, having deferred only the code.
Without it a preview model has no tile of its own, so it would be unranked (after
every visible tile) and, worse, could read as far and be parked forever.

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
unstarted render only when `MeshLru.has(entry.path)` answers false (`has` is a
peek, not an acquire — it does not bump recency, so asking does not distort
eviction, and it must stay that way). A warm-mesh render stays queued, ranked
after everything else, unranked work included: `far` is the one band *known* to
be off screen, while an unranked path merely has no tile reporting it. Kept
work re-checks at start — the queue drains it only at idle, and the mesh can be
evicted by then — and a job that wakes to a cold mesh parks itself at that
point instead of loading. The invariant either way: **a far tile never
triggers a mesh read** — the far band governs the read, not the render.

**Parked is not finished, and not error.** `ao-refreshes-thumbnails` named this
third per-entry state and left it for whichever change landed second; this is it.
Concretely a parked slot keeps everything it is displaying — `slot.url` is
untouched, so the tile shows whatever it had: the `{ status: 'loading' }`
placeholder the reconciler wrote, an embedded-3MF preview from `setPlaceholder`, or
a previous render. It must never land in the error state `model-thumbnails`
reserves for a model that failed to load or parse. Parking also runs `dropStale`,
because a cancelled job never runs and the stale PNG the lookup minted would
otherwise be a decoded image nothing releases.

Reaching the render handle alone requires giving it a name. `slot.cancels` is
flat and unlabelled and only `retire` fires it, so parking as written today would
kill the lookup too. The slot gets a separately-reachable render handle beside the
list.

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
"cancels the in-flight pass whole". Both stay literally true under the rule taken
here:

**Retirement restarts the lookup for every slot, parked or not; only the render
tail stays parked.** The lookup never touches the queue — it runs under
`lookupLimit`'s own concurrency of 8 at ~7 ms a call — so a parked far tile whose
new-recipe render is already cached repaints immediately, like every other tile. A
parked far tile whose new recipe is *not* cached does not push a render; it stays
parked and renders when its tile comes back — unless its mesh is still warm, in
which case D4's exception applies at restart exactly as at park time: the cheap
tail is pushed at the far rank and finishes at idle, making the new-recipe image
durable before eviction takes the mesh.

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
incurred no cost, and the LRU is the recheck seam that keeps it so: `has` at
park time says which jobs are past the expensive part, and `has` again at start
time says whether that is still true.

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
  fix this, plus an `intersect(el)` helper and an `awayAndBack()` helper — reuse
  them rather than writing a second stub. D1's split keeps the queue's own priority
  tests DOM-free.
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
