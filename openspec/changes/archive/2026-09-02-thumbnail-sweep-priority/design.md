# Design — thumbnail-sweep-priority

> **Amended 2026-09-02** after the parked implementation was measured against
> the real library and code-reviewed: parking is replaced by deferral (D4), the
> folder-cell rank moves one band worse (D2), and the review's ten findings are
> dispositioned in D6. Decisions D1–D3 and D5 are edited in place; the
> superseded parked text is in git history (`313da25`), not here.
>
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
written (twelve cells now, no `@vitest-environment` pragma).

Ties keep insertion order, so behavior with no visibility information at all is
exactly today's FIFO — the fallback is the current behavior rather than something
undefined. That matters more than it did when this was drafted: `thumbEntries`
now carries preview models whose paths may never be reported by any tile. One
rank sorts *below* unranked: `far`. An unranked path merely has no tile
reporting it and could be anywhere; a far path is known to be off screen — and
far is real work, taken when nothing nearer is pending — which is how a
listing left open drains itself nearest-first (D4, amended).

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
events are exactly the far-boundary crossings (the `far` rank, and
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
  scroll. `publish` is a component-level callback over refs — the tracked `Map` in a
  `useRef`, `previewsRef`, and the `onBands` prop — so both effects call the
  same function in any declaration order (code-review finding 10 retired the
  `publishRef` seam, whose correctness hung on a comment). It publishes a path
  only once **both** observers have reported it (finding 6: a defaulted half
  is a defaulted band, against the delta's "never defaulted"; until then the
  path is unreported), and returns early while the tracked state is empty
  (finding 3: a re-landing's previews effect must not report an empty world).

A folder tile registers **its preview models' paths one band worse than its
own** (amended 2026-09-02: visible → near, near → far, far → far), and a path
that is both a tile and a folder's preview takes the *nearest* of its positions
— a per-path max — so a far band never outranks visible work. One band worse,
because cells at the folder's own band outran the model tiles the user was
scrolling toward (measured; D4): a folder one or two screens above is `near`,
its cells tied with the near model tiles below and first in listing order. A
sheet is a folder's decoration; the tiles beside it are what the user came for. That rule is not
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
the queue's ranking wholesale — and touches no slot: position ranks work, it
never withholds it (D4) — all without a React re-render.

Three clauses of that contract are load-bearing enough to spell out
(2026-09-01 review):

- **Idempotent means cheap when equal** — `setBands` early-exits on a map equal
  to the one in force, before touching the queue or any slot. The caller cannot
  guarantee rarity: `shownEntries`' identity changes on every find-filter
  keystroke, which re-runs the observer effect and republishes ~500 unchanged
  bands — exactly the per-keystroke walk D3 rejects as a dependency, re-imported
  through the observer unless the equal case costs nothing.
- **Absent is not far.** A path missing from the map is *unreported* — it ranks
  in the middle class (D1), above far. Only an explicit `far` report defers. The distinction is easy to erase in a wholesale replacement — a
  `setBands` that defaulted missing paths to `far` would pass every ordering
  test while parking the world — so it is stated here and asserted (task 5.1).
- **The map is a message from the DOM's past, and `setBands` acts on nothing
  but the queue.** It resolves no slots — there is no per-slot work to apply a
  report to (D4) — so a report that arrives after the listing it described has
  gone can only misorder for one batch, and the per-listing reset below stops
  even that.

**The accepted map is kept only for the early exit, and reset per listing**
(amended 2026-09-02). With no park gate there is nothing to read it at commit
time; it exists so a republished-but-equal map costs nothing. When the
*listing* changes the hook drops it and clears the queue's ranking (code-review
finding 5): a previous listing's `far` verdict must not order a new listing's
work, and a same-path survivor starts unreported until the new grid reports.
"The listing" is App's own `entries`, passed as a separate `listingKey` — not
the `entries` the hook sweeps, which is `thumbEntries` and is rebuilt whenever
a folder peek lands. Keyed on that, the reset fired at exactly the moment the
user had stopped scrolling and the peeks answered, and every pending job fell
back to listing order until the next scroll (2026-09-02 second review, F1 —
found by a reproducing cell, which now stands as the regression).

**Filter-hidden models are reported far, by `App`** (2026-09-02 opus review —
the sharpest "effort follows attention" case, previously unmentioned). `Grid`
renders `shownEntries` while the hook sweeps `thumbEntries`, so a model hidden
by the find filter has a slot but no tile: unreported, ranked *above* far — with a filter narrowing 500 tiles to 3, the sweep would go on
reading gigabytes for the 497 just filtered away. `Grid` cannot report what has
no DOM node, but `App` knows the difference: it wraps the `setBands` it hands
to `Grid`, adding `far` before forwarding. Two halves of that rule are
load-bearing, and the first draft of this paragraph got both wrong (round-2
review):

- **The hidden set is `entries` minus `filteredListing`** — the tiles the
  filter or a kind restriction actually hid, both deliberately (the anchor is
  prepended separately and so exempt): a hidden *model* by its path, and a
  hidden *folder* by its preview cells' paths (code-review finding 2: left
  unreported, a hidden folder's cells ranked above genuinely far work — reads
  and renders for content the user just filtered away). It is *not*
  "`thumbEntries` minus `shownEntries`": preview models are appended to
  `thumbEntries` precisely because they are not tiles, so that difference
  contains every folder-preview model on every report, and stamping those far
  is what task 2.3 and the delta's shown-inside-another-tile scenario forbid —
  it would defer the sheet cells of a folder the user is looking at behind
  everything.
