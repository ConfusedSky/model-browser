## Why

A folder tile is a 📁 and a name (`Grid.tsx`). In a library you know, that is enough; the
name is the information. In a library you do not — a kit folder named
`Baba_Yaga_Dancing_Hut_4776321`, or the root of a corpus of 297 such kits — the tile says
nothing about what is inside, and the only way to find out is to open it. The first screen
of the public demo is exactly that: 297 identical icons. But the problem is not the
demo's; any library organised as kits (one folder per purchase, per creator, per project —
which is how print libraries are organised) shows the same wall of icons at every level
above the models.

The thumbnails to fix it already exist: the models inside the folder have them, cached and
rendered through the same pipeline as every tile. A folder tile can show four of them.
`docs/web-demo-notes.md` records the decision (Masa: "the 2×2 contact sheet for folders,
that can be implemented before making the split").

## What Changes

- **A folder tile shows up to four of its models' thumbnails as a 2×2 contact sheet**, with
  the folder's name beneath as today. Fewer than four fill what there is; none, or an
  unreadable folder, keeps the icon.
- **The preview is asked for per tile, when the tile is on screen**, not computed by the
  listing. A listing's cost does not change; a folder that scrolls into view costs one
  small, bounded peek. On cold removable media this is the difference between a listing
  that takes seconds longer and one that does not.
- **The models previewed are the first four found by a bounded, deterministic walk** of the
  folder in listing order — immediate models first, then subfolders in order — so a kit
  shows its parts and a folder of kits shows its first kit's parts. The walk's budget is
  small and fixed; a folder that exhausts it before finding four shows what it found.
- **Their thumbnails come from the same cache, queue and recipe as every other tile.** A
  preview model that is also a tile elsewhere shares its entry; the occlusion preference
  (`ao-as-recipe-dimension`) and visible-first priority (`thumbnail-sweep-priority`) apply
  to previews as to tiles.
- **Zip tiles are not previewed in this change.** A zip's contents cost a central-directory
  read — measured at 6.7 s across the real library's archives (`listing-tree-cache`) — and
  that change is where a cheap answer will come from. The icon stays.
- No pixel changes; no `RIG_VERSION` bump.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: **ADD** *Folder tiles preview their contents* — the peek endpoint,
  its bound and order, when a tile asks, and what the tile shows for 0–4 previews.
  *Thumbnail grid navigation* (folder tiles navigate on activation) is untouched; so are
  the requirements `library-root` and `search-cancellation` change.
- `model-thumbnails`: no requirement change — previews are model thumbnails obtained the
  way the *Client-side thumbnail rendering* requirement already describes.

## Impact

**Server**

- `GET /api/peek?path=<dir>&n=4` in `app.ts`: a bounded depth-first walk in listing order
  over `listFsDir`, returning up to `n` model entries (`DirEntry[]`, full shape — the
  client needs `mtime` for the cache key). Budget as a constant (entries examined), not an
  env knob. Refuses non-directories; a zip path returns an empty list in this change.
- `listing.ts`: the walk reuses `listFsDir` and `sortEntries`; no new traversal code.

**Client**

- `api/client.ts`: `peek(path, n)`.
- `components/Grid.tsx`: the folder tile requests its peek when it enters the viewport
  (an `IntersectionObserver` per grid, not per tile), renders 1–4 `<img>` in a 2×2 layout
  from the thumbs map, and keeps the icon for none.
- `App.tsx` / `hooks/useThumbnails.ts`: previews are rendered by a **second instance** of
  the hook over a separate, stable preview list — never appended to `thumbEntries`, whose
  identity change would reset every tile in the grid to a spinner (the hook's effect opens
  with `setThumbs(new Map(…loading))` and depends on `entries`). A small per-listing map of
  `folder path → preview entries`, dropped on navigation; models that are already tiles are
  read from the main map instead of previewed twice.
- Tests: peek order and budget on a fixture tree; a folder tile with 0/1/3/4 previews; a
  preview model shares its thumbnail with its own tile; no peek before the tile is visible.

**Ordering**

- After `library-root` (paths); after `ao-as-recipe-dimension` (previews follow the
  preference through the shared hook — automatic, but the tests assert it).
  `thumbnail-sweep-priority` adds an `IntersectionObserver` to `Grid` and a visibility band
  per *tile path*; a preview model has no tile, so without work here it is unranked (after
  every visible tile) and cancellable. This change therefore declares: if that change has
  landed, the folder tile registers its preview paths under its own band and the two share
  one observer; if it has not, this change's observer is the one it extends. Whichever lands
  second does the joining. `listing-tree-cache` can later serve the peek from its snapshot
  and extend it to zips; the endpoint's contract is written so it can.
