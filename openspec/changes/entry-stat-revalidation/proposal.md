## Why

A model re-exported over its own filename keeps its old mtime and size in every flat
listing and search served from the tree snapshot: revalidation compares only each
directory's mtime, and a directory's mtime does not move when a child is rewritten in
place (verified on ext4, 2026-09-14 — disk mtime 1789167647052 / size 1619 against a
flat entry still saying 1789167635981 / 19 after a completed pass). The folder view
stats every request and is right. It matters because `/api/thumb` never stats the
model — it looks the render up by the mtime the client took from the listing — so the
stale mtime hits the *old* cache key: two views disagree about one model's thumbnail,
indefinitely. `POST /api/reload` runs the same check and healed nothing
(`{changed:false}`), so the `listing-cache` spec's "a reload" heal is false today.

## What Changes

- The revalidation pass, when a directory's mtime matches the recorded one, no longer
  returns the recorded level outright: it stats every recorded model entry in that
  level and treats any disagreement — a moved mtime, a moved size, an entry that cannot
  be stat'd (a symlinked model whose target moved or vanished; a file gone inside the
  mtime granule) — as a change in that directory, re-reading it exactly as a moved
  directory mtime does. An archive's own tile is corrected from the stat `walkZip`
  already makes for it — no extra stat per archive. The pass stays incremental (no
  `readdir` of an unchanged directory, no archive opened); beyond what the directory and
  archive checks already cost, it adds one `stat` per recorded model entry. A reload
  therefore heals an overwrite, and the spec sentence becomes true.
- The remaining blindness is stated honestly: an overwrite that preserves both mtime
  and size (`cp -p`, `rsync -t`, `touch -r`) is invisible to the pass — and equally
  invisible to the uncached folder view and to the thumbnail cache, whose key is the
  same mtime. The cache is then exactly as blind as the rest of the app, no blinder.
- A changed entry reaches everything that carried the old value: the snapshot on disk
  is rewritten so a restart serves the corrected value; the changed entry's directory
  is reported to the derived layers so its folder's contact sheet (whose cells carry
  entry mtimes) and its ancestors' are re-derived; the thumbnail annotation and the
  client's thumbnail key follow from the corrected mtime with no change of their own.
- A switch to turn the listing tree cache off for testing: a `listingCache` boolean in
  the deployment configuration file and a `MODEL_BROWSER_LISTING_CACHE` environment
  variable overriding it. Off means every flat listing and search walks the filesystem
  — the server built with no snapshot store, which is already the app's own default —
  and, because the archive-directory cache lives in that store, every browse or peek
  of a zip-heavy folder re-reads each central directory too. **Default on** (Masa,
  2026-09-14).
- Every feature-report field gains an environment-variable override of its own,
  derived mechanically from the field's name (`MODEL_BROWSER_THUMB_WRITES`,
  `MODEL_BROWSER_APP_LAUNCH`, `MODEL_BROWSER_CHAT_TAB`, `MODEL_BROWSER_HOST_DETAILS`,
  `MODEL_BROWSER_MAINTENANCE`), each overriding that one key of the file alone, the way
  `MODEL_BROWSER_ROOT` overrides `root` alone — Masa's ask of 2026-09-11. A value that
  is not a recognised boolean spelling stops the server naming the variable, the same
  posture a malformed file takes.
- Tests for each of the above, with a falsification named for every behavioural cell;
  the warm cost recorded in the design with its conditions; the cold cost left as a
  measurement for Masa with the exact command.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `listing-cache`: MODIFIED *Walked trees are cached across restarts* — the overwrite
  clause: the pass sees an overwrite within a revalidation interval; the stated blindness
  is now the mtime-and-size-preserving overwrite. MODIFIED *Revalidation is proportional
  to tree shape* — one examination per recorded model entry beyond the directory and
  archive checks, still no directory read and no archive opened where nothing moved.
  MODIFIED *Freshness on demand* — a reload uses the same incremental check and so heals
  an overwrite. ADDED *An entry overwritten in place is seen by the pass* — the per-entry
  check, the archive tile's correction from its own stat, what a changed entry must
  reach, the remaining blindness. ADDED *The tree cache can be switched off* — the
  testing switch and what off means, the archive-directory cache included.
- `public-deployment`: ADDED *The environment overrides single keys* — the per-key
  environment overrides (the cache switch and every feature field), their precedence
  over the file, their strict parsing.

## Impact

- `server/src/listing.ts`: `levelFor`'s reuse branch, `FlatWalk` (a set of directories
  demoted by an entry disagreement, and the archive stats `walkZip` records for the
  tile write-back in `walkFsLevel`), `revalidateTree`'s `changedDirs`.
- `server/src/listingCache.ts`, `server/src/index.ts`, `server/src/app.ts`: comments that
  say "one `stat` per directory" (ten sites, listed in tasks) become "one `stat` per
  directory and per recorded model entry"; `index.ts` builds no `SnapshotStore` when the
  switch is off — which also removes the archive-directory cache — and says so on the
  startup line, unconditionally.
- `server/src/config.ts`, `shared/types.ts`: `DeploymentConfig.listingCache`, the
  environment overrides applied inside `loadConfig`, one strict boolean parser.
- `deploy/demo/config.json`: unchanged — the key is optional and the demo runs the
  default (on). Its suite cell stays green with no edit.
- `CLAUDE.md` Commands section: the switch and the feature environment variables.
- Tests: `server/test/listingCache.test.ts`, `server/test/layers.test.ts`,
  `server/test/config.test.ts`, `server/test/features.test.ts`.
- Cost: warm, in the pass's own shape (stat-only from a collected path list, no
  `readdir`; the 2026-09-14 review, ext4 on the removable volume, 5,077 directories /
  14,064 files): ~10 ms directory-only → ~40 ms with every entry, a ~4× multiplier.
  An earlier `os.walk` pair (59 → 98 ms, Masa's run) had the wrong shape and understated
  the ratio; design D2 keeps both. Cold is unmeasured and on spinning media may approach
  the cold walk itself; the pass runs behind a served listing for browsing, and waits
  only for an enumeration and a reload (design D2, Open Question).
- Not touched: the wire (`DirEntry` is unchanged; the corrected `mtime`/`size` ride the
  fields they always rode), the thumbnail cache, the client.
