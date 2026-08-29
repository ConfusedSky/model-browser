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

- [ ] 1.1 `server/src/library.ts`: read the root from `MODEL_BROWSER_ROOT`, else `root`
      in `~/.config/model-browser/config.json` (`MODEL_BROWSER_CONFIG` overrides the file
      path; `configHome` from `launch.ts` — extract it so both use one), at start; expose
      `refresh()` re-evaluating the same
- [ ] 1.2 Marker discovery: walk up from the root's real path to the filesystem root
      looking for `.model-browser/library.json`; first found is the library
      (`{ id, version: 1 }`, unknown fields ignored, malformed file = not a marker).
      None found → write one at the root with `randomUUID()`; write failure → state
      `unmarked` with `id = sha256(real top)`
- [ ] 1.3 States: `ready {id, top, root}` / `unconfigured` / `missing {root}` /
      `unmarked` (ready plus a flag). `missing` is re-checked on each request while
      missing (a mount arriving must not need a restart); `ready` is not re-checked
- [ ] 1.4 `resolve(libPath)` → `{ fsPath, entry? }`: refuse unless it starts with `/`;
      `parseVPath` **first**, then `posix.normalize` the `fsPath` half only (the entry half is
      opaque — normalizing it would rewrite cache keys); `join(top, fsHalf)`; `realpath` and
      require `=== realTop || startsWith(realTop + sep)`. Refusals are
      one error (`path outside the library`, 400) with no filesystem detail; a path
      that does not exist is the 404 the route already gives. Also `libPathOf(real)`
      for the reverse direction (`'/' + relative(realTop, real)`)
- [ ] 1.5 `GET /api/library` returns the state; while `unconfigured`/`missing`, every
      `/api/*` path route answers 503 `{ state, root? }` before touching a path (the
      `indexErrorReply` shape). Log the resolved library top and id once at start
- [ ] 1.6 Server tests (`server/test/library.test.ts`, per-test temp trees): subfolder
      pick keeps the outer marker's id; no marker → written with a fresh id; env beats
      config; missing root → `missing` and 503 on `/api/dir`; unwritable top → `unmarked`
      with the hashed id; `resolve` refuses `..` escapes, a relative path, an absolute
      filesystem path, a symlink whose target is outside; follows a symlink whose target
      is inside; a vpath's archive half is confined and its entry half untouched

## 2. Server: every path is a library path (D2, D3)

- [ ] 2.1 `listing.ts`: `listDir`/`listFlat` take a library path, resolve through 1.4,
      and emit every `DirEntry.path` as the **logical** library path —
      `posix.join(browsePath, name)` at `listFsDir`'s seam, `joinVPath` for archives — never
      `realpath`'d, so an in-library symlink alias keeps its own route (the flat-listing
      scenarios "Aliased directory is listed once" / "under the route walked first" must
      keep passing); `realpath` is for the confinement test and the visited set only; `walkFsLevel` skips a subdirectory whose
      `realpath` falls outside the top (the visited-set `realpath` is already there);
      the `path must be absolute` checks go
- [ ] 2.2 `complete(prefix)`: prefix is a library path; completes within the library;
      returns library paths; a prefix that does not start with `/` or resolves outside
      → `[]`; `.model-browser` is never offered, even for a `/.` prefix (the marker is
      invisible everywhere, and `complete` otherwise lets a dot-prefix reveal dot-entries)
- [ ] 2.3 `app.ts`: `/api/file`, `resolveEntryFile` (launch), `/api/thumb` GET/PUT,
      `/api/complete`, `/api/dir` all go through 1.4; `zipTemp.fileFor` keeps hashing
      the library vpath (its key was the vpath already)
- [ ] 2.4 Server tests: an entry's `path` in a listing is library-relative and round-trips
      through `/api/file` and `/api/thumb`; a flat walk over a tree containing an
      escaping symlink omits it; completion within and outside; `/api/file` on a vpath
      whose archive is outside the library is refused

## 3. Server: cache per library, migrated once (D5)

- [ ] 3.1 `ThumbCache`: constructed with the base dir and the library; files live under
      `<base>/<id>/`; key = `sha256(libPath)`; sidecar `path` is the library path; the
      existence sweep resolves through 1.4 and is **skipped** while the library is
      `missing` or `unconfigured`; the startup `void cache.maintain()` in `index.ts` runs
      only once the library is `ready`
- [ ] 3.2 Migration on first `ready`: scan `<base>/*.json` (legacy flat layout only —
      never recurse into id directories); for each sidecar whose recorded absolute
      path — or, for a vpath, its `fsPath` half — has a `realpath` under the real top,
      compute the library path, then: rename the PNG to the new key (preserving its
      mtime, the LRU clock), write the new sidecar with `path` rewritten, remove the old
      sidecar. Entries elsewhere are left, and the legacy flat directory gets an existence sweep of
      its own at each start (sidecars record absolute paths) so nothing there outlives its
      file; it counts toward no cap. Idempotent: a second start finds nothing to move
