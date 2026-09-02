# Thumbnail Sweep Priority

> **Rebased 2026-09-01 — do not apply the pre-rebase draft.** This change was
> proposed 2026-08-18 and last reviewed 2026-08-29. Between then and now,
> `ao-refreshes-thumbnails`, `ao-as-recipe-dimension`, `folder-contact-sheets`
> and `remove-axis-lighting` archived (all 2026-08-31) and `pose-for-every-model`
> completed, and together they rewrote every file this change touches. Four of
> its premises died outright: `useThumbnails` no longer sweeps a listing but
> reconciles a ref-held per-entry `EntrySlot` map; it no longer "cancels only on
> unmount/replacement"; `Grid` no longer lacks an `IntersectionObserver` (it has
> one, for folder previews); and the *parked* per-entry state that
> `ao-refreshes-thumbnails` deferred to "whichever of the two lands second" is
> now this change's to name. Every artifact here was rederived against main at
> `62f9f2d` and every code citation re-checked at that commit, then re-verified
> 2026-09-02 at HEAD by an opus review whose findings — the observers' root,
> the band-aware start gate, and the *Recipe-labelled thumbnails* qualification
> among them — are folded into all four artifacts; then **amended 2026-09-02**
> after measurement against the real library (design D4): far work is deferred
> to the back of the queue, never cancelled. The intent is unchanged —
> visible-first render ordering — and the mechanism is now the simpler one.

## Why

