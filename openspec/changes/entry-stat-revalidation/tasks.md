> **Ordering and collisions (checked 2026-09-14 against every active change's deltas).**
> `pose-layer-removal` MODIFIES `listing-cache`'s *Derived annotations ride the listing* and
> *Derived layers live beside the tree and die with their sources*; this change MODIFIES
> *Walked trees are cached across restarts*, *Revalidation is proportional to tree shape* and
> *Freshness on demand* and ADDs two — no requirement in common, so the two archive in either
> order. The consequence for the preview layer is stated in this change's ADDED requirement
> and composes with the other's text ("a detected change in any directory SHALL re-derive…")
> rather than editing it. Held poses are left to `pose-layer-removal` (design D3); if this
> lands first an overwritten model's held pose lingers to `POSE_ANNOTATION_TTL_MS` or the
> next reload — accepted. **Shared files:** `server/test/layers.test.ts` (both add cells —
> separate `describe` blocks, re-read before editing); `server/src/listing.ts` and `app.ts`
> with `search-cancellation` (different symbols: `levelFor`/`revalidateTree` here, `walkFlat`'s
> registry there — re-read against main before starting); `CLAUDE.md` with
> `hover-prefetch-listings` and `pose-layer-removal` (different bullets). No active change
> carries a `public-deployment` or `feature-report` delta. `directory-browsing` is not touched
> here.

## 1. The reuse branch confirms its entries (design D1)

- [ ] 1.1 `server/src/listing.ts`: add `demoted: Set<string>` to `FlatWalk` (populated on the
      revalidation path only; empty on a walk). In `levelFor`'s reuse branch, after the
      `access` probe, `stat` each `held.children` entry of kind `model` at
      `join(fsDir, posix.basename(e.path))` (`stat`, not `lstat` — it follows a symlinked
      model to its target as `listFsDir` does), charging one step per entry through
      `takeStep` when `charge` is set; if any entry's `mtimeMs` or `size` differs from the
      record, or the `stat` rejects (the target of a link moved or vanished; a file gone
      inside the granule), add `libPath` to `walk.demoted` and fall through to the
      `listFsDir` read below instead of returning `reusedLevel`. Directory children are
      skipped (their own visit); **`zip` children are skipped too** — 1.4 confirms them from
      `walkZip`'s stat, no third stat per archive (design D1). Rewrite the `levelFor` doc
      comment (the "Reuse —" paragraph) and `FlatWalk.reuse`'s doc ("one `stat` per
      directory rather than one per entry" is no longer true). Verify: `bun run typecheck`
      passes and the cells of 2.1–2.4 go green.
- [ ] 1.2 `server/src/listing.ts`: `revalidateTree` unions `g.demoted` into `changedDirs`
      (return `demoted` from `gatherFlat` beside `dirMtimes`). **Load-bearing, not
      belt-and-braces** (design D1, "the loop closes"): both `levelFor` branches record the
      directory's mtime in `dirMtimes`, and a demoted directory's did not move, so the
      `before.get(path) !== mtime` filter leaves it out; without the union the sheet is
      never dropped. Rewrite `revalidateTree`'s doc header: "one `stat` per recorded
      directory, one per recorded model entry, a `readdir` only where either moved; an
      archive confirmed by `walkZip`'s own stat". Verify: cell 2.5 (the sheet drop) goes
      green and goes red when the union is removed.
- [ ] 1.3 Comment sweep for "one `stat` per directory" — `listingCache.ts` (the module header,
      `REVALIDATE_TTL_MS`, `enumerate`, `reload`), `index.ts` (the startup pass comment),
      `app.ts` (`/api/models` and `/api/reload` headers), `listing.ts` (`FlatWalk.reuse`,
      `revalidateTree`). Verify: `grep -a -n "per directory" server/src/*.ts` returns only
      lines that now say "per directory and per model entry" or are about something else;
      note the `grep -a` — `app.ts` holds NUL bytes and plain grep prints nothing for it.
- [ ] 1.4 `server/src/listing.ts`: the archive tile's write-back (design D1, pinned by the
      2026-09-14 review). Add `zipStats: Map<string, { mtime: number; size: number }>` to
      `FlatWalk` beside `dirMtimes`; `walkZip` sets it from the `zipStat` it already makes,
      keyed by `zipLibPath`. In `walkFsLevel`'s archive branch, after `walkZip` returns, read
      it back into `e` and the pushed container entry the way the `fresh !== e.mtime` block
      does for a directory; when the mtime differs from `e.mtime` as recorded, add the
      archive's parent directory (`posix.dirname(e.path)`) to `walk.demoted` — the sheet drop,
      no re-read. The compare is **mtime-only** (`walkZip` surfaces no size; an overwrite
      always moves the mtime); the write-back carries both since the stat has both. Verify:
      cell 2.6 goes green, and the pass's stat count for the archive is unchanged (2.2's
      baseline accounting).

