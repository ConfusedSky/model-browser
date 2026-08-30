# Tasks — library-root

> Ordering (hard): lands **before** `listing-tree-cache` (its snapshots key on the root
> path and inherit `ThumbCache`'s directory — both become per-library; update its
> design.md before applying it), and before `search-cancellation` and
> `thumbnail-sweep-priority` are applied, or rebase those onto this — all three pass
> `path` through `listDir`/`listFlat`/`useThumbnails`. The parallel exploration's
> `library-root-confinement` is subsumed; do not create it. Re-read `listing.ts`,
> `app.ts`, `cache.ts`, `semantic.ts` and `useThumbnails.ts` against main before
> starting each section — other sessions edit them.

> Not in scope, by design: `overrides.json`, moving camera/axis into the library,
> runtime repointing, the public-origin guard. See design Non-Goals.

## 1. Server: the library (D1, D2, D4)

- [x] 1.1 `server/src/library.ts`: read the root from `MODEL_BROWSER_ROOT`, else `root`
      in `config.json` under the XDG config home (`~/.config/model-browser/` by default;
      `MODEL_BROWSER_CONFIG` overrides the file
      path; `configHome` from `launch.ts` — extract it so both use one), at start; expose
      `refresh()` re-evaluating the same — done 2026-08-29 (Stage A, `e8a4339`, cherry-picked; 21 tests in `library.test.ts`, confinement and marker-walk falsified; merged server suite 211 passed)
- [x] 1.2 Marker discovery: walk up from the root's real path to the filesystem root
      looking for `.model-browser/library.json`; first found is the library
      (`{ id, version: 1 }`, unknown fields ignored, malformed file = not a marker).
      None found → write one at the root with `randomUUID()`; write failure → state
      `unmarked` with `id = sha256(real top)` — done 2026-08-29 (Stage A, `e8a4339`, cherry-picked; 21 tests in `library.test.ts`, confinement and marker-walk falsified; merged server suite 211 passed)
- [x] 1.3 States: `ready {id, top, root}` / `unconfigured` / `missing {root}` /
      `unmarked` (ready plus a flag). `missing` is re-checked on each request while
      missing (a mount arriving must not need a restart); `ready` is not re-checked — done 2026-08-29 (Stage A, `e8a4339`, cherry-picked; 21 tests in `library.test.ts`, confinement and marker-walk falsified; merged server suite 211 passed)
- [x] 1.4 `resolve(libPath)` → `{ fsPath, entry? }`: refuse unless it starts with `/`;
      `parseVPath` **first**, then `posix.normalize` the `fsPath` half only (the entry half is
      opaque — normalizing it would rewrite cache keys); `join(top, fsHalf)`; `realpath` and
      require `=== realTop || startsWith(realTop + sep)`. Refusals are
      one error (`path outside the library`, 400) with no filesystem detail; a path
      that does not exist is the 404 the route already gives. Also `libPathOf(real)`
      for the reverse direction (`'/' + relative(realTop, real)`). A path that does not exist — every completion prefix, a listing of a deleted
      folder, a thumb PUT after a delete — is confined on the `realpath` of its nearest
      existing ancestor: under the top → the ordinary 404 (`[]` for completion); outside →
      the 400. `realpath` throwing ENOENT is never reported as either — done 2026-08-29 (Stage A, `e8a4339`, cherry-picked; 21 tests in `library.test.ts`, confinement and marker-walk falsified; merged server suite 211 passed)
- [x] 1.5 `GET /api/library` returns the state; while `unconfigured`/`missing`, every
      `/api/*` path route answers 503 `{ state, root? }` before touching a path (the
      `indexErrorReply` shape). Log the resolved library top and id once at start — done 2026-08-29 (B1, `cca3d4b` → `e1fb0a0` on main; api 34 / flat 49 / open 21 migrated to library paths, 14 new in `library-paths.test.ts`; the symlink gate and the 503 gate falsified; merged server suite 242 passed ×3)
