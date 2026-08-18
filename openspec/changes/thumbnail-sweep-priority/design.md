# Design — thumbnail-sweep-priority

## Context

`RenderQueue` (client/src/three/queue.ts) is a FIFO with a concurrency limit: `push` appends to `jobs`, `pump` takes `this.jobs.shift()`. It already does two things well — it suspends while the shared renderer is serving an orbit overlay or lightbox, and `push` returns a cancel handle that marks a job `cancelled` so `pump` skips it. Nothing calls that handle for scrolling; `useThumbnails` cancels only on unmount/replacement.

`useThumbnails` pushes one job per uncached model in listing order. Cached thumbnails never enter the queue at all — `model-thumbnails` already requires that separation, and it works: the measured cache hit is 7 ms. So the queue's contents are exactly the *misses*, and their order is exactly the listing's.

The measurement that motivates this: one flat listing = 500 model tiles = 20.21 GB of STL, at 120 MB/s ≈ 168s of I/O, two jobs wide. `Grid` has no notion of which tiles are on screen.

## Goals / Non-Goals

**Goals:**
- Time-to-image for the tiles the user is looking at is independent of how large the directory is.
- Effort follows attention: scrolling redirects the queue instead of adding to the back of it.

**Non-Goals:**
- Making the sweep cheaper. 20.21 GB must be read to thumbnail 20.21 GB; this changes the order, not the total. A directory left open still costs what it costs.
- Changing rendered output. No pixel changes, so no `RIG_VERSION` bump — the constant's rule is about the recipe, and scheduling is not the recipe.
- Changing the concurrency limit, the suspension rule, or the cached-lookup path.
- Lowering the 500-model cap. That trades away results and belongs to `directory-browsing`.

## Decisions

### D1: The queue ranks; the grid supplies the ranking

`RenderQueue` gains a priority: `push` takes a key alongside the job, and `pump` selects the best-ranked pending job rather than the oldest. The queue does not know what a viewport is — it holds a rank per key and a way to replace the whole ranking at once, which the grid drives. Keeping the visibility model out of the queue keeps it testable without a DOM, which is how its existing tests are written.

Ties keep listing order, so behavior with no visibility information at all is exactly today's FIFO — the fallback is the current behavior rather than something undefined.

*Alternative — a second high-priority queue:* two queues sharing one concurrency budget reproduces the same ranking problem with more state, and the interesting case (a tile moving between classes as it scrolls) becomes a migration between queues rather than a number changing.

### D2: Visibility comes from an `IntersectionObserver`, coarsely

`Grid` observes its tiles and reports which are intersecting, plus a margin so the next screenful is already warm. Reporting is throttled and coarse — three bands (visible, near, far) rather than a continuous distance — because the queue is two wide and cannot exploit finer resolution, and because a per-pixel ranking would re-sort the pending set on every scroll frame for no benefit.

### D3: Leaving the viewport cancels work that has not started

`push` already returns a cancel handle and `pump` already honors `cancelled`; this change finally calls it. A job that has *started* is not interrupted — it holds a renderer slot and its mesh load is in flight, and the existing suspend/`whenResumed` gating is the only safe interruption point. So the rule is precise: unstarted work for a far tile is dropped, started work runs to completion.

A dropped job is not a failure — the tile returns to its placeholder state and is re-queued if it comes back into view. That distinction matters: the tile must not land in the error state that `model-thumbnails` reserves for a model that failed to load or parse.

*Risk:* fast scrolling could drop and re-queue the same tile repeatedly. The `far` band is defined generously (well beyond the prefetch margin) so that oscillation needs deliberate effort, and re-queueing is cheap — the expensive part is the mesh read, which a dropped job never began.

### D4: The mesh LRU makes re-queueing cheap where it matters

A job dropped after its mesh was already loaded costs nothing to redo — `MeshLru` still holds the geometry, so the re-queued job skips straight to rendering. This is why cancellation is safe to be liberal about: the irreversible cost is the disk read, and the LRU is what keeps it from being paid twice.

## Risks / Trade-offs

- [Total sweep time is unchanged; a user who opens a big directory and waits sees no improvement] → accepted and stated in the proposal. The complaint being fixed is "the tiles I am looking at take minutes", not "the directory takes minutes".
- [Reordering could starve tiles that are never visible] → they are never visible; the queue drains them once the visible set is satisfied, in listing order among themselves.
- [`IntersectionObserver` in tests] → happy-dom does not implement it; the component tests stub it, and D1's split keeps the queue's own priority tests DOM-free.
- [Scroll-driven re-ranking on a 500-tile grid could itself cost frames] → D2's throttling and three-band coarseness bound it; the ranking is a map update, not a re-sort per tile.
- [A dropped job leaving a tile visually stuck] → D3 returns it to placeholder, not error, and re-queues on re-entry; a test pins that a scrolled-away-and-back tile ends up rendered.