Measured 2026-08-18 on the real library (that session's run; re-measure before
citing — task 6.2). A flat listing of one library root returns 500 model tiles —
the cap, `listFlat`'s `cap` from `envLimit('MODEL_BROWSER_FLAT_CAP', 500)` — and
those 500 models total **20.21 GB** of STL: median 25.1 MB, p90 99.9 MB, largest
221.4 MB. The disk delivers 120 MB/s over USB, so a first visit to that view is
**~168 seconds of pure I/O** before any parsing or GPU work, through a render
queue two jobs wide (`App`'s `new RenderQueue(2)`).

The listing itself is not the problem: the request returns in 0.47s, and a cached
thumbnail is a 7 ms fetch that never occupies the queue (`model-thumbnails`
already requires that separation, and `useThumbnails`' `lookupLimit` — a
`makeLimiter(8)` — is what implements it). The problem is 500 cache *misses* and
the order they are worked in.

`RenderQueue` is strictly FIFO — `pump` takes `this.jobs.shift()`, no priority, no
reordering. The reconciler in `useThumbnails`' sweep effect calls `start` for each
model in `entries` order and each `start` eventually pushes one job, so the queue
renders tile 1, 2, 3 … regardless of where the user is looking. Scroll to the
bottom of a fresh 500-tile grid and the tiles on screen are last in line behind
roughly 490 renders of models that are nowhere near the viewport. The user waits
minutes for images that were already computable in seconds.

Nothing here makes the sweep cheaper — 20.21 GB has to be read to thumbnail
20.21 GB. What it changes is *which* seconds the user spends waiting: proportional
to what they are looking at, rather than to the size of the directory.

## What Changes

- **The render queue takes priority, not just order**: pending jobs can be
  reordered, so the tiles currently on screen are rendered before tiles that are
  not.
- **Visibility drives that priority**: the grid reports which tiles are on screen,
  and scrolling re-prioritises the queue rather than appending to it. A tile
  scrolled far away yields its place; a tile scrolled into view claims one.
- **Work for tiles that left the viewport is deferred, never discarded**
  (amended 2026-09-02 — the parked design was built, measured and replaced,
  design D4): far work stays queued at the lowest rank and runs only when
  nothing nearer is pending. While the user is active there is always nearer
  work, so scrolling past uncached tiles spends nothing on them; when the user
  stops, the queue drains nearest-first — a listing left open warms itself,
  which the parked design's frozen sweep did not. No per-entry parked state:
  `ao-refreshes-thumbnails`' deferred third state resolves as unneeded.
- **A folder's sheet fills after the tiles beside it**: preview cells rank one
  band worse than their folder (a visible folder's cells are near), so a
  contact sheet never outranks the model tiles the user is scrolling toward.
- **The far band never cancels a cache lookup**, only defers the render tail.
  A recipe change re-looks-up every tile at once — so a render already cached
  under the new setting still paints, as *Recipe-labelled thumbnails* requires
  — and a miss queues at its position.
- **The grid's one observer effect serves both readers.** `Grid` already has an
  `IntersectionObserver` watching `[data-dir-tile]` for folder previews; this
  change widens it to model tiles and band reporting — the joining
  `folder-contact-sheets` explicitly deferred to whichever change landed second
  — and adds a second, margin-less observer in the same effect to split visible
  from near, which one observer's single `rootMargin` cannot do. Both observers
  root at `App`'s `<main>` scroller, without which the park margin is inert —
  the intersection algorithm clips at the scrolling ancestor before any margin
  on the default root applies (design D2).
- Unchanged: the concurrency limit, suspension during orbit/lightbox, the
  cached-lookup path that bypasses the queue entirely, and every pixel of what a
  thumbnail looks like. This is scheduling, not rendering, so no `RIG_VERSION`
  bump.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-thumbnails`: the **Client-side thumbnail rendering** requirement
  describes the queue as limited-concurrency and suspendable but says nothing
  about the order work is taken in — which is how strict listing order became the
  behavior by default. It gains an ordering rule: visible tiles first, then
  near, then unreported, then far — position orders work and never discards
  it, so a listing left open drains nearest-first; a folder's preview cells
  rank one band worse than the folder; hidden content is reported far; and a
  recipe change re-looks-up every entry at once, queueing a miss at its
  position.
- `model-thumbnails`: the **Recipe-labelled thumbnails** requirement's "and
  rendering only what is not [cached]" clause is qualified for work deferred
  off screen (2026-09-02 opus review: unqualified, the archived spec would
  carry two sentences contradicting each other). One clause; every scenario
  carried unchanged.
- `directory-browsing`: **Folder tiles preview their contents** — the peek is
  requested when a tile comes within the prefetch band, not only on screen
  (code-review finding 1; one sentence, one scenario body, nine scenarios
  carried).

## Impact

- `client/src/three/queue.ts` — `RenderQueue` gains priority: jobs carry a key,
  pending jobs can be re-ranked wholesale, `pump` takes the highest-ranked
  rather than the oldest, and the cancel handle reports whether the job was
  still pending. The two keyless `push` callers (`refreshThumbnail`,
  `setOrbitAxis` in `entryActions`) stay keyless and rank with visible work —
  they are user presses.
- `client/src/hooks/useThumbnails.ts` — `start` pushes its queue job with a
  key, unconditionally; `EntrySlot` gains its `DirEntry`. The hook returns an
  imperative `setBands` (a value-equal early exit over `queue.setRanking`),
  and resets the accepted map when `entries` changes identity. No parked
  marker, no labelled render handle — the amendment removed both.
- `client/src/components/Grid.tsx` — the existing observer effect widens to
  `[data-model-tile]` as well as `[data-dir-tile]`, stops unobserving on first
  intersection (a band tracker must keep watching; the repeat-peek guard moves
  entirely onto `App`'s `requestPeek`, which already refuses a path in
  `previewsRef.current` or `inFlightPeeks.current`), gains a second margin-less
  observer in the same effect (D2), roots **both** observers at `App`'s `<main>`
  scroller (passed down as a prop — a `rootMargin` against the default viewport
  root is clipped away by the scrolling ancestor before it applies, D2), reads
  `previews` through a ref rather than the dependency array, and reports bands
  through `setBands`. **Bands never become a `Tile` prop** — `tilePropsEqual` is a
  keys-based shallow compare, so a per-tile band would re-render all 500 tiles on
  every scroll settle.
- `client/src/App.tsx` — holds the `setBands` callback by identity, as it holds
  `onPeek`; gives `<main>` a `ref` and passes the `RefObject` to `Grid` as the
  observers' root; and wraps `setBands` to add `far` for filter-hidden models —
  `entries` minus `filteredListing`, never overwriting a band the report
  carries (D3: the wider `thumbEntries`-based difference captures every
  folder-preview model and would park sheet cells on screen) — so the sweep
  does not keep reading entries the user just filtered away.
- `client/src/three/lru.ts` — untouched after the amendment (the
  held-or-loading peek existed only for the parked design's warm-mesh
  exception).
- No server, API, cache-schema, or pixel-recipe change; `RIG_VERSION` is
  untouched.
- Related but separate: the 500-model cap is what makes a single view this
  expensive. Lowering it is a different trade (fewer results) and belongs to
  `directory-browsing`, not here.