- [x] 1.6 Server tests (`server/test/library.test.ts`, per-test temp trees): subfolder
      pick keeps the outer marker's id; no marker → written with a fresh id; env beats
      config; missing root → `missing` and 503 on `/api/dir`; unwritable top → `unmarked`
      with the hashed id; `resolve` refuses `..` escapes, a relative path, an absolute
      filesystem path, a symlink whose target is outside; follows a symlink whose target
      is inside; a vpath's archive half is confined and its entry half untouched
 — done 2026-08-29 (Stage A, `e8a4339`, cherry-picked; 21 tests in `library.test.ts`, confinement and marker-walk falsified; merged server suite 211 passed)
- [x] 1.7 Follow-up recorded at B2's check-in (2026-08-29): `Library.state()` caches `ready`
      (D4), so a volume unmounted *mid-session* keeps answering `ready` — routes 404 every
      path instead of reporting `missing`, and the thumbnail sweep would have judged every
      entry deleted. The sweep now stats the top before running (3.1, cache-side, the
      destructive case). Whether `state()` should re-stat the top per request so the UI
      shows `missing` mid-session is a later refinement: one `stat` per request against a
      clearer message; decide with a measurement on the removable volume — done 2026-08-29
      (W1): the measurement settled it — 1000 warm `stat`s of the mounted top
      /run/media/masa/STLLibrary took 1.72 ms, ~1.7 µs each (W1's run; the coordinator's
      read 2.03 ms), so `state()` now stats the top per call and answers `missing` without
      discarding the cached `ready`; the sweep re-runs from the comment beside the call in
      `createLibrary`'s `state`. Test: `library.test.ts` "reports a ready library whose top
      went away mid-session as missing, and takes it back unchanged" — falsified by removing
      the stat. `ThumbCache.maintain`'s guard is kept, its comment now saying it is belt and
      braces. `semantic.test.ts`'s stat-count bound absorbed the fixed two stats a request
      now pays and asserts the per-hit slope beside them
- [x] 1.8 Follow-up recorded in the fix round (2026-08-29): a root chosen *above* an existing
      library is **not** refused and not warned about (design R1). The marker walk only goes
      up, so the enclosed library is never seen; the enclosing marker is written over it and
      the inner library's cache is orphaned, cameras included. The only signal is the startup
      line and `/api/library`'s `top`. Build either a bounded downward probe at configuration
      time (refuse, naming the library it would swallow) or migration by prefixing keys — and
      note that a "listing passed a foreign `library.json`" warning is not an option:
      `listFsDir` skips every dot-entry, so `.model-browser` is never enumerated — done
      2026-08-29 (W1): the bounded downward probe, on the no-marker-above branch only and
      before `writeMarker`. Breadth-first, ≤ 4 levels below the root, ≤ 500 directories read,
      dot-entries skipped, `isDirectory()` dirents only so no symlink is followed; found → the
      new state `nested {root, library}`, no marker written, `ready` left undefined, 503 from
      the gate, and the client line "This root contains a library at …". Tests:
      `library.test.ts` "is refused, naming the library it would have enclosed, and writes
      nothing" / "names the shallowest library below the root" / "reaches four levels down but
      not five" / "gives up on a tree too wide to search rather than reading it all" (600
      siblings — deterministic: reaching any depth-2 directory needs 601 reads in every
      order), and `client/test/libraryState.test.tsx` "nested names the library the root would
      have enclosed". Falsified by skipping the probe (4 fail), by raising the depth bound to
      5, by raising the read budget to 5000, and client-side by dropping the message branch
