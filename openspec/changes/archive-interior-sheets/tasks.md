## 0. Ordering against active changes

- [x] 0.1 `search-cancellation` shares `server/src/listing.ts` and states in its
      proposal that "`takeStep` has only two call sites" and that the peek is
      exempt by construction. **Resolved, not deferred:** the interior walk has no
      `FlatWalk` and counts with its own counter, so `takeStep` still has exactly
      two call sites (`listFsDir`, `walkZip`) and an interior peek cannot inherit
      a cancellation token at all. Verified after implementation; no ordering
      constraint between the two changes.
- [x] 0.2 `hover-prefetch-listings` warms `/api/dir` for hovered **zip** tiles.
      With this change a hovered archive also runs the fill's interior peeks, so
      confirm the warm still fits its budget once both have landed.

## 1. Server: peek inside an archive

- [x] 1.1 Replace `peek`'s `if (entry !== undefined) return []` (server/src/listing.ts)
      with a branch that previews the archive interior, keeping the archive's own
      tile refused by the existing post-`stat` `/\.zip$/i` return (D1). Update the
      docstring's "Neither an archive nor anything inside one is previewed"
      sentence — it will otherwise contradict the code it heads.
- [x] 1.2 Give the branch the listing's refusals rather than a bare `[]` (D10):
      `requireArchive`'s 400 when the filesystem half is not an archive;
      `listZipDir`'s `404 cannot read zip: <libPath>` wrapper for an unreadable
      one (never the raw errno — that is the 500 naming the host path its comment
      records); 400/`VPathError` for an entry naming a file or a nested zip; `[]`
      for an empty entry half (`/kit.zip!/`), matching what `/kit.zip` answers,
      and **not** a fall-through to a `''` prefix that would preview the whole
      archive. A missing prefix inside a readable archive stays `[]`. A `ZipError`
      — the library holds one zip64 archive that raises it — propagates as
      `listDir` propagates it, not swallowed into an empty sheet.
- [x] 1.3 Add the interior level walk: filter `listZipEntries`' names by the
      directory's prefix, this level's models before its subdirectories,
      depth-first, in **code-point** order — not `sortEntries`' `localeCompare`
      (D2, the reason `listFsDir` sorts that way). Skip nested `.zip` entries
      rather than descending (D5). `peek`'s `found` is `FsEntry[]` and an interior
      find has no `fsPath`, so the branch needs its own `DirEntry` collection.
- [x] 1.4 Carry `zipStat.mtimeMs` on every interior find, as `listZipDir` and
      `walkZip` emit (D11) — thumbnails are keyed path+mtime, so any other value
      makes a sheet cell cache a second image beside the model tile's. Reuse the
      stat `listZipEntries` already takes rather than adding a second one.
- [x] 1.5 Charge `PEEK_BUDGET` **one step per distinct immediate child** — each
      file name and each distinct subdirectory name directly under the prefix
      (D4). Not `walkZip`'s per-entry-at-any-depth rule. Names outside the prefix
      are never charged; the charge loop runs over the code-point-sorted children
      and breaks at the budget as `listFsDir` does.
- [x] 1.6 Thread an optional `ZipDirCache` through `peek` to `listZipEntries`,
      the way `gatherFlat` threads `walk.zips` (D3).

## 2. Server: the shared archive read, routes, and invalidation

- [x] 2.1 Fold `listZipDir` onto the layer (D3): it takes a `ZipDirCache`,
      `listDir` gains the parameter to pass it, and `/api/dir` supplies
      `snapshots?.archiveCache()`. Without this the browse pays one tail read and
      the first peek pays another. Note the consequence: browsing an archive now
      writes a record for it.
- [x] 2.2 Thread the cache to where `peek` is actually called: neither route calls
      it directly, so `posedFirstPeek` takes it and passes it to both `walkOnly`
      and `walkRanked` (which stays unreachable for interiors but must compile);
      `/api/peek` and `fillPreviews` supply `snapshots?.archiveCache()`. No change
      to the `unchosen` collection — it already takes these dirs (D7).
