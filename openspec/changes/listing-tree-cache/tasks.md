# Tasks — listing-tree-cache

> Rebased on `library-root` (landed 2026-08-29): every path is a library path, the thumbnail
> cache is per library under `<cache>/<library-id>/`, and an unmounted volume is the `missing`
> state answered before any listing. Snapshot keys are the library id plus the root's library
> path; the delta and design were rewritten to match — re-read both before starting.

> Ordering: after `search-matches-folder-names` (its container collection changes what the walk gathers). This caches **the tree the walk gathers, not a walk's filtered output** — the distinction is the whole design: `q` and the search options are filters applied over the snapshot, so they are not part of its key, and a toggle re-filters rather than re-walking. Independent of `search-options` for the same reason. Re-read `listing.ts` against main before starting (parallel sessions).

> **Landed since this was drafted, and load-bearing here** (`library-overrides`, 2026-08-31):
> `applyDisplayNames` in `app.ts` **mutates emitted `DirEntry`s in place**, setting
> `displayName` from the per-library override store, and only ever sets — it never clears.
> Safe today because every listing mints fresh entries; a snapshot that hands out cached
> `DirEntry` objects would bake the first request's names in and keep them across a store
> removal or a library repoint, breaking that change's "no store → byte-identical labels"
> requirement. Serve **copies** from the snapshot (or make the name pass copy-on-write)
> and add the cell: repoint/remove the store, re-list, labels revert.

## 1. Validate the freshness signal before building on it

- [x] 1.1 **Do this first — D4 rests on it.** Measure directory-mtime behavior on the real **exfat** volume (`/run/media/masa/Files and S`): add, remove, and rename entries in a directory and confirm its mtime moves in each case, at what granularity, and whether it survives unmount/remount. exfat timestamps are coarser than ext4's and driver-dependent
      — run 2026-09-02 (`scripts/probe-dir-mtime.py`, re-runnable against any volume;
      coordinator session, /dev/sda2 exfat 3.7T spinning, linux `exfat` driver, relatime):
      **all eight behavior probes pass** — add/remove/rename of files AND subdirs each
      move the parent's mtime; a content edit does not; a change one level down does not
      move the grandparent. **Granularity is 10 ms**, not the feared 2 s: ~90 adds at
      50 ms spacing produced ~90 distinct mtimes stepping in clean 10 ms units (the
      exFAT on-disk resolution, honored by this driver). **Remount-safe**: every probe
      directory's mtime was byte-identical after `udisksctl unmount`/`mount`, 10 ms
      fractional parts included. Residual D4 hazard window is one 10 ms granule, not 2 s
- [x] 1.2 If mtime proves unreliable there, fall back to the readdir fingerprint (entry count + total size per directory) from D4 and record the switch in the design before writing cache code — it still skips per-entry stats and zip tails, which is where the measured cost is
      — not needed: 1.1 proved mtime reliable on the real volume (all moves detected,
      no false moves, 10 ms granularity, remount-stable). The fallback stays in D4 as
      the contingency for *other* filesystems per the proposal's wider-target note,
      unbuilt here

## 2. Cache store

