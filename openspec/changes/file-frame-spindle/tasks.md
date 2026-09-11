## 0. Before the old code goes

- [x] 0.1 Capture the L-bracket OBJ's C0 frames at spindles `y` and `z` as single lossless
      PNGs from the spike worktree (`agent-af1bc1b75df6032ae`, commit `f3442dd`; its
      `out/` holds them only inside contact sheets), beside the eleven STL `*_C0.png`
      there (522,728 bytes), into `scripts/frame-ab/baseline/` with the spike's
      `results.json` as the record of the run. After 1.3 lands, C0 cannot be regenerated
      *(2026-09-10: done in the spike worktree, commit `621e333` — `spike/frame-ab/baseline/`,
      15 files, 574,622 bytes; STL subtotal 522,728 as recorded. The OBJ frames differ
      from the committed contact sheets by 1,860 / 2,969 px (max 15 / 18): the AO pass's
      noise is unseeded per process (`GTAOPass` → `SimplexNoise` → `Math.random`), so
      AO-on renders are not bit-exact across processes; AO-off renders are 0/0 across
      three processes. Recorded in D6; the tolerance widened to 5 % with the `-noao`
      frames carrying the tight check. Follow-up before 1.3 merges: capture
      `OBJ_axis_{y,z}-noao_C0.png` too. 4.1 moves the set to `scripts/frame-ab/baseline/`)*
- [x] 0.2 **Masa, before any of §1–§3 lands** (Migration Plan step 2): `features.thumbWrites:
      false` in `~/.config/model-browser/config.json`, `rm -rf client/dist`, restart the dev
      instance (other sessions may own it — say so in the session), no other browser on
      3177. From here until 5.2 restores it, nothing can write a sidecar
      *(INCIDENT 2026-09-10: not in force when §1–§2 merged. The dev instance is
      `bun --watch` over the primary checkout, so it ran each merge live. Three code
      windows hit the primary cache (`97ecc020`): label landed 16:43:57 (e3072cb) → bake
      removed 16:48:57 (3736fa8): 3 framed sidecars stamped `frame: 2` over SCENE axes
      (y, y, −y, all with cameras — genuine orbits on a correctly displayed model, wrongly
      labelled; the script would skip them forever) + 33 renders (correct); bake removed →
      default fixed 17:01:53 (e4b9d91): 27 sidecars (24 orbits, 1 axis-only, 2 discards,
      all labelled) + 178 renders, every un-framed STL drawn lying down about the `y`
      fallback and cached as a hit; after 17:01:53: nothing. The other three caches: nothing.
      Ordering constraint the tasks never stated: 2.1 before 1.3 mislabels scene axes, 1.3
      before 2.1 (or 1.3 before 1.4) caches lying-down renders — 0.2 is what makes either
      order safe, and it must precede the FIRST merge, not the test window. Recovery:
      moot — Masa deleted every cache directory on 2026-09-11 during the test window
      ("no need for migration any more"); the 106 framed entries went with them)*
      *(2026-09-10 17:59: done — `features.thumbWrites: false` in the config, dev instance
      restarted at 17:59:51, `/api/features` answers `thumbWrites: false`; `client/dist`
      (a 2026-09-07 pre-change bundle 3177 was serving) removed by the coordinator at
      ~17:50. Both guards in force from here)*

## 1. Frames and defaults

- [x] 1.1 `FRAMES` becomes the D3 table. The derivation lives once, in `shared/frames.ts`
      (below): the pre-bake triples, `unbake(x,y,z) = (x, −z, y)`, the re-key by the
      spindle vector's axis; `three/camera.ts` only lifts the shared triples into
      `Vector3`s. The six entries asserted in a unit cell against the design's table; `defaultAxisFor(format: ModelFormat)` (D2) —
      an argument that is `null` or `undefined` is a type error, not a default — and
      `formatOfEntry(entry)` in `three/models.ts` (`entry.format ?? formatOf(entry.path)`,
      throwing with the path when neither classifies; cell: a model entry without
      `format` resolves from its path, a `.txt` throws);
      `shared/frames.ts` (new, no `three` import — D5): the six frames as plain triples,
      `unbake`, the re-key, `migrateAxis` and `swapOffset` as plain arithmetic;
      `camera.ts` builds its `Vector3` `FRAMES` from it. `statePosition`, `applyState`
      and `captureState` lose their `= 'y'` defaults and take `axis` as required, as do
      `renderThumbnail` (`renderer.ts`) and `ViewerSession`'s constructor (`session.ts`)
      — they hold an `Object3D`, not an entry (D2). Existing cell adjusted:
      `camera.test.ts` "the default axis reproduces the historical world-Y
      representation" → the `y` frame is unchanged, asserted as such.
      Cells: the six entries; `a × b = −s` on all six; `migrateAxis`'s six pairs;
      `swapOffset`'s six values in degrees with the sign checked against `captureState`
      (a direction vector round-trips through old frame → offset → new frame); a camera
      round-trip about every spindle still exact