- [x] 1.9 Follow-up recorded in the fix round (2026-08-29): `findMarker` walks from the root
      to the filesystem root unbounded, and the first marker wins. A stray
      `.model-browser/library.json` above the root — one left in `$HOME` by an earlier root
      choice — silently becomes the library top, re-basing every path and widening
      confinement to that whole tree, with nothing to distinguish it from a deliberate
      marker. Bound the walk at a mount boundary (compare `stat().dev` against the root's, or
      stop at the mount point), or surface the resolved top in the UI so a wrong one is
      visible without reading the server log — done 2026-08-29 (W1): the walk climbs only
      while the parent's `st_dev` matches the start's, and stops at a parent it cannot stat.
      `findMarker` is exported with a defaulted `devOf` so a test can place a boundary without
      mounting anything. Test: `library.test.ts` "does not adopt a marker across a device
      change, and still takes one below it" — falsified by dropping the device comparison. The
      accepted caveat (btrfs subvolumes carry their own `st_dev`) is in D1, and what is still
      undetected — a stray marker on the *same* filesystem, and how it shows without the log —
      is in R1; the repo CLAUDE.md bullet and `docs/platform-surface.md` match

## 2. Server: every path is a library path (D2, D3)

- [x] 2.1 `listing.ts`: `listDir`/`listFlat` take a library path, resolve through 1.4,
      and emit every `DirEntry.path` as the **logical** library path —
      `posix.join(browsePath, name)` at `listFsDir`'s seam, `joinVPath` for archives — never
      `realpath`'d, so an in-library symlink alias keeps its own route (the flat-listing
      scenarios "Aliased directory is listed once" / "under the route walked first" must
      keep passing); `realpath` is for the confinement test and the visited set only. `listFsDir` returns the
      filesystem path beside the logical one (an internal `fsPath`, never emitted), because
      the walk consumes `e.path` as a filesystem path in `walkFsLevel`'s `realpath`,
      `listFsDir(e.path, walk)` and `walkZip(e.path, …)` — re-resolving the logical path
      through 1.4 would realpath the alias away. `walkFsLevel` skips a subdirectory whose
      `realpath` falls outside the top **at the `walk.dirs.push` site, before the push** —
      the visited-set check sits after the push by design (the aliased-directory comment),
      so a check placed there would still list the escaping entry. The same confinement
      applies to **every emitted entry**, not only directories: `listFsDir` `stat`s through
      symlinks and classifies by extension, so a symlinked `evil.stl`/`evil.zip` pointing
      outside would otherwise be listed as a model/archive, and `walkFsLevel`'s zip branch
      calls `walkZip(e.path, …)` with no test, enumerating an outside archive's names —
      test the real path of each entry before emitting it — gated on `dirent.isSymbolicLink()`, since a non-symlink entry can only escape through an already-confined ancestor and a 200,000-entry search walk cannot afford an lstat chain per entry (design Risks);
      the `path must be absolute` checks go — done 2026-08-29 (B1, `cca3d4b` → `e1fb0a0` on main; api 34 / flat 49 / open 21 migrated to library paths, 14 new in `library-paths.test.ts`; the symlink gate and the 503 gate falsified; merged server suite 242 passed ×3)
- [x] 2.2 `complete(prefix)`: prefix is a library path; completes within the library;
      returns library paths; a prefix that does not start with `/` or resolves outside
      → `[]`; `.model-browser` is never offered, even for a `/.` prefix (the marker is
      invisible everywhere, and `complete` otherwise lets a dot-prefix reveal dot-entries) — done 2026-08-29 (B1, `cca3d4b` → `e1fb0a0` on main; api 34 / flat 49 / open 21 migrated to library paths, 14 new in `library-paths.test.ts`; the symlink gate and the 503 gate falsified; merged server suite 242 passed ×3)
- [x] 2.3 `app.ts`: `/api/file`, `resolveEntryFile` (launch), `/api/thumb` GET/PUT,
      `/api/complete`, `/api/dir` all go through 1.4; `zipTemp.fileFor` keeps hashing
      the library vpath (its key was the vpath already) — done 2026-08-29 (B1, `cca3d4b` → `e1fb0a0` on main; api 34 / flat 49 / open 21 migrated to library paths, 14 new in `library-paths.test.ts`; the symlink gate and the 503 gate falsified; merged server suite 242 passed ×3)