## 2. Server cells for the pass (`server/test/listingCache.test.ts`, design D7)

- [ ] 2.1 "picks up a model re-exported over its own name": `primed(f)`, then overwrite
      `a/bracket.stl` with `stlBytes(20)` padded to a **different length** and `utimesSync` it
      to `recorded.mtime + 5000`; `cache.revalidate` returns `true`; the flat listing's entry
      for `a/bracket.stl` has `mtime` and `size` equal to `statSync`'s; `f.store.load(ROOT)`
      holds the same values. **Falsify:** delete the per-entry loop in `levelFor` — red.
- [ ] 2.2 "confirms an unchanged tree with no directory read and stores its entries and
      directory records unchanged": extend the existing "leaves an unchanged tree unchanged,
      reading nothing at all" cell with a `stat` counter on the mocked `node:fs/promises`
      (beside `readdirs`/`opens`), filtered to the tree like `treeReaddirs`. **The count is
      relative, never an absolute literal**, because today's unchanged pass already stats
      more than once per directory (the 2026-09-14 review measured it on this fixture): the
      root twice (`gatherFlat`'s own stat, then `levelFor`'s), each archive twice
      (`walkZip`'s `zipStat`, then the archive layer's key — `archiveKey` asks
      `library.state()`). So: land the counter **first**, run this cell on the unchanged
      code, and record that number as `BASELINE_STATS` beside the cell with the commit it
      was read at and the accounting above; then assert, after 1.1, `treeStats(f) ===
      BASELINE_STATS + modelEntries`, where `modelEntries` is the count of snapshot entries
      of kind `model` whose path holds no `!/` (computed from `f.store.load(ROOT)`, never
      typed — here 4). Also: `treeReaddirs(f)` is `[]`, `archiveOpens(f)` is 0, and the
      stored `entries` and `dirs` `toEqual` the loaded ones (`walkedAt` is rewritten by every
      pass — do not compare the whole snapshot). **Falsify:** make the loop fall through
      unconditionally — `treeReaddirs` is no longer empty; stat a `zip` child in the loop —
      the count is one over.
- [ ] 2.3 "an overwrite that keeps mtime and size is the documented blindness": overwrite with
      bytes of the **same** length, `utimesSync` the recorded stamp back; `revalidate` returns
      `false` and the entry is unchanged. This cell documents D4; its check that it exercises
      the branch is 2.1's falsification running beside it (change the length here and the
      cell flips).
- [ ] 2.4 "re-reads a directory whose entry can no longer be stat'd", two cases in one
      `it.each` or two cells. **Granule:** record the directory's `mtime` with `statSync`,
      `unlinkSync` the model, `utimesSync` the directory back to the recorded stamp;
      `revalidate` returns `true`; the entry is absent from the listing and the snapshot.
      **Symlinked model** (the field case, design D1): before priming, `symlinkSync` a
      relative link `kit/a/linked.stl -> ../z/bracket.stl` (inside the library, so
      `listFsDir`'s `realpath` confinement admits it and the walk records the target's
      mtime/size under `/kit/a/linked.stl`); prime; `unlinkSync` the **target** `kit/z/
      bracket.stl` (no `utimesSync` needed — nothing about the target touches `kit/a`);
      `revalidate` returns `true`, `/kit/a/linked.stl` is absent from the listing and the
      snapshot, and `treeReaddirs(f)` contains `join(f.kit, 'a')` (the parent was re-read
      although its own mtime never moved; `kit/z` is re-read too, by its own mtime). A third
      variant, target *replaced* (`writeFileSync` over `kit/z/bracket.stl` with a different
      length, `utimesSync` later) → the link's entry carries the target's new `mtime`/`size`.
      **Falsify:** treat a rejected `stat` as agreement — both gone cases red; the replaced
      variant is 2.1's falsification.