- [x] 1.2 `three/pose.ts`: delete `toSceneSpace`; `axisOf` matches the file vector;
      `cameraForPose` unchanged otherwise; `POSE_VERSION` stays 2 and its comment says
      why ("2 = poses carried into scene space" is no longer the meaning — the mapping is
      gone and the pictures are the same, D4). Cells: `up [0,0,1]` → `z`, `[0,1,0]` → `y`,
      `[0,0,-1]` → `-z`; the seven posed root samples' (axis, az, el) from the spike's
      table reproduced (Benchy `z` 90° 20°, bod_test_cube `-x` 405° 20°, …) — falsify by
      restoring `toSceneSpace`. Existing cells adjusted: `pose.test.ts` "maps a file up
      axis to the spindle it becomes in the scene" (now: is the spindle) and "keeps the
      model upright: camera up is the model up, in scene space" (now: in file space)
- [x] 1.3 `three/models.ts`: the STL bake removed; the comment about 3MF corrected (the
      loader rotates nothing; the format is Z-up by specification, which is why its default
      is `z`). Cell: an STL fixture's bounding box after parse equals its file's.
      `client/test/stlNormals.test.ts`'s "a healthy file is unchanged" cell asserts the
      stored field carried through the rotation — rewritten to assert the field verbatim
      (semantics-is-the-point, named in the report)
      *(2026-09-10: 1.1–1.3 merged as 3736fa8 (fable worker): `shared/frames.ts` derives
      `FILE_FRAMES` from `SCENE_FRAMES` under R⁻¹, `migrateAxis`, `swapOffset`,
      `defaultAxisFor`; `ModelFormat` moved to shared/types; `formatOfEntry` throws on an
      unclassifiable path. Falsified: `toSceneSpace` restored → 6 pose cells; a/b swapped in
      two FILE_FRAMES rows → the D3-table cell, a×b, both swapOffset cells; rotateX restored →
      the bbox cell and stlNormals. 40 cells across the five files; typecheck clean)*