- [x] 2.4 Server tests: an entry's `path` in a listing is library-relative and
      round-trips; an escaping symlinked *file* and an escaping symlinked *archive* are
      omitted from a listing and a walk (no entry, no archive names); a nonexistent path
      under the top is 404 and a completion prefix under the top completes; round-trips
      through `/api/file` and `/api/thumb`; a flat walk over a tree containing an
      escaping symlink omits it; completion within and outside; `/api/file` on a vpath
      whose archive is outside the library is refused
 — done 2026-08-29 (B1, `cca3d4b` → `e1fb0a0` on main; api 34 / flat 49 / open 21 migrated to library paths, 14 new in `library-paths.test.ts`; the symlink gate and the 503 gate falsified; merged server suite 242 passed ×3)
- [x] 2.5 A request's path was echoed back and used as a cache key **as the client spelled
      it**, not as `resolve` canonicalises it, so `/Kit/./x.stl` and `/Kit//x.stl` named the
      same file under different keys and came back in the response under the caller's
      spelling — done in the fix round, 2026-08-29: requests are canonicalised before they
      are echoed or keyed. Landed as `103b5a6` (W1, fix round): `canonicalLibPath` at every keying and echo site, the marker directory refused, a 4096-byte/256-component bound, `not an archive` for a `!/` on a non-zip, safe `MODEL_BROWSER_CACHE_CAP` parsing, semantic hits confined against the library, and a legacy sweep that leaves an unmounted volume alone; 11 tests, nine falsifications; merged server suite 262 ×3, client 515

## 3. Server: cache per library, migrated once (D5)

- [x] 3.1 `ThumbCache`: constructed with the base dir and the library; files live under
      `<base>/<id>/`; key = `sha256(libPath)`; sidecar `path` is the library path; the
      existence sweep resolves through 1.4 and is **skipped** while the library is
      `missing` or `unconfigured`; the startup `void cache.maintain()` in `index.ts` runs
      only once the library is `ready` — done 2026-08-29 (B2, `aa9eadd`, cherry-picked; 11 new cache tests, 23 total; the ready guard, the live top-stat guard and mtime preservation each falsified; merged server suite 222 passed). `index.ts` still constructs `ThumbCache` without the library until B1 lands — wired by the coordinator at that merge
- [x] 3.2 Migration on first `ready`: scan `<base>/*.json` (legacy flat layout only —
      never recurse into id directories); for each sidecar whose recorded absolute
      path — or, for a vpath, its `fsPath` half — has a `realpath` under the real top,
      compute the library path, then: rename the PNG to the new key (preserving its
      mtime, the LRU clock), write the new sidecar with `path` rewritten, remove the old
      sidecar. Entries elsewhere are left, and the legacy flat directory gets an existence sweep of
      its own at each start (sidecars record absolute paths) so nothing there outlives its
      file; it counts toward no cap. Idempotent: a second start finds nothing to move — done 2026-08-29 (B2, `aa9eadd`, cherry-picked; 11 new cache tests, 23 total; the ready guard, the live top-stat guard and mtime preservation each falsified; merged server suite 222 passed). `index.ts` still constructs `ThumbCache` without the library until B1 lands — wired by the coordinator at that merge
- [x] 3.3 Server tests: hit after a simulated remount (same tree copied to a new
      location, root repointed); two libraries with identical layouts and mtimes serve
      distinct PNGs and cameras; legacy entries under the top are moved with camera and
      axis intact and PNG mtime preserved; legacy entries outside are untouched; an
      interrupted migration (PNG moved, old sidecar still present) converges on the next
      start; the sweep does not delete while `missing`
 — done 2026-08-29 (B2, `aa9eadd`, cherry-picked; 11 new cache tests, 23 total; the ready guard, the live top-stat guard and mtime preservation each falsified; merged server suite 222 passed). `index.ts` still constructs `ThumbCache` without the library until B1 lands — wired by the coordinator at that merge
