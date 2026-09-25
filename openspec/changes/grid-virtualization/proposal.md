## Why

Scrolling the grid stutters on phones, and it is worst in exactly the view the demo invites: a
flat view or a large folder. The grid mounts every entry of the listing — 954 tiles and about
13,000 elements in the demo corpus's flat view — and what is left of the main thread's work once
the thumbnails are cached scales with that count. Compositor commit, hit testing for every touch
move and the per-tile layers are the largest entries in the profile, read from it rather than
sized one by one; the before/after totals below are measured. Earlier fixes (off-screen animations paused, folder sheets
contained, asynchronous readback) removed the other costs; this one is structural.

A throwaway probe that row-virtualized the grid with `@tanstack/react-virtual` was compared on
the owner's iPhone against the unvirtualized grid and against `content-visibility` on tiles, and
was judged "WAY better". In phone emulation on the production build (4× CPU throttle, the same
touch swipes each run), the flat view went from 84 frames over 33 ms of 712 to 13 of 730, p95
50 ms → 16.8 ms, and main-thread time 6.6 s → 2.4 s, while scrolling half again as far; the
mounted grid fell from 954 tiles to 12–20.

The probe skipped everything that assumes every tile is in the page. This change does the whole
job: the grid mounts only the rows near the viewport, and every behaviour that finds a tile in
the DOM finds it through the grid instead.

## What Changes

- The grid renders its entries as rows of the column count the responsive layout yields, and
  mounts only the rows within the viewport and a small margin around it, plus rows it is
  required to keep (the first row, the row of the tile that last held keyboard focus). The scroll height stays the
  whole listing's.
- Thumbnail positions (visible / near / far) and folder-preview requests are computed from the
  grid's row layout and the scroll position rather than reported by `IntersectionObserver`s over
  mounted tiles — an unmounted tile is not observable, and its position is known anyway. The
  near band keeps its present extent (two viewport heights either side).
- Every place that looks a tile up in the DOM goes through a small grid handle that can bring
  an unmounted entry into the mounted range first: retrace placement and reveal centring, arrow
  keys (whose steps become index arithmetic over the shown entries), first-tile and arrival
  focus, returning focus when the find control closes or a weak meaning set is expanded, and
  returning focus to the stepped-to model's tile when the lightbox closes. Tab steps from tile
  to tile in listing order through the grid itself, and the tile that last held focus stays
  mounted, so a control that hands focus back to it still finds it.
- A live change of column count (window resize, tile size) keeps the first visible entry where
  it was rather than keeping the pixel offset.
- A scroll-performance bench (`scripts/scroll-bench.mjs`, phone emulation, touch swipes) is
  added so later changes can be held to these numbers.
- The throwaway probe switch (`client/src/probes.ts`) is removed.
- **Known limit, accepted**: the browser's own find-in-page no longer finds names of tiles that
  are not mounted. The app's Narrow control, which the platform find shortcut already opens from
  an empty search box, filters the whole listing and is unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: a new requirement that the grid mounts only the rows near the view and
  that no behaviour depends on a tile being mounted — Tab and the arrow keys reach every tile,
  a retrace, a reveal, an arrival and a closed lightbox each land and focus as they do now, and
  a focused tile is not lost by scrolling away from it. Added as its own requirement so the
  existing ones, several of which other active changes also touch, are left as they are.
- `model-thumbnails`: a new requirement that a tile's position is taken from the grid's layout
  rather than from what is mounted, so every entry of a virtualized listing is ranked — near
  work for tiles within the near band that are not mounted, far work for the rest — as the
  existing ordering rules require.

## Impact

- **Client**: `client/src/components/Grid.tsx` (row virtualization, band and peek computation,
  arrow keys, the handle), `client/src/App.tsx` (placement, reveal, focus landings, lightbox
  close, find close, weak-set focus go through the handle), `client/src/lib/placement.ts`
  (unchanged; `applyIn` is now called from the handle), `client/src/index.css` (the off-screen marker
  moves to rows).
- **Dependency**: `@tanstack/react-virtual` (MIT, headless, no runtime dependencies beyond its
  own core) in the client workspace.
- **Tests**: `folderSheets.test.tsx`'s band and peek cells move from observer stubs to a fixed
  layout; `gridArrowNav.test.tsx`'s column stubs become the grid's column count;
  `retracePlacement.test.tsx` and the focus cells gain cells whose anchors and targets start
  outside the mounted range; `placement.ts` and its unit tests are unchanged. The app harness fixes the grid's geometry so existing app-mount cells keep seeing
  their tiles.
- **Coordination**: `hover-prefetch-listings` adds a prop to `Grid.tsx`'s non-model tile; the
  two touch the same file but no shared requirement. Whichever lands second rebases.
- **Server, wire, specs of other capabilities**: unchanged.
