# Design — thumbnail-image-serving

> Reviewed twice before implementation (2026-09-02). D8 dispositions the
> second review's twenty-three findings; D0, D3's seeding rule, D7 and D5's
> liveness bound exist because of it.

## Context

The cached-thumbnail path today, per tile: `useThumbnails`' `start` pushes a
lookup into the module-level `lookupLimit` (`makeLimiter(8)`, plain FIFO);
the lookup calls `ApiClient.getThumb`, which GETs `/api/thumb?path&mtime[&ao][&gen]`;
the server (`app.ts`'s `/api/thumb` handler, `ThumbCache.get`) answers JSON
carrying the labels (`lighting`, `rig`, `posed`), the stored `camera`/`axis`,
the write `gen`, and — on a hit — the PNG base64-encoded in `png`, bumping
the PNG's mtime (`utimes`) as the LRU clock `maintain`'s size-cap sweep
evicts by; `ApiClient` decodes into a `Blob` and mints an object URL
(`base64ToBlobUrl`); the hook's hit branch applies its usability test
(`cached.lighting === THUMB_LIGHTING && cached.rig === RIG_VERSION && !poseStale`)
and calls `setThumb`, whose ownership (`slot.url`, revoke on
displace/remove/unmount) the hook carries and which, since `a2c5c28`, adopts
the answer's `gen` absence included. `Tile` renders `thumb.url` through
`ThumbView` — shared with folder-sheet cells — as an `<img src>` with no
declared box; `overlayRectFor` (`App.tsx`) returns that `<img>`'s own rect
when one exists.

The sweep effect handles a new entry as `slots.set` → `added.push` →
`start(entry, fresh)`, and *after the loop* seeds every added path
`{ status: 'loading' }` in one `setThumbs` updater. Nothing in `start` writes
state synchronously today — its first act is a lookup that suspends on
`await` — so that seed always lands first. A survivor whose `ao` and pose are
unchanged is `continue`d and its `slot.entry` is never updated.

`immutable-thumbnail-serving` (2026-09-02) gave the JSON GET three cache tiers
— `immutable` when the request names the current `gen`, an `ETag`/304 tier
otherwise, `no-store` on a miss. That makes a revisit's JSON *cacheable*; it
does not make it free. Its Non-Goals rule out an image response on the
grounds of the base64 overhead alone; the profile in the proposal shows the
read and the request are the cost.

`listing-tree-cache` D7/§6 (drafted, not landed) adds an in-memory per-path
thumbnail-state index to `ThumbCache`, attached to `DirEntry` at emission in
`app.ts` beside `applyDisplayNames` — which is called at three sites (the
directory listing, the flat listing, `/api/peek`); the two scoring routes
return `hitsToEntries`' entries directly. That change's 6.3 already names
this change's field shape (D2) as the seam to adopt.

Measured (2026-09-02, this session, real library, flat root, ~60% cached):
618 lookups, 49.7 MB, 65 s wall, worst single lookup 3.7 s — ~765 KB/s over
loopback, i.e. disk-bound: the sweep's far drain was reading 2.4 GB of meshes
off the same USB head. `/api/dir` 434 ms; poses 37 ms. Through the dev proxy
(`'/api'` → `127.0.0.1:3177`) and the Hono server alike this is HTTP/1.1 on
one origin: the browser's ~6 connections are *fewer* than today's 8-wide
limiter, so "native parallel fetching" is not a benefit here and is not
claimed.

## Goals / Non-Goals

**Goals:**
- A first visit answers the tiles the user is near first: lookups are ranked
  by the band map, far last.
- A cached tile the listing can vouch for costs the browser one native image
  fetch when it approaches, and on a revisit zero bytes.
- The lookups that remain are ranked by the band map, so a visible tile's
  answer never waits behind off-screen ones.
- A pending lookup for a tile nearer than far is never starved by the sweep's
  far drain — and the drain can never be frozen by a wedged lookup.

**Non-Goals:**
- Replacing `GET /api/thumb`. It stays byte-for-byte as the answer for what
  the listing cannot say and for every client written against it.
- Changing what a thumbnail looks like, the recipe, `RIG_VERSION`, the cache's
  on-disk shape, or the PUT.
- Folding poses into the listing (`listing-tree-cache` §6.1; the wave costs
  37 ms).
- Building the thumbnail-state index (§6.2); this change reads it and adds
  fields to it.
- Serving freshly rendered pixels through the image route: a just-rendered
  PNG is in memory as a Blob, and re-fetching it is a round trip for bytes the
  client has.
- Giving `getThumb` an abort signal. Its absence is why D5 needs a liveness
  bound rather than a cancellation; fixing it is a separate, wider change.

## Decisions

### D0: Lookups are ranked, not held — and this lands first

The alternative the first draft never weighed: the band map already tells
the hook which tiles are far, and today's `makeLimiter(8)` looks tiles up in
listing order, so a visible tile's cache hit waits behind hundreds of
off-screen ones. The lookup queue therefore takes the sweep's ranking (D4):
visible, near, unreported, far. A pure client change on machinery that
exists, no server work, no dependency on `listing-tree-cache`; §0 of the
tasks, landed 2026-09-02.

**Ranked, not held.** The second review proposed holding far lookups outright
(F23), and the first fold-in adopted that; implementing it failed a cell that
the capability's own text explains: *Client-side thumbnail rendering* says a
recipe change consults every entry's cache "at once whatever its position",
and *Recipe-labelled thumbnails* says a control "answers on the listing in
front of the user, showing a render already cached under the new setting at
once". A held far lookup leaves a far tile showing the old recipe until the
user approaches it — a contradiction the archived sweep change wrote into
main deliberately, on the grounds that a lookup is ~7 ms and never occupies
the render queue. So far lookups are *ordered last*, and they run. What that
gives up: on a fully cached first visit all 618 lookups still happen — after
the visible and near ones, whose answers are what the user is waiting for —
and those reads still share the disk with the drain (D5's gate keeps the
drain from getting in *their* way). The reads themselves go away only when
the listing can vouch for the bytes (D1–D3), which is why this change does
not stop at §0.

Measured after §0 (2026-09-02, this session, cached region of the flat root,
1280×900): the 16 visible tiles filled in **545 ms**, and their lookups
completed at ranks 0–17 of the listing's lookups — first, as ranked.

*Alternative — hold far lookups until approached:* captures the disk reads
too, and contradicts main. Recorded in D8 as F24.
### D1: An image route beside the JSON one, on the same key and the same tiers

`GET /api/thumb/image?path&mtime[&ao=off][&gen]` answers `image/png` bytes.
It shares the JSON route's key (`path + mtime + ao + gen`) and its exact cache
tiers — `immutable` when `gen` names the current generation, `ETag`/304
otherwise, `no-store` and 404 for **anything but a hit** (a `stale` answer has
camera and axis and no pixels; the route has nothing to serve) — by extracting
that tier logic into one helper both routes call, so the two cannot drift. A
request naming a superseded `gen` is answered with the current bytes under
`no-cache`: never stale pixels, merely an uncacheable answer. The route is
confined exactly as the lookup is — a path the library refuses is refused
here — and, like the JSON hit, it bumps the PNG's LRU clock (D7).

*Alternative — negotiate `Accept: image/png` on the JSON route:* one URL, two
body shapes, and `<img>` cannot send the header the client would choose with.

### D2: The listing carries the labels the client's usability test reads

Presence alone cannot let the client skip the lookup, because whether a
present render is *usable* is the client's decision: `RIG_VERSION` and
`POSE_VERSION` are client constants the server never interprets. So the
annotation carries, per occlusion variant, the labels the hit test compares —
`lighting`, `rig`, `posed` — and, entry-level, the stored `camera`/`axis`
(the lightbox opens at them exactly as it does from a lookup), the write
`gen`, and `framed`. The hook runs the *same* predicate it runs on a
`getThumb` answer — extracted so it cannot drift — on the entry, with no
request. The one thing the entry cannot vouch for is that the bytes are still
on disk, which is exactly what D3's fallback covers. `mtime` needs no field:
`DirEntry.mtime` is already the cache key's mtime.

Wire shape, additive on `DirEntry`:

```
thumb?: {
  gen: number
  framed: boolean
  camera?: CameraState
  axis?: OrbitAxis
  ao?:   { state: 'hit' | 'stale' | 'miss'; lighting?: string; rig?: number; posed?: number }
  noao?: { state: 'hit' | 'stale' | 'miss'; lighting?: string; rig?: number; posed?: number }
}
```

`state` is **derived at emission** from the index's stored sidecar mtime
against the entry's mtime — never stored as a verdict, or a file edited since
the last read would read `hit`. It is attached at every site that emits model
entries: the directory and flat listings, `/api/peek`, and the two scoring
routes' `hitsToEntries` — a meaning or similarity grid is a primary browsing
mode and would otherwise keep the full lookup cost. Payload: a framed entry
carries a whole `CameraState`, so the ~120-byte figure is optimistic; 6.2
measures it. `listing-tree-cache` 6.3 has adopted this shape.

### D3: The hook decides per entry, seeded in the sweep's own batch

**Seeding, not `setThumb`.** The annotation branch must not write through
`setThumb` during the sweep: the added-entry batch that runs after the loop
seeds every added path `loading`, and React applies queued updaters in call
order, so a synchronous `setThumb(ready)` inside `start` would be overwritten
and — with nothing pushed to any queue — never written again: a fully cached
listing spinning forever. Instead `start` returns the annotation's verdict,
the reconciler seeds `ready` at the image URL *in the same updater* it seeds
`loading` in (`next.set(path, annotationState ?? { status: 'loading' })`),
and slot ownership is assigned before it. One updater, one place.

**The verdict.** If the entry carries `thumb`, the recipe-in-force variant
reads `hit`, and the client's predicate passes (labels equal the constants,
`poseStale` false against the pose the hook holds — the pose wave lands after
the listing, and the first pass with no pose held draws from the listing
exactly as today's lookup would; the wave's arrival retires and restarts the
slot through the existing `samePose` path, which then falls through to the
lookup where `posed` predates it), the state is `ready` at
`ApiClient.thumbImageUrl(path, mtime, ao, gen)` with the entry's
`camera`/`axis` **and `gen`** — `setThumb` and the seed adopt the generation
absence included since `a2c5c28`, so omitting it would wipe the key that
makes later fetches immutable. Every other case takes the lookup path.

