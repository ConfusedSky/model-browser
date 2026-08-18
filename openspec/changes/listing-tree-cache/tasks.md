# Tasks — listing-tree-cache

> Ordering: after `search-matches-folder-names` (the walk's predicate and its container collection both change there, and this caches that walk's output). Independent of `search-options`, but the cache key must include whatever options reach the server — coordinate before either lands. Re-read `listing.ts` against main before starting (parallel sessions).

## 1. Validate the freshness signal before building on it

- [ ] 1.1 **Do this first — D4 rests on it.** Measure directory-mtime behavior on the real **exfat** volume (`/run/media/masa/Files and S`): add, remove, and rename entries in a directory and confirm its mtime moves in each case, at what granularity, and whether it survives unmount/remount. exfat timestamps are coarser than ext4's and driver-dependent
- [ ] 1.2 If mtime proves unreliable there, fall back to the readdir fingerprint (entry count + total size per directory) from D4 and record the switch in the design before writing cache code — it still skips per-entry stats and zip tails, which is where the measured cost is

## 2. Cache store

- [ ] 2.1 A metadata cache module beside `server/src/cache.ts`, following its patterns: same `~/.cache/model-browser` root and `MODEL_BROWSER_CACHE` override, same size accounting and `maintain()` sweep, one env knob per limit through a validating helper (`envLimit`'s existing contract — a malformed value must not silently unbound anything)
- [ ] 2.2 Snapshot shape: entries keyed by walked root, holding name/kind/size/mtime, plus per-directory freshness state; versioned on disk so a format change invalidates rather than mis-parses
- [ ] 2.3 Keyed on the root path, so the same library at another mountpoint misses rather than hits (D6)

## 3. Archive directory cache (the largest measured win)

- [ ] 3.1 `zip.ts`'s central-directory read consults the cache keyed on the archive's `{mtime, size}`; an unchanged archive is never opened (D3). Measured at ~6.7s across 409 archives on the spinning volume — assert in a test that a second walk opens zero archives
- [ ] 3.2 A rewritten archive re-reads and replaces its cached directory

## 4. Walk integration and revalidation

- [ ] 4.1 `listFlat` serves from the snapshot when one exists for the root; a miss walks and populates
- [ ] 4.2 Incremental revalidation: one `stat` per directory, re-reading only those whose freshness signal moved (D4). Never a background full re-walk — that reintroduces the cold cost off-screen (D5)
- [ ] 4.3 Revalidation failure invalidates; an unreadable or unmounted root fails as it does today rather than serving cached entries (D6)

## 5. Freshness on the wire

- [ ] 5.1 Additive staleness marker on `/api/dir` responses; a freshly walked listing carries none
- [ ] 5.2 Client: present cached results immediately with a "refreshing" affordance, and reconcile the corrected listing when it arrives — no new transport (the Hono app must run on Node unchanged, architecture D1), so the client issues an ordinary follow-up request on seeing the marker; the existing latest-wins guard and skeleton already cover a later response landing

## 6. Tests

- [ ] 6.1 Server: cached and walked responses are entry-for-entry identical on an unchanged tree (including ordering and truncation); a second walk opens no archives; adding, removing, and renaming a model is picked up; an unreadable root invalidates rather than serving; a different mountpoint for the same tree is a miss; the on-disk format version invalidates a stale snapshot
- [ ] 6.2 Client: a stale-marked listing renders immediately with the refreshing affordance and reconciles on the follow-up; an unmarked listing shows no affordance; a superseded reconciliation is discarded by latest-wins

## 7. Verification

- [ ] 7.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 7.2 Re-run the proposal's measurement on **both** volumes with `vm.drop_caches` between runs, and record the numbers here: cold search on the spinning exfat volume should land near its warm figure (~0.8s) rather than ~32s. Report the revalidation cost separately — that is the one that scales with directory count and is the honest recurring price
