# Thumbnail Sweep Priority

## Why

Measured 2026-08-18 on the real library. A flat listing of one library root returns 500 model tiles — the cap — and those 500 models total **20.21 GB** of STL: median 25.1 MB, p90 99.9 MB, largest 221.4 MB. The disk delivers 120 MB/s over USB, so a first visit to that view is **~168 seconds of pure I/O** before any parsing or GPU work, through a render queue two jobs wide.

The listing itself is not the problem: the request returns in 0.47s, and a cached thumbnail is a 7 ms fetch that never occupies the queue (`model-thumbnails` already requires that separation). The problem is 500 cache *misses* and the order they are worked in.

`RenderQueue` is strictly FIFO — `this.jobs.shift()`, no priority, no reordering. Jobs are pushed in listing order, so the queue renders tile 1, 2, 3 … regardless of where the user is looking. Scroll to the bottom of a fresh 500-tile grid and the tiles on screen are last in line behind roughly 490 renders of models that are nowhere near the viewport. The user waits minutes for images that were already computable in seconds.

Nothing here makes the sweep cheaper — 20.21 GB has to be read to thumbnail 20.21 GB. What it changes is *which* seconds the user spends waiting: proportional to what they are looking at, rather than to the size of the directory.

## What Changes

- **The render queue takes priority, not just order**: pending jobs can be reordered, so the tiles currently on screen are rendered before tiles that are not.
- **Visibility drives that priority**: the grid reports which tiles are on screen, and scrolling re-prioritises the queue rather than appending to it. A tile scrolled far away yields its place; a tile scrolled into view claims one.
- **Work for tiles that left the viewport before starting is dropped** rather than run: `RenderQueue.push` already returns a cancel handle, and nothing currently calls it for scroll.
- Unchanged: the concurrency limit, suspension during orbit/lightbox, the cached-lookup path that bypasses the queue entirely, and every pixel of what a thumbnail looks like. This is scheduling, not rendering, so no `RIG_VERSION` bump.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-thumbnails`: the **Client-side thumbnail rendering** requirement describes the queue as limited-concurrency and suspendable but says nothing about the order work is taken in — which is how strict listing order became the behavior by default. It gains an ordering rule: visible tiles first, and work for tiles that left the viewport before starting is abandoned rather than completed.

## Impact

- `client/src/three/queue.ts` — `RenderQueue` gains priority: jobs carry a key, pending jobs can be re-ranked, and the pump takes the highest-ranked rather than the oldest.
- `client/src/hooks/useThumbnails.ts` — pushes jobs with a key and feeds the queue a visibility signal.
- `client/src/components/Grid.tsx` — reports tile visibility (an `IntersectionObserver` over the tiles, which the grid does not have today).
- No server, API, cache-schema, or pixel-recipe change; `RIG_VERSION` is untouched.
- Related but separate: the 500-model cap is what makes a single view this expensive. Lowering it is a different trade (fewer results) and belongs to `directory-browsing`, not here.