- **The merge never overwrites a band the incoming map reports** — the
  per-path max of D2, applied at `App`'s layer. Needed even with the scoped
  set: a filter-hidden *tile* can simultaneously be a **visible folder's
  preview cell**, and the folder's registration must win, or the model is
  deferred behind everything while something showing it is on screen.

The wrapper forwards the report untouched when `filteredListing` *is*
`entries` by identity — the unfiltered case, where a 500-entry Set would be a
guaranteed no-op per batch (finding 9). The wrapper itself is identity-stable — `useCallback` with an empty dependency
list, reading the two lists through refs kept fresh per render, the idiom
`requestPeek` already uses (`previewsRef`, `listingRef`). Built on the lists
directly it would change identity per find-filter keystroke *and* per landed
peek (`thumbEntries` memoises over `previews`, which is a new map per landing),
and anything unstable handed to `Grid`'s observer effect re-imports exactly the
rebuild churn the previews-ref decision above removed. Clearing the filter
changes `shownEntries`, re-runs the observer effect, and the fresh merged
reports re-rank what came back; models still off screen report `far` and wait
their turn, which is the rule working, not a gap.

The alternative — a `bands` argument beside `ao` and `poses` — is rejected and
recorded so nobody simplifies back to it: bands change on every scroll settle, and
the sweep effect's dependency array is what triggers the reconciler's walk over
every entry, so a bands dependency would pay a 500-entry reconcile per scroll for
a signal the reconciler does not read.

`EntrySlot` holds its `DirEntry` (task 3.2). The reason it was added — a
restart from outside the sweep effect — went with the parked design; it stays
because the removal loop reads `slot.entry.mtime` and the sibling change
`immutable-thumbnail-serving` sits its `thumbGen` beside it.

### D4: Position ranks work; it never removes it (amended 2026-09-02)

**Why this replaced parking.** The parked design — cancel a far tile's
unstarted render, resurrect it when the tile returns — was built, reviewed
twice and measured. The deep-scroll number held (2.2 s to first visible image).
Three things did not, all measured 2026-09-02 against the real library:

- **The sweep stopped at the near boundary and never used idle time.** After
  visible and near filled, 306 uncached models sat parked while the disk was
  idle for 100 s of watching; anything past two screens stayed bare however
  long the user waited. The proposal's own Non-Goal — "a directory left open
  still costs what it costs" — implied the sweep completes; parking made that
  false, and a user who idled expecting the app to work ahead was right to.
- **Folder sheets outran the model tiles the user was scrolling toward.**
  Cells ranked at their folder's band, and a folder one or two screens above
  stays `near` — tied with the near model tiles below, and first in listing
  order, so the sheet won.
- **The resurrection machinery was the change's largest surface and its
  largest defect source.** The flag, `parkTail`, unpark as clear→retire→start,
  the held-or-loading peek and the wake-up re-check drew round-2 findings N2
  and N8 and the code review's 3, 4, 5 and 8 — every one a race or a leak in
  how removed work came back.