**Survivors re-read it.** The annotation is a new input to the pixels, so a
survivor restarts when the listing names a generation the slot has not seen
— neither the one its own lookup or PUT taught it (`slot.thumbGen`) nor the
one its previous entry carried — and a survivor's `slot.entry` is updated
either way. Not the literal `slot.entry.thumb?.gen === entry.thumb?.gen`
first drafted: that restarts a tile whose own PUT it just watched, the moment
a listing names the number it already knows, re-fetching bytes the client
holds (the Non-Goal above). A listing carrying no annotation is not a new
fact either — the server has simply not learned the entry. Without that, a tile pinned
`immutable` at gen N would ignore a listing naming N+1 — another tab, a
lightbox persist elsewhere, `bulk-thumbnail-jobs` — and show wrong pixels
with no request that could ever discover it. The cost is one restart per
write per listing refresh, whose first branch is the annotation itself.

**The image can fail to arrive.** An entry evicted between emission and fetch
answers 404 — `ThumbCache.maintain`'s size-cap sweep makes that real — and so
does an unmounted library (`/api/*` answers 503, which `<img>` reports as
`error`). The tile's `<img>` reports the failure through an `onImageError(path)`
callback — the *path*, because `ThumbView` is shared with folder-sheet cells
whose path is not the tile's — and the hook demotes that entry to the lookup
path. The refusal is **remembered on the slot as the generation the failed URL
named** (`urlGen`, recorded when the URL is built — not the entry's current
word, which a later un-annotated listing leaves `undefined`; second review
R5). Per render, not per entry: the two variants' PNGs are evicted
independently while the generation is the entry's, so the refusal carries
the variant the failed URL named (`urlAo`/`refusedAo`) and a toggle to the
other variant is still drawn from the listing (third review, R3); a bulk
reset's `refetch` refuses both. Nothing clears it: a listing naming a
*different* generation simply passes the comparison: without memory, the
next `start` for that slot — a pose wave, a toggle — would rebuild the same
URL and 404 again, and a pulled disk would turn 500 image 503s into 500
retire/start cycles.

