## Why

The grid forgets where you were. Its scroller is the app's own `<main>`, not the window,
so the browser's history scroll restoration never applies; and a history restore that has
to re-fetch its listing replaces the grid with the skeleton and lands the new tiles at the
top. Going back from a folder to the listing you scrolled through, dismissing a search you
raised from halfway down a kit, or pressing ↑ out of a folder all put you somewhere you
were not. On a library of hundreds of kits that is the difference between browsing and
re-finding your place after every excursion.

The one piece that does remember is the reveal (`entry-actions`, *Reveal an entry in its
containing folder*): it locates a tile and centres it. This change generalises that into
the grid's one placement mechanism and gives it the two memories the navigations need.

## What Changes

- **Retracing restores, arriving does not.** Back, Forward and a dismissal land where the
  history entry was left; ↑ lands where the parent looked when you went into the child; a
  tile click, a typed path, a deep link or a new search land at the top, every time.
- **A placement is an anchor tile and an offset**, not a scroll offset: the first tile
  crossing the scrollport's top edge and how far above the edge its top sits. It reproduces
  the pixel position when nothing changed and degrades to "the same tile in the same place"
  when columns or neighbours changed. The reveal becomes the same record with a centred
  alignment.
- **Every history entry carries its placement**, recorded continuously as the user scrolls
  and written into a session-scoped mirror of the history stack keyed by an index the
  entry's state carries. Back reads the entry it lands on; ↑ walks the mirror back to the
  nearest entry whose listing is the parent — *the* visit that led here, not the parent's
  latest visit on some other branch.
- **↑ changes the path and nothing else.** It keeps the current flat state; the parent's
  remembered anchor is tried against whatever arrangement the user is in, and a missing
  anchor falls through — to the child folder tile centred where that tile exists (never in
  flat, which shows no folders), else the top.
- **The narrow-by-name filter and the reveal mark stay outside history**, as today.

## Capabilities

### Modified Capabilities
- `directory-browsing`: **ADD** a requirement *Retracing restores the grid's place* — the
  placement rule per arrival kind and its fallbacks. ADD rather than MODIFY *Thumbnail
  grid navigation*, so this delta cannot collide with the three active changes whose
  deltas also ADD to this capability (`search-cancellation`, `hover-prefetch-listings`,
  `hover-prefetch-thumbnails`).
- `entry-actions`: **no requirement change.** The reveal keeps its behaviour and its
  ephemerality; only its mechanism becomes the shared placement.

## Impact

- `client/src/lib/urlState.ts` — `commitUrl` stamps an entry index into the state it
  writes, beside the lightbox and similar-excursion markers it already writes.
- A new `client/src/lib/trail.ts` — the session mirror of the stack (`sessionStorage`):
  record, prune on push, look up by index, walk back to a listing.
- A new `client/src/lib/placement.ts` — measure a placement off a scroller, apply one to
  it, and the fallback chain as a pure function.
- `client/src/App.tsx` — the scroll recorder on `mainRef`, the pending placement resolved at
  a settled landing (the honor-or-drop shape `pendingReveal` already has), `goUp`'s walk,
  `onPop`'s read, and the fresh-landing top.
- `client/src/components/Grid.tsx` — the tile-level `scrollIntoView` on `marked` gives way
  to the placement the grid is handed; tiles become findable by path.
- Tests in `client/test/`: the pure functions, the mirror, and the arrival table row by
  row. No server change, no thumbnail pixel change, no `RIG_VERSION` bump.