**The rule now.** The lookup tail always pushes its render, keyed by path. The
queue ranks visible → near → unreported → far (D1), and **far is real work,
taken when nothing nearer is pending**. Everything parking bought is still
true while the user is active — there is always nearer work, so a passed
tile's mesh is not read — and what parking took away comes back the moment
nothing nearer remains: the queue drains nearest-first, which is idle draining
without a feature for it, and any scroll puts the newly visible tiles ahead of
that drain again (a started far job finishes its ~1–2 s, then rank rules).

**No per-entry state.** A deferred tile is a loading tile whose job waits at
the back of the queue — it keeps whatever it shows and never enters error.
`ao-refreshes-thumbnails` left a third state for this change to name; the
answer is that none is needed. `EntrySlot` loses `parked` and `parkTail`;
`MeshLru` loses `holds`; the hook loses `startRef` and the unpark seam. The
sweep effect's retire/start branch is once again the only restart path, and
D5 needs nothing park-aware.

**What is given up, stated honestly.** A far tile's mesh can now be read when
the user is idle — that is the point — and briefly while the user scrolls
inside fully cached content, where the queue has nothing nearer to do. The
invariant is therefore *far work never runs ahead of nearer work*, not *far
work never runs*. The queue holds every miss's job for the listing's life
(~500 at the flat cap), scanned per `take`; finding 7's husk-splice keeps that
scan to live jobs, and at n=500 it is microseconds. And a job that carries a
stale-hit PNG (a rig or label upgrade, a pose wave over an unposed listing)
keeps that Blob alive until it runs or is retired — under parking the far
job's cancel released it at once. Up to ~500 decoded PNGs for the length of a
drain, bounded by the listing; plain misses carry none.

**Kept from the parked design, because it was about ranking, not removal:**
the cancel handle's pending answer (`push` returns it), keyless presses
ranking with visible, absent ≠ far, and the band map's value-equal early exit.

### D5: A recipe change re-looks-up every slot; the fresh tail queues at the position in force

When the occlusion preference or the index's pose changes, the reconciler
retires every affected slot and starts a fresh lookup, far or not. *Recipe-
labelled thumbnails* requires that a preference change "answer on the listing
in front of the user, showing a render already cached under the new setting
at once and rendering only what is not" — the second half is qualified by the
delta's second MODIFIED block for deferred work: the lookup runs at once for
every tile (a far tile whose new-recipe render is cached repaints
immediately), and a miss's fresh tail is pushed at whatever rank the band map
gives it, taken after everything nearer. Nothing here is park-aware any more:
there is no flag for `retire` to preserve and no withheld tail to resurrect.

A deferred tail always renders under the slot's **current** `(ao, pose)`: the
job reads them when it runs, and a retirement in between kills it through the
generation check before it can draw stale pixels.

*Cost, stated honestly:* a toggle over a 500-tile grid issues 500 cache
lookups. At concurrency 8 and ~7 ms that is the cost the cached-lookup
requirement already blesses — "a directory whose thumbnails are all cached
fills at the speed of the cache" — and it buys exact compliance with the
sentence above.

### D6: Review disposition (2026-09-02 code review by model-browser-agent-2, opus finders)

Ten verified findings and four test nits against the parked implementation
(`1f107e4..78a4e82`). How each lands under the amendment:

