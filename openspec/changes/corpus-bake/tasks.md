## 1. The bake script

- [ ] 1.1 Lift `findModule`/`findChrome` out of `scripts/encoder-probe.mjs` into
      `scripts/playwright-found.mjs` (one export each, same search: `~/.npm/_npx` for the
      library, `~/.cache/ms-playwright` newest first for the browser); `encoder-probe.mjs`
      imports them. Verify: `node scripts/encoder-probe.mjs` still runs its encoder check
      and prints the same shape of report
- [ ] 1.2 `scripts/bake-demo.ts`, the exported core (Node APIs only): `verifyBake(cacheDir,
      libraryId, models: {path, mtime}[], recipe: {rig, posed, lighting})` returning the
      per-model misses and the posed/unposed counts under design D1 step 7 (both renders
      on disk, both label sets at the model's mtime, `lighting`/`rig` equal, `posed` equal
      and `poseKey` present wherever `posed` is carried); `manifestFor(...)` producing the
      D2 shape; `rsyncCommand(localCache, localId, host, boxDir)` producing the D4 command
      with `--exclude 'snapshots/'`, both trailing slashes and no `--delete`. Cells in
      `server/test/bakeDemo.test.ts` against a fixture cache directory built in a temp
      dir (sidecars written by `ThumbCache.put` itself, so the fixture is the real shape):
      a complete store passes with the right counts; a model missing its `.noao.webp` is
      listed; a `noao` label at another mtime is listed; `rig` behind by one is listed;
      `posed` carried without `poseKey` is listed; zero posed is a refusal; the rsync
      command's exact text. Falsify: drop the `noao` mtime compare → its cell fails
- [ ] 1.3 The driver (Bun): D1 steps 1–6 — the scratch build (`bunx vite build --outDir`,
      never `client/dist`), the scratch config (`hostDetails: true`), the child server
      killed on normal end, throw, `SIGINT` and `SIGTERM`, the port-in-use refusal, the
      `/api/library` ready wait, the index check (`/api/semantic/status?fresh=true`
      `ready` with `collectionRoot === '/'`; wait through `warming`), the complete
      enumeration, and the two headless generate passes with the pill toggled between
      them and the tab reopened per poll. Verify by a dry run over one kit as its own
      library (`--root <kit dir>`, the index started by the user on that kit, or the
      whole corpus with a scoped enumeration) — the run ends with both counts at zero,
      `ps` shows no `server/src/index.ts` on the scratch port afterwards, and a `Ctrl-C`
      mid-pass leaves the port free
- [ ] 1.4 The manifest (step 8) written into `<cache>/<id>/bake/bake.json` after the
      server is stopped; the pose fingerprint from `<--index-cache>/pose-cache.json`.
      Confirm the assumption D6 marks before trusting it: that `pose-cache.json` is where
      mini-classify's `/poses` answers come from (read `serve_api.py`'s pose loading in
      the sibling checkout; record the function name here). Verify: start the bake
      instance's server once more against the scratch cache and check the manifest is
      still there after its startup sweep (the "manifest survives a restart" scenario);
      then a cell in `bakeDemo.test.ts` that runs `new ThumbCache(dir, cap, 1,
      libraryFor(top)).maintain()` over a fixture holding `bake/bake.json` and asserts
      the file survives, beside a control that a stray `bake.json` at the id level is
      removed — the control is what proves the subdirectory is load-bearing
- [ ] 1.5 `--ship <user@host> --ship-dir <box id dir>` (D5): runs the rsync, `ssh <host>
      'cd /opt/model-browser && docker compose -f deploy/demo/compose.yaml restart app'`,
      then the two hit checks of 4.2 against `https://models.masamaeda.com` for the first
      three enumerated models; without the flag, prints the same three commands. Verify:
      without the flag the printed rsync names both ids and excludes `snapshots/`; the
      flag's path is exercised in 4.1

## 2. The pin check

- [ ] 2.1 `deploy/demo/check-bake.sh <manifest> [<pose-cache.json>]` (D2): POSIX sh; the
      two extractions with the exactly-one-line guard; the manifest read with `sed`; the
      `sha256sum` compare when a pose cache is given; exit 0 silent, exit 1 naming each
      disagreement, exit 1 `no bake manifest at <path>`. `server/test/checkBake.test.ts`
      spawns `sh` on the script with fixture manifests in a temp dir: equal → 0 and no
      output; `rig` one ahead → 1 and the line `rig: checkout <n>, bake <n-1>`; a pose
      cache whose hash differs → 1; missing manifest → 1; a copy of `renderer.ts` with the
      constant duplicated, pointed at by an env override the script honours for tests
      only → 1 naming "2 lines". The equal case builds its manifest from `POSE_VERSION`
      imported from `client/src/three/pose.ts` and `RIG_VERSION` from
      `client/src/three/renderer.ts` (a dynamic import; the module creates no renderer at
      load — `renderer` is a `let … = null`), so the extraction is pinned to the live
      constants, never a literal. Falsify: change the pattern's `[0-9]+` to `[0-9]` →
      the equal cell fails once a version reaches two digits; simpler, make the guard
      accept two lines → the duplicated-constant cell fails
- [ ] 2.2 The bake script runs `sh deploy/demo/check-bake.sh <manifest> <pose cache>` as
      its last step (D1 step 9) and fails the bake on a non-zero exit. Verify: a bake run
      with `POSE_VERSION` edited to `3` in the working tree after the build but before
      the check (a contrived tree, restored after) fails at the check naming `posed`
