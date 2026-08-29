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

### D2: A bounded depth-first walk in listing order

The peek walks the folder with `listFsDir`: models at this level in sorted order, then each
subfolder in sorted order, recursively, until `n` models are found or `PEEK_BUDGET`
entries have been examined (a constant — 64 — not an env knob; a preview is a glance, not
a search). Deterministic, so a folder's contact sheet is the same on every visit and on
every machine. Hidden directories are skipped as everywhere else; an unreadable subfolder
is skipped; an unreadable root is a 404 like `listDir`'s. Archives met on the way are
not entered (Non-Goals), and a zip path as the root returns `[]` rather than an error, so
the client can treat "no preview" uniformly.

### D3: Preview models go through the same pipeline, as a second stable input

`useThumbnails` takes `entries`, and its load effect opens by resetting every entry to
`{ status: 'loading' }` and re-runs whenever the array's identity changes. Appending peek
results to `thumbEntries` — the obvious move — would therefore blank the whole grid to
spinners and re-issue every lookup on every scroll-triggered peek response, which is
exactly the defect `ao-refreshes-thumbnails` §2.1 exists to fix, and would make this
change depend on it. So previews never touch the listing's entries. `App.tsx` holds a
separate preview list (all peeked models, deduplicated by path, minus any that are already
tiles in this listing) and runs a **second `useThumbnails` instance** over it, with the same
`api`, `lru`, `queue` and `poses`. A folder tile reads a preview's state from the preview
map, falling back to the main map for a model that is also a tile. Each instance's effect
re-runs only when *its* list changes, so a peek landing resets preview cells that are
still loading and nothing else.

Both instances share the cache, the queue, the LRU and the recipe, which is what makes
`ao-as-recipe-dimension` and `ao-refreshes-thumbnails` apply to previews with no code of
their own — the preference is read inside the hook, and a preference change re-runs both
sweeps.

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
  observer issues them viewport-first. Measured on the demo root, this is 297 × (≤64
  entries) worst case, 297 × ~5 in practice — a fraction of one listing's walk.
- [Preview renders compete with tile renders for the queue] → They *are* tile renders in
  the queue's eyes. But `thumbnail-sweep-priority` ranks by the *tile path* an observer
  reports, and a preview model has no tile: left alone it is unranked (after every visible
  tile) and, if its path ever reads as far from the viewport, cancelled. So the folder tile
  registers its preview paths under its own visibility band, and the two changes share one
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
