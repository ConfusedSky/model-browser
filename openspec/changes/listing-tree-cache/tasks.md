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

- [x] 4.1 `listFlat` serves from the snapshot when one exists for the root; a miss walks and populates. The snapshot is keyed by the **root alone** (its library path under the library's id) — not by `q`, not by the search options — and filtering runs over it exactly as it runs over a live walk (D1)
      <br>**The seam 4.1a needs already exists (2026-09-01, aggregate-review worker WR-S).**
      `server/src/listing.ts` exports `walkFlat` — `listFlat`'s body, returning
      `{ listing, budgetExhausted, capped }` — and `listFlat` is now a one-line wrapper
      over it. Build 4.1 on `walkFlat`, not on `listFlat`: `DirListing.truncated` is the
      **OR** of those two flags and cannot answer 4.1a's question, so a folder walked end
      to end whose 501st model the response cap dropped would otherwise refuse to cache
      itself forever. `budgetExhausted` alone is the completeness fact. Cells:
      `flat.test.ts` › "the two reasons a listing is truncated, which the wire does not
      tell apart"
      <br>— landed 2026-09-02 (stage 2). `walkFlat` takes the `SnapshotStore` as a
      trailing optional parameter and returns an additional `fromSnapshot`; every
      existing caller compiles unchanged and the pre-change suite is byte-green (530
      cells). Its body split into **`gatherFlat`** — the traversal, with no query, no cap
      and no snapshot in sight — and the filter/cap/emit block, which now runs over
      either a fresh gather or a stored one. That split *is* D1: the three collections
      `gatherFlat` returns are what a snapshot holds, and nothing below that line has
      ever seen the query. Stored in the walk's own emission order (containers, then the
      deeper containers, then the models) and partitioned back by kind and by whether the
      name carries a `/`; nothing is sorted on the way in or out, per the Bun/Node
      `readdir` divergence. `store.archiveCache()` is threaded through `FlatWalk.zips`
      into `walkZip`'s `listZipEntries` — falsified by dropping it, which fails "opens no
      archive" with `expected 2 to be +0`. **Deep search needs no second integration**:
      `/api/dir?flat=true&q=` is the only deep-search path in the app; `/api/semantic*`
      delegates to the index and `walkRanked` is `peek`, which is bounded, unsnapshotted
      and deliberately outside this
- [x] 4.1a Only a **complete** traversal is persisted: a walk that stopped against its step budget populates nothing, or a partial tree is stored as though whole and is permanently wrong (D1). Test that a budget-truncated walk leaves no snapshot behind, and that the next unbudgeted request traverses
      — the gate is `!budgetExhausted` at the one `store.save` call in `walkFlat`.
      Falsified twice: dropping the gate fails the budget cell with
      `expected { root: '/kit', …(3) } to be null`, and writing it against the wire's
      truncation instead (`budgetExhausted || models.length > FLAT_CAP`) fails the
      capped-but-complete cell with `expected null not to be null` — the exact confusion
      the note above warns about, caught by a cell of its own. A walk that **rejects**
      persists nothing by construction: `save` is the only write and the only flush, and
      it is downstream of the traversal. `WalkCancelled` does not exist yet
      (`search-cancellation` has not landed), so the cell injects the rejection at the
      unreadable-root failure that does escape `walkFlat` today, and asserts both halves —
      no tree file, and a later store still opens the archive
- [x] 4.2 Incremental revalidation: one `stat` per directory, re-reading only those whose freshness signal moved (D4). Never a background full re-walk — that reintroduces the cold cost off-screen (D5)
      — `revalidateTree` (listing.ts) re-runs `gatherFlat` with the snapshot's `dirs`
      indexed as a per-directory reuse map: `levelFor` stats each directory, hands back
      the recorded level unchanged when the mtime matches, and `readdir`s only where it
      moved. A new subdirectory under a changed one is walked fresh from there, so an
      addition is not limited to the folder that moved. Archives are revalidated by their
      own `{mtime, size}` through the D3 layer rather than by directory mtime, which is
      what a zip rewritten in place needs. Instrumented at the syscall, never timed: the
      add cell asserts `readdir` was called for exactly `<kit>/a` and no archive was
      opened; the unchanged-tree cell asserts zero of each. Falsified by dropping the
      mtime comparison (always reuse), which fails six cells —
      `expected [ 'a', 'z', 'box.zip', …(6) ] to include 'a/added.stl'` and
      `expected [] to deeply equal [ '…/kit/a' ]` among them