- [x] 3.4 Follow-up recorded in the fix round (2026-08-29): `maintain()` races `put()`.
      `maintain` reads each sidecar, then in its size-cap pass deletes the PNG and rewrites
      the entry from the `Meta` it read earlier — so a `put` landing in between has its PNG
      deleted and its camera reverted to the pre-read value. Pre-existing, but the window is
      wider now that `maintain` also runs the migration and the legacy sweep before it
      reaches that pass. Fix by re-reading the sidecar immediately before the rewrite, or by
      merging into the current one rather than writing back a snapshot — done 2026-08-29 (W2):
      the cap pass re-reads each victim's sidecar before evicting, skips it (counting nothing
      against the cap) when it is gone or its `mtime` moved, and otherwise writes back
      `{...fresh, mtime: undefined}` from the re-read. `readMeta` is `protected` so the test
      can interpose; `cache.test.ts` gains `InterposingCache` and two cells — "spares an entry
      a mid-sweep put re-rendered, png and camera both" and "keeps a camera-only put that
      lands mid-sweep while still clearing the png". Both falsified against the old
      write-back (`expected 'stale' to be 'hit'`; the camera read back as `CAM`, not `CAM2`);
      server suite 264 passed (10 files). The window between the re-read and the `rm` remains, is
      commented in `maintain` and stated in design.md's Risks

## 4. Server: the index maps through its root (D6)