| # | Finding | Disposition |
|---|---|---|
| 1 | Peek timing contradicts `directory-browsing`'s "when the tile is on screen" — archive blocker | **Fixed**: a `directory-browsing` delta MODIFIES *Folder tiles preview their contents* (one sentence, one scenario body); `search-cancellation`'s delta there is ADD-only, no overlap |
| 2 | Hidden *folder*'s preview cells left unreported, ranked above far | **Fixed**: App's wrapper reports a hidden folder's cells far, never overwriting a reported band (D3) |
| 3 | Previews effect republished against just-cleared observer state → mass unpark | **Dissolved + guarded**: no unpark exists; `publish` also returns early on an empty state so a re-landing never reports an empty world |
| 4 | Park loop flagged completed slots; parkTail's answer discarded → doubled lookups, interrupted renders | **Dissolved**: no park loop, no flag |
| 5 | Band map never reset on listing change → previous listing's far verdict parks a new slot | **Fixed**: the hook resets its accepted map (and the queue ranking) when `entries` identity changes; with no gate a stale verdict could only misorder, and now it cannot do that either |
| 6 | `stateOf` defaulted the unheard observer's half → derived band from defaults, order-dependent | **Fixed**: a path is published only once both observers have reported it; until then it is unreported, per the delta's "never defaulted" |
| 7 | `take` rescanned cancelled husks for the listing's life | **Fixed**: husks are spliced out as the scan meets them |
| 8 | Park gate discarded the completed lookup → re-GET per unpark | **Dissolved**: the tail is never withheld, so the lookup's answer rides in the job's closure |
| 9 | Full-map publish per batch; wrapper's 500-entry Set on unfiltered listings; observer rebuild per keystroke | **Partly fixed**: the wrapper forwards as-is when `filteredListing` is `entries` by identity (the unfiltered case). Per-batch publish (~124 µs at n=500) and the per-keystroke observer rebuild are accepted and recorded here — the rebuild is what re-observing a filtered grid costs |
| 10 | `publishRef` coupled correctness to effect declaration order | **Fixed**: `publish` is a component-level callback over refs (`bandStateRef`, `previewsRef`) and the `onBands` prop; both effects call it, in any order |
| nit | 4.3's survivor-branch rule unpinned | **Moot**: there is no unpark path for the survivor branch to be confused with |
| nit | "concurrency unchanged" rested on old cells | **Kept as is**: the queue's concurrency code is untouched by the amendment |
| nit | fake LRU's `has`/`holds` one function | **Moot**: `holds` is gone |
| nit | warm/cold control inside one `it` | **Moot**: the warm-mesh exception is gone |

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
- [A deferred job leaving a tile visually stuck] → D4 keeps the tile exactly
  as it was, never error; its job waits at the back and is taken at its new
  position on return, or at idle; a test pins that a scrolled-away-and-back
  tile ends up rendered.
- [Deferral fights the pose wave's retirements] → it cannot: a pose wave
  retires and re-`start`s through the reconciler, and the fresh tail queues at
  the rank in force (D5). Nothing is withheld, so nothing needs resurrecting.

### D7: Second review disposition (2026-09-02, fresh opus reviewer on the amended build)

| # | Finding | Disposition |
|---|---|---|
| F1 | The per-listing ranking reset keyed on `thumbEntries` identity, which a landed peek rebuilds — the ranking was wiped right after the user stopped scrolling | **Fixed**: `useThumbnails` takes a `listingKey` (App's `entries`) for the reset; the reviewer's reproducing cell is the regression |
| F2 | The folder-cell rule's cell passed with `CELL_BAND` reverted; §7.7 claimed otherwise | **Fixed**: the cell releases the cell's lookup first, so it only passes if rank decides; §7.7's claim corrected |
| F3 | D3 still described `setBands` parking and restarting slots | **Fixed**: edited in place; code comments in `App` and `queue` likewise |
| F4 | The 6.2 run record measures the parked build without saying so; the deep-scroll headline was not re-measured under deferral | **Fixed**: the record is labelled, and 7.7's record carries the deferral re-measurement |
| F5, F6 | Nearest-wins and never-overwrite unfalsified | **Fixed**: cells stage a contradicting push order |
| F7, F10 | Empty-state guards unfalsified; an all-half-heard batch could publish an empty map | **Fixed**: `publish` also returns on an empty *result*; both guards recorded here as defensive |
| F8 | Stale-hit PNGs retained for the drain | **Recorded** in D4's honesty paragraph |
| F9 | `state.clear()` below the empty-listing early return | **Fixed**: cleared first |
| F11 | `push`'s docstring claimed a consumer for the pending answer | **Fixed**: the docstring says nothing reads it and why it stays |
| F12–F14 | Twelve cells not four; `PARK_ROOT_MARGIN` vocabulary; root/margin unfalsifiable under the stub | **Fixed** the first two (renamed `FAR_ROOT_MARGIN`); the third is inherent to happy-dom and covered by E2E 6.2a/7.7 |