**The box is declared.** `overlayRectFor` measures the `<img>`'s own rect,
and an `<img>` whose lazy resource has not loaded has no intrinsic size — a
press on a listing-drawn tile would open the orbit overlay at 0×0. Thumbnails
are always 512² at aspect 1 (the renderer's contract), so the tile image gets
`width: 100%; aspect-ratio: 1 / 1`, and `overlayRectFor`'s fallback also
covers an `<img>` reporting an empty rect. Until the lazy image's `load`,
`ThumbView` keeps its placeholder up over the box, so a visible cached tile
shows a spinner then the picture, never a blank square.

`loading="lazy"` and `decoding="async"` on the tile image: the browser then
fetches listing-known images by approach, a prefetch band of its own on top of
the sweep's. Object-URL ownership (`slot.url` revocation on displace, removal
and unmount) applies to `blob:` URLs only, decided by prefix; an image URL is
a string the hook does not own, and a tile can hold either over its life.

### D4: Lookups are ranked by reusing the render queue's class, not its instance

The lookups that remain are keyed, cancellable, bounded and now ranked —
which is `RenderQueue` with `suspend` never called. `lookupLimit` becomes a
module-level `new RenderQueue(8)`; `setRanking` re-pumps, so a re-ranking
that changes what runs next takes effect without waiting for a push.
Suspension cannot leak into it structurally: `App` creates and suspends only
its own `new RenderQueue(2)` and holds no reference to a module-level queue.
Cancellation on retirement is preserved verbatim — `push`'s handle joins
`slot.cancels` as before — and every lookup is keyed by path, so the
keyless-ranks-visible rule never fires for one.

