## 1. The bake script

- [ ] 1.1 Lift `findModule`/`findChrome` out of `scripts/encoder-probe.mjs` into
      `scripts/playwright-found.mjs` (one export each, same search: `~/.npm/_npx` for the
      library, `~/.cache/ms-playwright` newest first for the browser); `encoder-probe.mjs`
      imports them. Verify: `node scripts/encoder-probe.mjs` still runs its encoder check
      and prints the same shape of report
- [ ] 1.2 `scripts/bake-demo.ts`, the exported core (Node APIs only): `verifyBake(cacheDir,
      libraryId, models: {path, mtime}[], recipe: {rig, poseVersion, lighting})` returning
      the per-model misses, the posed/unposed counts and the list of unlabelled paths
      under design D1 step 7 (both renders on disk, both label sets at the model's mtime,
      `lighting`/`rig` equal, `posed` equal and `poseKey` present wherever `posed` is
      carried); `auditUnposed(unlabelled: string[], answer: Record<string, IndexPose |
      null>)` returning the paths absent from the answer and the paths answered with a
      pose (D1 step 8's judgement, separated from the fetch so it is testable);
      `manifestFor(...)` producing the D2 shape and serialising it as
      `JSON.stringify(m, null, 2)` — the writer's formatting is what the check reads, so
      the serialisation is the core's, not the driver's; `rsyncCommand(localCache,
      localId, host, boxDir)` producing the D4 command with `--exclude 'snapshots/'`,
      both trailing slashes and no `--delete`. Cells in `server/test/bakeDemo.test.ts`
      against a fixture cache directory built in a temp dir (sidecars written by
      `ThumbCache.put` itself, so the fixture is the real shape): a complete store passes
      with the right counts and lists its unlabelled paths; a model missing its
      `.noao.webp` is listed; a `noao` label at another mtime is listed; `rig` behind by
      one is listed; `posed` carried without `poseKey` is listed; zero posed is a refusal;
      the rsync command's exact text; the manifest's text is byte-equal to
      `JSON.stringify(manifestFor(...), null, 2)` and carries `recipe.poseVersion`,
      `posedModels`, `unposedModels`, `index.poseCacheSha256`, `index.runParamsSha256`
      (no key named `posed`, no key named `sha256`). Falsify: drop the `noao` mtime
      compare → its cell fails
- [ ] 1.3 The driver (Bun): D1 steps 1–6 — the scratch build (`bunx vite build --outDir`,
      never `client/dist`), the scratch config (`hostDetails: true`), the child server
      killed on normal end, throw, `SIGINT` and `SIGTERM`, the port-in-use refusal, the
      `/api/library` ready wait, the index check through the bake instance
      (`/api/semantic/status?fresh=true` `ready` with `collectionRoot === '/'`; wait
      through `warming`) **and directly** (the index's `/status` at `MODEL_BROWSER_INDEX`,
      default `http://127.0.0.1:8077`: `ready: true`, `cache_dir` naming `--index-cache`
      by the D1 step 4 compare — absolute equals realpath, relative equals its basename —
      and `views`, `elevations`, `up_axis`, `n_models` kept for the manifest), the
      complete enumeration, and the two headless generate passes. Per pass the stopping
      rule is D1 step 6's: the chip (`role="status"`) has settled — no Cancel button,
      `BulkJobs.run`'s last patch — the button reads `Generate 0 missing thumbnails`,
      **and** a relaunch settles at `Generated 0 of 0 in the library`; only then is the
      `ssao` pill toggled and the tab reopened for the other variant, because
      `renderEntryThumbnail` reads `aoEnabled()` live and an entry in flight at the
      toggle would be filed under the new variant. Verify by a dry run over one kit as
      its own library (`--root <kit dir>`, the index started by the user on that kit, or
      the whole corpus with a scoped enumeration) — the run ends with both passes at
      `Generated 0 of 0`, `ps` shows no `server/src/index.ts` on the scratch port
      afterwards, and a `Ctrl-C` mid-pass leaves the port free. Verify the settle wait
      by contriving its absence once: toggle the pill by hand while a pass's chip still
      offers Cancel and confirm the next count for the *first* variant is non-zero — the
      bug the wait exists to close; restore the wait and confirm it reads zero
- [ ] 1.4 The manifest (D1 step 9) written into `<cache>/<id>/bake/bake.json` after the
      server is stopped; the fingerprint is the SHA-256 of `<--index-cache>/pose-cache.json`
      **and** of `<--index-cache>/run-params.json`, each under its own key
      (`index.poseCacheSha256`, `index.runParamsSha256`). The assumption D6 carried
      (that `pose-cache.json` alone is where `/poses` answers come from) was read against
      mini-classify's source on 2026-09-15 and is half right — record here, from the
      sibling checkout: `Collection.pose_of` (`src/collection.py`) takes the entry from
      `self.poses` (`load_pose_cache` over `pose-cache.json`) and derives `front` through
      `pose.front_view(entry, self.view_cfg)`, with `view_cfg = view_config(args)`
      (`src/cachedir.py`) keyed on `views`/`elevations`, which `apply_run_params` reads
      from `run-params.json` in `--cache-dir`; the client's `poseKeyFor` keys the render
      by that `front`. Re-read those symbols when implementing; if they have moved, fix
      this line and D6. Verify: start the bake instance's server once more against the
      scratch cache and check the manifest is still there after its startup sweep (the
      "manifest survives a restart" scenario); then a cell in `bakeDemo.test.ts` that
      runs `new ThumbCache(dir, cap, 1, libraryFor(top)).maintain()` over a fixture
      holding `bake/bake.json` beside two real sidecars and asserts the file survives and
      both sidecars are `annotate`d afterwards. **The control** (what proves the
      subdirectory is load-bearing) asserts what a flat manifest does, which is not
      deletion: with 1.7's guard **absent** (the cell is written against today's code
      first), a `bake.json` at the id level makes `maintain()` reject with a `TypeError`
      and leaves a sidecar listed after it un-`annotate`d; with the guard landed the
      control becomes: the file survives, `maintain()` resolves, one warning names it,
      and every sidecar is annotated — 1.7's cell. Never assert that a flat manifest is
      removed at the id level; it is not (design Context, second bullet)
