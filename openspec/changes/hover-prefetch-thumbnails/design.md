## Context

`hover-prefetch-listings` files a warmed listing in a small client store and lands the
click from it. Its store already calls a `warmImages(entries)` hook on resolve; this
change supplies it. Nothing else here is new machinery.

Two facts decide the shape, both found reviewing the draft this split out of
(2026-09-08):

- A directory entry carries its contact-sheet cells **nested** in `entry.preview`
  (`shared/types.ts`, since `listing-tree-cache`'s emission-time filling). App draws
  those cells from the carried previews. A walk over top-level entries looking for model
  entries therefore sees none of the images a folder listing actually paints.
- A thumbnail is ~5 KB of WebP at 256² (`webp-thumbnails`, 2026-09-07), not the ~100 KB
  PNG the original draft priced. One screen of ~114 images is ~0.57 MB, which is what
  makes warming a whole screen defensible at all.

## Goals / Non-Goals

**Goals:** a warmed listing's first screen paints from the browser's cache; nothing is
rendered or looked up on hover; the warm never competes with the visible grid.

**Non-Goals:** rendering missing thumbnails on hover (the render queue serves what is on
screen); a second size or variant; warming anything below the first screen.

## Decisions

### D1. An `Image`, not `<link rel=prefetch>` or `fetch()`

`new Image().src = url` is the tile's own fetch under the tile's own URL, so the entry
the browser files is the entry the `<img>` will hit. `/api/thumb/image` answers a current
generation `public, max-age=31536000, immutable` with no `Vary`, so the match is exact.
`<link rel="prefetch">` varies by browser in priority and in whether the response is
reused for an image; `fetch()` raises the same reuse question and would be the only image
fetch in the client not made by an `<img>`.

`img.fetchPriority = 'low'` on every warm image: the warm competes for connections with
the *current* grid's still-loading images, which is a contention the listing warm does not
have. That is one property, not a design.

### D2. The walk is over what the screen draws, not over what the listing lists

For each entry in listing order: the entry itself if it names a drawable render, then the
entries it carries in `preview`. Stop at the image budget. `isCurrentRender` — already
exported from `useThumbnails` — is the test, passed the same orientation the tile's own
first pass uses (`entry.pose ?? undefined`), so the warm cannot fetch a render the tile
would refuse as pose-stale.

### D3. The budget is images, and its number comes from a measurement

The draft said 24 tiles. A demo first screen is ~114 images. Neither is a measurement of
this app's layout at the demo's default viewport, which is what the number should be:
`Grid` knows its visible tile count, and the bake's sheet size is fixed at four. Take the
number from `hover-prefetch-listings` task 1.1's own screen measurement rather than
guessing again.

## Risks / Trade-offs

- [A hover the user abandons wastes a screen of images] → ~0.57 MB at the measured size,
  fired only after the linger, and every byte is one the click would have spent. If the
  dwell measurement shows abandoned hovers dominate, this change is the one to drop —
  which is why it is separate.
- [The warm delays the images the user is looking at] → `fetchPriority = 'low'` (D1), and
  the warm starts only after its listing resolves, by which time the current grid's own
  images are usually in flight or done.
- [A CDN makes this worthless] → then do not build it. The ordering says so explicitly.

## Open Questions

- The image budget's number (D3), which is a measurement, not an argument.
- Whether to warm at all when the connection reports itself metered or slow
  (`navigator.connection`), which the listing half never needed to ask.
