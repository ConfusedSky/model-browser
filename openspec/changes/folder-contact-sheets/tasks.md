# Tasks — folder-contact-sheets

> Ordering (hard): after `library-root` (paths are library paths), `ao-as-recipe-dimension`
> (previews follow the preference through the shared hook — asserted in 3.3) and
> `ao-refreshes-thumbnails` (the incremental sweep D3 relies on — without it every landing
> peek resets the grid). Prefers `thumbnail-sweep-priority` first so previews inherit
> visible-first ordering; if it has landed, 2.2 joins its ranking and observer. `listing-tree-cache` may later back the peek from its snapshot. Re-read
> `Grid.tsx`, `useThumbnails.ts`, `App.tsx`, `listing.ts`, `app.ts` against main before
> starting.

> No `RIG_VERSION` bump — no new render, four existing ones in a CSS grid.

## 1. Server: the peek (D2)

- [ ] 1.1 `listing.ts` `peek(libPath, n)`: depth-first over `listFsDir` in its sorted order —
      models at this level, then subdirectories recursively — until `n` models or
      `PEEK_BUDGET = 64` entries examined; skips hidden and unreadable subdirectories; does
      not enter archives; a zip root returns `[]`; an unreadable root is the 404 `listDir`
      gives. Resolves through the library (`library-root` 1.4)
- [ ] 1.2 `app.ts` `GET /api/peek?path&n` (n defaults 4, capped at 8); returns `DirEntry[]`
      with library paths and mtimes
- [ ] 1.3 Server tests: order (level models before subfolder models, sorted names); budget
      stops the walk and returns what was found; hidden and unreadable subfolders skipped;
      zip root → `[]`; a folder with only subfolders previews the first subfolder's models;
      determinism across two calls

## 2. Client: the tile (D1, D3, D4)

- [ ] 2.1 `api/client.ts` `peek(path, n)`; `App.tsx` keeps a per-listing `Map<folderPath,
      DirEntry[]>` cleared on navigation, and appends the preview entries (deduplicated by
      path) to `thumbEntries` for the **one** `useThumbnails` instance — relying on
      `ao-refreshes-thumbnails` 2.1's incremental sweep, so a landing peek adds entries and
      resets nothing (D3; a second instance was tried on paper and has the same defect one
      level down, plus two wholesale rankings and an unreachable `setPlaceholder`)
- [ ] 2.2 `Grid.tsx`: one `IntersectionObserver` for the grid observing folder tiles —
      shared with `thumbnail-sweep-priority`'s if it has landed, and a folder tile then
      registers its preview paths under its own visibility band so the single ranking carries
      them and they are neither unranked nor cancelled as far-away work; on first visibility a tile requests its peek (once per
      listing); the folder tile
      renders 1–4 previews from `thumbs` in the D4 layouts, each cell the model tile's
      spinner-or-image, and the icon for none / not-yet-answered / zip
- [ ] 2.3 Memoisation: the folder tile compares on its entry, its preview entries and their
      thumb states — the grid's existing memo rule — so typing in the search box does not
      re-render sheets
- [ ] 2.4 Client tests: a tile requests no peek until visible, then exactly one; 0/1/3/4
      previews render the D4 layouts; the icon shows while the peek is in flight; a preview
      model that is also a tile shares one `thumbs` entry (one render, two images); a peek
      landing does **not** reset any tile or sheet cell already shown (assert every
      pre-existing state is untouched across a peek response and only the added paths
      issue lookups); an embedded-3MF placeholder shows in a sheet cell as it would on a
      tile; the map clears on navigation

## 3. Verification

- [ ] 3.1 `bun run test` / `bun run typecheck` clean
- [ ] 3.2 Live on the demo corpus root (`clustered-hq`, 297 kits): the first screen fills
      with sheets viewport-first; the listing request's timing is unchanged from before
      (network panel); scrolling issues peeks for folders as they appear and no others
- [ ] 3.3 Live with the AO pill: toggling re-renders sheet cells along with tiles
      (`ao-refreshes-thumbnails`), and a sheet cell and its model tile show identical images
- [ ] 3.4 Cold-media check on the real library (unmount/remount to drop the page cache): time
      to first sheet on a folder-of-kits root, recorded in this file beside the number of
      peeks issued
- [ ] 3.5 `docs/web-demo-notes.md`: the contact-sheet row points here; item 4 (landing)
      notes that sheets exist and flat-view-at-root is still its own question
