## Why

The other half of `hover-prefetch-listings`, split out on 2026-09-08 because its win is
the half most likely to be redundant.

Warming a folder's listing on hover takes the *serial* round trip off the click:
`/api/*` cannot be edge-cached and HTTP/2 does not collapse a dependency, so nothing in
the infrastructure removes it. What remains after the click is a fan-out — the first
screen's thumbnail images, fetched once the grid mounts. That fan-out is exactly what
`demo-infrastructure`'s HTTP/2 collapses onto one connection, and what a CDN in front of
the origin would move to an edge hop: 5 KB immutable WebPs are close to the ideal edge
object. This change is worth building only if a measurement, after the listing half has
landed, shows the residual gap is still the images.

## What Changes

- **A warmed listing warms the images its first screen will draw.** When a listing warm
  resolves, the client starts image fetches for the entries whose thumbnail facts already
  name a render it would draw without a lookup, using the same URLs the tiles will use,
  so each tile's later image load is a cache hit.
- **The walk descends into a folder's preview cells.** Since `listing-tree-cache`, a
  directory entry carries its sheet cells nested in `entry.preview`. The draft this
  change came from walked only top-level entries for model entries, so on a
  folder-of-folders — the demo root, and every kit parent — it would have warmed nothing.
- **The bound counts images, not tiles.** A first screen on the demo is ~114 thumbnails
  (roughly 28 folder tiles of four cells), not the 24 the draft assumed.
- **Nothing is rendered on hover.** An entry with no current render is left alone: no
  lookup, no render queued for a tile that is not on screen.

## Capabilities

### Modified Capabilities

- `directory-browsing`: ADDs one requirement — a warmed listing warms the thumbnails its
  first screen will draw. It rides the requirement `hover-prefetch-listings` adds and is
  meaningless without it.

## Impact

- **Client only**: `client/src/App.tsx` (the `warmImages` hook the store already calls),
  `client/src/lib/listingPrefetch.ts` (holding the `Image` objects for an entry's life).
  `useThumbnails` needs no change: `isCurrentRender` is already exported and is the same
  test the tile applies.
- **Ordering**: after `hover-prefetch-listings`, which owns the store and the warm, and
  after the CDN question in `docs/web-demo-notes.md` is decided — if a CDN fronts the
  origin, this change may be worth nothing and should be dropped rather than built.