- [ ] 2.5 `server/test/layers.test.ts`, a new `describe('an overwrite re-derives the sheet')`:
      `recordPreview` for `/kit/a`, `/kit` and `/kit/z` at `PEEK_DEFAULT`, overwrite
      `/kit/a/bracket.stl` as in 2.1, run `cache.revalidate`; `previewFor('/kit/a')` and
      `previewFor('/kit')` are `undefined`, `previewFor('/kit/z')` is still held.
      **Falsify:** remove 1.2's union — the two stay held.
- [ ] 2.6 "a rewritten archive's own tile carries its new stamp": rewrite `box.zip` with a
      different entry set (size moves), `utimesSync` later; after the pass the container
      entry for `box.zip` in the flat listing and the interior entries agree on the new
      `mtime`, the container's `size` is `statSync`'s, `changedDirs` (or the sheet cell's
      `previewFor('/kit')`) shows the parent reported, `treeReaddirs(f)` is `[]` (no
      re-read — the write-back is the correction), and the tree stat count is 2.2's
      `BASELINE_STATS + modelEntries` exactly (no third stat for the archive).
      **Falsify:** drop 1.4's write-back — the tile keeps the old stamp while the interior is
      fresh; stat the zip in `levelFor`'s loop instead — the count is one over.
- [ ] 2.7 "the reload heals an overwrite and the thumbnail state says stale" (api-level, in
      `listingCache.test.ts` beside the existing reload cell): build an app over the fixture
      with a `ThumbCache` in a temp dir, `PUT /api/thumb` for `/kit/a/bracket.stl` at the
      recorded mtime, overwrite as in 2.1, `POST /api/reload` → `{ok:true, changed:true}`;
      `GET /api/dir?flat=true&path=/kit` carries the new `mtime` and `thumb.ao.state ===
      'stale'`; `GET /api/thumb?path=…&mtime=<new>` is a miss. Stub the index and
      `resetIndexStatus()` as `server/test/CLAUDE.md` requires for any `/api/dir` cell.
      **Falsify:** 2.1's.