- [x] 1.4 The remaining eleven of the sixteen `'y'` fallbacks replaced by
      `defaultAxisFor(formatOfEntry(entry))` (five became required in 1.1) — `ViewerLayer`
      ×5: the `sessionAxis` state seed (`useState<OrbitAxis>('y')` → the entry's default),
      `savedPromise`'s resolved branch, its `.then`, its `.catch`, `liveFramingView`'s
      `s?.axis ?? axis ?? 'y'`; `useThumbnails`' render site; `bulkJobs`' discard;
      `entryActions` ×4 (the `framingAfterDiscard` callers and `DEFAULT_ORBIT_AXIS`,
      retired — `App`'s tile-menu consumer `thumbs.get(path)?.axis ?? DEFAULT_ORBIT_AXIS`
      takes the entry's format). Callers of `renderThumbnail` and `ViewerSession` pass the
      axis they already resolved. Doc comments that would read false after: `OrbitAxis`
      ("Default 'y'"), `CameraState` in shared/types ("Under the default 'y' spindle…"),
      `Meta.axis` in cache.ts ("undefined reads as 'y'"). Existing cells that assert `'y'`
      for an STL are adjusted to `'z'` — each named in the report. New cells: an un-framed
      STL opens at `z` and the lightbox marks Z; an un-framed OBJ opens at `y`; the tile
      menu's axis group marks the same letter as the lightbox for each; a `+Y`-posed STL
      marks Y with no flip (issue #8's cross-check)

## 2. The stores

      *(2026-09-10: merged as e4b9d91 (fable worker). Sixteen sites; five made required,
      eleven take `defaultAxisFor(formatOfEntry(entry))`; `DEFAULT_ORBIT_AXIS` deleted;
      `ThumbResult.axis`'s "(read as 'y')" comment fixed too. Nine existing cells moved to
      file-frame answers (the four named plus orbitAxisMenu ×2, openInApps ×2, thumbnailQueue
      ×3 — all "un-framed STL is y" → z); five test-file callers pass `'y'` explicitly where
      the axis is immaterial. New: STL lightbox marks Z, OBJ marks Y, the menu agrees, a +Y
      pose marks Y with no flip (issue #8). Falsified: `axisOf` [0,1,0]→'-z' fails the posed
      cells; `defaultAxisFor` always 'y' fails 8, always 'z' fails the OBJ cells. Merged main:
      client 952/952, server 754/754, typecheck clean; `grep "'y'" client/src` is the letter
      list and the frame tables only)*
- [x] 2.1 Server `cache.ts`: `frame?: number` on `Meta`; `put` stamps `frame: 2` only when
      the write carries a `camera` or `axis` (a discard, `null`, counts), and carries
      `prev.frame` otherwise — in both hand-built sidecars, the main write and the
      `png === null` deletion branch (the size-cap write-back and the re-key spread the
      previous meta). Not on the wire: `ThumbGetResponse` is unchanged. Cells: a framing
      write stamps it; a discard stamps it; a pixels-only write on an unlabelled framed
      entry preserves both the axis and the absence of the label (falsify: stamp on every
      write → fails); a pixels-only write on a labelled entry keeps the label; the
      deletion branch keeps it (falsify: drop it from that branch → fails); an old
      sidecar without it reads as before
      *(2026-09-10: merged as e3072cb (fable worker); `FRAME_CONVENTION` moved to
      shared/frames.ts by 2.3 with a re-export from cache.ts. Seven cells; falsified: stamp on
      every write → the pixels-only cell (`expected true to be false` on `'frame' in sidecar`);
      drop it from the deletion branch → `expected undefined to be 2`)*
      *(removed 2026-09-11 — Masa: unreleased, no data to migrate; the merged code was
      reverted in this commit)*
- [x] 2.2 `scripts/migrate-frames.ts --cache-dir <dir> [--undo]` (D5), the shape of
      `gen-overrides.ts`: named flags with an unknown-flag refusal, an exported core
      `migrateFrames(options): Promise<MigrateResult>` with an injected `report` and a
      structured count object, a `pathToFileURL(process.argv[1])` main guard so
      `server/test` imports the core. It walks sidecars, applies `migrateAxis` /
      `swapOffset` by `formatOf(path)`, stamps `frame: 2`, writes with plain `writeFile`
      like `writeMeta`, leaves render files alone, writes the marker `.frame-migration`
      (no `.json` — the sweeps would delete it, D5), reports the seven counts; an
      unclassifiable path is
      reported and untouched; refuses when the marker exists and a framed sidecar is
      unlabelled with a file mtime newer than the marker's `at` (a rolled-back server,
      Risks), naming the sidecars and the copied-without-mtimes case. Cells (server/test,
      over a temp cache dir built the way `cache.test.ts`'s `tempCache()` does, with a
      small sidecar-fixture helper in the test file): an STL `y` + camera → `z`, camera untouched, render files
      untouched; an STL `-z` → `y`; an STL camera with no axis → label only, axis still
      absent (falsify: default a missing axis to `y` → fails); an OBJ `z` + camera → `z`,
      az + 90°; an OBJ at `y` untouched; a labelled entry untouched and counted; `--undo`
      inverts, clears the label and removes the marker; a sidecar with neither axis nor
      camera is skipped and not labelled; a second run reports zero changes; an unlabelled
      framed sidecar touched after the marker → the run refuses (falsify: drop the mtime
      test → it relabels `z` to `-y`). Falsify: swap two rows of `migrateAxis` → the STL
      cells fail
      *(2026-09-10: merged as 87d4a08 (fable worker). Format from listing.ts's exported
      `modelFormat` (the `MODEL_EXT` wrapper); inverse axis by search over `migrateAxis`;
      `--undo` never refuses; refusal reads everything before writing anything. 14 cells;
      falsified: default a missing axis to 'y' → the camera-only cell; drop the mtime test →
      the refusal cell resolves with `relabelled: 1` (the rolled-back `z` turned to `-y`);
      swap two SCENE_FRAMES bodies → cells 1/2. Also run under Bun on a scratch dir: forward,
      undo byte-identical, bad flags exit 1)*
      *(removed 2026-09-11 — Masa: unreleased, no data to migrate; the merged code was
      reverted in this commit)*
- [x] 2.3 `api/localFramings.ts`: `LocalFraming` gains `frame`; `readLocalFraming`
      transforms an unlabelled entry (format from the path — a zip entry's path ends in
      the model's extension) at the store boundary, never inside a React updater
      (`useThumbnails`' updater rule), and writes it back labelled; `writeLocalFraming`
      carries the label. Cells: the same shapes as 2.2 through the read path; a framing
      write after a migrated read keeps the label and a re-read does not migrate again
      (falsify: drop `frame` from the write → fails); a read under a storage that refuses
      writes still serves the transformed framing; two reads in one tick agree

## 3. The compare pill (temporary — D7; deleted in 5.2)

      *(2026-09-10: merged as fdbe141 (fable worker). The transform lives in
      `toFileConvention` at the store boundary; OBJ offset applied uniformly since
      `swapOffset` is 0 at y/−y by derivation. The named test file did not exist — created;
      three assertions in apiClient.test.ts gained the label. 11 cells; falsified: drop
      `frame` from the write → the re-read migrates z→−y; skip the transform → 8 fail)*
      *(removed 2026-09-11 — Masa: unreleased, no data to migrate; the merged code was
      reverted in this commit)*
- [x] 3.1 `three/bakeToggle.ts` module flag; `parseModel(bytes, format, bake)` takes the
      convention as an argument; the frame lookup uses the legacy table when on; the pose
      read applies the legacy mapping when on; **two `MeshLru` instances** in `App` from
      one `meshLoader(api, bake)` factory, consumers handed `legacyBake ? bakeLru : lru`
      (`ViewerLayer`, `useThumbnails`, `bulkJobs`, and the hover warmer through its
      `[lru]`-keyed memo) — keys stay bare paths, nothing is cleared. Pill `bake` beside
      `ssao`, same shape (`aria-pressed`, a `title` — "Legacy Z-up bake — compare the old
      rendering; removed before this change ships" — the module-flag + `useState` mirror);
      flipping closes the lightbox and the orbit overlay and drops the thumbs map;
      `BulkJobs` takes `lru` as a getter (its `ao` precedent). Ordering: `adaptive-ao-default`
      1.2 edits the same corner block — whichever lands second rebases the block.
      **`putThumb` is
      withheld while the pill exists**, on either side, by the first line of
      `LocalFramingClient.putThumb` (before the local branch, so nothing reaches
      `localStorage` from a PUT either, D7). Cells: the
      flag off is the default; on, an STL parses rotated and a model still loads (falsify:
      pass the wrong `bake` → the bounding box flips); the two instances hold separate
      parses of one path; a flip re-renders and the warmer's next call reaches the other
      instance; no framing is stored from a `putThumb`, on the wire or locally, with the
      pill off either (falsify by removing the guard)
      *(2026-09-10: merged as f5be254 (fable worker). Guard as `BAKE_PILL_PRESENT`, a
      constant not a flag read, first line of `LocalFramingClient.putThumb`; two LRU
      instances from `meshLoader(api, placeholderRef, bake)`; the thumbs "drop" is a
      per-path `refetch` over the visible models from an effect keyed on the flag, since
      no drop-all exists; `actionHost` was a fifth `lru` consumer, handed `liveLru` too.
      The suite-wide guard lift is a vitest `setupFiles` mock (`bakePillGuard.setup.ts`),
      with `bakeToggle.test.ts` unmocking it as the falsification target — approved at
      check-in. 7 cells; falsified: invert the bake test → both parse cells; delete the
      guard line → the guard cell. Merged main: client 960/960, typecheck clean. The
      worker's 5.2 delete list is in its report and is the brief for 5.2. With this merge
      the dev instance's client bundle carries the guard, so the incident window is closed
      from the client side; the server-side refusal (0.2) is still pending)*
- [x] 3.2 Masa's test window (0.2 in force): the pill on and off over the real library — Pikachu (stored
      camera + axis), Main_Complete (`-z` stored), Benchy (posed, no framing), Head
      (`+Y` posed), an OBJ if one is at hand. Known during the window (D7): an orbit is
      not durable across navigation, the library tab's reset count moves for framings
      never stored, a bulk generate reports every entry skipped, and a browser framing
      in the file convention reads a quarter turn off with the pill on. Record
      what was looked at and any difference seen beyond the shadow penumbra here, before
      the pill is removed
      *(2026-09-11, coordinator's headless check on the live dev instance at c38f64d, index
      on, caches empty, both guards on, AO off: tiles for fat_cat / 3DBenchy /
      xyzCalibration_cube diffed against the spike's `-noao` C0 baselines composited the
      same way — pill OFF max Δ 47/56/45, pill ON max Δ 46/56/47 (lossy-WebP noise; a
      quarter turn or a default view would be ≈ 255), and a control against a default-view
      render of fat_cat from the harness page gave max Δ 163. So on a fresh load both sides
      stand and the pose is applied. Masa's two reports — legacy side on its side after the
      6a7ac2a fix, pose ignored with the index back on — did not reproduce; the first
      matches a tab that had not reloaded the fixed camera module, the second the pose wave
      running once per listing landing (its effect keys on the wave id, not on index
      availability), so a listing landed while the index was off has no poses until the
      next navigation — pre-existing behaviour, not this change's). After Masa emptied the
      cache and hard-reloaded, both reports persisted — so the difference was browser
      state, and there is one store a reload keeps: framings held in `localStorage`
      (`mb:framing:<library>:<path>`, where the client keeps orbits while `thumbWrites`
      is off). Reproduced headless by injecting one: `{axis:'z'}` for fat_cat → pill OFF
      max Δ 160 vs the posed baseline (a stored axis withholds the pose — the spec's own
      rule), pill ON max Δ 187 and the saved tile is the cat on its side (a file-convention
      axis read against the legacy frames on a baked mesh — D7's accepted quarter turn).
      Both symptoms, one cause. Fix for the test: clear the `mb:framing:` keys; the legacy
      side cannot show a framed model right and is not meant to)*
      *(Closed 2026-09-11. Masa: "Bake off is correct" — the new rendering, index off, pure
      defaults — and, once the framings held in the browser's localStorage were cleared,
      the poses showed. Verdict: the pill is understood and should be removed; the
      change's point is the true up axis, and the harness's in-process run had already
      shown the two renderings equal. Two things came out of the window worth keeping: the
      spec's "a stored axis withholds the pose" rule is easy to mistake for a bug when the
      store is invisible (a browser-held framing survives a hard reload and a cache
      clear), and *reset framing* must reach that store — it did before the pill and does
      again after it)*

## 4. The harness (D6)

- [x] 4.1 `scripts/frame-ab/`: `run.mjs`, the page, the sample list, the OBJ fixture
      generator, the diff and contact sheet; a config file for the playwright-core and
      chromium paths; a README naming the port, the config, the tolerance and its basis
      (≤ 5 % pixels, no delta > 96, with the `-noao` frames at ≤ 2 % — the bake residual
      is ≤ 1.8 % / ≤ 60 and the AO pass adds an unseeded-noise floor across processes,
      D6), and stating plainly that the STL samples are this machine's library
      through a live dev server and only the OBJ fixture travels; the page at
      `client/spike/ab.{html,ts}`, served by `bunx vite --port 5174 --strictPort` from
      `client/`, `spike` added to `client/tsconfig.json`'s `include`;
      `renderThumbnailCanvas` in `renderer.ts` as the lossless path, with
      `renderThumbnail` refactored onto it (same staging, `toBlob` last) and a cell that
      the two agree on a fixture's pixels
      *(2026-09-10: merged as 7da47a5 (fable worker); 17 baselines checked in, 624,531 bytes
      in 22 new files, the repo's first tracked binaries. `renderThumbnail` refactored onto
      `renderThumbnailCanvas`, one cell. The plumbing run found the real per-process AO
      floor: 5–23 % of pixels on real STLs (bod_test_cube 22.4 % between two fresh Chromium
      processes running the SAME code; 0/0 with AO off), far above the L-bracket's 4.6 %,
      so AO-on rows cannot be gated across processes at all. The `-noao` rows reproduced
      the spike's residual to within a few pixels (922 vs 951; 282 vs 285) — the bake
      claim, measured again. All seven posed samples reproduced the record's (axis, az,
      el) under the new `cameraForPose` — D4 confirmed live. Follow-up in flight: an
      in-process mode through the pill's flag (the spike's own zero-noise method) for 4.2,
      `-noao` baselines for all nine STLs, and baseline mode gating `-noao` rows only)*
- [x] 4.2 Run it on main with the pill code present and `legacyBake` off: every sample
      within tolerance; paste the table here
      with the max per sample. A sample outside tolerance is a finding, not a threshold to
      widen.
      **Done 2026-09-10** (Chromium 1228, this machine, the pill code present, both runs
      against the live dev server on 3177, library `97ecc020…`, 73 entries at `/`; the
      `legacyBake` flag is off for every `current` render and on only inside the page's
      legacy renders of the in-process run). The harness gained `--mode in-process|baseline`
      for this (README "Two modes"; D6): in-process renders C0 through the pill's flag in the
      same page and gates every row; baseline gates the `-noao` rows only, AO-on rows
      reference only (the plumbing run's 5–23 % cross-process AO floor). Every gated row
      passed; no finding. The in-process run wrote the seven missing `-noao_C0.png` STL
      baselines (308,327 bytes) after its self-check found the flag pixel-identical (0/0) to
      the spike's four stored `-noao` frames. Both tables verbatim (`page errors: 404` is Chromium's
      `/favicon.ico` request, which the page declares none of — the console error's URL
      read with a probe on the same page; the spike's record carries the same string):

      `node scripts/frame-ab/run.mjs --mode in-process`
      ```
      mode       | sample                        | ao  | diff px |  diff % | max Δ | bound         | pass
      -----------|-------------------------------|-----|---------|---------|-------|---------------|-----
      in-process | _Pikachu_X_Kakashi.stl        | on  |     919 |    1.40 |    10 | ≤ 2 % / ≤ 96  | ok
      in-process | _Pikachu_X_Kakashi.stl-noao   | off |    1037 |    1.58 |    10 | ≤ 2 % / ≤ 96  | ok
      in-process | _Main_Tubeless.stl            | on  |    1110 |    1.69 |    10 | ≤ 2 % / ≤ 96  | ok
      in-process | _Main_Tubeless.stl-noao       | off |    1224 |    1.87 |    10 | ≤ 2 % / ≤ 96  | ok
      in-process | _Main_Complete.stl            | on  |     997 |    1.52 |    14 | ≤ 2 % / ≤ 96  | ok
      in-process | _Main_Complete.stl-noao       | off |    1123 |    1.71 |    15 | ≤ 2 % / ≤ 96  | ok
      in-process | _bod_test_cube_5s.stl         | on  |     815 |    1.24 |    15 | ≤ 2 % / ≤ 96  | ok
      in-process | _bod_test_cube_5s.stl-noao    | off |     688 |    1.05 |    15 | ≤ 2 % / ≤ 96  | ok
      in-process | _3DBenchy.stl                 | on  |     433 |    0.66 |     9 | ≤ 2 % / ≤ 96  | ok
      in-process | _3DBenchy.stl-noao            | off |     447 |    0.68 |     9 | ≤ 2 % / ≤ 96  | ok
      in-process | _BeardedGentleman.stl         | on  |     582 |    0.89 |     8 | ≤ 2 % / ≤ 96  | ok
      in-process | _BeardedGentleman.stl-noao    | off |     629 |    0.96 |     8 | ≤ 2 % / ≤ 96  | ok
      in-process | _Octopus_sup_v5.6.stl         | on  |     516 |    0.79 |     8 | ≤ 2 % / ≤ 96  | ok
      in-process | _Octopus_sup_v5.6.stl-noao    | off |     590 |    0.90 |     8 | ≤ 2 % / ≤ 96  | ok
      in-process | _fat_cat.stl                  | on  |     874 |    1.33 |     9 | ≤ 2 % / ≤ 96  | ok
      in-process | _fat_cat.stl-noao             | off |     922 |    1.41 |    12 | ≤ 2 % / ≤ 96  | ok
      in-process | _xyzCalibration_cube.stl      | on  |     248 |    0.38 |     7 | ≤ 2 % / ≤ 96  | ok
      in-process | _xyzCalibration_cube.stl-noao | off |     282 |    0.43 |    10 | ≤ 2 % / ≤ 96  | ok
      in-process | OBJ_axis_y                    | on  |       0 |    0.00 |     0 | ≤ 2 % / ≤ 96  | ok
      in-process | OBJ_axis_y-noao               | off |       0 |    0.00 |     0 | ≤ 2 % / ≤ 96  | ok
      in-process | OBJ_axis_z                    | on  |       0 |    0.00 |     0 | ≤ 2 % / ≤ 96  | ok
      in-process | OBJ_axis_z-noao               | off |       0 |    0.00 |     0 | ≤ 2 % / ≤ 96  | ok
      self-check _fat_cat.stl-noao: legacy render vs stored C0 — 0 px / max 0 (must be 0/0): ok
      self-check _xyzCalibration_cube.stl-noao: legacy render vs stored C0 — 0 px / max 0 (must be 0/0): ok
      self-check OBJ_axis_y-noao: legacy render vs stored C0 — 0 px / max 0 (must be 0/0): ok
      self-check OBJ_axis_z-noao: legacy render vs stored C0 — 0 px / max 0 (must be 0/0): ok
      wrote 7 AO-off baseline(s) from the legacy render, for baseline mode after the pill is gone:
        /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/baseline/_Pikachu_X_Kakashi.stl-noao_C0.png (54335 bytes)
        /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/baseline/_Main_Tubeless.stl-noao_C0.png (57090 bytes)
        /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/baseline/_Main_Complete.stl-noao_C0.png (59989 bytes)
        /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/baseline/_bod_test_cube_5s.stl-noao_C0.png (35850 bytes)
        /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/baseline/_3DBenchy.stl-noao_C0.png (20699 bytes)
        /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/baseline/_BeardedGentleman.stl-noao_C0.png (47749 bytes)
        /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/baseline/_Octopus_sup_v5.6.stl-noao_C0.png (32615 bytes)
      22 rows, 0 failed; renders in /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/out
      ```
      `node scripts/frame-ab/run.mjs --mode baseline`
      ```
      mode       | sample                        | ao  | diff px |  diff % | max Δ | bound         | pass
      -----------|-------------------------------|-----|---------|---------|-------|---------------|-----
      baseline   | _Pikachu_X_Kakashi.stl        | on  |    9216 |   14.06 |    75 | reference     | —
      baseline   | _Pikachu_X_Kakashi.stl-noao   | off |    1037 |    1.58 |    10 | ≤ 2 % / ≤ 96  | ok
      baseline   | _Main_Tubeless.stl            | on  |   10331 |   15.76 |    45 | reference     | —
      baseline   | _Main_Tubeless.stl-noao       | off |    1224 |    1.87 |    10 | ≤ 2 % / ≤ 96  | ok
      baseline   | _Main_Complete.stl            | on  |   11409 |   17.41 |    88 | reference     | —
      baseline   | _Main_Complete.stl-noao       | off |    1123 |    1.71 |    15 | ≤ 2 % / ≤ 96  | ok
      baseline   | _bod_test_cube_5s.stl         | on  |   15104 |   23.05 |    51 | reference     | —
      baseline   | _bod_test_cube_5s.stl-noao    | off |     688 |    1.05 |    15 | ≤ 2 % / ≤ 96  | ok
      baseline   | _3DBenchy.stl                 | on  |    2543 |    3.88 |    45 | reference     | —
      baseline   | _3DBenchy.stl-noao            | off |     447 |    0.68 |     9 | ≤ 2 % / ≤ 96  | ok
      baseline   | _BeardedGentleman.stl         | on  |    8867 |   13.53 |    35 | reference     | —
      baseline   | _BeardedGentleman.stl-noao    | off |     629 |    0.96 |     8 | ≤ 2 % / ≤ 96  | ok
      baseline   | _Octopus_sup_v5.6.stl         | on  |    5907 |    9.01 |    51 | reference     | —
      baseline   | _Octopus_sup_v5.6.stl-noao    | off |     590 |    0.90 |     8 | ≤ 2 % / ≤ 96  | ok
      baseline   | _fat_cat.stl                  | on  |    7634 |   11.65 |    26 | reference     | —
      baseline   | _fat_cat.stl-noao             | off |     922 |    1.41 |    12 | ≤ 2 % / ≤ 96  | ok
      baseline   | _xyzCalibration_cube.stl      | on  |    3596 |    5.49 |    27 | reference     | —
      baseline   | _xyzCalibration_cube.stl-noao | off |     282 |    0.43 |    10 | ≤ 2 % / ≤ 96  | ok
      baseline   | OBJ_axis_y                    | on  |    1864 |    2.84 |    18 | reference     | —
      baseline   | OBJ_axis_y-noao               | off |       0 |    0.00 |     0 | ≤ 2 % / ≤ 96  | ok
      baseline   | OBJ_axis_z                    | on  |    3006 |    4.59 |    19 | reference     | —
      baseline   | OBJ_axis_z-noao               | off |       0 |    0.00 |     0 | ≤ 2 % / ≤ 96  | ok
      22 rows, 0 failed, 11 reference only; renders in /home/masa/Documents/model-browser/.claude/worktrees/agent-a04d6136fa7f54c6a/scripts/frame-ab/out
      ```

## 5. Migrate, remove, land

- [ ] 5.1 Stop the dev server (both guards were in force through the window, Migration
      Plan step 4); `for d in ~/.cache/model-browser/*/; do bun run scripts/migrate-frames.ts --cache-dir "$d"; done` — **every** directory in
      `~/.cache/model-browser/` (four on 2026-09-10 — 18,428 / 1,507 / 122 / 40 sidecars,
      74 framed entries in all — 54 camera+axis, 20 axis-only, 0 camera-only — all STL,
      `0f680186` the only one with `x`-family axes); record each run's seven counts here
      (label-only is expected 0 everywhere); `--undo` then re-run on one id reports the
      same counts both ways — true only if nothing was written between the two runs: an
      undo also converts entries the new server wrote fresh (correctly — it is a convention
      translation, not an edit log — the reviewer's probe), so its counts exceed the
      forward run's by however many landed in between. 2026-09-11: the caches were
      deleted by Masa before this ran, so there is nothing to migrate on this machine;
      the server recreates a library's directory on its next write, so once `thumbWrites`
      is restored (5.2) run the script over each new directory so it carries the marker
      (`convention: 2`) with zero counts — the tool's real test is its 17 cells, and the
      demo's browsers migrate on read regardless
      *(removed 2026-09-11 — Masa: unreleased, no data to migrate; the merged code was
      reverted in this commit)*
- [x] 5.2 Delete the pill, `bakeToggle.ts`, the second LRU and the loader's `bake`
      argument, the pill's legacy frame lookup, the legacy pose mapping and every branch
      on the flag, including the `putThumb` guard and the getters' second instance —
      **not** `shared/frames.ts`'s pre-bake triples, which `FILE_FRAMES` and `swapOffset`
      derive from and the harness uses (D5/D7), and **not** the `meshLoader` extraction, a
      permanent improvement (wave-2 review #2): it loses its `bake` parameter only. The
      delete surface is the pill worker's list (its commit f5be254 message and report):
      `bakeToggle.ts`; `parseModel`'s third parameter; `camera.ts`'s `LEGACY_FRAMES`,
      the `frameFor` branch, the `defaultAxisFor` wrapper (back to the plain re-export
      of `shared/frames`' — it defaults a baked mesh to the old spindle `y`, 2026-09-11)
      and the two imports; `pose.ts`'s `toSceneSpace` and its two
      call sites; `App.tsx`'s `bakeLru`, `bake`/`setBake`, `liveLru`, `liveLruRef`,
      `bakeSeenRef` + its effect (and the `renderEntryThumbnail` import only it uses —
      the effect re-renders the visible tiles locally since 2026-09-11), the `liveLru`
      hand-offs (back to `lru`), the pill
      button and its comment, and `lru` back into the `jobs` memo's deps and value;
      `bulkJobs.ts`'s `JobDeps.lru` back to a plain value and the deps spread;
      `localFramings.ts`'s `BAKE_PILL_PRESENT` import and guard; `vite.config.ts`'s
      `setupFiles` line; `client/test/bakePillGuard.setup.ts`, `bakeToggle.test.ts`,
      `bakePill.test.tsx`; `bulkJobs.test.ts`'s getter back to a value; in the harness:
      `client/spike/ab.ts`'s `setLegacyBake` import, `RenderOpts.legacy`,
      `legacyModelCache` and the `legacy` branch, `run.mjs`'s `--mode in-process` and
      the README's in-process paragraphs (baseline mode stays). While in those files, the
      review's nits: `pose.ts`'s `POSE_VERSION` comment stops saying `toSceneSpace` is
      "now gone" in the interim (it will be true then); `client/spike/ab.ts` assigns
      `window.ab` through a local cast, not a `declare global` that leaks into `src`'s
      type program.
      `grep -rn "legacyBake\|bakeToggle\|toSceneSpace\|bakeLru" client/src client/spike
      scripts/frame-ab` is empty and `parseModel` is back to two parameters; suites green; 4.2 re-run; restore
      `thumbWrites` in the local config and restart; start the server; open Pikachu and
      Main_Complete and confirm the stored view is the one shown and their cached renders
      are served as hits (no re-render)
      *(2026-09-11: deleted in one commit (fable worker), every item on the list above at
      its listed fate — `bakeToggle.ts`, `bakePillGuard.setup.ts`, `bakeToggle.test.ts`,
      `bakePill.test.tsx` removed; `parseModel(bytes, format)`; `camera.ts` back to the
      plain `defaultAxisFor` re-export, `lift` kept as the one lifting helper; `pose.ts`
      matches `up`/`azimuth_zero` directly and its `POSE_VERSION` comment names the mapping
      by its formula rather than a symbol that no longer exists; `App.tsx` differs from the
      pre-pill tree (f5be254^) by the `meshLoader` extraction alone; `BulkJobs` takes `lru`
      as a value; the `putThumb` guard and its discard exception are gone, the plain
      `keepsFramingsLocally` branch is first again; `vite.config.ts` back to `{ css: true }`;
      the harness lost `--mode` altogether (baseline is the only way it runs, the `mode`
      column with it), `ab.ts` lost `legacy` and assigns `window.ab` through a local cast.
      Nothing on the list was already gone. The gate grep over client/src, client/spike,
      scripts/frame-ab and vite.config.ts finds two `legacy`s, both prose and neither the
      pill's (`renderer.ts`'s `THUMB_LIGHTING` label-type comment; the README's kept
      in-process run record). Suites: client 943/943 over 65 files (the three deleted files
      held 10 cells, 7 + 3), server 732 + 3 skipped, typecheck clean, validate
      `--strict` valid, archive dry run applies (~4). 4.2 re-run without the flag: 22 rows,
      0 failed, 11 reference; the eleven `-noao` rows at the 2026-09-10 counts exactly
      (1037/10, 1224/10, 1123/15, 688/15, 447/9, 629/8, 590/8, 922/12, 282/10, OBJ 0/0 ×2).
      Not done here, for the coordinator: restoring `thumbWrites` in the local config, the
      restart, and the Pikachu / Main_Complete hit check — the dev instance was read-only
      for this worker)*
- [x] 5.3 `bun run typecheck` and both suites green on merged main
      *(2026-09-11 on 4d00018, the pill removed: both typechecks exit 0; client 65 files /
      943; server 22 files / 732 passed, 3 skipped in `indexContract.test.ts`, which
      `describe.skipIf`s itself when the index server on 8077 is unreachable — pre-existing
      (5d0cf27), environmental, not this change's. The gate grep over client/src,
      client/spike, scripts/frame-ab and vite.config for the pill's names is empty)*
- [ ] 5.4 Records: `docs/web-demo-notes.md` if it names an axis convention;
      `deploy/demo/README.md`: demo framings held from before the change are expendable
      (Risks — written 2026-09-11); issue #8 closed with this
      comment, which Masa posts or approves: "Fixed by `file-frame-spindle`. The app no
      longer rotates STL geometry on load, so the axis pill names the file's own axis: a
      `+Z` model reads Z, and the contact sheet and the pill agree. The cross-check is now
      the direct one — a `+Y` model reads Y with no flip. Provenance turned out not to be
      needed once the two tools spoke the same frame." 
      *(2026-09-11: `docs/web-demo-notes.md` names no axis convention (its two "axis"
      hits are the retired axis-lighting mode) — no edit; `deploy/demo/README.md` carries
      the two sentences on browser-held framings (c38f64d); CLAUDE.md's cache bullet is
      back to `{mtime, lighting, rig, posed}` (the label went with the migration). Open:
      the issue #8 comment above, for Masa to post or approve)*
- [ ] 5.5 `openspec validate file-frame-spindle --strict`; archive dry run on a fresh copy;
      after archiving, the applied `model-viewer`, `model-thumbnails` and `semantic-search`
      text carries no change-scoped prose