- [x] 2.1 A metadata cache module beside `server/src/cache.ts`, following its patterns: same `~/.cache/model-browser` root and `MODEL_BROWSER_CACHE` override, same size accounting and `maintain()` sweep, one env knob per limit through a validating helper (`envLimit`'s existing contract — a malformed value must not silently unbound anything)
      — landed 2026-09-02 as `server/src/snapshot.ts` (`SnapshotStore`). Cache root and
      library are constructor arguments on `ThumbCache`'s shape, so the suite never reads
      the env. `MODEL_BROWSER_SNAPSHOT_CAP` (default 64 MB) goes through `envCap`, a copy
      of `envLimit`'s contract; falsified by returning `Number(raw)` unvalidated, which
      fails the knob cell with `expected NaN to be 67108864`.
      **The sweep is the store's own, not `ThumbCache.maintain()`** — see D2 and 2.3 below
- [x] 2.2 Snapshot shape: entries keyed by library id plus the walked root's library path, holding name/kind/size/mtime, plus per-directory freshness state; versioned on disk so a format change invalidates rather than mis-parses
      — `SnapshotEntry` (name/path/kind/format/size/mtime) plus `SnapshotDir`
      (`{path, mtime}`, D4's per-directory signal, a record so the readdir-fingerprint
      fallback can be added without changing what `mtime` means). Deliberately **not**
      `DirEntry`: that shape carries `displayName`, which `applyDisplayNames` sets in place
      and never clears, so persisting it would bake one request's override names into every
      later answer — the preamble's hazard, made unrepresentable rather than merely
      discouraged. `SNAPSHOT_VERSION` guards the format and writes are atomic
      (temp + fsync + rename, `writeOverrides`' procedure). Reads are **pure**: a file of
      the wrong version is refused, not deleted; `maintain` reaps it
- [x] 2.3 Keyed on the library's identity plus the walked root's **library path**, under
      `<cache>/<library-id>/`, so the same library at another mountpoint is a hit and two
      libraries with the same layout never share a snapshot (D6)
      — `<cache>/<library-id>/snapshots/tree-<sha256(root library path)>.json`, one file
      per walked root, plus `archives.json` per library. **The `snapshots/` subdirectory is
      load-bearing, not tidiness** (D2, amended in `b54967c` after this was read):
      `ThumbCache.maintain()` treats every `*.json` in the per-library directory as a
      thumbnail sidecar, so a snapshot filed flat there makes `sourceExists(meta.path)`
      throw on an undefined path and aborts the whole sweep — silently, since `runMaintain`
      swallows it. Demonstrated, not assumed: filing them flat fails the coexistence cell
      with `TypeError: Cannot read properties of undefined (reading 'startsWith')` from
      `library.ts`'s `resolve`. `maintain()` is byte-unchanged. Identity is checked twice
      over — the directory *and* a `library` field inside each file, so a file restored
      into the wrong library's directory is refused on its own contents

## 3. Archive directory cache (the largest measured win)

- [x] 3.1 `zip.ts`'s central-directory read consults the cache keyed on the archive's `{mtime, size}`; an unchanged archive is never opened (D3). Measured at ~6.7s across 409 archives on the spinning volume — assert in a test that a second walk opens zero archives
      — landed 2026-09-02. `listZipEntries(zipPath, cache?)` takes an optional
      `ZipDirCache`, a two-method structural interface **declared in `zip.ts`** so that file
      imports no cache plumbing; `SnapshotStore.archiveCache()` implements it and maps the
      filesystem path to a library path, so the layer survives a remount. `listing.ts` is
      untouched — both its call sites pass nothing, and stage 2 (4.1) threads the cache in.
      **`fileSize()` became a `stat()`**: it read the size by `open`+`fstat`, which would
      open every archive on the cache-hit path and make "never opened" unmeetable by
      construction; `stat` also supplies the mtime half of the key. No pre-existing zip or
      listing cell noticed the difference (ENOENT parity) — all 530 server tests pass
      untouched. The zero-opens claim is **instrumented at the syscall**, never timed: a
      `vi.mock('node:fs/promises')` wrapper records every `open` by path. Two cells — a
      second walk in the same process, and a second walk in a *later* store over the same
      cache directory (what a restart is). Falsified by removing the cache consult, which
      reports `expected [ 2, 2, 2 ] to deeply equal [ +0, +0, +0 ]` (2 = the tail read plus
      the central-directory read)
- [x] 3.2 A rewritten archive re-reads and replaces its cached directory
      — the rewritten archive is re-read, its neighbour still answers with zero opens, and
      the *replacement* is what persists. Falsified by dropping the `{mtime, size}`
      comparison: `expected [ 'part-0.stl' ] to deeply equal [ 'extra.stl', 'renamed.stl' ]`.
      Fixture note for later stages: `cpSync` gives the copy a fresh mtime (and
      `preserveTimestamps` still loses sub-millisecond precision), so a copied archive is a
      *rewritten* one and correctly misses — a remount must be simulated with `renameSync`,
      which keeps the inode

## 4. Walk integration and revalidation

- [ ] 4.1 `listFlat` serves from the snapshot when one exists for the root; a miss walks and populates. The snapshot is keyed by the **root alone** (its library path under the library's id) — not by `q`, not by the search options — and filtering runs over it exactly as it runs over a live walk (D1)
      <br>**The seam 4.1a needs already exists (2026-09-01, aggregate-review worker WR-S).**
      `server/src/listing.ts` exports `walkFlat` — `listFlat`'s body, returning
      `{ listing, budgetExhausted, capped }` — and `listFlat` is now a one-line wrapper
      over it. Build 4.1 on `walkFlat`, not on `listFlat`: `DirListing.truncated` is the
      **OR** of those two flags and cannot answer 4.1a's question, so a folder walked end
      to end whose 501st model the response cap dropped would otherwise refuse to cache
      itself forever. `budgetExhausted` alone is the completeness fact. Cells:
      `flat.test.ts` › "the two reasons a listing is truncated, which the wire does not
      tell apart"
- [ ] 4.1a Only a **complete** traversal is persisted: a walk that stopped against its step budget populates nothing, or a partial tree is stored as though whole and is permanently wrong (D1). Test that a budget-truncated walk leaves no snapshot behind, and that the next unbudgeted request traverses
- [ ] 4.2 Incremental revalidation: one `stat` per directory, re-reading only those whose freshness signal moved (D4). Never a background full re-walk — that reintroduces the cold cost off-screen (D5)
- [ ] 4.3 A revalidation that cannot be completed against a root that is **present** — an
      unreadable directory, permissions changed — invalidates rather than serving cached
      entries. A root that is not present at all never reaches revalidation: it is the
      library's `missing` state, answered before any listing, which neither serves the
      snapshot nor discards it (D6)

## 5. Freshness on the wire

- [ ] 5.1 Additive staleness marker on `/api/dir` responses; a freshly walked listing carries none
- [ ] 5.2 Client: present cached results immediately with a "refreshing" affordance, and reconcile the corrected listing when it arrives — no new transport (the Hono app must run on Node unchanged, architecture D1), so the client issues an ordinary follow-up request on seeing the marker; the existing latest-wins guard and skeleton already cover a later response landing

## 6. Derived layers and explicit freshness (added 2026-09-02 — see design D7–D9; build after §4, the layers hang off the snapshot and its revalidation)

- [ ] 6.1 Pose and preview-choice layers beside the snapshot module: per-path entries
      keyed against the tree plus the index generation and pose version; populated when
      the server's semantic proxy answers (poses) and when a peek derives a choice
      (previews); never consulted-and-blocked-on at emission — a lookup hits or the field
      is absent. Preview re-derivation on directory change covers the changed directory
      **and its ancestors** (D7's stated subtlety)
- [ ] 6.2 Thumbnail-state index: `ThumbCache` exposes an in-memory per-path index —
      presence, staleness against the snapshot's mtime, the sidecar's write
      generation, and `framed` (a stored camera OR axis exists — the definition
      `bulk-thumbnail-jobs`' reset shares, review M4; presence/staleness are per
      occlusion variant, since the store keys renders that way, review m20) —
      maintained on its own
      reads/writes, no directory rescan per listing. The write generation is a seam
      the immutable-thumbnail-serving change consumes and `framed` one
      `bulk-thumbnail-jobs` consumes (its reset counts/derivation); keep the shape
      additive
- [ ] 6.3 Emission: additive `DirEntry` fields (`shared/types.ts`) attached in `app.ts`
      beside `applyDisplayNames`, same in-place caveat as the preamble's `displayName`
      note — cached snapshot entries must not bake annotations in; serve copies. A
      library with no layer content emits byte-identical listings (pin with the
      library-overrides DOM/wire-identity cells as precedent). **Shape seam
      (2026-09-02):** `thumbnail-image-serving` (drafted, sequenced after this
      §6) consumes the thumbnail annotation and its design D2 names the field
      shape — `DirEntry.thumb?: { gen, framed, camera?, axis?, ao?: { state,
      lighting?, rig?, posed? }, noao?: {…} }`, i.e. 6.2's presence/staleness/
      gen/framed plus the recipe labels and stored camera/axis the client's
      usability test reads. Adopt it here or amend it there — one shape, not
      two; that change's proposal says the same
- [ ] 6.4 Client: the pose wave asks only for entries whose listing carried no pose
      (`semanticPosesFor` callers in `App`); everything else about the wave — background,
      chunked, silent-failure — unchanged
- [ ] 6.5 Startup revalidation (D8): when the library resolves ready and a snapshot
      exists, start the incremental pass; no snapshot → nothing at startup. Reuses the
      library-ready hook `library-overrides`' eager store load established in `index.ts`
- [ ] 6.6 Reload endpoint (D9): runs the same pass now, answers whether anything moved;
      client affordance minimal (the stale-marker reconciliation already covers how
      corrections land)
- [ ] 6.7 Scope enumeration (added 2026-09-02 — the seam `bulk-thumbnail-jobs` waits on;
      its review finding S2, settled with Masa by ordering rather than by a walk of that
      change's own): a read-only route answering **every model beneath a library path** —
      the whole subtree, archive contents included, with no response cap
      (`MODEL_BROWSER_FLAT_CAP` bounds *listings*; this is not one) — each entry carrying
      its 6.3 annotation, resolved from the 6.2 index by key lookup exactly as emission
      does, and the answer stating whether the traversal was complete. Served from the
      snapshot when one exists, no filesystem I/O; a root with none pays the walk as a
      flat listing's miss does (4.1 — persisted only if complete, per 4.1a) on the search
      budget, and an incomplete traversal is answered as incomplete, never refused. Shape
      to build: `GET /api/models?path=` → `{ path, entries, complete }` (the name is the
      implementer's; the contract is the delta's *enumerable* requirement). Entries are
      copies (preamble). The annotation is the one shape `thumbnail-image-serving` D2
      names (`DirEntry.thumb`) — the same object on a listing and on an enumeration,
      never two. Cell: a 600-model fixture enumerates 600 (a flat listing of it caps at
      500); a snapshot-served enumeration opens no directory and no archive (instrument)

## 7. Tests

- [ ] 7.1 Server: cached and walked responses are entry-for-entry identical on an unchanged tree (including ordering and truncation); one cached tree serves several different queries and both settings of the folder-matching option without re-traversing (instrument the walk, do not infer from timing); a second walk opens no archives; adding, removing, and renaming a model is picked up; a present-but-unreadable root invalidates rather than serving; the same tree reached at a different mountpoint under the same library is a **hit**; an unmounted library answers `missing` and leaves the snapshot in place; the on-disk format version invalidates a stale snapshot
      <br>**Partly landed 2026-09-02 (stage 1) — `server/test/snapshot.test.ts`, 25 cells.
      Deliberately still unchecked**: the remaining cells need §4's walk integration, which
      does not exist yet. Done here: **a second walk opens no archives** (3.1, both
      in-process and across a restart, instrumented at `open`); **the format version
      invalidates a stale snapshot** (and an unparseable one, and a read stays pure —
      the sweep reaps, the reader refuses); **a different mountpoint under the same library
      is a hit**, driven through the library's identity rather than by remounting, for the
      tree and for the archive layer; two same-layout libraries never share a snapshot;
      a rewritten archive is re-read (3.2); atomic writes leave the old snapshot or the new
      one, never a torn one; the store directory is created lazily and its absence is
      tolerated by every operation (a pre-change cache has no `snapshots/`); the size bound
      falls back on a malformed knob and evicts oldest-read-first; and the snapshot store is
      invisible to `ThumbCache.maintain()`, which still sweeps.
      Still owed by §4: cached-vs-walked entry-for-entry identity, one tree serving several
      queries and both folder-matching settings, add/remove/rename pickup, a
      present-but-unreadable root invalidating, and an unmounted library answering `missing`
      with the snapshot left in place.
      Every behavioral cell above was **falsified before being trusted** — each defect
      (skipped version check, either half of the library key, dropped `{mtime, size}`
      comparison, no cache consult, non-atomic write, unvalidated knob, reversed eviction
      order, snapshots filed flat) was introduced, watched to fail, and reverted. One
      finding: "two same-layout libraries never share" is guarded **twice** (the directory
      *and* the in-file `library` field) and only fails when both are removed — recorded
      because a single-defect falsification of that cell passes and would have looked like
      coverage
- [ ] 7.2 Client: a stale-marked listing renders immediately with the refreshing affordance and reconciles on the follow-up; an unmarked listing shows no affordance; a superseded reconciliation is discarded by latest-wins
- [ ] 7.3 Layers (server): an index-generation bump stops pose/preview answers while the
      tree keeps serving; a deep directory change re-derives its ancestors' preview
      choices and not an unchanged sibling's; emission with a wedged index is as fast as
      with none (instrument, don't time); no-layer listings byte-identical. Client: the
      wave requests only unposed entries; a reload surfaces an external change without
      restart

## 8. Verification

- [ ] 8.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 8.2 Re-run the proposal's measurement on **both** volumes with `vm.drop_caches` between runs, and record the numbers here: cold search on the spinning exfat volume should land near its warm figure (~0.8s) rather than ~32s. Report the revalidation cost separately — that is the one that scales with directory count and is the honest recurring price