- [ ] 2.3 `deploy/demo/README.md` §6: the redeploy line becomes `git pull && sh
      deploy/demo/check-bake.sh /srv/cache/<id>/bake/bake.json /srv/index/pose-cache.json
      && docker compose … up -d --build`, with two sentences: what the refusal means (the
      build does not start, the stack keeps serving) and what to do (re-bake, §7); the
      rollback paragraph says a rollback across a bump is refused the same way and needs
      that revision's bake. §4's first deploy says why it runs without the check
- [ ] 2.4 `docs/platform-surface.md`: the latent-POSIX-assumptions bullet names the bake
      and the check — `sh`, `grep`, `sed`, `sha256sum`, `rsync`, `ssh`, a Playwright
      Chromium found under `~/.cache/ms-playwright` — as developer-machine and box
      assumptions, Linux only as everything else there is

## 3. The first full bake (live — the coordinator's run)

- [ ] 3.1 Preconditions recorded: the index started by the user with the collection root
      at `clustered-hq` (`serve_api.py ~/Documents/tests/test-models/miniatures/clustered-hq
      --cache-dir embed-cache-test --no-volume --port 8077`), `/api/semantic/status` on the
      bake instance answering `ready` with `collectionRoot: '/'`; the dev instance on 3177
      untouched; the scratch port free. Record the index's `/status` count and cache dir
      beside the library id the bake instance logs
- [ ] 3.2 The run: both passes to `Generate 0 missing thumbnails`, `verifyBake` clean,
      manifest written, `check-bake.sh` passing. **Record here, and in design D-cost**:
      `[SLOT — coordinator's figures: renders per variant, elapsed per variant, renders/s
      per variant, wall time, `du -sh` of the id directory, failures relaunched if any,
      the machine and the Chromium flags, the manifest's commit]`. The dry run of the same
      day for scale: 15 renders at 9.6/s off and 9.2/s on, every sidecar `rig: 7`,
      `posed: 2`, `poseKey` present

## 4. Ship and verify (live)

- [ ] 4.1 Ship: the printed rsync into `/srv/cache/54c0a4e9-d05b-4a53-8aad-e37a8b384422/`
      (the box's id, read from its startup line — re-read it, do not assume), then
      `docker compose -f deploy/demo/compose.yaml restart app` on the box (D3: for the
      startup sweep's index, not for correctness). Record the rsync's transferred bytes
      and file count, and confirm `snapshots/` on the box is unchanged (`ls -la
      --time-style=full-iso` before and after) and that `bake/bake.json` is present
      after the restart
- [ ] 4.2 Hit checks on the live host, for three models including
      `/Player_Character_Pack_03_3750572/CatfolkRogue.stl` with its recorded mtime:
      `GET /api/thumb?path=<model>&mtime=<mtime>` and the same with `&ao=off` appended
      (absent means the occluded render — `ApiClient.getThumb` and `thumbImageUrl` append
      `&ao=off` only when the preference is off; read 2026-09-14) both answer `status: 'hit'` with `rig: 7`, `posed: 2` and a `poseKey`; `GET
      /api/thumb/image?…` answers `image/webp` with the immutable cache header for both.
      Record the three paths and the answers here
- [ ] 4.3 First-visit measurement, headless Chromium as a visitor from this machine
      (browser cache cold): the root, then one kit. Count, per screen: `/api/thumb/image`
      responses (200), `/api/thumb` lookups, `PUT /api/thumb` attempts (must be 0), and
      tiles whose `img` `src` is a `blob:` URL (a client render — must be 0) against
      tiles whose `src` names `/api/thumb/image` (must be all). Do it under both pill
      states. Record the counts, the settle time and the bytes beside the notes' 2026-09-05
      figures (114 tiles, 9.62 MB PNG; 0.57 MB projected at 5 KB WebP) — same tab, no
      DOM-mutating probe before the measurement (CLAUDE.md)

## 5. Records

- [ ] 5.1 `deploy/demo/README.md` §7 rewritten around the script: the command with its
      arguments, the index precondition (root at `clustered-hq`, `--no-volume`), what
      ships and what does not (D4), the restart and why (D3), the manifest's location and
      why it is in `bake/`, the re-bake triggers (D6), and the pin as the check §6 now
      runs; §3.2's ordering sentence points at §7. The old two-bullet pin text goes
- [ ] 5.2 `openspec/changes/web-demo-backlog/tasks.md` 1.7 ticked with the run's figures
      and this change's name; `docs/web-demo-notes.md`: the "Not yet baked" sentence at
      the top and item 8's "bake both" line updated with the date, the figures from 3.2
      and 4.3, and a pointer to this change; the Decided table's bake row, if it has one,
      names the manifest and the check
- [ ] 5.3 CLAUDE.md, only if the bake changes a rule a session needs: a line under
      Testing's cache bullet that `bake/` under the id directory is the manifest's home
      and the sweeps delete a `*.json` at either level — otherwise nothing

## 6. Gate

- [ ] 6.1 `bun run typecheck` and both suites green; `bakeDemo.test.ts` and
      `checkBake.test.ts` falsified as their tasks say
- [ ] 6.2 `openspec validate corpus-bake --strict` passes; archive dry run on a fresh
      copy (`T=$(mktemp -d); cp -r openspec $T/; (cd $T && openspec archive corpus-bake
      --yes)`); the applied `deployment-infrastructure` text read once for change-scoped
      prose