- [x] 2.3 Re-derive a stale interior sheet at emission (D9): the held cells carry
      the archive's mtime and so does the listing's interior entry, so emission
      compares them and re-derives on a mismatch. **Not** `noteDirChanged` — it
      walks upward and leaves interior keys held (probed); and not the
      revalidation route, which never runs for a nested `/api/dir`.
- [x] 2.4 Update `selfAndAncestors`' comment in server/src/layers.ts — "A preview
      is never derived inside an archive today" becomes false with 1.1.

## 3. Server tests

- [x] 3.1 Rewrite `server/test/peek.test.ts`'s "previews nothing for a path
      inside an archive" — it asserts today's bug. It becomes: a directory inside
      an archive previews the models under it (`${zipLibPath}!/parts` → `lid.stl`).
- [x] 3.2 Keep and re-assert the two neighbours that stay true: a zip **root**
      previews nothing, and an archive met on the way during a filesystem walk is
      not entered.
- [x] 3.3 Cover an interior whose own level holds only subdirectories (descends),
      one holding a nested `.zip` (skipped, not descended), and the bound (an
      interior wider than `PEEK_BUDGET` still answers, cut identically twice).
      Pin 1.5's accounting with a level whose one subdirectory holds more entries
      than the budget: it must still reach the level's own models.
- [x] 3.4 Cover 1.2's refusals as refusals, not as empty sheets — `/somedir!/x`,
      a mode-000 archive, `/kit.zip!/box.stl`, `/kit.zip!/inner.zip` — and that
      `/kit.zip!/` answers `[]` like `/kit.zip`. Check the unreadable case's
      message names the library path, not the host path. `refusals.test.ts` has a
      `/api/peek` cell for `/` only; extend it there.
- [x] 3.5 Assert an interior find's entry equals the listing's for the same model,
      mtime included (1.4), so the shared-thumbnail requirement is pinned rather
      than assumed.
- [x] 3.6 Assert the archive is read once for a listing plus its tiles, through a
      counting `ZipDirCache` rather than a timing — and beware the vacuous pass:
      `fillAnnotations` returns early unless the index probe is ready, and
      `peek.test.ts` stubs `fetch` to throw, so a counting cache there sees
      **zero** reads and 3.8's revert also shows zero. Use the harness in
      `server/test/layers.test.ts` ("emission fills what the layers lack",
      `createApp` with a store and a stubbed ready index) and assert
      `reads === 1`, never `<= 1`. Cover the no-store case (each call reads)
      since D3 claims it.
- [x] 3.7 Cover 2.3: a sheet held against an older archive mtime is re-derived at
      emission rather than served.
- [x] 3.8 Falsify every cell before trusting it — revert 1.1's branch (and 2.3's
      check for 3.7) and confirm each new test fails for the reason it names, not
      merely fails.

## 4. Verify against the running app

- [x] 4.1 `bun run typecheck` and `bun run test` clean across workspaces.
- [x] 4.2 Live check on the real library, from a restarted server: `/api/peek`
      on `/Oni+Cyber+Punk+Mask.zip!/files` returns the two STLs, and `/api/dir`
      on `/Oni+Cyber+Punk+Mask.zip` carries them as that tile's `preview`. Record
      the library top and root the measurement was taken against.
- [x] 4.3 Browse 5173 (not 3177 — a stale `client/dist` would serve an old
      bundle) into a zipped kit and confirm the folder tiles fill. Judge the
      pixels; this line is not done when the code lands.
- [x] 4.4 Land the cost probe as `scripts/zip-tail-cost.ts` — the Bun script
      behind the Context measurement (cold reads with `POSIX_FADV_DONTNEED`, the
      with/without-layer A/B) — so the number is re-runnable rather than retyped.
      Re-run it after 2.1 and record the browse-path figure beside it.

## 5. Archive

- [ ] 5.1 Dry-run `openspec archive` on a fresh copy of `openspec/` and confirm
      the MODIFIED block still applies without dropping a scenario.
- [ ] 5.2 After archiving, read `openspec/specs/directory-browsing/spec.md` and
      strip any change-scoped prose that reads as the capability's own.