- [ ] 2.8 "the corrected entry survives a restart": after 2.1's pass, a second
      `new SnapshotStore(f.base, undefined, f.library)` loads the corrected `mtime`/`size`.
      **Falsify:** guard `revalidateTree`'s `save` with `if (changedDirs.length > 0 &&
      dirMtimesMoved)` — the file keeps the old value.
- [ ] 2.9 Run the whole server suite under Bun as well as vitest for the order-sensitive
      cells: `cd server && bun test test/listingCache.test.ts` is not the runner — instead
      run `bun run <script.ts>` for a scratch fixture that overwrites one file and prints the
      flat listing's entry before and after `revalidateTree`, confirming the property under
      Bun's raw `readdir` order (CLAUDE.md, Testing). Record the script's output in this
      line.

## 3. The switch (design D5) and the feature overrides (design D6)

- [ ] 3.1 `shared/types.ts`: `DeploymentConfig.listingCache?: boolean` with a doc comment
      naming the default (on), the environment variable, and that it is a testing
      affordance. `server/src/config.ts`: `listingCache` in `TOP_LEVEL_KEYS`, validated as a
      boolean ("listingCache must be a boolean"). Verify: `config.test.ts` cells 4.1–4.2.
- [ ] 3.2 `server/src/config.ts`: one strict boolean parser `envBoolean(name, env)` — `1`/`true`
      → true, `0`/`false` → false, unset/blank → undefined, else `ConfigError` naming the
      variable and the four spellings. Its doc comment states the contrast with `env.ts`'s
      `envPositiveInt` and why: a numeric knob with a bad value **falls back** (a fallback
      is a safe number), a switch with a bad value **stops the server** (a switch read as
      its default would run what the tester meant to turn off, silently). An `envName(key)`
      deriving `MODEL_BROWSER_` + SCREAMING_SNAKE from a camelCase key. **Export both
      `envName` and `FEATURE_KEYS`** (module-local today) so 4.4/4.6 iterate the real set —
      no Bun leak, `config.ts` already imports from `./app` and stays Node-clean. `loadConfig`
      applies, after the file and after `withRootFromEnv`: `MODEL_BROWSER_LISTING_CACHE`
      over `listingCache`, and for each of `FEATURE_KEYS` its derived variable over
      `features[key]` (creating `features` when the file had none). **Two sites, not one:**
      the ordinary return and the ENOENT early return (`return withRootFromEnv({}, env)` —
      an absent file is the ordinary case, and an override that only applied when a file
      existed would be silently ignored on the default deployment). Fold both into one
      `withEnvOverrides(config, env)` that `withRootFromEnv` becomes. A module-level
      assertion that the derived names are disjoint from the other `MODEL_BROWSER_*` names
      this server reads (list them beside it). Verify: cells 4.3–4.6, and 4.4's no-file case
      is what covers the ENOENT site.
- [ ] 3.3 `server/src/index.ts`: `const snapshots = config.listingCache === false ? undefined :
      new SnapshotStore(undefined, undefined, library)`; `new ListingCache(snapshots)`;
      the startup block skips `snapshots.maintain()` and the revalidation loop when
      `undefined`. Print `listing cache: off` **unconditionally, at top level beside the
      `client at …` line** — not inside `library.state().then(...)`, which fires its
      `library … at …` branch only on `ready`, so an off run against an unconfigured or
      missing library would never say so. A comment beside the skipped `maintain()`: while
      off, the snapshot directory's bound is unenforced — nothing sweeps or caps
      `<cache>/<id>/snapshots/` until the next on run's startup sweep (design Risks).
      Verify: with a throwaway config file (`MODEL_BROWSER_CONFIG=<tmp>/config.json`
      carrying `{"listen":{"port":3179},"listingCache":false}` and `MODEL_BROWSER_ROOT` at a
      scratch kit) start `bun run --cwd server src/index.ts`, read the `listing cache: off`
      line, `curl -H 'Host: 127.0.0.1' 'http://127.0.0.1:3179/api/dir?flat=true&path=/'`
      twice (neither answer carries `stale`), confirm no `snapshots/` directory appears
      under the cache dir, then stop it; start once more with `MODEL_BROWSER_ROOT` unset and
      read the line again. Never touch 3177/5173.
- [ ] 3.4 `server/test/listingCache.test.ts`: "a reload with no store reports no roots and
      still drops the layers" — `createApp` with `snapshots` undefined, `recordPreview`
      something, `POST /api/reload` → `{ok:true, roots:0, changed:false}` and
      `layers.size().previews === 0`. **Falsify:** move `layers.dropAll()` below the roots
      loop and return early on zero roots — previews survive.
- [ ] 3.5 `CLAUDE.md` Commands section, in the `bun run dev` bullet after the config-file
      sentences: `listingCache` (default on; `false` makes every flat listing and search walk
      the filesystem — no snapshot read or written, no `stale` marker — for testing) and
      `MODEL_BROWSER_LISTING_CACHE=0|1` overriding it; and the rule that every `features`
      field has `MODEL_BROWSER_<FIELD>` (`MODEL_BROWSER_THUMB_WRITES` … `_MAINTENANCE`),
      values `1|true|0|false`, anything else stops the server — with the one-clause
      contrast: a **switch** with a bad value stops the server, a **numeric knob**
      (`_FLAT_BUDGET`, `_CACHE_CAP` and the rest through `envPositiveInt`) with a bad value
      falls back to its default, because a knob's fallback is a safe number while a switch
      read as its default runs the cache the tester meant to turn off. One sentence on
      what off costs: the cold walk (~32 s measured on the spinning volume) **and** the
      archive-directory cache, which lives in the same store — every browse or peek of a
      zip-heavy folder re-reads each central directory — and that the snapshot directory
      is neither swept nor capped while off. Verify: the bullet reads in the section's
      voice and `grep -n LISTING_CACHE CLAUDE.md` finds it.

## 4. Configuration cells (`server/test/config.test.ts`, `server/test/features.test.ts`)

- [ ] 4.1 "accepts listingCache as a boolean and refuses anything else": `{listingCache:false}`
      loads to `{listingCache:false}`; `{listingCache:'no'}` rejects `/listingCache must be a
      boolean/`; `{listingcache:false}` rejects `/unknown key "listingcache"/`.
      **Falsify:** drop the key from `TOP_LEVEL_KEYS` — the first assertion rejects.
- [ ] 4.2 "the committed demo configuration still loads with no listingCache key" — extend the
      existing demo cell: `config.listingCache` is `undefined`. (Documents that the demo runs
      the default; no falsification — a record cell.)
- [ ] 4.3 "MODEL_BROWSER_LISTING_CACHE overrides the file's key alone": file `{listingCache:true,
      features:{chatTab:true}}` + env `MODEL_BROWSER_LISTING_CACHE=0` → `{listingCache:false,
      features:{chatTab:true}}`; env `=1` over file `false` → true; env `''` → the file's
      value. **Falsify:** apply the env before the file's validation — the file wins.
- [ ] 4.4 "each feature field has its own variable and it overrides that field alone": for
      every key of `DEFAULT_FEATURES` (iterate, never list), env `MODEL_BROWSER_<NAME>=false`
      over a file declaring every field `true` yields that field false and the others true;
      with no file, env `MODEL_BROWSER_CHAT_TAB=1` yields `{features:{chatTab:true}}`.
      **Falsify:** derive the name from the wrong case (`MODEL_BROWSER_CHATTAB`) — red.
- [ ] 4.5 "a misspelled boolean stops the server naming the variable": `TRUE`, `yes`, `2` for
      `MODEL_BROWSER_MAINTENANCE` each reject with a message containing the variable's name
      and `1, true, 0, false`. **Falsify:** fall back to the default on a bad value — resolves.
- [ ] 4.6 "derived names collide with nothing this server reads": the set
      `FEATURE_KEYS.map(envName)` (both imported from `config.ts` — 3.2 exports them) plus
      `MODEL_BROWSER_LISTING_CACHE` is disjoint from the
      known list (`MODEL_BROWSER_CACHE`, `_CONFIG`, `_ROOT`, `_CLIENT`, `_INDEX`,
      `_LAUNCH_CONFIG`, `_CACHE_CAP`, `_SNAPSHOT_CAP`, `_FLAT_BUDGET`, `_FLAT_CAP`,
      `_FOLDER_CAP`, `_SEARCH_BUDGET`). **Falsify:** add a fake `cache: true` to a local copy of
      `DEFAULT_FEATURES` in the cell — red.
- [ ] 4.7 `features.test.ts`: "`/api/features` reports the environment's override" — build the
      report the way `index.ts` does from a `loadConfig` result with `MODEL_BROWSER_APP_LAUNCH=0`
      and assert the route answers `appLaunch:false` while `/api/open` refuses with
      `refused:'appLaunch'` (the declaration and the refusal from one value).
      **Falsify:** read the env in the route instead of in `loadConfig` — the report and the
      refusal disagree.

## 5. Spec and records

- [ ] 5.1 After archive, read `openspec/specs/listing-cache/spec.md` and
      `openspec/specs/public-deployment/spec.md` end to end: the overwrite sentence now says
      what the pass sees and what it cannot, "a reload" is a true heal, and nothing
      change-scoped rode across (this change's deltas carry no HTML comments — confirm none
      appeared). Verify with the whitespace-collapsed grep from CLAUDE.md for "a reload, and
      any name change" — it must be gone.
- [ ] 5.2 Design D2's table: the real-shape warm figures are the 2026-09-14 review's (two
      runs each); the implementer re-runs task 6.1's script — the `collect` step and the
      two warm `time` steps, no drop-caches — on the same volume and records the pair beside
      the review's with the date and the counts the script printed, so the number lives
      where it can be re-run. The `os.walk` pair stays as the record of the wrong shape and
      is not re-run.

## 6. Cold measurement — Masa (design D2, Open Question 2)

- [ ] 6.1 **Masa:** measure cold on each library volume (the ext4 SSD and, when attached, the
      spinning exfat HDD), once per volume, in one sitting — any exploratory command
      re-warms the cache. Save the probe as `scripts/probe-entry-stat.py` beside
      `probe-dir-mtime.py` (so the measurement can be re-run, not re-typed). **The probe
      has the pass's shape**: the path list is collected in one warm pass and written to a
      file *off the volume*; the timed loops then `stat` from that list and `readdir`
      nothing, as the real pass does — an `os.walk` inside the timed region (the 2026-09-14
      draft) reads every directory the pass never reads and diluted the multiplier to 1.7×
      where the real shape shows ~4× (design D2). The script writes nothing to the volume:
      ```
      import os, sys, time
      # collect: python3 scripts/probe-entry-stat.py collect "$ROOT" /tmp/entry-stat-paths.txt
      # time:    python3 scripts/probe-entry-stat.py time /tmp/entry-stat-paths.txt dirs|entries
      mode = sys.argv[1]
      if mode == 'collect':
          root, out = sys.argv[2], sys.argv[3]
          with open(out, 'w') as fh:
              for dp, dns, fns in os.walk(root):
                  fh.write(f'd\t{dp}\n')
                  for n in fns: fh.write(f'f\t{os.path.join(dp, n)}\n')
          sys.exit()
      listing, entries = sys.argv[2], sys.argv[3] == 'entries'
      paths = [l.rstrip('\n').split('\t', 1) for l in open(listing)]
      t = time.perf_counter(); d = f = 0
      for kind, p in paths:
          if kind == 'd': os.stat(p); d += 1
          elif entries:
              try: os.stat(p); f += 1
              except OSError: pass
      print(f'{"dirs+entries" if entries else "dirs only"}: {(time.perf_counter()-t)*1000:.1f} ms, {d} dirs, {f} files')
      ```
      Run: collect once (warm — it is the walk, and its cost is not the measurement), then
      time with the cache dropped before **each** cold timing (root needed; `echo 2` drops
      dentries and inodes, which is what a stat-only pass reads; the memory note's `3` also
      drops page cache and is not needed here):
      ```
      python3 scripts/probe-entry-stat.py collect "$ROOT" /tmp/entry-stat-paths.txt
      sync; echo 2 | sudo tee /proc/sys/vm/drop_caches; python3 scripts/probe-entry-stat.py time /tmp/entry-stat-paths.txt dirs
      sync; echo 2 | sudo tee /proc/sys/vm/drop_caches; python3 scripts/probe-entry-stat.py time /tmp/entry-stat-paths.txt entries
      python3 scripts/probe-entry-stat.py time /tmp/entry-stat-paths.txt dirs; python3 scripts/probe-entry-stat.py time /tmp/entry-stat-paths.txt entries   # warm, same sitting
      ```
      Record all four numbers per volume, with the volume, filesystem, the counts the script
      printed and the date, in design D2's real-shape table and in `REVALIDATE_TTL_MS`'s
      comment (replacing "~5.6 s measured cold"). Then answer Open Question 2 **off the real
      shape**: if cold entries on the spinning volume are within the same order as cold
      directories, close it; if they approach the cold walk, open the second-cadence
      follow-up change and say so on the question.
