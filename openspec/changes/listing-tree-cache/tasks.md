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

- [ ] 1.1 **Do this first — D4 rests on it.** Measure directory-mtime behavior on the real **exfat** volume (`/run/media/masa/Files and S`): add, remove, and rename entries in a directory and confirm its mtime moves in each case, at what granularity, and whether it survives unmount/remount. exfat timestamps are coarser than ext4's and driver-dependent
- [ ] 1.2 If mtime proves unreliable there, fall back to the readdir fingerprint (entry count + total size per directory) from D4 and record the switch in the design before writing cache code — it still skips per-entry stats and zip tails, which is where the measured cost is

## 2. Cache store

- [ ] 2.1 A metadata cache module beside `server/src/cache.ts`, following its patterns: same `~/.cache/model-browser` root and `MODEL_BROWSER_CACHE` override, same size accounting and `maintain()` sweep, one env knob per limit through a validating helper (`envLimit`'s existing contract — a malformed value must not silently unbound anything)
- [ ] 2.2 Snapshot shape: entries keyed by library id plus the walked root's library path, holding name/kind/size/mtime, plus per-directory freshness state; versioned on disk so a format change invalidates rather than mis-parses
- [ ] 2.3 Keyed on the library's identity plus the walked root's **library path**, under
      `<cache>/<library-id>/`, so the same library at another mountpoint is a hit and two
      libraries with the same layout never share a snapshot (D6)

## 3. Archive directory cache (the largest measured win)

- [ ] 3.1 `zip.ts`'s central-directory read consults the cache keyed on the archive's `{mtime, size}`; an unchanged archive is never opened (D3). Measured at ~6.7s across 409 archives on the spinning volume — assert in a test that a second walk opens zero archives
- [ ] 3.2 A rewritten archive re-reads and replaces its cached directory

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

## 7. Tests

- [ ] 7.1 Server: cached and walked responses are entry-for-entry identical on an unchanged tree (including ordering and truncation); one cached tree serves several different queries and both settings of the folder-matching option without re-traversing (instrument the walk, do not infer from timing); a second walk opens no archives; adding, removing, and renaming a model is picked up; a present-but-unreadable root invalidates rather than serving; the same tree reached at a different mountpoint under the same library is a **hit**; an unmounted library answers `missing` and leaves the snapshot in place; the on-disk format version invalidates a stale snapshot
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
