# Tasks — thumbnail-sweep-priority

> Ordering: independent of the search and cache changes — it touches the client render queue and grid only. Re-read `queue.ts`, `useThumbnails.ts`, and `Grid.tsx` against main before starting (parallel sessions).

## 1. Queue priority

- [ ] 1.1 `RenderQueue.push` takes a key with the job; `pump` selects the best-ranked pending job instead of `jobs.shift()`, with ties keeping insertion order so an unranked queue behaves exactly as today's FIFO (D1)
- [ ] 1.2 A method to replace the whole ranking at once (the grid recomputes bands wholesale on scroll, rather than moving keys one at a time)
- [ ] 1.3 Unit tests, DOM-free as the existing queue tests are: ranked jobs run before unranked; a re-ranking mid-flight changes what runs next but never interrupts a running job; ties preserve insertion order; concurrency and the suspend/`whenResumed` gating are unchanged

## 2. Visibility

- [ ] 2.1 `Grid` observes tiles with an `IntersectionObserver` (with a prefetch margin) and reports three coarse bands — visible / near / far — throttled; no per-pixel ranking (D2)
- [ ] 2.2 `useThumbnails` pushes jobs keyed by path and feeds the band map into the queue's re-ranking

## 3. Cancellation on scroll-away

- [ ] 3.1 A tile entering the `far` band cancels its **unstarted** job via the handle `push` already returns; a started job runs to completion — it holds a renderer slot and its mesh read is in flight (D3)
- [ ] 3.2 A cancelled tile returns to **placeholder**, never to the error state `model-thumbnails` reserves for a model that failed to load or parse; re-entering the viewport re-queues it, and the mesh LRU makes that re-queue cheap (D4)

## 4. Tests

- [ ] 4.1 Component tests on the shared harness: a large uncached listing scrolled immediately to the bottom renders the now-visible tiles before the earlier ones — the assertion that fails under FIFO; a tile scrolled away before starting is not rendered; scrolled away and back, it ends up rendered and never shows the error state; a listing with all thumbnails cached is unaffected (those never enter the queue)
- [ ] 4.2 Confirm no renderer-mock updates are needed and `RIG_VERSION` is untouched — this changes scheduling, not the recipe; if a mock needs touching, that is a signal something rendering-related moved

## 5. Verification

- [ ] 5.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 5.2 Manual E2E via Playwright MCP against the real library, with the thumbnail cache cleared for the target directory (`~/.cache/model-browser`): open a 500-tile flat listing, scroll immediately to the bottom, and confirm visible tiles resolve in seconds rather than after the earlier ~490. Record the measured time-to-first-visible-image before and after — the proposal's claim is time-to-image for what you are looking at, not total sweep time, and the numbers should say exactly that