- [x] 4.3 A revalidation that cannot be completed against a root that is **present** — an
      unreadable directory, permissions changed — invalidates rather than serving cached
      entries. A root that is not present at all never reaches revalidation: it is the
      library's `missing` state, answered before any listing, which neither serves the
      snapshot nor discards it (D6)
      — a failed pass raises `RevalidationError`, and `ListingCache`'s catch calls
      `store.invalidate(root)`. Two guards, and **each fails a different cell**, so
      neither is dead weight: `walkFsLevel`'s catch re-throws `RevalidationError` instead
      of swallowing it like an unreadable subdirectory (falsified → the unreadable-folder
      cell fails `expected { root: '/kit', …(3) } to be null`), and a recorded directory
      whose `realpath` can no longer be established is a contradiction rather than an
      unconfined entry to skip (falsified → the unreadable-*root* cell fails the same
      way). The second exists because **`chmod` does not move a directory's mtime**: an
      unreadable root's own level is reused unchanged and it is the children's `realpath`
      that raises EACCES. The `missing` state is answered by `createApp`'s existing
      library gate — the `UNGATED` middleware above every path route, which 503s before
      `/api/dir` is reached — so nothing was rebuilt; a cell drives the route and asserts
      the 503 with the snapshot still loadable. The pass itself checks readiness twice,
      and the second check needed a cell of its own to be reachable at all: removing it
      passed everything until a cell was added for the volume leaving *mid*-pass, which
      is the real gap (the pass runs after the response). Falsified then →
      `expected null not to be null`

## 5. Freshness on the wire

- [x] 5.1 Additive staleness marker on `/api/dir` responses; a freshly walked listing carries none
      — `DirListing.stale?: true` (`shared/types.ts`), absent otherwise and never `false`.
      Owned by **`server/src/listingCache.ts`**, a new module holding the one genuinely
      new decision this stage makes: validation state is per **(process, root)**, since a
      snapshot is durable but "has this process checked it" is not and cannot be read off
      the file. A cache-serve for a root this process has not checked *recently* answers at
      once, marked, and starts the incremental pass single-flighted per root; a request
      arriving while that pass is in flight **awaits it**, which is what makes §5.2's one
      follow-up request terminate rather than loop on the marker — the worst wait is the
      ~5.6 s incremental pass, not the ~32 s walk. After a completed pass, serves are
      unmarked, and the pass has *applied* what it found, so the following serve **is** the
      corrected listing. A fresh walk is never marked.
      **Corrected in the fix round below (findings 1 and 6), and this line said otherwise
      when it was written**: validation is a *timestamp*, not a membership — it stands for
      `REVALIDATE_TTL_MS` and then the root is unchecked again — and the awaiting request
      is **not** served unmarked on principle, but re-takes the ordinary decision on the
      stamp the pass left or did not leave. Threaded through
      `createApp` as a trailing `snapshots?: SnapshotStore` (the `features` precedent);
      **absent by default**, so with no store `ListingCache` is `listFlat` and nothing
      else and every pre-existing cell is untouched. Falsified: always marking a
      cache-serve (`expected true to be undefined`), marking a fresh walk (same), not
      awaiting the in-flight pass and never starting one (`expected true to be false`,
      and the wire cell's `expected undefined to be defined` — it polls to convergence
      rather than assuming a timing)
- [x] 5.2 Client: present cached results immediately with a "refreshing" affordance, and reconcile the corrected listing when it arrives — no new transport (the Hono app must run on Node unchanged, architecture D1), so the client issues an ordinary follow-up request on seeing the marker; the existing latest-wins guard and skeleton already cover a later response landing
      — landed 2026-09-02. `stale` rides the landing (`Landed`/`Result` in
      `state/reducer.ts`, normalised to a boolean the way `truncated` is), and two flags
      carry the follow-up: `Inflight.followUp` on the request, stamped onto `Result.followUp`
      at landing. The follow-up is an ordinary `listDir` through the existing fetch effect,
      so `accepts` and the effect's abort handle a superseded one with no new machinery.
      **One correction to this task's own last clause**: the skeleton does *not* already
      cover it — `busy` counts any `inflight`, so a follow-up would have blanked the grid
      after `SKELETON_DELAY_MS` for the length of the ~5.6 s revalidation pass, which is the
      inverse of "present cached results immediately". `busy` now skips a `followUp`
      request; that is the only pre-existing selector touched and nothing else can set the
      flag. The once-guard is `Result.followUp`, read by App's `staleId` — the ANSWER's
      identity, not a boolean beside the state, so navigating away and back gets its own
      single follow-up (cell). `revalidate` also refuses while anything is in flight, so the
      effect firing just as the user clicks cannot overwrite that navigation, and it carries
      `standIn` through, or a stale placeholder listing's follow-up would rename the view and
      end the deferral. A failed follow-up is not retried: `staleId` did not change.
      Falsified: no dispatch → 5 cells, `expected 1 to be 2`; `busy` counting it →
      `expected <div …(1)></div> to be null` (the skeleton, over the grid it is meant to
      keep); the affordance unwired → 4 cells, `expected undefined to be 'Refreshing…'`;
      **both halves of the once-guard removed → `expected 7 to be 2` and a second cell
      hitting `Test timed out in 5000ms`** — a real runaway, since each answer re-asks in a
      microtask and starves the timer. Recorded: either half alone still stops the loop (the
      reducer refuses, or `staleId` never moves), so the guard is deliberately doubled