- [x] 4.0 Remove the two temporary allow-list entries B1 left in `app.ts`'s library gate
      (`/api/semantic`, `/api/semantic/similar` — added 2026-08-29 at B1's check-in so
      B3's untouched tests stayed green rather than 503 for a reason unrelated to B3), and
      test that both routes answer the 503 state envelope while the library is not ready.
      Until this lands the two scoring routes answer over an unready library — a known,
      dated hole, not a design — done 2026-08-29 (B3, `aaee758`, cherry-picked; semantic 30 / similar 19 / library-paths 15 / client semantic 35; the library-path keying and the allow-list removal falsified; merged suites server 251, client 513)
- [x] 4.1 `semantic.ts`: `scopeWithin` takes a library path, resolves through 1.4, and still
      returns the absolute real path — that is what goes to the index;
      `hitsToEntries` computes the collection root's library path once
      (`libPathOf(realpath(collection_root))`, null when outside) and names each entry
      `collectionLibPath + '/' + rel_path`; the `resolve(collectionRoot, rel_path)`
      containment guard stays; `modelEntryAt` receives the library path to emit; the
      `poses` and `scores` maps are keyed by that same library path (today by the absolute
      `full`), or `useThumbnails`' `poses[entry.path]` silently stops finding every index
      pose — done 2026-08-29 (B3, `aaee758`, cherry-picked; semantic 30 / similar 19 / library-paths 15 / client semantic 35; the library-path keying and the allow-list removal falsified; merged suites server 251, client 513)
- [x] 4.2 `IndexAvailability`: `collectionRoot` becomes the library path when inside,
      absent with `detail` naming the situation when outside; the side panel's
      "It covers …" line reads it (`SidePanel.tsx`), and every scope affordance is
      withheld when it is absent (the existing `scopeWithin`-null path) — done 2026-08-29 (B3, `aaee758`, cherry-picked; semantic 30 / similar 19 / library-paths 15 / client semantic 35; the library-path keying and the allow-list removal falsified; merged suites server 251, client 513)
- [x] 4.3 Server tests: hits under a collection root beneath the top are named by library
      path and resolve to tiles; a collection root outside the top yields no scope for
      any path and the availability names it; the poses/scores maps are keyed by the
      library path the entry carries — done 2026-08-29 (B3, `aaee758`, cherry-picked; semantic 30 / similar 19 / library-paths 15 / client semantic 35; the library-path keying and the allow-list removal falsified; merged suites server 251, client 513)

## 5. Client: the root is `/` (D7)

- [x] 5.1 `urlState.ts`: `path` and `model` are library paths; `serializeView` omits
      `path` when it is `/`; `parseUrl` reads an absent `path` as `/` — done 2026-08-29 (B4, `8a20e7c` → `f582b35` on main; 18 client tests added, 511 total; the not-ready gate, the `!/` expansion and the navigation re-probe falsified; the harness now seeds a test's start through the URL)
- [x] 5.2 `App.tsx` `resolveView`: default `path` is `/` (no `getLastPath()`);
      `recents.ts` keys become `model-browser:recents:v2` / `last-path:v2` and store
      library paths — old keys are never read — done 2026-08-29 (B4, `8a20e7c` → `f582b35` on main; 18 client tests added, 511 total; the not-ready gate, the `!/` expansion and the navigation re-probe falsified; the harness now seeds a test's start through the URL)
- [x] 5.3 `PathBar.tsx`: shows the library path verbatim (`/` at the top); completion and
      recents are library paths; `ApiClient.library()` added, no request shape changes — done 2026-08-29 (B4, `8a20e7c` → `f582b35` on main; 18 client tests added, 511 total; the not-ready gate, the `!/` expansion and the navigation re-probe falsified; the harness now seeds a test's start through the URL)
- [x] 5.4 The `unconfigured` and `missing` states render in the path bar's error line
      (naming the root when missing), retried on the next navigation; `useThumbnails`
      and the listing reducer treat the 503 state envelope as a non-crashing empty
      view — done 2026-08-29 (B4, `8a20e7c` → `f582b35` on main; 18 client tests added, 511 total; the not-ready gate, the `!/` expansion and the navigation re-probe falsified; the harness now seeds a test's start through the URL)
- [x] 5.5 Copy path (`entryActions.ts`, both surfaces) and the lightbox info panel's path
      expand a library path to the filesystem path — `posix.join(library.top, path)` with
      the `!/` notation kept — so what a user pastes elsewhere still opens; the library
      state exposes `top` for it (`ApiClient.library()`) — done 2026-08-29 (B4, `8a20e7c` → `f582b35` on main; 18 client tests added, 511 total; the not-ready gate, the `!/` expansion and the navigation re-probe falsified; the harness now seeds a test's start through the URL)
- [x] 5.6 Client tests: `serializeView`/`parseUrl` round-trip `/`, `/Kit`,
      `/Kit/a.zip!/x.stl`, and omit the root; `resolveView` with no URL path is `/`;
      old recents keys are not read; the missing-library state shows the root and does
      not render a grid
 — done 2026-08-29 (B4, `8a20e7c` → `f582b35` on main; 18 client tests added, 511 total; the not-ready gate, the `!/` expansion and the navigation re-probe falsified; the harness now seeds a test's start through the URL)
- [x] 5.7 Follow-up recorded at B4's check-in (2026-08-29): `App.tsx`'s `target === ''` landing
      ("Enter a directory path above to browse your models.") and its `toggleFlat` guard are
      unreachable once boot is `/` and the library states render ahead of it — left in
      place by design there; deleted in a later cleanup, not as a point fix. The test harness
      now seeds a test's starting place through the URL (`bootPath` →
      `replaceState('/?path=…')`) instead of the retired last-path key — under D2 the URL is
      the only legitimate way to start anywhere but `/`.
      **Done 2026-08-29 (W3):** `''` was *not* yet unreachable — `parseUrl` read the path as
      `p.get('path') ?? '/'`, and `URLSearchParams.get` answers `''`, not `null`, for `?path=`
      and for a bare `?path`, so a hand-edited URL still booted the view at `''`; that is what
      the landing rendered for (the boot effect's early return suppressed the fetch, so no
      skeleton stood in front of it). PathBar's submit refuses an empty target and
      `serializeView` never wrote one, so the URL was the only source. Adjudicated at check-in
      (coordinator): read blank as the root in `parseUrl` — the leniency `q` and `similar`
      already get — then delete all five remnants. Removed: `parseUrl`'s `??` default (now
      `rawPath === null || rawPath === '' ? '/' : rawPath`); `serializeView`'s `view.path !== ''`
      clause and the comment about "the one view that still spells its path that way";
      `App`'s landing `<p>` with its `target === '' && !showSkeleton` ternary branch (the
      surrounding comment about the region staying empty under a library message still reads
      true and is kept); `toggleFlat`'s `if (target === '') return`; the boot effect's
      `if (state.view.path === '') return`; and the `target === ''` disjunct in the ↑ button's
      `disabled`. `grep -rn "target === ''\|view.path === ''\|path !== ''" client/src/` now
      answers nothing, and `grep -rn "Enter a directory path" client server openspec docs`
      found the sentence only in `App.tsx` and in this line — no test referenced it, so no
      test was fixed. New coverage in `urlState.test.ts` ("reads a blank `path` as the root"):
      `?path=`, `?path` and `?path=&flat=1` all parse to `/`, and what a blank one resolves to
      serializes back to nothing. Falsified by reverting the parser line alone to `rawPath ?? '/'`:
      `expect(parseUrl('?path=').path).toBe('/')` fails with `AssertionError: expected '' to be
      '/' // Object.is equality`. D2 records the collapse. Client 519 passed / 0 failed (50 files),
      typecheck clean, `openspec validate library-root` clean

## 6. Docs, ordering, verification

- [x] 6.1 `docs/platform-surface.md`: user-dirs bullet gains `config.json` and
      `~/.cache/model-browser/<id>/`; a new bullet states that the marker is the first
      file this app writes beside the models, and what `unmarked` means on a read-only
      volume — done 2026-08-29 (coordinator)
- [x] 6.2 `CLAUDE.md`: the dev-instance line names `MODEL_BROWSER_ROOT`; `directory-browsing`'s
      guard rationale ("reads and serves arbitrary local paths") becomes "the user's model library" — a one-phrase truth fix in the delta (*API restricted to the app's own origin*, every scenario carried) and in `guard.ts`'s docstring; the guard itself is unchanged, the demo's public-origin change rewrites it later; the semantic
      line notes the index root must lie inside the library; `docs/web-demo-notes.md`
      item 2 points here as superseded — done 2026-08-29 (coordinator; `guard.ts` docstring and the delta both say "the user's model library")
- [x] 6.3 `listing-tree-cache`: rewrite its **delta spec** and design before it is applied —
      `specs/listing-cache/spec.md` *The filesystem is authoritative* ("the same library
      reached by a different path is a miss" inverts under a library identity; its
      unmounted-volume scenario becomes the `missing` state) and *Walked trees are cached
      across restarts* ("share the storage location … of the existing thumbnail cache" is
      now per-library); keying is `id` + library path under `<base>/<id>/` — done in two passes.
      **2026-08-29 (coordinator):** the delta spec — *Walked trees…* and *The filesystem is
      authoritative* rewritten to library-id keying and the `missing` state, new scenario
      "A remount keeps the snapshot" — plus design Context, the removable-volume risk bullet
      and a tasks header. **Finished 2026-08-29 (fix round, W3):** that tick claimed the
      change was rebased while four of its assertions still said the opposite — design D6's
      own body (the decision 2.3/4.3/6.1 cite by number), tasks 2.3 ("misses rather than
      hits"), 4.3 ("an unreadable or unmounted root fails as it does today") and 6.1 ("a
      different mountpoint … is a miss"), and the proposal's "beside the existing thumbnail
      cache … keyed by root". All five rewritten to the landed truth: snapshots keyed by
      library id + the root's library path under `<cache>/<library-id>/`, a remount is a
      hit, an absent volume is the `missing` state (answered before any listing, neither
      serving nor discarding the snapshot), and only a *present but unreadable* root
      invalidates. `openspec validate` clean on both; both archives dry-run in order
- [x] 6.4 Live verification against the real library: set `MODEL_BROWSER_ROOT`, confirm
      the marker is written, the legacy cache directory drains into `<id>/` with camera
      sidecars intact (count before/after), a tile with a saved orientation opens with
      it, a deep link from before the change fails with the plain error, and
      `bun run test` / `bun run typecheck` are clean across workspaces
      — partly verified 2026-08-29 (coordinator) against the demo corpus and a **copy** of the real cache (`MODEL_BROWSER_CACHE` pointed at the copy; the user's cache untouched): marker written at `deduplicated/.model-browser/library.json`; 799 of 1,799 legacy sidecars — every one recorded under that tree, cameras 32 of 32 — re-keyed under `<id>/` with PNGs, the 1,000 recorded under other trees left; a migrated camera entry served on `/api/thumb` as a **hit** with PNG and camera at the listing's exact mtime; suites clean. Remaining: the real library (`STLLibrary`, not mounted today), the user's own cache (it migrates on the dev server's first start with `MODEL_BROWSER_ROOT`), and a browser check that a tile with a saved orientation opens with it
      — completed 2026-08-29 (coordinator) against the real library (`STLLibrary`, id
      `97ecc020…`, dev server started with `MODEL_BROWSER_ROOT`): marker present; the user had
      cleared the legacy cache before the change, so the drain had no real-library entries to
      move — a side instance on 3178 rooted at the real library over a copy of the pre-change
      cache left its 1,000 legacy sidecars (all recorded under `/home/masa/Documents`, another
      library) and both `<id>/` directories byte-for-byte identical (file lists diffed);
      `/api/thumb` for `…/32mm_JuvenileProtoOsteotron1_Base.stl` answered `hit` with
      `camera {az -1.63, el 0.64}` and `axis z`, pressing the tile mounted the overlay canvas
      over the tile showing the same frame, and the lightbox opened with the Z axis pill lit
      and the base at that view (`.playwright-mcp/64-*.png`); the sidecar's content and mtime
      were unchanged after two press-and-release cycles; the old absolute deep link 404s
      (verified earlier the same day); server 262, client 515, typecheck clean
- [x] 6.6 Regression found by the user 2026-08-29 after 6.4 closed: with the index rooted at
      the library top its `collectionRoot` is `/`, and the client's `indexCovers` prefix
      check built `//`, so meaning search read every subfolder as outside the index
      ("does not cover this folder. It covers /."). Every client test mocked the root as
      `/models`. Fixed in `indexCovers` (a root ending in `/` is its own prefix);
      `client/test/indexCovers.test.ts` fails on the unfixed selector
      (`expected false to be true`) and passes on the fix; verified in the browser at
      `/Loot Studios/…/No Supports` on the real library. `scopeWithin` server-side was
      never affected — it compares realpaths
- [x] 6.5 Live verification of confinement: with the dev server on the library,
      `curl` `/api/dir?path=/../` and `/api/file?path=/etc/passwd`-shaped requests are
      refused with no filesystem detail in the body; a symlink planted inside the
      library pointing at `/tmp` is skipped by a flat walk and refused by `/api/dir` — done 2026-08-29 (coordinator, side instance on :3178 rooted at the demo corpus `deduplicated/`): `/api/dir?path=/..` → 200 listing of the top (folds, per the adjudication), `/../../etc` and `/etc/passwd` → 404 naming only the library path, `../` → 400 `path must be a library path`, `/api/complete?prefix=/.` → `[]`; a planted `zz_escape → /tmp` symlink was absent from the nested listing and the flat walk and `/api/dir?path=/zz_escape` → 400 `path outside the library`; symlink removed after
