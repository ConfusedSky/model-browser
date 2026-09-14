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
      `access` probe, `stat` each `held.children` entry of kind `model` or `zip` at
      `join(fsDir, posix.basename(e.path))`, charging one step per entry through `takeStep`
      when `charge` is set; if any entry's `mtimeMs` or `size` differs from the record, or the
      `stat` rejects, add `libPath` to `walk.demoted` and fall through to the `listFsDir` read
      below instead of returning `reusedLevel`. Directory children are skipped (their own
      visit). Rewrite the `levelFor` doc comment (the "Reuse —" paragraph) and
      `FlatWalk.reuse`'s doc ("one `stat` per directory rather than one per entry" is no
      longer true). Verify: `bun run typecheck` passes and the cells of 2.1–2.3 go green.
- [ ] 1.2 `server/src/listing.ts`: `revalidateTree` unions `g.demoted` into `changedDirs`
      (return `demoted` from `gatherFlat` beside `dirMtimes`). Rewrite `revalidateTree`'s doc
      header: "one `stat` per recorded directory and one per recorded entry, a `readdir` only
      where either moved". Verify: cell 2.5 (the sheet drop) goes green and goes red when the
      union is removed.
- [ ] 1.3 Comment sweep for "one `stat` per directory" — `listingCache.ts` (the module header,
      `REVALIDATE_TTL_MS`, `enumerate`, `reload`), `index.ts` (the startup pass comment),
      `app.ts` (`/api/models` and `/api/reload` headers), `listing.ts` (`FlatWalk.reuse`,
      `revalidateTree`). Verify: `grep -a -n "per directory" server/src/*.ts` returns only
      lines that now say "per directory and per entry" or are about something else; note the
      `grep -a` — `app.ts` holds NUL bytes and plain grep prints nothing for it.

## 2. Server cells for the pass (`server/test/listingCache.test.ts`, design D7)

- [ ] 2.1 "picks up a model re-exported over its own name": `primed(f)`, then overwrite
      `a/bracket.stl` with `stlBytes(20)` padded to a **different length** and `utimesSync` it
      to `recorded.mtime + 5000`; `cache.revalidate` returns `true`; the flat listing's entry
      for `a/bracket.stl` has `mtime` and `size` equal to `statSync`'s; `f.store.load(ROOT)`
      holds the same values. **Falsify:** delete the per-entry loop in `levelFor` — red.
- [ ] 2.2 "confirms an unchanged tree with no directory read and stores it byte-identically":
      extend the existing "leaves an unchanged tree unchanged, reading nothing at all" cell
      with a `stat` counter on the mocked `node:fs/promises` (beside `readdirs`/`opens`):
      after the pass, `treeReaddirs(f)` is `[]`, `archiveOpens(f)` is 0, the tree stats count
      equals recorded directories plus recorded file entries (four models + one zip + the
      directories — computed from the snapshot, never a literal), and the stored `entries`
      `toEqual` the loaded ones. **Falsify:** make the loop fall through unconditionally —
      `treeReaddirs` is no longer empty.
- [ ] 2.3 "an overwrite that keeps mtime and size is the documented blindness": overwrite with
      bytes of the **same** length, `utimesSync` the recorded stamp back; `revalidate` returns
      `false` and the entry is unchanged. This cell documents D4; its check that it exercises
      the branch is 2.1's falsification running beside it (change the length here and the
      cell flips).
- [ ] 2.4 "re-reads a directory whose entry vanished inside the mtime granule": record the
      directory's `mtime` with `statSync`, `unlinkSync` the model, `utimesSync` the directory
      back to the recorded stamp; `revalidate` returns `true`; the entry is absent from the
      listing and the snapshot. **Falsify:** treat a rejected `stat` as agreement — red.
- [ ] 2.5 `server/test/layers.test.ts`, a new `describe('an overwrite re-derives the sheet')`:
      `recordPreview` for `/kit/a`, `/kit` and `/kit/z` at `PEEK_DEFAULT`, overwrite
      `/kit/a/bracket.stl` as in 2.1, run `cache.revalidate`; `previewFor('/kit/a')` and
      `previewFor('/kit')` are `undefined`, `previewFor('/kit/z')` is still held.
      **Falsify:** remove 1.2's union — the two stay held.
