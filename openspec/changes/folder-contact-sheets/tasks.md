# Tasks — folder-contact-sheets

> Ordering (hard): after `library-root` (paths are library paths), `ao-as-recipe-dimension`
> (previews follow the preference through the shared hook — asserted in 3.3) and
> `ao-refreshes-thumbnails` (the incremental sweep D3 relies on — without it every landing
> peek resets the grid). Independent of `search-cancellation`: a peek is bounded and joins
> neither its shared traversals nor its cancellation, by requirement. Prefers `thumbnail-sweep-priority` first so previews inherit
> visible-first ordering; if it has landed, 2.2 joins its ranking and observer. `listing-tree-cache` may later back the peek from its snapshot. Re-read
> `Grid.tsx`, `useThumbnails.ts`, `App.tsx`, `listing.ts`, `app.ts` against main before
> starting.

> No `RIG_VERSION` bump — no new render, four existing ones in a CSS grid.

> **Partial application, 2026-08-31 (Masa's call):** the hard ordering above is knowingly
> broken for everything except D3. `ao-refreshes-thumbnails` (0/24) and
> `ao-as-recipe-dimension`'s client half were unlanded, and nothing here is *textually*
> unmergeable against them — this change never edits `useThumbnails.ts`, only feeds it —
> so §1, 2.1's mechanics, 2.2, 2.3 and the non-D3 parts of 2.4 were applied now. Deferred
> until `ao-refreshes-thumbnails`' reconciler lands: 2.4's no-reset-across-a-peek-landing
> assertions (either direction — no such test exists yet, on purpose), 3.3, and the live
> checks 3.2/3.4. Until then a peek landing visibly resets the grid to spinners
> (`useThumbnails`' load effect resets every tile on an entries identity change) — a known,
> accepted defect, not a regression to hunt.

## 1. Server: the peek (D2)

- [x] 1.1 `listing.ts` `peek(libPath, n)`: depth-first over `listFsDir` in its sorted order —
      models at this level, then subdirectories recursively — until `n` models or
      `PEEK_BUDGET = 64` entries examined — **charged per entry through a walk object passed to
      `listFsDir`** (`takeStep`), since without one `listFsDir` stats a whole level before
      returning; and `listFsDir` sorts its dirents in **code-point order before** the charge loop (not `localeCompare`, which is locale-dependent), or an over-budget level keeps the first N in `readdir` order and the preview differs between machines (D2); the peek passes no cancellation token — bounded and brief, it runs to completion when abandoned, which the requirement now states so `search-cancellation`'s "a traversal no request is awaiting SHALL be stopped" does not apply to it; and the peek's own recursion applies `library-root`'s confinement to every entry it descends into or previews (its checks sit in `walkFsLevel` and `listFsDir`; the peek recurses over `listFsDir` itself); skips hidden and unreadable subdirectories; does
      not enter archives; a zip root returns `[]`; an unreadable root is the 404 `listDir`
      gives. Resolves through the library (`library-root` 1.4)
- [x] 1.2 `app.ts` `GET /api/peek?path&n` (n defaults 4, capped at 8); returns `DirEntry[]` with library paths and mtimes; a path route, so it answers `library-root` 1.5's not-ready envelope like the others
      — 1.1/1.2 applied 2026-08-31 (commit "Lets a folder answer what is inside it, in one
      order everywhere"). One taxonomy decision at review: a peek on an existing file that
      is not a directory answers **400** `not a directory` (`listDir`'s split — "not found"
      and "has no inside" are different answers), 404 only for absent or unreadable-root
      paths. A directory *named* `x.zip` is walked (stat before name, `listDir`'s order);
      only a zip file answers `[]`.
- [x] 1.3 Server tests: order (level models before subfolder models, sorted names);
      a single folder wider than the budget stops at the budget **and previews the first models in code-point order** regardless of `readdir` order (shuffle the fixture's creation order); a symlinked subfolder pointing outside the library is neither previewed nor descended into; budget
      stops the walk and returns what was found; hidden and unreadable subfolders skipped;
      zip root → `[]`; a folder with only subfolders previews the first subfolder's models;
      determinism across two calls
      — done 2026-08-31, `server/test/peek.test.ts` (26 cells, suite 326 green under
      vitest/Node). **"Shuffle the fixture's creation order" was a wrong instruction**: Node
      *sorts* `readdir`, so a shuffled fixture still arrives in code-point order under
      vitest and asserts nothing — the suite instead `vi.mock`s `node:fs/promises` to hand
      back the real listing **reversed**, and the order cells were falsified against that
      (sort removed → `m16–m19` for `m00–m03`; `localeCompare` swapped in → the 64-entry
      cut lands on `a.stl` for `B.stl`). The peek's own confinement guard is defense-in-depth
      (`listFsDir` drops the out-of-library symlink first), behaviourally unfalsifiable, and
      pinned by a source-shape assertion on `flat.test.ts`'s precedent.

## 2. Client: the tile (D1, D3, D4)

- [x] 2.1 `api/client.ts` `peek(path, n)`; `App.tsx` keeps a per-listing `Map<folderPath,
      DirEntry[]>` cleared on navigation, and appends the preview entries (deduplicated by
      path) to `thumbEntries` for the **one** `useThumbnails` instance — relying on
      `ao-refreshes-thumbnails` 2.1's incremental sweep, so a landing peek adds entries and
      resets nothing (D3; a second instance was tried on paper and has the same defect one
      level down, plus two wholesale rankings and an unreachable `setPlaceholder`)
      — mechanics applied 2026-08-31 (commit "Lets a folder tile show what is inside it,
      once per listing"); the D3 clause waits on `ao-refreshes-thumbnails` (header note).
      "Cleared on navigation" landed as cleared on **`entries` identity**, not
      `state.result` — see design D1's recorded decision (`patch` spreads the result on
      fetchless view changes); the same reference is the stale-landing generation token.
      A failed peek stores `[]` — an answer, so no retry within the listing
- [x] 2.2 `Grid.tsx`: one `IntersectionObserver` for the grid observing folder tiles —
      shared with `thumbnail-sweep-priority`'s if it has landed, and a folder tile then
      registers its preview paths under its own visibility band so the single ranking carries
      them and they are neither unranked nor cancelled as far-away work — a path that is
      both a visible tile and a far folder's preview takes the **nearest** band (per-path
      max), so a far band never cancels visible work; on first visibility a tile requests its peek (once per
      listing); the folder tile
      renders 1–4 previews from `thumbs` in the D4 layouts, each cell the model tile's
      spinner-or-image, and the icon for none / not-yet-answered / zip
      — done 2026-08-31 as the **standalone** observer: `thumbnail-sweep-priority` had not
      landed (0/12), so per its own header that change does the joining when it does; no
      bands, no ranking here. The cell three-state is `ThumbView`, extracted from the model
      tile, not copied. Grid observes `data-dir-tile`, written only by the `dir` branch
- [x] 2.3 Memoisation: the folder tile compares on its entry, its preview entries and their
      thumb states — the grid's existing memo rule — so typing in the search box does not
      re-render sheets
      — done: `tilePropsEqual`, shallow-over-keys with one exemption (`previewThumbs`,
      elementwise by identity — `setThumb` reuses untouched per-path state objects)
- [ ] 2.4 Client tests: a tile requests no peek until visible, then exactly one; 0/1/3/4
      previews render the D4 layouts; the icon shows while the peek is in flight and when the peek request fails (503 envelope, network error); a preview
      model that is also a tile shares one `thumbs` entry (one render, two images); a peek
      landing does **not** reset any tile or sheet cell already shown (assert every
      pre-existing state is untouched across a peek response and only the added paths
      issue lookups); an embedded-3MF placeholder shows in a sheet cell as it would on a
      tile; the map clears on navigation
      — all but the no-reset clause done 2026-08-31, `client/test/folderSheets.test.tsx`
      (13 cells; suite 536 green). The no-reset assertions are the deferred D3 family
      (header note) — the file's own header says the omission is a decision, and no cell
      asserts either direction. Falsified: the once-per-listing guard (removed → the
      away-and-back and failure cells count 2 calls) and the `thumbEntries` dedup
      (removed → the shared-entry cell finds 3 lookups for 1). The first falsification run
      exposed a vacuous retry assertion — a re-fired intersection on an already-unobserved
      tile reaches Grid's `unobserve`, never App's guard — rewritten as `awayAndBack()`
      (find-filter unmount/remount), the only shape that reaches App's guard. Also: two
      cells first failed because a `listDir.mockImplementation` installed *before*
      `mountApp` is discarded by its `mockReset` and every landing then reuses one listing
      object — correctly not a listing change; install listing mocks after mounting.
      Extra cell beyond the list: a stale peek landing after a listing change (flat
      toggle — the same folder in both listings) is dropped by the generation token and
      the folder is peekable again

## 3. Verification

- [x] 3.1 `bun run test` / `bun run typecheck` clean
      — run 2026-08-31 on the merged branch (both worker commits cherry-picked onto main
      `e14b24e`): server 326 passed | 3 skipped, client 536 passed, both typechecks exit 0
- [ ] 3.2 Live on the demo corpus root (`clustered-hq`, 297 kits): the first screen fills
      with sheets viewport-first; the listing request's timing is unchanged from before
      (network panel); scrolling issues peeks for folders as they appear and no others
- [ ] 3.3 Live with the AO pill: toggling re-renders sheet cells along with tiles
      (`ao-refreshes-thumbnails`), and a sheet cell and its model tile show identical images
- [ ] 3.4 Cold-media check on the real library (unmount/remount to drop the page cache): time
      to first sheet on a folder-of-kits root, recorded in this file beside the number of
      peeks issued
- [x] 3.5 `docs/web-demo-notes.md`: the contact-sheet row points here; item 4 (landing)
      notes that sheets exist and flat-view-at-root is still its own question
      — done 2026-08-31; both edits say the application is partial and point at this
      file's header note for what waits on `ao-refreshes-thumbnails`