- [ ] 5.2a Judge the affordance's pixels, then freeze (the tune-then-freeze rule; the code
      above is landed and tested, the copy and placement are not). Today it is a small
      `Refreshing…` in the results-header notice bar, beside the label and opposite the
      truncation caveat — no panel, no spinner, `aria-live="polite"`. Open questions for the
      eye: whether it belongs on the caveat's side instead, and whether it should read
      differently when the follow-up has come back marked again and nothing further is being
      asked (it stays up in that state deliberately — the server's pass is still running)

## 6. Derived layers and explicit freshness (added 2026-09-02 — see design D7–D9; build after §4, the layers hang off the snapshot and its revalidation)

- [x] 6.1 Pose and preview-choice layers beside the snapshot module: per-path entries
      keyed against the tree plus the index generation and pose version; populated when
      the server's semantic proxy answers (poses) and when a peek derives a choice
      (previews); never consulted-and-blocked-on at emission — a lookup hits or the field
      is absent. Preview re-derivation on directory change covers the changed directory
      **and its ancestors** (D7's stated subtlety)
      — landed 2026-09-02 as `server/src/layers.ts` (`DerivedLayers`, `LAYER_VERSION`),
      held by `ListingCache` because the event that invalidates a preview choice is
      discovered by the pass that class owns. **Both layers are in-memory**, settled at
      this stage's check-in and recorded in D7 and the delta (`7c9d280`): with no
      observable index build identity, a persisted pose could outlive a re-classification
      indefinitely, so a restart is a third drop point rather than a loss. Populated from
      answers that already flow — the two `/api/semantic/poses` routes, and `peek`, whose
      `posedFirstPeek` now hands its **own** `probeStatus` result back
      (`{entries, collectionRootFs}`) rather than letting the route probe again: the first
      cut did probe again and cost two pre-existing peek *count* cells
      (`expected 7 to be less than or equal to 6`, `expected 2 to be 3`), both green again
      untouched. The collection root is recorded on **every** pose answer including an
      empty one — gating it on a non-empty answer made a repoint undetectable, since the
      root comes from `/status` and a repointed collection is exactly what answers empty
      (falsified: the repoint cell failed `expected { up: [ +0, 1, +0 ], …(4) } to be
      undefined`). Ancestors come from the pass, which now reports **which** directories
      moved; falsified by dropping the changed dir alone → `/ should be re-derived:
      expected [ { name: 'x.stl', …(4) } ] to be undefined`

- [x] 6.2 Thumbnail-state index: `ThumbCache` exposes an in-memory per-path index —
      presence, staleness against the snapshot's mtime, the sidecar's write
      generation, and `framed` (a stored camera OR axis exists — the definition
      `bulk-thumbnail-jobs`' reset shares, review M4; presence/staleness are per
      occlusion variant, since the store keys renders that way, review m20) —
      maintained on its own
      reads/writes, no directory rescan per listing. The write generation is a seam
      the immutable-thumbnail-serving change consumes and `framed` one
      `bulk-thumbnail-jobs` consumes (its reset counts/derivation); keep the shape
      additive
      — landed 2026-09-02. `ThumbCache.facts` (a `Map<libPath, Meta | null>`) plus
      `annotate(path, mtime)`, a Map get and a pure derivation with **no I/O**. Recorded
      at `readMeta`'s call sites and inside `writeMeta`, which is *every* write path this
      class has — `put`, the size cap's write-back, the migration — so the index tracks
      the store by construction rather than by an enumeration a later writer could fall
      out of; the sweep both populates it (it already holds every sidecar, which is how a
      restarted server knows the library without a scan of its own) and deletes what it
      reaps. `null` is a real answer: looked for, not there. Staleness is **derived at
      emission** through `statusFor`, extracted so `get` and the annotation cannot drift;
      `framed` is camera **or** axis (review M4). Falsified: no recording on writes →
      `expected undefined to deeply equal { gen: 1788394018769, …(4) }`; none on reads →
      `expected undefined to deeply equal { gen: +0, framed: false, …(2) }`; `framed`
      camera-only → the per-variant cell's `toDeeply equal` diff; a stored verdict instead
      of a derivation → `expected 'hit' to be 'stale'`, which also fails a **pre-existing**
      `cache.test.ts` cell, so the extraction is load-bearing in both directions
- [x] 6.3 Emission: additive `DirEntry` fields (`shared/types.ts`) attached in `app.ts`
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
      — landed 2026-09-02. One `annotate(entries)` pass in `createApp`, called beside
      `applyDisplayNames` at all three of its sites (`/api/dir` flat and browse,
      `/api/peek`) and on 6.7's enumeration. **Three fields, because the delta's
      annotation requirement names three**: `thumb` (D2's shape verbatim, adopted
      unchanged — `ThumbInfo`/`ThumbRenderInfo` in `shared/types.ts`), `pose` (6.4's
      client narrowing needs entries to carry it) and `preview` (a directory's choice;
      the requirement's scenario pins only poses+thumb, so all three are emitted and this
      is recorded rather than assumed). No copy is made here and that was **verified, not
      presumed**: `wire` mints an entry per emission on the walked path and `partition`
      does on the cached one, so the snapshot's own objects never reach a route — the
      preamble's rule, already discharged upstream, and copying again would only hide a
      regression in it. Falsified: no pose attached → 7 cells including
      `expected undefined to deeply equal { up: [ +0, 1, +0 ], …(4) }`; the kind guard
      removed so a model entry takes a preview →
      `expected [ { name: 'forged.stl', …(4) } ] to be undefined`.
      **One pre-existing cell changed, escalated first and adjudicated**: `poses.test.ts`
      › "an index that is silent selects exactly as it did before poses" (absent/warming/
      wedged) compared the peek route's JSON with `peek()`'s byte for byte, and the layer
      now legitimately annotates a model an earlier cell in that file taught it — which
      is the delta's "carrying whatever annotations the layers already held" while the
      index is down. Verified against the archived normative text before touching it: the
      requirement it pins is `directory-browsing`'s *Folder tiles preview their contents*,
      whose words are about **selection** ("SHALL be chosen entirely by a bounded,
      deterministic walk"; Determinism: "the same models … in the same order") and never
      about wire bytes — no contradiction, so the helper now strips exactly the three
      additive fields and still compares serialised key order. Falsified as asked by
      un-stripping `pose`: all three fail on the annotation, not the selection
      (`expected '[{"name":"a.stl","path":"/mixed/a.stl…' to be '…'`)
- [x] 6.4 Client: the pose wave asks only for entries whose listing carried no pose
      (`semanticPosesFor` callers in `App`); everything else about the wave — background,
      chunked, silent-failure — unchanged
      — landed 2026-09-02. **Both** `semanticPosesFor` call sites narrow: the listing
      wave's `wavePaths` memo (`e.kind === 'model' && e.pose === undefined`) and the
      previews' wave, which skips a carried entry *before* marking it asked, so it is never
      a question rather than a question recorded as answered. Nothing else about either
      moved. The other half is `carriedPoses`, a memo over `thumbEntries` — tiles, the
      similarity anchor and sheet cells, all annotated by the same layer — folded into the
      `poses` memo at LOWEST precedence, so an asked answer still wins a shared path.
      Identity discipline is preserved on purpose: with nothing carried the memo returns the
      `NO_POSES` constant and `poses` is the very reference it was before, so no library
      whose server has no layer content pays the sweep's reconcile walk for this
      (`ao-refreshes-thumbnails` 2.1). The `poses` memo moved below `thumbEntries` to read
      it; nothing between the two positions used it. Falsified: the filter dropped → 3
      cells, `expected "spy" to be called with arguments: [ [ '/models/quiet.stl' ] ]` and
      `expected "spy" to not be called at all, but actually been called 1 times`; the merge
      dropped → `expected undefined to deeply equal { up: [ +0, 1, +0 ], …(4) }`
- [x] 6.5 Startup revalidation (D8): when the library resolves ready and a snapshot
      exists, start the incremental pass; no snapshot → nothing at startup. Reuses the
      library-ready hook `library-overrides`' eager store load established in `index.ts`
      — landed 2026-09-02 inside `index.ts`'s existing `library.state()` ready branch,
      beside the eager override load and the two sweeps. Iterates
      `SnapshotStore.roots()` — new, and the only way to recover a root, since the store
      is keyed by a hash; it does **not** bump the LRU clock `load` bumps, because a
      census is not a serve. One root at a time, so two passes never contend for the same
      disk head. A library with no snapshot yields no roots and nothing is walked — the
      census reads the cache directory, never the library (asserted). `createApp` grew a
      trailing `listings?: ListingCache` for this: the pass **must** run on the instance
      the app serves from, or the app would still believe every root unchecked and run a
      duplicate pass behind the first listing. Falsified by making `roots()` find nothing
      → 3 cells, `expected [ '/tmp/mb-ly-13kECF/top/kit/a', …(1) ] to deeply equal [ ]`
      and `expected { ok: true, roots: +0, changed: false } to deeply equal
      { ok: true, roots: 1, changed: false }`
- [x] 6.6 Reload endpoint (D9): runs the same pass now, answers whether anything moved;
      client affordance minimal (the stale-marker reconciliation already covers how
      corrections land)
      — `POST /api/reload` → `{ ok, roots, changed }` (`ReloadResult`). No machinery of
      its own: `ListingCache.revalidate` over `store.roots()`, sequentially. That method
      now **returns** whether the tree moved (it swallowed the fact before) and the
      in-flight map carries the answer, so a reload joining a pass already running reports
      what that pass found; no pre-existing cell asserted the old `void`. The derived
      layers are dropped wholesale while the tree is *revalidated* rather than dropped —
      for the tree there is a check, for the layers there is none (D7/M9). Falsified: no
      `dropAll` → `expected { up: [ +0, 1, +0 ], …(4) } to be undefined`; the pass never
      reporting movement → `expected false to be true` in two cells
- [x] 6.7 Scope enumeration (added 2026-09-02 — the seam `bulk-thumbnail-jobs` waits on;
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
      — landed 2026-09-02 as `GET /api/models?path=` → `{ path, entries, complete }`
      (`ModelsListing`), the shape this task names; `/under` was weighed and declined as
      another process's noun (it is mini-classify's route, not this server's). A path
      route like `/api/dir`: canonicalised the same way, so the library gate answers
      `missing` before it and `path is required`/404 come free. `enumerateModels`
      (`listing.ts`) answers three ways, cheapest first — this root's snapshot, the
      nearest **ancestor** root's (the common case: the library tab enumerates what
      browsing already walked), else a gather on the **search** budget persisted only if
      complete (§4.1a). All three go through one `modelsUnder`, which re-derives each
      `name` from its path so a snapshot-served answer is indistinguishable from a walk of
      that path, and which prefixes on both `/` and `!/` so enumerating an archive is not
      silently empty. Uncapped means uncapped; the step budget still bounds the *work*,
      and the route's comment says why that is not a cap on the *answer*. Falsified:
      applying `MODEL_BROWSER_FLAT_CAP` where all three paths pass →
      `expected [ …(500) ] to have a length of 600 but got 500` (the first attempt patched
      only the walking branch and **nothing failed**, because the cell is snapshot-served
      — the patch was misplaced, not the cell weak); always claiming complete →
      `expected true to be false`; handing back an ancestor snapshot's names unchanged →
      `expected [ 'a/bracket.stl', 'a/deep/part.stl' ] to deeply equal [ 'bracket.stl',
      'deep/part.stl' ]`. The incomplete cell needed **two** folders under the root: the
      root level is uncharged and `walkFsLevel` abandons the level it was reading when the
      budget goes, so a single over-budget folder answers zero models and "what was found
      still comes back" would have asserted nothing

- [x] 6.8 The client consumes the carried preview (added 2026-09-02, Masa's find:
      peeks were still issued for entries whose listing carried `preview` — the
      annotation landed with no consumer, the reload-affordance gap's twin):
      `requestPeek` lands `entry.preview` through the same map and
      once-per-listing discipline instead of calling `/api/peek`; an entry
      without the field asks exactly as before. Cell in folderSheets.test.tsx
      ("draws a listing-carried preview and asks the server for nothing" — the
      four-model peek mock proves no request decided the two-cell sheet);
      falsified by removing the branch: `expected "spy" to not be called at
      all, but actually been called 1 times`

- [x] 6.8a Review of 6.8 (288f55a, low round): three fixes landed — nested preview
      cells now take display names (`applyDisplayNames` recurses into
      `entry.preview`, and BOTH /api/dir branches annotate before naming, since
      naming-first walked a preview that did not exist yet; route-level cell
      falsified `expected undefined to be 'Kindle Cleric'`); the carried land is
      inlined and keeps its in-flight marker (the synchronous delete opened a
      same-batch re-entry window — churn, not I/O; per-listing clearing resets
      the marker); the per-peek O(listing) find is a WeakMap memo per listing
      identity. Finding "carried cells stripped of pose/thumb" was REFUTED
      against source: a5ed10d's emission-side `annotate(preview)` attaches both.
      Carried-choice staleness accepted as the recorded layer-lifecycle class

- [ ] 6.9 Emission-time filling (added 2026-09-03, Masa — see the delta's revised
      annotation requirement and D7's emission-time note): when the memoised probe
      says ready, `annotate`'s pass fills what the layers lack within
      `ANNOTATION_BUDGET_MS` (exported const, ~300 ms) — ONE batched `/poses` ask
      for the listing's unposed models; preview derivation via the existing
      posed-first peek pipeline (snapshot-served walk) for unchosen dirs, concurrency
      ≤4 — attaching what returns in time; late answers still `record*` into the
      layers (fire-and-forget continuation, errors swallowed like the wave's). Probe
      not ready → zero index calls, zero added latency. Client untouched: the wave
      and peek stay the fill for what emission missed. Cells: a ready fast index →
      first listing carries pose+preview and (instrumented) the client-visible
      answer needed no follow-up; a gated slow index → listing ships within budget
      without the fact, the late answer lands in the layer, the NEXT listing carries
      it; probe not-ready → no upstream call (count at the fetch seam) and emission
      latency unchanged; falsify each (drop the budget → hang; drop the probe gate →
      warming index slows a listing; drop the late-record → second listing still
      bare)

## 7. Tests

- [x] 7.1 Server: cached and walked responses are entry-for-entry identical on an unchanged tree (including ordering and truncation); one cached tree serves several different queries and both settings of the folder-matching option without re-traversing (instrument the walk, do not infer from timing); a second walk opens no archives; adding, removing, and renaming a model is picked up; a present-but-unreadable root invalidates rather than serving; the same tree reached at a different mountpoint under the same library is a **hit**; an unmounted library answers `missing` and leaves the snapshot in place; the on-disk format version invalidates a stale snapshot
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
      <br>**Completed 2026-09-02 (stage 2) — `server/test/listingCache.test.ts`, 22 cells**,
      alongside stage 1's 25. The five owed above all landed: cached-vs-walked identity
      (ordering *and* truncation reporting, with the no-store walk as the control); nine
      asks — several queries and both folder-matching settings — off one tree with zero
      `readdir`s and zero archive opens, instrumented at the syscall through a
      `node:fs/promises` mock rather than inferred from timing; add, remove, rename and a
      whole new folder picked up; a present-but-unreadable root and a present-but-unreadable
      folder each invalidating; and an unmounted library answering `missing` with the
      snapshot left in place, at the route and in the pass. Every behavioral cell was
      falsified before being trusted — thirteen defects introduced, watched to fail and
      reverted; each one's exact failure text is recorded against §4.1–§4.3 and §5.1 above.
      Two findings worth inheriting. **A `git checkout` is not how a falsification is
      unwound** — it reverts the whole working file rather than the patch, and cost this
      stage a full re-application of `listing.ts`; patch and unpatch against a copy.
      And **"serves copies" has no single-defect falsification at this stage**, recorded
      rather than left looking like coverage: `store.load` re-parses the file per request
      and `partition` and `wire` each mint fresh objects, so no one defect makes an
      annotation stick — making `wire` hand back its input fails the three *identity*
      cells and leaves the copies cell green. It guards a future in-memory snapshot cache,
      not today's code, and should be read that way
      <br>**Fix round 2026-09-02 (stage-1/2 review's confirmed findings) — 14 cells added
      across `listingCache.test.ts` (8), `snapshot.test.ts` (5) and `flat.test.ts` (1),
      for 589 server cells in all.** Closed here: **1** validation is a per-root
      *timestamp* against `REVALIDATE_TTL_MS` (10 s), so a long-lived process re-marks and
      re-runs the pass at a bounded cadence instead of never (driven through an injected
      clock, not a ten-second sleep); **2** the pass's failure taxonomy — only a
      `RevalidationError` invalidates, a failed invalidate leaves the root unvalidated with
      the snapshot in place, and any other failure (the store's own `save` on ENOSPC)
      neither invalidates nor stamps; **3** `walkFlat`'s request-path `save` is
      best-effort, so a full or read-only cache answers the listing it computed rather than
      a 500 carrying an errno and the cache's filesystem path (`revalidateTree`'s save
      still rejects, or finding 2's taxonomy could not see it); **4** an `access(R_OK|X_OK)`
      beside the reuse `stat`, since `chmod` moves no mtime and the reuse branch was blind
      to a models-only folder revoked and to a root left executable but not readable — one
      `access` per reused directory, still proportional to shape; **5** (secondary half) a
      re-read directory's **own** entry is refreshed from the stat the pass already made,
      so the saved snapshot's entry mtime and its `dirs` record are the same fact; **6** the
      pending-await branch re-takes the ordinary decision instead of serving unmarked, so
      an awaiter of a pass that exited through the volume-gone early return is marked;
      **8** `.tmp` files are reaped only past 60 s, so the startup sweep cannot unlink a
      live `writeAtomic` temp; **9** `flush()` marks clean *before* its await against a
      serialised copy (a `set` landing mid-write re-dirties and is persisted by the next
      flush), eviction skips `archives.json` entirely, and the reap-on-unusable branch now
      also resets the in-memory map and dirty flag — the write-back loop the eviction
      branch's comment used to guard; **10** `envCap` and `envLimit` floor *before* the
      positivity test, so `0.5` falls back rather than becoming a cap of 0 (evicts
      everything every sweep) or a budget of 0 (every walk instantly exhausted).
      All thirteen defects were introduced, watched to fail, and unpatched — each one's
      exact failure text is in the fix round's report. The primary half of finding 5
      (in-place overwrites served at the recorded mtime) changed no code: it is
      spec-resolved as a normative caveat in the delta and in D5's Risks bullet.
      The review's cleanup list — dead `FlatWalk.capped`, the hand-copiers,
      `writeAtomic`/`envCap` duplication, `revalidateTree`'s double load and unconditional
      save — was deliberately **not** touched here and is left for a simplify pass.
      One finding worth inheriting: **the mid-flush cell needs an interposition point
      inside `writeAtomic`**, and `rename` is the only one a test can reach — it fires
      exactly once per write, after the bytes are down and before the flag is cleared. The
      suite's existing `node:fs/promises` mock grew a one-shot `onRename` hook for it;
      without an interposition, "a `set` during the write is not lost" has no falsification
      at all and would have looked like coverage
      <br>**Fix round 2 2026-09-02 (the round-2 review's ten composition-seam findings) —
      12 cells added across `listingCache.test.ts` (4), `layers.test.ts` (4),
      `snapshot.test.ts` (1), `listingRefresh.test.tsx` (2) and a new `env.test.ts` (4
      cells, one file), for 608 server / 701 client.** Closed here: **R1** a `ListingError`
      from `gatherFlat`'s up-front root stat — the walked root deleted or renamed while the
      volume is present — is a contradiction like `RevalidationError` and invalidates, where
      before it left the snapshot in place and every later serve answered a ghost tree
      forever (the `isReady` recheck is what still separates an unmounted volume); **R2** a
      FAILED follow-up paints no header error — the reducer's `failure` case clears the
      request on `inflight.followUp`, keeps the result and its stale flag, and leaves
      'Refreshing…' up as the truthful line, which is what App's staleId effect had claimed
      in prose all along; **R3** `enumerateModels`' request-path `save` is best-effort like
      `walkFlat`'s (the sibling missed when R1-round-1's finding 3 was applied); **R4a**
      `/api/models` resolves the requested path before an *ancestor's* snapshot answers for
      it, so a phantom path under a cached root 404s exactly as the uncached branch does
      (one `stat`; the exact-root branch needs none — a snapshot there was written by a walk
      that resolved it, and R1 now invalidates a root that has since gone); **R4b** an
      enumeration awaits the covering root's pass when its stamp is missing or past
      `REVALIDATE_TTL_MS`, rather than serving unchecked — correct over instant, because a
      job's scope has no staleness marker on the wire for the caller to notice by; **R5**
      the reuse branch's `access` probe is a contradiction only when the recorded level is
      **non-empty**, since the walk itself skips an unreadable directory and an empty
      recorded level re-obtains the same nothing — before this, one `chmod 644` on one empty
      folder made every cadence a full cold walk, forever, because the walk that followed
      recorded it empty again; **R6** pose-layer entries carry a `recordedAt` and stop being
      emitted (and are dropped) past `POSE_ANNOTATION_TTL_MS` (5 min, injected clock) —
      without it the annotation filters a model out of the client's wave permanently and
      converts "stale until the next navigation" into "stale until restart"; **R7**
      `POST /api/reload` uses a new `ListingCache.reload`, which awaits an in-flight pass
      and then runs a **fresh** one, so the verdict it reports is a pass that began after
      the gesture (`revalidate` keeps join semantics for serves); **R8** the invalidate
      branch calls a new `DerivedLayers.dropPreviewsUnder(root)`, since that branch has no
      changed-directory list to drive `noteDirChanged` with and folder tiles went on drawing
      contact sheets of a contradicted subtree (ancestors kept, poses untouched); **R9** the
      third env-parser copy is gone — one `server/src/env.ts` `envPositiveInt`, with the
      floor-before-positivity rule and the never-silently-unbounded doc, behind all three
      knobs; `cache.ts`'s copy still floored *after* the test, so
      `MODEL_BROWSER_CACHE_CAP=0.5` was a cap of 0 that swept the whole pixel store on every
      write; **R10** `SnapshotStore.flush()` chains on a private promise, so two concurrent
      flushes cannot commit an older serialization over a newer one (the mark-clean-before-
      await and re-dirty-on-throw semantics stay inside the chained section).
      Every behavioral fix was falsified before being trusted — each defect re-introduced,
      watched to fail, and unpatched from a copy (never `git checkout`, per the previous
      round's finding); the exact failure text for each is in this round's report.
      Two findings worth inheriting. **No pre-existing cell had to change**, but one nearly
      did: `flat.test.ts`'s "the walk collects without consulting the query" slices
      `listing.ts` between `async function walkFsLevel` and the literal text `function
      envLimit`, so R9's extraction would have made that `indexOf` return -1 and the slice
      run to the end of the file, failing on the query predicates for a reason with nothing
      to do with the walk. `envLimit` is kept as a named forwarder to `envPositiveInt` and
      the coupling is now documented at the declaration — a source-shape guard is a
      dependency on a symbol like any other. And **R4b's "touches nothing when cached" cells
      survive unchanged only because a completing walk stamps its root**: `listFlat` through
      `ListingCache` validates as a side effect, so the enumerations that follow it in the
      same cell are inside the TTL window and run no pass. A cell that cached a tree by any
      other route would now pay one — worth knowing before writing the next one
- [x] 7.2 Client: a stale-marked listing renders immediately with the refreshing affordance and reconciles on the follow-up; an unmarked listing shows no affordance; a superseded reconciliation is discarded by latest-wins
      — landed 2026-09-02 as `client/test/listingRefresh.test.tsx`, 9 cells (6 here, 3 for
      §6.4 below). All three this line names are there, plus the two the review of §5.1's
      wording made necessary: the **one-follow-up** cell (a stale→stale sequence, counting
      requests) and a **no-skeleton** cell, since the follow-up's whole point is that the
      cached grid stays visible. The stale fixtures are additive on the harness's shared
      `listDir` — every one of the 668 pre-existing client cells passes untouched (677
      after).
      Two findings worth inheriting. **The loop cell's mock has a floor** — marked for six
      answers, then unmarked — and the floor is the mock's, not the client's: an unguarded
      client re-asks in a microtask chain that starves the macrotask timer, so the
      falsification arrives as `Test timed out in 5000ms` rather than as a diff. The floor
      turns it into `expected 7 to be 2`, which says what went wrong. And **"the carried
      pose reached the sweep" is not observable through a render at mount**: the thumbnail
      pipeline reaches `fetchModel` and stops short of `renderThumbnail` in this
      environment, and it does so identically for a pose delivered by the *wave* — verified
      by driving the control, so it is a property of the app-mount harness and not of this
      change. The cell reads `poses[viewer.entry.path]` at the viewer handoff instead, which
      is the one place a carried pose and a wave-supplied one could differ and do not
- [x] 7.3 Layers (server): an index-generation bump stops pose/preview answers while the
      tree keeps serving; a deep directory change re-derives its ancestors' preview
      choices and not an unchanged sibling's; emission with a wedged index is as fast as
      with none (instrument, don't time); no-layer listings byte-identical. Client: the
      wave requests only unposed entries; a reload surfaces an external change without
      restart
      <br>**Server half landed 2026-09-02 — `server/test/layers.test.ts`, 23 cells.**
      Left unchecked: the two client cells are the later client worker's.
      All four server cells are there. The first is written against the identity the
      server can actually observe: an *index-generation bump* is not one — review M9, and
      D7 turns on it — so what is driven is the **collection root** moving and the
      `LAYER_VERSION` half (a layer built for another version is inert: it records
      nothing and answers nothing), both with the tree still serving beside them.
      "As fast as with none" is instrumented, never timed: the index is stubbed at `fetch`
      and the emission that carries a pose makes **zero** calls. Byte-identity is pinned
      against a server constructed with no store at all — the pre-change app — on the flat
      and the browse paths, and is followed by its own control: each of the three layers,
      seeded alone, makes the bytes differ, so the cell can fail.
      Two findings worth inheriting. **A route-driven cell cannot falsify a "serves
      copies" defect** — `c.json` serialises, so what a test mutates is its own
      deserialised object and no shared reference is reachable; three separate copy
      defects (hand out the held array, keep the caller's array, share the pose object)
      were introduced and *nothing failed*. The coverage now lives in an in-process cell
      against `DerivedLayers`, which fails on both array defects
      (`expected [ { …(5) }, …(1) ] to deeply equal [ { name: 'x.stl', …(4) } ]`); this is
      stage 2's own recorded finding met one layer up. And the pose object is handed out
      **by reference on purpose** — a small record nothing here writes to, against one
      copy per model per listing on a 500-tile grid — which is stated at `poseFor` rather
      than covered by a cell that could not fail.
      <br>**Client half, 2026-09-02.** *The wave requests only unposed entries* is landed —
      three cells in `client/test/listingRefresh.test.tsx` (the narrowed ask; a listing
      whose models all carry poses asking nothing at all; and the carried pose reaching the
      same consumer a wave-supplied one does, which is what makes not-asking safe rather
      than merely cheaper). Falsification texts are on §6.4.
      *A reload surfaces an external change without restart* is **not** landed here, and is
      not blocked so much as relocated: the reload cell travels with the affordance, whose
      recorded home is `bulk-thumbnail-jobs`' library tab (its design D6, which names that
      tab "the natural later home for listing-tree-cache's reload affordance (its 6.6)").
      The endpoint and its server cells are landed here; the surface and its cell land
      there. 6.6's "client affordance minimal" half-clause should have cited D6 and did not
      — that is the line to read alongside this one.

## 8. Verification

- [x] 8.1 `bun run typecheck` and `bun run test` pass across workspaces
      — 2026-09-02 on the fully merged main (c27a99a): server 589 (18 files), client
      685 (55 files), both typechecks exit 0, `openspec validate` clean
- [x] 8.2 Re-run the proposal's measurement on **both** volumes with `vm.drop_caches` between runs, and record the numbers here: cold search on the spinning exfat volume should land near its warm figure (~0.8s) rather than ~32s. Report the revalidation cost separately — that is the one that scales with directory count and is the honest recurring price

      — run 2026-09-02 (coordinator, curl against the hot-reloaded dev instance; page
      cache dropped per volume by udisksctl unmount/mount, which needs no root — the
      earlier sda2 numbers were discarded as wrong-volume, the library is on /dev/sdb1
      ext4 USB): **cold bare search walk 1.33 s; cold WITH snapshot 46 ms to the
      stale-marked answer (~29x), follow-up awaiting the cold incremental pass 0.70 s;
      warm walk 49 ms; browse-after served unmarked from the search's snapshot in
      56 ms** — that last one is the recorded budget asymmetry live (a browse whose own
      walk is budget-truncated serves complete from the snapshot). The spinning-exfat
      column is MISSING and recorded so per the preamble's rule: the configured library
      does not live on that volume today (it holds an unrelated tree), so the ~32 s
      motivating case could not be re-measured against a real configured library; the
      1.1 exfat mtime validation on that volume stands separately. Revalidation cost
      scales with this tree's directory count; re-measure on the exfat library when one
      is configured there.