- [ ] 1.5 `--ship <user@host> --ship-dir <box id dir>` (D5): runs the rsync, `ssh <host>
      'cd /opt/model-browser && docker compose -f deploy/demo/compose.yaml restart app'`,
      then the two hit checks of 4.2 against `https://models.masamaeda.com` for the first
      three enumerated models; without the flag, prints the same three commands. Verify:
      without the flag the printed rsync names both ids and excludes `snapshots/`; the
      flag's path is exercised in 4.1
- [ ] 1.6 The pose audit (D1 step 8), after both passes and `verifyBake`: every
      unlabelled path POSTed to the bake instance's `/api/semantic/poses` in batches of at
      most `POSES_MAX` (imported from `shared/types.ts`, 1024), `/api/semantic/status?fresh=true`
      read `ready` before the first batch and after the last (a `null` filed under an
      `absent`/`wedged`/`volume-gone` memo is not the absence the audit wants — the route
      files `null` for those too), a failed batch retried once, and `auditUnposed` over
      the merged answer: any path absent from the answer, or answering a pose, refuses
      the bake with the list printed and no manifest written. Cells in
      `bakeDemo.test.ts` over `auditUnposed`: an answer with every path present-and-`null`
      → empty lists; one path absent → it is named as unsettled; one path carrying a pose
      → it is named as should-have-been-posed; and a driver-level cell with a fake
      `fetch` that a batch of 1,500 paths goes out as two POSTs of 1,024 and 476 and
      the two answers merge. Falsify: make `auditUnposed` read `answer[p] === undefined`
      as settled (the `??`/`!==` confusion `enumerate`'s comment warns about) → the
      absent-path cell fails
- [ ] 1.7 The guard in `maintain` (`server/src/cache.ts`, design D2): in the loop over
      the id directory's `*.json`, a parsed object whose `path` is not a string is
      skipped with one `console.warn` naming the file, before `sourceExists` is asked and
      before it can join the cap pass. Cell in `server/test/cache.test.ts`, beside its
      existing `maintain()` cells: a fixture id
      directory holding a real sidecar, then a `bake.json` with no `path`, then another
      real sidecar (names chosen so the stranger lists between them under Node's sorted
      `readdir` — and assert nothing about order beyond that both sidecars end up
      annotated); `maintain()` resolves, both sidecars answer `annotate`, the stranger is
      still on disk, and the warning was emitted once. Falsify: remove the guard → the
      cell fails with the `TypeError` from `library.resolve` and the second sidecar is
      not annotated — restore the bug verbatim before trusting the green (memory:
      *Falsify the mutation too*). `sweepLegacy` and `migrate` need no guard
      (`parseVPathSafe(undefined)` is null there and the file is removed, the flat
      directory's rule); say so in the guard's comment

## 2. The pin check

- [ ] 2.1 `deploy/demo/check-bake.sh <manifest> [<index dir>]` (D2): POSIX sh; the two
      source extractions with the exactly-one-line guard; the four manifest reads by
      line (`"rig"`, `"poseVersion"`, `"poseCacheSha256"`, `"runParamsSha256"`) with the
      same exactly-one-line guard; the two `sha256sum` compares when an index directory
      is given (a missing file there is a disagreement); exit 0 silent, exit 1 naming each
      disagreement, exit 1 `no bake manifest at <path>`. `server/test/checkBake.test.ts`
      spawns `sh` on the script with manifests **produced by `manifestFor`** in a temp dir
      — never hand-written JSON, so a fixture cannot drift from the writer's formatting:
      equal → 0 and no output; `rig` one ahead → 1 and the line `rig: checkout <n>, bake
      <n-1>`; **the commit line** — a manifest whose `client.commit` differs from `git
      rev-parse HEAD` prints `commit: checkout <a>, bake <b>` and still **exits 0**; one
      whose commit equals it prints nothing; one with no `client.commit`, and a run where
      `git rev-parse HEAD` fails, print nothing and exit 0 (the only reporting line in the
      script — it never moves the exit code, D2); a pose cache whose hash differs → 1; a `run-params.json` whose hash differs
      → 1 naming it; an index directory missing one of the two → 1; missing manifest → 1;
      a copy of `renderer.ts` with the constant duplicated, pointed at by an env override
      the script honours for tests only → 1 naming "2 lines"; a manifest re-serialised
      onto one line → 1 naming the manifest read that matched 0 lines. The server cells
      obtain `<n>` the way the script does — the same pattern over the same source file
      — never by importing `renderer.ts`, which imports `three` and lives in the client
      workspace only (design Context). **The equal case that pins the extraction to the
      live constants is the client suite's**, `client/test/checkBake.test.ts`: it imports
      `POSE_VERSION` from `client/src/three/pose.ts` and `RIG_VERSION` from
      `client/src/three/renderer.ts` (a dynamic import; the module creates no renderer at
      load — `renderer` is a `let … = null`), builds the manifest through `manifestFor`
      with them, and spawns the script → 0, so the extraction is pinned to the live
      constants, never a literal. Falsify: change the pattern's `[0-9]+` to `[0-9]` → the
      client cell fails once a version reaches two digits; simpler, make the guard accept
      two lines → the duplicated-constant cell fails; make the manifest read a plain
      `grep` without the guard → the one-line-manifest cell fails
- [ ] 2.2 The bake script runs `sh deploy/demo/check-bake.sh <manifest> <--index-cache>`
      as its last step (D1 step 10) and fails the bake on a non-zero exit. Verify: a bake
      run with `POSE_VERSION` edited to `3` in the working tree after the build but before
      the check (a contrived tree, restored after) fails at the check naming `poseVersion`
- [ ] 2.3 `deploy/demo/README.md` §6: the redeploy line becomes `git pull && sh
      deploy/demo/check-bake.sh /srv/cache/<id>/bake/bake.json /srv/index && docker
      compose … up -d --build`, with two sentences: what the refusal means (the build
      does not start, the stack keeps serving) and what to do (re-bake, §7); **the
      rollback line carries the same check** — `git checkout <rev> && sh
      deploy/demo/check-bake.sh … && docker compose … up -d --build` — and the rollback
      paragraph says a rollback across a bump is refused the same way and needs that
      revision's bake. §4's first deploy says why it runs without the check
- [ ] 2.4 `docs/platform-surface.md`: the latent-POSIX-assumptions bullet names the bake
      and the check — `sh`, `grep`, `sed`, `sha256sum`, `rsync`, `ssh`, a Playwright
      Chromium found under `~/.cache/ms-playwright` — as developer-machine and box
      assumptions, Linux only as everything else there is

## 3. The first full bake (live — the coordinator's run)

- [ ] 3.1 Preconditions recorded: the index started with the collection root at
      **`decimated`**, the tree the demo ships (`cd ~/Documents/tests/mini-classify &&
      .venv/bin/python serve_api.py ~/Documents/tests/test-models/miniatures/decimated
      --cache-dir embed-cache-test --no-volume --port 8077`) — 8077 held a *different*
      index until 2026-09-15 (`embed-cache512` rooted at `/run/media/masa/STLLibrary`,
      stopped by the user), so read what answers there before starting anything;
      `/api/semantic/status` on the bake instance answering `ready` with
      `collectionRoot: '/'`, the index's own `/status` answering
      `cache_dir: embed-cache-test` with its `views`, `elevations`, `up_axis` and
      `n_models` (record them here — they go into the manifest). **Expect
      `n_models: 2976`** — the 2,976 of 3,121 pose entries with an `.npy` under these run
      parameters, a property of the cache and not of the tree (design Context, *The
      index*); anything else stops the line before a render is drawn. The dev instance on
      3177 untouched; the scratch port free. Record the index's `/status` count and cache
      dir beside the library id the bake instance logs — that id does **not** exist yet
      (`decimated/` carries no `.model-browser/`, so the bake mints it on first start;
      `5358d071-…` is `clustered-hq`'s, not it)
- [ ] 3.2 The run: both passes settled at `Generated 0 of 0`, `verifyBake` clean, the
      pose audit passing (every unlabelled path present-and-`null` — record the count
      here; the pre-script run's 145 per variant passed it by hand, D-cost), manifest
      written, `check-bake.sh` passing. **Record here, and in design D-cost**:
      *(pre-script run on `clustered-hq`, recorded in design D-cost, 2026-09-14 and
      superseded — the scale, not a reproduction target: 3,106 + 3,106 PUTs, 361 s +
      442 s, 8.6 and 7.0 renders/s, zero failures, 3,121 sidecars / 6,242 WebP / 32.3 MB
      of images, 33 MB with sidecars by bytes, 56 MB by `du`; 2,976 posed and keyed per
      variant, 145 settled-null unlabelled — asked of `/poses` directly, all `null`; the
      baked directory is kept at `~/.cache/model-browser-bake/2026-09-14/cache/<local id>/`, with the ad-hoc driver (`bake.mjs`, `dryrun.mjs`), its config and its log beside it, until the script's own run reproduces it and ships; the driver is the script's precedent, not its shape)* The dry run of the same day for scale: 15 renders at 9.6/s off and
      9.2/s on, every sidecar `rig: 7`, `posed: 2`, `poseKey` present. **What must
      reproduce is structural, not the rate**: 3,121 sidecars, 6,242 WebP, both passes
      settled at `Generated 0 of 0`, every sidecar `rig: 7` and `lighting: camera`, 2,976
      posed with a `poseKey` and 145 settled-null per variant, zero failures. The rates
      will differ — decimated's meshes are the larger of the two trees on this corpus and
      mesh load shares the render queue

## 4. Ship and verify (live)

- [ ] 4.1 Ship: the printed rsync into `/srv/cache/<box id>/`, the id read from the box's
      startup line `library <id> at /library/miniatures/decimated` — **it is a new id**:
      the box mints its own marker under the decimated root (the operator's call,
      2026-09-15), so `54c0a4e9-d05b-4a53-8aad-e37a8b384422` is the clustered-hq era's and
      its directory is left behind. Before the rsync, `stat` three shipped models inside
      the app container and confirm each mtime equals this machine's decimated copy to the
      nanosecond (`Player_Character_Pack_03_3750572/CatfolkRogue.stl` is 2026-09-15
      04:26:15.358908391 UTC, 2,500,084 bytes) — a mismatch means the box still serves
      other bytes and every shipped sidecar would read `stale`, which no visitor can heal.
      Then
      `ssh <host> 'cd /opt/model-browser && docker compose -f deploy/demo/compose.yaml
      restart app'` (D3: for the startup sweep's index, not for correctness). Record the
      rsync's transferred bytes and file count (expect ~34 MB and 9,364 files: 3,121 +
      6,242 + the manifest), and confirm `snapshots/` under the target id is unchanged (`ls -la
      --time-style=full-iso` before and after; under a freshly minted id it holds only
      what the box has written since its first start there — record which) and that `bake/bake.json` is present after
      the restart, and that the container's log after the restart carries no `maintain`
      warning (1.7's guard found no stranger)
- [ ] 4.2 Hit checks on the live host, for three models including
      `/Player_Character_Pack_03_3750572/CatfolkRogue.stl` with its recorded mtime:
      `GET /api/thumb?path=<model>&mtime=<mtime>` and the same with `&ao=off` appended
      (absent means the occluded render — `ApiClient.getThumb` and `thumbImageUrl` append
      `&ao=off` only when the preference is off; read 2026-09-14) both answer `status: 'hit'` with `rig: 7`, `posed: 2` and a `poseKey`; `GET
      /api/thumb/image?…` answers `image/webp` with the immutable cache header for both.
      Record the three paths and the answers here
- [ ] 4.3 First-visit measurement, headless Chromium as a visitor from this machine
      (browser cache cold), **after the restart's startup sweep has finished** (D3: the
      sweep is `void`ed; give it a minute, or watch the log, before the first visit): the
      root, then one kit. Count, per screen: `/api/thumb/image` responses (200, must be
      every tile); `/api/thumb` JSON lookups (must be 0 — every tile annotated `hit` by
      the warm memo); `/api/file` fetches (the mesh route, `ApiClient.fetchModel` — must
      be 0: no client render loads a mesh); `renderThumbnail` calls (0 — count them by a
      page-installed hook, `page.exposeFunction` or a wrapper on the module's export in
      the main world, or by the absence of `/api/file` bytes, which is the same fact from
      the network side). A tile whose `img` `src` is a `blob:` URL is **not** a tell: a
      lookup hit is minted as `blob:` too (`ApiClient.getThumb` → `base64ToBlobUrl`), so
      a blob count condemns a correct bake whose memo was cold; and `PUT /api/thumb` is
      not a tell either (writes are refused on the box whatever the client tries). Do it
      under both pill states. Record the counts, the settle time and the bytes beside the
      notes' 2026-09-05 figures (114 tiles, 9.62 MB PNG; 0.57 MB projected at 5 KB WebP)
      — same tab, no DOM-mutating probe before the measurement (CLAUDE.md)

## 5. Records

- [ ] 5.1 `deploy/demo/README.md` §7 rewritten around the script: the command with its
      arguments, the index precondition (root at `decimated`, `--no-volume`, the
      `cache_dir` the script cross-checks), what ships and what does not (D4), the
      restart and why (D3), the manifest's location and why it is in `bake/` (and what a
      flat one does to the sweep, now a warning), the re-bake triggers (D6, both index
      files), and the pin as the check §6 now runs on both its lines; §3.2's ordering
      sentence points at §7. The old two-bullet pin text goes
- [ ] 5.2 `openspec/changes/web-demo-backlog/tasks.md` 1.7 ticked with the run's figures
      and this change's name; `docs/web-demo-notes.md`: the "Not yet baked" sentence at
      the top and item 8's "bake both" line updated with the date, the figures from 3.2
      and 4.3, and a pointer to this change; the Decided table's bake row, if it has one,
      names the manifest and the check
- [ ] 5.3 CLAUDE.md, under Testing's cache bullet: `bake/` under the id directory is the
      manifest's home; a `*.json` at the cache top is removed by the legacy sweep, and one
      at the id level with no `path` is skipped with a warning since 1.7 (before it, the
      startup sweep threw on it silently and left every later sidecar unremembered)

## 6. Gate

- [ ] 6.1 `bun run typecheck` and both suites green; `bakeDemo.test.ts`,
      `checkBake.test.ts` (both suites) and 1.7's cell falsified as their tasks say
- [ ] 6.2 `openspec validate corpus-bake --strict` passes; archive dry run on a fresh
      copy (`T=$(mktemp -d); cp -r openspec $T/; (cd $T && openspec archive corpus-bake
      --yes)`); the applied `deployment-infrastructure` and `model-thumbnails` text read
      once for change-scoped prose
