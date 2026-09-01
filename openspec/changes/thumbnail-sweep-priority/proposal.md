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
> `62f9f2d` and every code citation re-checked at that commit. The intent is
> unchanged: visible-first render ordering, and far-band cancellation of work
> that has not started.

## Why

Measured 2026-08-18 on the real library (that session's run; re-measure before
citing — task 5.2). A flat listing of one library root returns 500 model tiles —
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
- **Work for tiles that left the viewport before starting is parked** rather than
  run: `RenderQueue.push` already returns a cancel handle, and nothing calls it
  for scroll today. *Parked* is the third per-entry state
  `ao-refreshes-thumbnails` named and deliberately left for this change — cancelled
  unstarted, restartable on re-entry, distinct from finished and from error.
- **The far band never cancels a cache lookup**, only the render tail. A parked
  tile that the preference or the index's opinion moves under is looked up again
  at once — so a render already cached under the new setting still paints, as
  *Recipe-labelled thumbnails* requires — while its render stays parked until its
  tile comes back.
- **The grid's one `IntersectionObserver` serves both readers.** `Grid` already
  has one, watching `[data-dir-tile]` for folder previews; this change widens it
  to model tiles and to band reporting, which is the joining
  `folder-contact-sheets` explicitly deferred to whichever change landed second.
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
  behavior by default. It gains an ordering rule: visible tiles first; work for
  tiles that left the viewport before starting is parked rather than completed;
  and a parked entry is looked up but not rendered when its recipe moves under it,
  so it re-renders when its tile returns.

## Impact

- `client/src/three/queue.ts` — `RenderQueue` gains priority: jobs carry a key,
  pending jobs can be re-ranked wholesale, and `pump` takes the highest-ranked
  rather than the oldest.
- `client/src/hooks/useThumbnails.ts` — `start` pushes its queue job with a key;
  `EntrySlot` gains its `DirEntry` and a parked marker, and its `cancels` list
  gains a separately-reachable render handle (today it is a flat, unlabelled
  `(() => void)[]` that only `retire` fires, so the render tail cannot be
  cancelled without also killing the lookup). The hook returns an imperative
  `setBands`.
- `client/src/components/Grid.tsx` — the existing observer effect widens to
  `[data-model-tile]` as well as `[data-dir-tile]`, stops unobserving on first
  intersection (a band tracker must keep watching; the repeat-peek guard moves
  entirely onto `App`'s `requestPeek`, which already refuses a path in
  `previewsRef.current` or `inFlightPeeks.current`), and reports bands through
  `setBands`. **Bands never become a `Tile` prop** — `tilePropsEqual` is a
  keys-based shallow compare, so a per-tile band would re-render all 500 tiles on
  every scroll settle.
- `client/src/App.tsx` — holds the `setBands` callback by identity, as it holds
  `onPeek`.
- No server, API, cache-schema, or pixel-recipe change; `RIG_VERSION` is
  untouched.
- Related but separate: the 500-model cap is what makes a single view this
  expensive. Lowering it is a different trade (fewer results) and belongs to
  `directory-browsing`, not here.
