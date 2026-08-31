## Context

`Grid.tsx` renders a `dir` or `zip` entry as an emoji and a name; a `model` entry as an
`<img>` from the `thumbs` map that `useThumbnails(entries, api, lru, queue, poses)`
maintains, keyed by entry path. The hook's pipeline — cache lookup under its own
concurrency limit, then load → parse → render → PUT through the render queue on a miss —
is the only way a thumbnail is produced. `listFsDir` (`listing.ts`) reads one directory
and sorts it dirs → zips → models by name; `listFlat` walks with a step budget.

Cold-media cost is the constraint that shapes this: the real library's cold walk was
measured at 2.4 ms per entry on the spinning USB volume, and `listing-tree-cache`'s design
records 6.7 s of archive-tail seeks in one warm walk. A preview computed *by the listing*
would add a peek per subfolder to every directory request; a preview asked for *by the
tile* costs only for folders the user scrolls past.

## Goals / Non-Goals

**Goals:**

- A folder tile shows what is inside it, from thumbnails the app already has or would make.
- A directory listing costs exactly what it costs today.
- Previews are ordinary thumbnails: same cache, same queue, same recipe, same priority.

**Non-Goals:**

- Previewing zip tiles (a central-directory read per archive; `listing-tree-cache`'s job).
- A composed "folder thumbnail" PNG. Four images in a CSS grid, never a fifth render.
- Choosing *representative* models. First four in a deterministic order; anything smarter
  needs the metadata store.

## Decisions

### D1: The tile asks; the listing does not answer

`GET /api/peek?path&n` is a separate request per folder tile, issued when the tile enters
the viewport. The alternative — a `preview` field on each `DirEntry` — makes every
listing pay N peeks up front (the demo root: 297), on the cold path the tree cache exists
to shorten, for folders the user may never scroll to. Per-tile requests are proportional
to what is looked at, which is the same argument `thumbnail-sweep-priority` makes for
renders. One `IntersectionObserver` on the grid, observing folder tiles, with a small
in-memory map per listing; a re-mounted tile (scrolled away and back) reuses the map.

"Per listing" is `entries` identity, not `state.result` identity (decided at review,
2026-08-31): the reducer's `patch` spreads `state.result` on every fetchless view change —
a lightbox open, a kind option — while deliberately preserving `entries` identity, which is
the identity `useThumbnails` already keys on and only a landing replaces (R5). Keyed on
`state.result`, every landed sheet would be wiped and every peek re-issued on each lightbox
open. The same `entries` reference serves as the stale-landing generation token: a peek that
lands after the listing changed is dropped, never written into the new listing's map.

### D2: A bounded depth-first walk, models first at each level

The peek walks the folder with `listFsDir`: models at this level in sorted order, then each
subfolder in sorted order, recursively, until `n` models are found or `PEEK_BUDGET`
entries have been examined — passing a walk object so `takeStep` charges every entry
`listFsDir` stats; without it a single wide folder pays its whole `readdir` and stat pass before the budget is consulted. Charging inside the level costs determinism unless the dirents are **sorted by code-point name order before the charge loop** (`sortEntries`' `localeCompare` is ICU/locale-dependent and cannot promise the same cut on two machines; the display order it produces afterwards may stay locale-aware): `listFsDir` charges before each stat, breaks at the budget, and sorts afterwards, so an over-budget level would otherwise keep the first N in `readdir` order — filesystem order, not stable across machines. Sorting first also makes `listFlat`'s own truncation deterministic, with no other behaviour change. Hidden entries are skipped before the charge and are not counted; the bound counts stats (a constant — 64 — not an env knob; a preview is a glance, not
a search). Deterministic, so a folder's contact sheet is the same on every visit and on
every machine. Hidden directories are skipped as everywhere else; an unreadable subfolder
is skipped; an unreadable root is a 404 like `listDir`'s. Archives met on the way are
not entered (Non-Goals), and a zip path as the root returns `[]` rather than an error, so
the client can treat "no preview" uniformly.

### D3: Preview models join the one thumbnail pipeline, which is incremental

`useThumbnails` takes `entries`, and today its load effect opens by resetting every entry to
`{ status: 'loading' }` and re-runs whenever the array's identity changes. Appending peek
results to `thumbEntries` would therefore blank the grid on every peek response — and so
would a second hook instance over a "preview list", since that list's identity changes on
every peek too (the first draft of this design tried that; it moves the flicker to the
sheets and adds O(n²) lookups). The fix is not a second pipeline but a pipeline that does
not reset: `ao-refreshes-thumbnails` makes the sweep **incremental over its entries** —
remaining entries keep state and image, only added ones start loading, removed ones are
dropped. This change hard-orders after it and then does the simple thing: preview models are
appended to `thumbEntries` (deduplicated by path — a preview model may also be a tile in a
flat listing) and rendered by the **one** hook instance. A peek landing adds a few entries
and touches nothing else.

One instance is also what the other seams need: `thumbnail-sweep-priority` replaces the
queue's ranking wholesale from `useThumbnails` (its tasks 1.2/2.2), so two instances would
erase each other's ranks; and `App.tsx`'s `placeholderRef` is one ref to one instance. With
previews in the same list, the folder tile reports its preview paths under its own
visibility band and the single ranking carries them; the embedded-3MF placeholder works
for a preview model as for a tile. Both the cache, the queue, the LRU and the recipe are
shared, which is what makes `ao-as-recipe-dimension` and `ao-refreshes-thumbnails` apply
to previews with no code of their own.

### D4: Four cells, filled in order, icon for none

A 2×2 CSS grid inside the tile's image area; previews fill cells in peek order. One → a
single full-size image (not one quadrant and three blanks); two → side by side; three →
two above one; four → the grid. Zero — an empty folder, an unreadable one, a zip, or a
peek that has not answered yet — keeps today's icon, so the tile never blanks while its
peek is in flight. Each preview cell shows the spinner-or-image the model tile shows, so
a sheet fills in progressively as renders land.

## Risks / Trade-offs

- [A grid of many folders fires many peeks on first paint] → Each is one small bounded
  read; they run under the cache-lookup concurrency limit, not the render queue; the
  observer issues them viewport-first. On the demo root that is 297 × ~5 entries in practice
  (arithmetic, not a measurement); the worst case — 297 × 64 ≈ 19k entries — would be a cold
  walk of its own (~45 s at the 2.4 ms/entry cold figure `search-cancellation` records),
  which is why peeks are viewport-driven and bounded rather than issued for a whole listing.
- [Preview renders compete with tile renders for the queue] → They *are* tile renders in
  the queue's eyes. But `thumbnail-sweep-priority` ranks by the *tile path* an observer
  reports, and a preview model has no tile: left alone it is unranked (after every visible
  tile) and, if its path ever reads as far from the viewport, cancelled. So the folder tile
  registers its preview paths under its own visibility band, the one ranking the single hook
  instance hands the queue carries them (D3), and the two changes share one
  `IntersectionObserver` in `Grid` — whichever lands second does the joining (proposal,
  ordering). Visible-first for previews is work, not an inheritance.
- [A folder whose first four models are all bases or the same part] → Correct and
  deterministic; picking better needs metadata (`overrides.json`, later). Stated in
  Non-Goals.
- [Cold media: 297 folders × a peek each on the first visit] → Proportional to scrolling;
  and `listing-tree-cache` can later answer the peek from its snapshot without touching
  the disk — the endpoint returns plain `DirEntry[]` so its backing can change.

## Migration Plan

None. A new endpoint and a new tile layout; nothing stored changes.

## Open Questions

- Whether the demo's landing should open in flat view instead of, or as well as, sheets
  — `docs/web-demo-notes.md` item 4. Independent of this change.