- [ ] 3.3 Server tests: hit after a simulated remount (same tree copied to a new
      location, root repointed); two libraries with identical layouts and mtimes serve
      distinct PNGs and cameras; legacy entries under the top are moved with camera and
      axis intact and PNG mtime preserved; legacy entries outside are untouched; an
      interrupted migration (PNG moved, old sidecar still present) converges on the next
      start; the sweep does not delete while `missing`

## 4. Server: the index maps through its root (D6)

- [ ] 4.1 `semantic.ts`: `scopeWithin` takes a library path and resolves through 1.4;
      `hitsToEntries` computes the collection root's library path once
      (`libPathOf(realpath(collection_root))`, null when outside) and names each entry
      `collectionLibPath + '/' + rel_path`; the `resolve(collectionRoot, rel_path)`
      containment guard stays; `modelEntryAt` receives the library path to emit; the
      `poses` and `scores` maps are keyed by that same library path (today by the absolute
      `full`), or `useThumbnails`' `poses[entry.path]` silently stops finding every index
      pose
- [ ] 4.2 `IndexAvailability`: `collectionRoot` becomes the library path when inside,
      absent with `detail` naming the situation when outside; the side panel's
      "It covers …" line reads it (`SidePanel.tsx`), and every scope affordance is
      withheld when it is absent (the existing `scopeWithin`-null path)
- [ ] 4.3 Server tests: hits under a collection root beneath the top are named by library
      path and resolve to tiles; a collection root outside the top yields no scope for
      any path and the availability names it; the poses/scores maps are keyed by the
      library path the entry carries

## 5. Client: the root is `/` (D7)

- [ ] 5.1 `urlState.ts`: `path` and `model` are library paths; `serializeView` omits
      `path` when it is `/`; `parseUrl` reads an absent `path` as `/`
- [ ] 5.2 `App.tsx` `resolveView`: default `path` is `/` (no `getLastPath()`);
      `recents.ts` keys become `model-browser:recents:v2` / `last-path:v2` and store
      library paths — old keys are never read
- [ ] 5.3 `PathBar.tsx`: shows the library path verbatim (`/` at the top); completion and
      recents are library paths; `ApiClient.library()` added, no request shape changes
- [ ] 5.4 The `unconfigured` and `missing` states render in the path bar's error line
      (naming the root when missing), retried on the next navigation; `useThumbnails`
      and the listing reducer treat the 503 state envelope as a non-crashing empty
      view
- [ ] 5.5 Copy path (`entryActions.ts`, both surfaces) and the lightbox info panel's path
      expand a library path to the filesystem path — `posix.join(library.top, path)` with
      the `!/` notation kept — so what a user pastes elsewhere still opens; the library
      state exposes `top` for it (`ApiClient.library()`)
- [ ] 5.6 Client tests: `serializeView`/`parseUrl` round-trip `/`, `/Kit`,
      `/Kit/a.zip!/x.stl`, and omit the root; `resolveView` with no URL path is `/`;
      old recents keys are not read; the missing-library state shows the root and does
      not render a grid

## 6. Docs, ordering, verification

- [ ] 6.1 `docs/platform-surface.md`: user-dirs bullet gains `config.json` and
      `~/.cache/model-browser/<id>/`; a new bullet states that the marker is the first
      file this app writes beside the models, and what `unmarked` means on a read-only
      volume
- [ ] 6.2 `CLAUDE.md`: the dev-instance line names `MODEL_BROWSER_ROOT`; the semantic
      line notes the index root must lie inside the library; `docs/web-demo-notes.md`
      item 2 points here as superseded
- [ ] 6.3 `listing-tree-cache`: rewrite its **delta spec** and design before it is applied —
      `specs/listing-cache/spec.md` *The filesystem is authoritative* ("the same library
      reached by a different path is a miss" inverts under a library identity; its
      unmounted-volume scenario becomes the `missing` state) and *Walked trees are cached
      across restarts* ("share the storage location … of the existing thumbnail cache" is
      now per-library); keying is `id` + library path under `<base>/<id>/`
- [ ] 6.4 Live verification against the real library: set `MODEL_BROWSER_ROOT`, confirm
      the marker is written, the legacy cache directory drains into `<id>/` with camera
      sidecars intact (count before/after), a tile with a saved orientation opens with
      it, a deep link from before the change fails with the plain error, and
      `bun run test` / `bun run typecheck` are clean across workspaces
- [ ] 6.5 Live verification of confinement: with the dev server on the library,
      `curl` `/api/dir?path=/../` and `/api/file?path=/etc/passwd`-shaped requests are
      refused with no filesystem detail in the body; a symlink planted inside the
      library pointing at `/tmp` is skipped by a flat walk and refused by `/api/dir`
