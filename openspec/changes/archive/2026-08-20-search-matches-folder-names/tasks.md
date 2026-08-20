# Tasks — search-matches-folder-names

> Ordering: no change blocks this one, but two now depend on it and must archive **after**
> it: `find-in-listing` MODIFIES *Live name filter* and `semantic-search` MODIFIES *Deep
> name search*, both written against the text this change leaves behind. Whichever archives
> second wins, so re-base those deltas onto this one's wording before archiving them.
> (`url-navigation-state`, named here at proposal time, archived in `5a85992`.) Line numbers
> below were taken at proposal time.

## 1. Server predicate and folder results

- [x] 1.1 `matchesQuery` (server/src/listing.ts:143) tests the whole root-relative name, not `baseName(name)` — the query matches anywhere in the path below the root (D1). The root's own immediate containers keep their existing bare-name collection, so their behavior is unchanged
- [x] 1.2 `FlatWalk` gains `dirs: DirEntry[]`; `walkFsLevel` (:170-190) pushes **every** descended directory, named `${rel}${e.name}` like its models are, `kind` preserved (`dir`/`zip`); `walkZip` does the same for the interior directory names it already synthesizes. **No query predicate inside the walk** — `matchesQuery` must stay absent from `walkFsLevel`/`walkZip`, or the walk stops being reusable across queries and `search-cancellation`, `listing-tree-cache`, and `search-options` all lose the invariant they are built on (D2)
- [x] 1.2a Guard that push on `rel !== ''` (and the `walkZip` equivalent): `listFlat` passes the root's entries to *both* `containers` and `walkFsLevel(level, '', walk)`, so an unguarded push returns a matching root child twice — same name, same `path`, two tiles. The root level is the containers path's job, everything below it the walk's; no dedup pass needed once the guard is in (D2). In `walkZip` the discriminator is its existing `root` parameter, **not** an empty prefix: the walk-met-a-zip call `walkZip(e.path, '', …)` also passes `''`, but for `entry` — its directories are below the root and must be collected
- [x] 1.2b Filter the collected directories in `listFlat`, beside the existing model and container filters: a directory matches on its **own base name**, not its path, so a folder inside a matching folder is not itself a tile while its models still come back via 1.1. Deliberately a different predicate from the model one (whole relative path) — take the basename explicitly rather than reusing `matchesQuery` (D2)
- [x] 1.3 Queried listings order **within each block**, keeping the existing `[...containers, ...models]` assembly rather than interleaving folder tiles with their contents: containers by `sortEntries`' kind rank (dir before zip) with root-relative path as the tiebreak, then models by root-relative path. Unqueried flat listings keep base-name-then-path order — one branch on `hasQuery` beside the existing "Not sortEntries" comment. Note the containers need a **new sort call**: `listFlat` sorts only `walk.models` today, its containers arriving pre-ranked from `listFsDir` and never re-sorted, which stops being true once deeper matches are appended to them (D3)
- [x] 1.4 Bound matched containers with `MODEL_BROWSER_FOLDER_CAP` (default 50) through the existing `envLimit` helper, separate from `MODEL_BROWSER_FLAT_CAP`; either bound dropping entries sets `truncated` (D4). Keep the cap applied after filtering, as `filter-before-sort` (commit `2086f27`) left it

## 2. Server tests

- [x] 2.1 Invert `excludes a model matched only via a containing folder name, not its file name` (server/test/flat.test.ts:272-277): searching `arms` now returns `kit.zip!/arms/left.stl` **and** the `arms` directory tile. Rename it to say what it now pins
- [x] 2.1a **The invariant**: a test that the walk's output does not depend on the query — walk the same fixture under two different queries and assert the collected set (before filtering) is identical. This is what `search-cancellation` shares between requests and what `listing-tree-cache` snapshots; a regression here is silent in this change and wrong in those
- [x] 2.2 New coverage: a folder matching several levels down returns a tile (not just the root's children); a zip whose name matches returns its contents; the search root's own name does not self-match; a folder inside a matching folder is not itself a tile while its models are still results; **a matching root child appears exactly once** — the assertion that fails without 1.2a's guard, and the one a casual `toContain` check would miss
- [x] 2.3 Ordering: a query matching two folders that hold same-named files (`base.stl` in both) returns each folder's models contiguously — the assertion that fails under base-name ordering; folder tiles still lead the response as a block, dirs before zips with relative path as the tiebreak (bare-named root children sorting alongside path-named deeper ones) — a fixture needing a matching zip *and* a matching directory, or the kind rank is untested; an unqueried flat listing still returns base-name order (the existing tests at :78 and :100 must stay green untouched)
- [x] 2.4 Bounds: `MODEL_BROWSER_FOLDER_CAP` truncates containers without reducing the models returned, and sets `truncated`; the model cap still bounds matches, not raw walk output

## 3. Client wording

- [x] 3.1 Re-read the search-results label and both empty states (client/src/App.tsx) against the new rule: nothing may claim or imply that a search matches file names only. The `truncated`-empty message from `file-name-search` D5 keeps its wording — budget exhaustion is unchanged by this
- [x] 3.2 Confirm no client filter change is needed (it already matches full names) and that `Grid` renders `dir`/`zip` tiles from a search response the same way it renders the root's containers today — deep results have always been able to hold them; add a component test only if that turns out untrue

## 4. Verification

- [x] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 4.2 Manual E2E via Playwright MCP on the real library: the search that prompted this — a set/folder fragment — returns the folder tile and its parts, where it previously said "No models matched"; entering the returned folder tile navigates normally; a file-name search still behaves as before; a deliberately broad fragment truncates and says so