**One writer for both rankings.** `setBands` is not the only writer of the
render queue's ranking: the sweep effect's per-listing reset (`4161f37`)
writes an empty map directly. A helper applies a map to both queues, and the
reset goes through it, or the lookup queue keeps a previous listing's `far`
verdict for a survivor path and holds its fresh lookup — the exact regression
that reset exists to prevent, reintroduced on the lookup side.

**Module-level state needs an owner.** A module-level queue that carries a
ranking and an `onSettle` pointing at whichever render queue was mounted last
contaminates tests (a leaked pending lookup in one test closes the far gate
in the next) and dangles on unmount. So: the hook's wiring effect clears the
gate and `onSettle` in its cleanup, and the module exports a test reset the
suite calls in `beforeEach`, beside the preference-module resets the client
test conventions already document.

### D5: Far dispatch yields to nearer lookups, and the gate cannot stick

`RenderQueue.take` skips `far`-ranked jobs while a gate says no. The signal
is **a lookup ranked nearer than far pending**, not any lookup: D5's own
reason is that a tile the user can see must not wait on a deferred tile's
25 MB read, and under D0 the far lookups run last anyway — during an AO toggle
over a 500-tile grid (the archived D5's blessed 500-lookup storm) the far
tiles' pending lookups would otherwise stall the drain for tiles nobody is
waiting on.

**Liveness.** `getThumb` takes no abort signal and has no timeout; a
retirement's cancel cannot reach an in-flight `await`. One lookup stalled on
a contended disk would close the gate for the life of the tab and silently
revoke the sweep's "a listing left open warms itself" — so the gate is
time-bounded inside the queue: once it has read closed for `FAR_GATE_MAX_MS`
(a few seconds — tuned in 6.2, above the measured worst lookup of 3.7 s)
`take` dispatches far work regardless, and the bound is stated in the spec.

**The reset window.** Every navigation applies an empty ranking to both
queues (D4), so until the grid publishes its first bands every pending
lookup is *unreported* — nearer than far by definition — and the gate reads
"any lookup pending" for exactly the window in which a fresh listing's
cached tiles are filling. F8's nearer-than-far refinement bites only once
bands are in; that is the right order (review R10).

**Contiguous hold.** The bound's clock measures a contiguous run of held far
work: it resets whenever a take passes without holding a far job — the gate
read open, or there was nothing far to hold. Left running across a gap (a
navigation retires the far jobs; new far work is pushed after the bound),
the clock would already have expired and the new job would dispatch at once
under a closed gate, defeating the gate until some take happened to read it
open (review R1, verified under Bun with a faked clock).

**When the clock is forgotten.** On an open reading; on a take that meets no
live far job (`take` scans to the end, never breaking at a visible job, so
husks behind one are spliced and a far job behind one is met); when a
cancel retires the last live far job — the cancel handle checks, because a
saturated queue takes nothing and a navigation retires far work exactly
when its slots are busiest; and from the gate's own timer when it fires
with no live far job left, which covers a far job re-ranked nearer under
that same saturation (third review, R1). A pinned
far job — `bulk-thumbnail-jobs`' third `push` argument — is gated exactly as
a ranked-far one, in `take` and in `pendingNearerThanFar` alike, so a bulk
generate job advances in bound-sized bursts while the user browses (third
review, R8; the pin's own doc asks for no better).

**After the bound.** Once far work has been held for the whole bound, the
clock is kept rather than reset: every far job then dispatches while the
gate stays closed, so the backlog drains, and the clock is forgotten only
when the gate next reads open. Resetting on the expired path dispatched one
far job per bound — twelve renders a minute under a wedged lookup (second
review, R7). And the gate is read on the first far job a take meets, whether
or not a nearer job has already won that take, so the clock cannot depend on
arrival order (R6).

**Mechanics.** `pendingNearerThanFar` walks the live jobs — husks are
spliced only inside `take`, so it must not read `jobs.length` (a general
`pending` count was built and dropped: nothing read it). The settle signal is
`onSettle`, fired after **every** job finishes and after the decrement, not
an idle-only `onIdle`: the gate reads "nearer than far pending", and the last
*near* lookup can settle while far lookups still run — an idle signal would
then leave far renders waiting on the last far lookup. The hook's callback
pokes the render queue, whose gate re-reads the count; a closed gate arms one
timer for the bound's remainder, since a queue holding only far work has
nothing else to pump it. Nearer work is unaffected: a visible tile's render
runs beside a pending lookup for a tile the user also wants.

### D6: Rollback and coexistence

Every piece is additive: a client without the annotation takes the lookup
path; a server without the image route is never asked for it (image URLs are
built only from an annotation only that server emits); older clients ignore
`thumb`. D0's ranked lookups and the far gate are client-only and revert with the
code.

### D7: The eviction clock

`ThumbCache.get`'s hit path bumps the PNG's mtime, and `maintain`'s size-cap
sweep evicts least-recently-read by it (*Bounded, self-maintaining cache*).
Two things here touch that:

- The image route reads bytes without going through `get`. It bumps the clock
  exactly as `get` does, so a cold-browser view counts as a read.
- A browser-cached view makes no request at all — that is the revisit goal —
  and so is invisible to the server. `immutable-thumbnail-serving` opened this
  for tier-1 JSON; this change makes it the ordinary path. Recorded as the
  trade it is: the clock now means *least recently served by this server*,
  and a thumbnail the user views often from browser cache can be evicted
  ahead of one never viewed. The cost of a wrong pick is one re-render when
  the browser's copy is also gone; the size-cap sweep is the only reader of
  the clock. The requirement's word "read" is not amended; this paragraph is
  where its meaning under browser caching is written down.

### D7a: What the test DOM does with an image

happy-dom (20.x) loads no image URL — `enableImageFileLoading` is off — so it
fires no `load`, and a cell about a picture arriving synthesizes the event.
It *does* fire `error`, synchronously on `src` assignment, whenever the global
`URL` cannot parse the source; and both harnesses stubbed `URL` with a spread
copy that was not a constructor, so every listing-drawn tile demoted itself
before a cell could look. The stubs are subclasses with two statics
overridden now (`client/test/CLAUDE.md`). Task 5.1's premise that neither
event fires was half right; recorded here so the next reader of a spinning
tile in a test knows where to look.

### D8: Review disposition (2026-09-02, fresh opus reviewer on the draft)

| # | Finding | Disposition |
|---|---|---|
| F1 | The annotation branch's `setThumb` is overwritten by the added-entry batch — every cached tile spins forever | **Fixed** (D3): the verdict seeds the same updater |
| F2 | `loading="lazy"` breaks `overlayRectFor`; task 2.4's parenthetical was false | **Fixed** (D3): declared square box, widened fallback, task rewritten |
| F3 | Survivors never re-read the annotation; `immutable` pins wrong pixels | **Fixed** (D3): `gen` joins the survivor test, `slot.entry` updated |
| F4 | The LRU eviction clock silently disabled | **Decided** (D7): the route bumps it; browser-cached invisibility recorded |
| F5 | Module-level lookup queue contaminates tests, dangles on unmount | **Fixed** (D4): cleanup in the wiring effect, exported test reset |
| F6 | The per-listing ranking reset misses the lookup queue | **Fixed** (D4): one helper writes both |
| F7 | One wedged lookup closes the far gate forever | **Fixed** (D5): time-bounded gate |
| F8 | "Any lookup pending" over-applies | **Adopted** (D5): nearer-than-far lookups only |
| F9 | `onIdle`/decrement ordering | **Stated** (D5, task 4.1) |
| F10 | `onError` demotion has no memory | **Fixed** (D3): refusal remembered per slot and generation |
| F11 | `ThumbView` is shared with sheet cells; callback needs the path | **Fixed** (D3): `onImageError(path)` |
| F12 | Scoring routes never carry the annotation | **Fixed** (D2): attached at `hitsToEntries` too |
| F13 | A ready tile with an unloaded lazy image draws blank | **Fixed** (D3): placeholder until `load` |
| F14 | Image route's answer for `stale` unspecified | **Fixed** (D1, delta): anything but a hit is 404 |
| F15 | `state` must be derived at emission | **Stated** (D2, task 1.3) |
| F16 | *Far reads yield* narrows an unmodified main requirement without saying so | **Fixed** (delta): the ADD names what it qualifies and that it is bounded |
| F17 | Duplicated suspension scenario | **Dropped** |
| F18 | Split ownership of the listing field | **Fixed** (delta): phrased as consumption |
| F19 | The eviction cell can only synthesize `onError` | **Stated** (task 5.1); the browser half is 6.2's |
| F20 | "−33% bytes" overstates | **Fixed** (proposal): ~25% |
| F21 | "Native parallel fetching" is false over HTTP/1.1 | **Struck** (Context records why) |
| F22 | The 65 s is disk-bound; the Why attributed it to the request shape | **Rewritten** (proposal Why): lazy first visit, cached revisit, the disk gate |
| F23 | The cheaper alternative — hold far lookups on the existing band map — was never weighed | **Adopted as D0 and §0** for the ranking; the hold was dropped (F24) |
| F24 | *(found implementing §0)* Holding far lookups contradicts main's "consulted at once whatever its position" — a far tile would keep its old recipe until approached; a cell failed on it | **Decided** (D0): ranked last, not held; the disk reads are D1–D3's to remove |
| — | Blocking understated | **Fixed** (tasks header): which halves can start today |

### D9: Implementation review (2026-09-02, opus, on `a5ed10d`/`7c42aad`/`f65299f`)

| # | Finding | Disposition |
|---|---|---|
| R1 | The far gate's bound clock survived a gap in held far work; new far work pushed after the bound dispatched at once under a closed gate | **Fixed** (D5 *Contiguous hold*): `releaseHold` on every take that holds nothing; cell "the bound measures a contiguous hold" |
| R2 | The image route is the first cross-origin-embeddable resource; `guard.ts` said none existed — a foreign page's `<img>` as an existence oracle | **Fixed**: `Cross-Origin-Resource-Policy: same-origin` on the image response, asserted in its cell; `guard.ts`'s rationale amended |
| R3 | The delta's "a different generation SHALL be re-evaluated" was the literal rule D3 rejected | **Fixed** (delta): the implemented rule, absence included |
| R4 | 6.2's "4 lookups" depends on a warm server: the fact index is per process | **Recorded** (6.2 precondition, Risks) |
| R5 | `reportImageError`'s re-seed branch was dead | **Fixed**: `start` called for its side effect, `loading` written |
| R6 | The sweep's batch wrote answered states twice | **Fixed** |
| R7 | `persistPut.test.tsx` still stubbed `URL` as a spread copy, firing four spurious image errors per run | **Fixed**: subclass form |
| R8 | Five test comments falsified by the subclass stub | **Fixed** where found (`viewerCredits`, `viewerMenu`, `viewerPanelActions`) |
| R9 | `gateTimer` survived `setFarGate(null)` | **Fixed**: `releaseHold` on gate removal |
| R10 | Task 4.3's fifth cell pinned counting, not wiring; the reset window makes the gate "any lookup pending" until bands publish | **Fixed**: the settle cell carries a pending far lookup; D5 *The reset window* |
| R11 | `image`'s conditional spread; `new Uint8Array(png)` copied every PNG | **Fixed**: `{ gen, png }`; the body is a `Uint8Array` view over the Buffer's own bytes (offset and length kept — Bun may pool), since Hono's types refuse a Buffer |
| R12 | `ThumbView` hid good pixels behind a spinner when a tile moved from `blob:` back to an image URL | **Fixed**: the placeholder only until the first picture this view has shown |

### D10: Second implementation review (2026-09-03, opus)

| # | Finding | Disposition |
|---|---|---|
| R1 | The hook's far-gate wiring was unpinned — a no-op gate left every cell green | **Fixed**: cell *the hook gates far renders on nearer lookups* (`thumbnailQueue.test.tsx`) |
| R2 | The placeholder-until-load and R12's fix were unpinned in both directions | **Fixed**: `thumbView.test.tsx`, three cells with a synthesized `load` |
| R3 | Listing-carried sheet cells were never annotated — the revisit cost a lookup per cell (Masa's base64 sheets) | **Fixed** (`2824007`): `annotate` recurses into `preview`; cells in `layers.test.ts` and `folderSheets.test.tsx` |
| R4 | The similarity route's annotation was unpinned | **Fixed**: cell in `similar.test.ts`, entries and anchor |
| R5 | The image-error refusal recorded the entry's current generation, lost after an un-annotated listing | **Fixed** (D3): `urlGen` recorded when the URL is built; cell falsified against the old record |
| R6 | The bound's clock depended on arrival order | **Fixed** (D5): the gate is read on the first far job met; cell |
| R7 | After the bound, one far job per bound | **Fixed** (D5 *After the bound*): the backlog drains; cell |
| R8 | `onIdle` named in tasks and proposal, never built | **Fixed**: `onSettle` everywhere |
| R9 | D9's R11 quoted a body call that did not land | **Fixed** (D9) |
| R10 | 5.1's "keeps the entry's `gen` on its slot" was uncovered | **Fixed**: the demoted lookup's `gen` argument asserted |
| R11 | `setFarGate(null)`'s timer disposal was unpinned | **Fixed**: cell with `vi.getTimerCount()` |
| R12 | Stale counts in 6.1; two delta scenarios with no cell, unsaid | **Fixed**: 6.1 no longer carries a count; 5.1 names the two scenarios (in the tasks, not the delta — delta prose lands in main) |

### D11: Third implementation review (2026-09-03, opus)

| # | Finding | Disposition |
|---|---|---|
| R1 | The contiguous-hold clock escaped through a saturated queue (no take) and through the scan's break at a visible job — reproduced | **Fixed** (D5 *When the clock is forgotten*): the cancel handle ends the hold when it retires the last live far job; the gate timer forgets the clock when it fires with none left (a far job re-ranked nearer); the scan runs to the end so husks behind a visible job are spliced. Two cells, one per path, each falsified against its release removed |
| R2 | 6.2's listing payload figure predated the sheet-cell annotation | **Re-measured** (6.2) |
| R3 | The image refusal was entry-level while the failure is per variant | **Fixed** (D3): `urlAo`/`refusedAo`; cell with the toggled variant |
| R4 | `refetch` cleared `url` but not `urlGen` | **Fixed**: cleared beside it, with `refusedAo` set to both |
| R5 | `RenderQueue.pending` had no production reader | **Dropped**, with its cell and D5's paragraph |
| R6 | *Far lookups do not hold the drain*'s second WHEN clause read false | **Fixed** (delta): the far-ranked remainder of a toggle's storm |
| R7 | `ThumbView`'s `everLoaded` survived a same-path new-mtime entry | **Fixed**: keyed on path and mtime; cell |
| R8 | Pinned-far bulk renders are gated too, unsaid | **Recorded** (D5) |

## Risks / Trade-offs

- [The fact index is per process] → the first listing of a directory after
  a server start, before the startup sweep has read its sidecars, costs the
  full lookup storm; the annotation appears once that process has read the
  entries (review R4). Recorded, not mitigated: warming is
  `listing-tree-cache`'s sweep, and a persisted index is its D7's note.

- [An entry evicted between emission and fetch] → 404; `onImageError(path)`
  demotes the entry to the lookup path once per generation (D3).
- [The annotation goes stale between emission and fetch — re-rendered
  elsewhere] → the URL names the old `gen`; the server answers current bytes
  under `no-cache`; the next listing names the new generation and the
  survivor test restarts the slot (D3).
- [Listing payload grows] → measured in 6.2, recorded honestly; framed
  entries carry a whole `CameraState`. Tens of KB on one request against 50 MB
  removed.
- [Far lookups still cost their disk reads on a first visit] → D0 ranks, it
  does not hold (main forbids holding); the reads go away only with D1–D3.
- [The far gate stalls the idle drain] → nearer-than-far signal plus a time
  bound (D5); a cell pins that a never-settling lookup cannot hold far work
  past the bound.
- [Module-level queue state leaks across tests or mounts] → cleanup and test
  reset (D4).
- [Eviction picks a browser-cached favourite] → D7's recorded trade; one
  re-render.
- [`RenderQueue` doing double duty invites suspension into lookups] →
  structurally impossible (`App` holds no reference); a cell pins it anyway.
- [Sequencing on an unlanded change] → §0, §1.1–1.2, §3, §4 need nothing
  unlanded; the annotation half waits, and its seam is already written into
  `listing-tree-cache` 6.3.

## Open Questions

- Whether §6.1's pose layer, when it lands, should also ride the annotation so
  `poseStale` is decidable from the entry alone. It would make the wave fill
  gaps only; no change to this design's contract either way.