- [ ] 2.6 "a rewritten archive's own tile carries its new stamp": rewrite `box.zip` with a
      different entry set (size moves), `utimesSync` later; after the pass the container
      entry for `box.zip` in the flat listing and the interior entries agree on the new
      `mtime`. **Falsify:** skip `zip` kinds in the loop — the tile keeps the old stamp while
      the interior is fresh.
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
      variable and the four spellings. An `envName(key)` deriving `MODEL_BROWSER_` +
      SCREAMING_SNAKE from a camelCase key. `loadConfig` applies, after the file and after
      `withRootFromEnv`: `MODEL_BROWSER_LISTING_CACHE` over `listingCache`, and for each of
      `FEATURE_KEYS` its derived variable over `features[key]` (creating `features` when the
      file had none). A module-level assertion that the derived names are disjoint from the
      other `MODEL_BROWSER_*` names this server reads (list them beside it). Verify: cells
      4.3–4.6.
- [ ] 3.3 `server/src/index.ts`: `const snapshots = config.listingCache === false ? undefined :
      new SnapshotStore(undefined, undefined, library)`; `new ListingCache(snapshots)`;
      the startup block skips `snapshots.maintain()` and the revalidation loop when
      `undefined`; print `listing cache: off` beside the `library … at …` line. Verify: with
      a throwaway config file (`MODEL_BROWSER_CONFIG=<tmp>/config.json` carrying
      `{"listen":{"port":3179},"listingCache":false}` and `MODEL_BROWSER_ROOT` at a scratch
      kit) start `bun run --cwd server src/index.ts`, read the `listing cache: off` line,
      `curl -H 'Host: 127.0.0.1' 'http://127.0.0.1:3179/api/dir?flat=true&path=/'` twice
      (neither answer carries `stale`), confirm no `snapshots/` directory appears under
      the cache dir, then stop it. Never touch 3177/5173.
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
      values `1|true|0|false`, anything else stops the server. One sentence on what off
      costs (the cold walk, ~32 s measured on the spinning volume). Verify: the bullet reads
      in the section's voice and `grep -n LISTING_CACHE CLAUDE.md` finds it.

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
      `FEATURE_KEYS.map(envName)` plus `MODEL_BROWSER_LISTING_CACHE` is disjoint from the
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
- [ ] 5.2 Design D2's table: the warm figures are Masa's 2026-09-14 run (one run each); the
      implementer re-runs the same python (task 6.1's script, without the drop-caches step)
      on the same volume and records the second pair beside the first with the date, so
      the number lives where it can be re-run.

## 6. Cold measurement — Masa (design D2, Open Question 2)

- [ ] 6.1 **Masa:** measure cold on each library volume (the ext4 SSD and, when attached, the
      spinning exfat HDD), once per volume, in one sitting — any exploratory command
      re-warms the cache. Save the probe as `scripts/probe-entry-stat.py` beside
      `probe-dir-mtime.py` (so the measurement can be re-run, not re-typed):
      ```
      import os, sys, time
      root = sys.argv[1]; entries = sys.argv[2] == 'entries'
      t = time.perf_counter(); d = f = 0
      for dp, dns, fns in os.walk(root):
          os.stat(dp); d += 1
          if entries:
              for n in fns:
                  try: os.stat(os.path.join(dp, n)); f += 1
                  except OSError: pass
      print(f'{"dirs+entries" if entries else "dirs only"}: {time.perf_counter()-t:.3f} s, {d} dirs, {f} files')
      ```
      Run, with the cache dropped before **each** timing (root needed; `echo 2` suffices
      for dentries and inodes, `3` also drops page cache and is what the memory note uses):
      ```
      sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'; python3 scripts/probe-entry-stat.py "$ROOT" dirs
      sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'; python3 scripts/probe-entry-stat.py "$ROOT" entries
      python3 scripts/probe-entry-stat.py "$ROOT" dirs; python3 scripts/probe-entry-stat.py "$ROOT" entries   # warm, same sitting
      ```
      Record all four numbers per volume, with the volume, filesystem, counts and date, in
      design D2's table and in `REVALIDATE_TTL_MS`'s comment (replacing "~5.6 s measured
      cold"). Then answer Open Question 2: if cold entries on the spinning volume are within
      the same order as cold directories, close it; if they approach the cold walk, open the
      second-cadence follow-up change and say so on the question.
