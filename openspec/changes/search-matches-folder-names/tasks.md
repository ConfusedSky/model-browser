# Tasks — search-matches-folder-names

> Ordering: no hard dependency on another change, but `url-navigation-state` is unarchived and edits `client/src/App.tsx`; this change's client work is confined to wording, so conflicts are unlikely — still re-read against main before starting (parallel sessions). Line numbers below were taken at proposal time.

## 1. Server predicate and folder results

- [ ] 1.1 `matchesQuery` (server/src/listing.ts:143) tests the whole root-relative name, not `baseName(name)` — the query matches anywhere in the path below the root (D1). The root's own immediate containers keep their existing bare-name collection, so their behavior is unchanged
- [ ] 1.2 `FlatWalk` gains `dirs: DirEntry[]`; `walkFsLevel` (:170-190) pushes a descended directory whose **own** name matches, named `${rel}${e.name}` like its models are, `kind` preserved (`dir`/`zip`); `walkZip` does the same for the interior directory names it already synthesizes. A folder nested inside a matching folder is not itself a match — only its own name counts, or one hit returns a subtree of tiles (D2)
- [ ] 1.3 Queried listings sort by root-relative path; unqueried flat listings keep base-name-then-path order. One comparator branched on `hasQuery`, beside the existing "Not sortEntries" comment explaining the flat ordering (D3)
- [ ] 1.4 Bound matched containers with `MODEL_BROWSER_FOLDER_CAP` (default 50) through the existing `envLimit` helper, separate from `MODEL_BROWSER_FLAT_CAP`; either bound dropping entries sets `truncated` (D4). Keep the cap applied after filtering, as `filter-before-sort` (commit `2086f27`) left it

## 2. Server tests

- [ ] 2.1 Invert `excludes a model matched only via a containing folder name, not its file name` (server/test/flat.test.ts:272-277): searching `arms` now returns `kit.zip!/arms/left.stl` **and** the `arms` directory tile. Rename it to say what it now pins
- [ ] 2.2 New coverage: a folder matching several levels down returns a tile (not just the root's children); a zip whose name matches returns its contents; the search root's own name does not self-match; a folder inside a matching folder is not itself a tile while its models are still results
- [ ] 2.3 Ordering: a query matching two folders that hold same-named files (`base.stl` in both) returns each folder's models contiguously — the assertion that fails under base-name ordering; an unqueried flat listing still returns base-name order (the existing tests at :78 and :100 must stay green untouched)
- [ ] 2.4 Bounds: `MODEL_BROWSER_FOLDER_CAP` truncates containers without reducing the models returned, and sets `truncated`; the model cap still bounds matches, not raw walk output

## 3. Client wording

- [ ] 3.1 Re-read the search-results label and both empty states (client/src/App.tsx) against the new rule: nothing may claim or imply that a search matches file names only. The `truncated`-empty message from `file-name-search` D5 keeps its wording — budget exhaustion is unchanged by this
- [ ] 3.2 Confirm no client filter change is needed (it already matches full names) and that `Grid` renders `dir`/`zip` tiles from a search response the same way it renders the root's containers today — deep results have always been able to hold them; add a component test only if that turns out untrue

## 4. Verification

- [ ] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.2 Manual E2E via Playwright MCP on the real library: the search that prompted this — a set/folder fragment — returns the folder tile and its parts, where it previously said "No models matched"; entering the returned folder tile navigates normally; a file-name search still behaves as before; a deliberately broad fragment truncates and says so
