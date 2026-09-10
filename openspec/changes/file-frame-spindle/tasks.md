## 0. Before the old code goes

- [ ] 0.1 Capture the L-bracket OBJ's C0 frames at spindles `y` and `z` as single lossless
      PNGs from the spike worktree (`agent-af1bc1b75df6032ae`, commit `f3442dd`; its
      `out/` holds them only inside contact sheets), beside the eleven STL `*_C0.png`
      there (522,728 bytes), into `scripts/frame-ab/baseline/` with the spike's
      `results.json` as the record of the run. After 1.3 lands, C0 cannot be regenerated

## 1. Frames and defaults

- [ ] 1.1 `three/camera.ts`: `FRAMES` becomes the D3 table, derived in code from the
      current table by R⁻¹ (`unbake(x,y,z) = (x, −z, y)`, re-keyed by the spindle vector's
      axis) with the derivation kept as the source of truth and the six entries asserted in
      a unit cell against the design's table; `defaultAxisFor(format: ModelFormat)` (D2) —
      an argument that is `null` or `undefined` is a type error, not a default — and
      `formatOfEntry(entry)` in `three/models.ts` (`entry.format ?? formatOf(entry.path)`,
      throwing with the path when neither classifies; cell: a model entry without
      `format` resolves from its path, a `.txt` throws);
      `migrateAxis` and `swapOffset` derived from the two tables and exported through
      `shared/` for the script and `localFramings` (D5). `statePosition`, `applyState`
      and `captureState` lose their `= 'y'` defaults and take `axis` as required.
      Cells: the six entries; `a × b = −s` on all six; `migrateAxis`'s six pairs;
      `swapOffset`'s six values in degrees with the sign checked against `captureState`
      (a direction vector round-trips through old frame → offset → new frame); a camera
      round-trip about every spindle still exact
- [ ] 1.2 `three/pose.ts`: delete `toSceneSpace`; `axisOf` matches the file vector;
      `cameraForPose` unchanged otherwise; `POSE_VERSION` stays 2 and its comment says
      why ("2 = poses carried into scene space" is no longer the meaning — the mapping is
      gone and the pictures are the same, D4). Cells: `up [0,0,1]` → `z`, `[0,1,0]` → `y`,
      `[0,0,-1]` → `-z`; the seven posed root samples' (axis, az, el) from the spike's
      table reproduced (Benchy `z` 90° 20°, bod_test_cube `-x` 405° 20°, …) — falsify by
      restoring `toSceneSpace`
- [ ] 1.3 `three/models.ts`: the STL bake removed; the comment about 3MF corrected (the
      loader rotates nothing; the format is Z-up by specification, which is why its default
      is `z`). Cell: an STL fixture's bounding box after parse equals its file's.
      `client/test/stlNormals.test.ts`'s "a healthy file is unchanged" cell asserts the
      stored field carried through the rotation — rewritten to assert the field verbatim
      (semantics-is-the-point, named in the report)
- [ ] 1.4 The fifteen `'y'` fallbacks replaced by `defaultAxisFor(formatOfEntry(entry))` —
      `renderThumbnail`; `ViewerSession`; `ViewerLayer` ×4 (open, catch, close, discard);
      `useThumbnails`' render site; `bulkJobs`' discard; `entryActions` ×4 (the
      `framingAfterDiscard` callers and `DEFAULT_ORBIT_AXIS`, retired — `App`'s tile-menu
      consumer `thumbs.get(path)?.axis ?? DEFAULT_ORBIT_AXIS` takes the entry's format);
      `camera.ts` ×3 handled in 1.1. Doc comments that would read false after: `OrbitAxis`
      ("Default 'y'"), `CameraState` in shared/types ("Under the default 'y' spindle…"),
      `Meta.axis` in cache.ts ("undefined reads as 'y'"). Existing cells that assert `'y'`
      for an STL are adjusted to `'z'` — each named in the report. New cells: an un-framed
      STL opens at `z` and the lightbox marks Z; an un-framed OBJ opens at `y`; the tile
      menu's axis group marks the same letter as the lightbox for each; a `+Y`-posed STL
      marks Y with no flip (issue #8's cross-check)

## 2. The stores

- [ ] 2.1 Server `cache.ts`: `frame?: number` on `Meta`; `put` stamps `frame: 2` only when
      the write carries a `camera` or `axis` (a discard, `null`, counts), and carries
      `prev.frame` otherwise — in both hand-built sidecars, the main write and the
      `png === null` deletion branch (the size-cap write-back and the re-key spread the
      previous meta). Not on the wire: `ThumbGetResponse` is unchanged. Cells: a framing
      write stamps it; a discard stamps it; a pixels-only write on an unlabelled framed
      entry preserves both the axis and the absence of the label (falsify: stamp on every
      write → fails); a pixels-only write on a labelled entry keeps the label; the
      deletion branch keeps it (falsify: drop it from that branch → fails); an old
      sidecar without it reads as before
- [ ] 2.2 `scripts/migrate-frames.ts <cache-dir> [--undo]` (D5): walks sidecars, applies
      `migrateAxis` / `swapOffset` by `formatOf(path)`, stamps `frame: 2`, writes
      with plain `writeFile` like `writeMeta`, leaves render files alone, writes
      `.frame-migration.json`, reports the seven counts; an unclassifiable path is
      reported and untouched; refuses when the marker exists and a framed sidecar is
      unlabelled with a file mtime newer than the marker's `at` (a rolled-back server,
      Risks), naming the sidecars and the copied-without-mtimes case. Cells (server/test,
      over a temp cache dir): an STL `y` + camera → `z`, camera untouched, render files
      untouched; an STL `-z` → `y`; an STL camera with no axis → label only, axis still
      absent (falsify: default a missing axis to `y` → fails); an OBJ `z` + camera → `z`,
      az + 90°; an OBJ at `y` untouched; a labelled entry untouched and counted; `--undo`
      inverts, clears the label and removes the marker; a sidecar with neither axis nor
      camera is skipped and not labelled; a second run reports zero changes; an unlabelled
      framed sidecar touched after the marker → the run refuses (falsify: drop the mtime
      test → it relabels `z` to `-y`). Falsify: swap two rows of `migrateAxis` → the STL
      cells fail
- [ ] 2.3 `api/localFramings.ts`: `LocalFraming` gains `frame`; `readLocalFraming`
      transforms an unlabelled entry (format from the path — a zip entry's path ends in
      the model's extension) at the store boundary, never inside a React updater
      (`useThumbnails`' updater rule), and writes it back labelled; `writeLocalFraming`
      carries the label. Cells: the same shapes as 2.2 through the read path; a framing
      write after a migrated read keeps the label and a re-read does not migrate again
      (falsify: drop `frame` from the write → fails); a read under a storage that refuses
      writes still serves the transformed framing; two reads in one tick agree

## 3. The compare pill (temporary — D7; deleted in 5.2)

- [ ] 3.1 `three/bakeToggle.ts` module flag; `parseModel(bytes, format, bake)` takes the
      convention as an argument; the frame lookup uses the legacy table when on; the pose
      read applies the legacy mapping when on; **two `MeshLru` instances** in `App` from
      one `meshLoader(api, bake)` factory, consumers handed `legacyBake ? bakeLru : lru`
      at call time (`ViewerLayer`, `useThumbnails`, `bulkJobs`, the hover warmer, the 3MF
      placeholder hook) — keys stay bare paths, nothing is cleared. Pill `bake` beside
      `ssao`, same shape; flipping closes the lightbox and the orbit overlay and drops the
      thumbs map; the flag mirrors into React state like `ssao`; `BulkJobs` and
      `createHoverWarmer` take `lru` as a getter (the `ao` precedent). **`putThumb` is
      withheld while the pill exists**, on either side, by the outermost client decorator
      (outside `LocalFramingClient`, so nothing reaches `localStorage` either). Cells: the
      flag off is the default; on, an STL parses rotated and a model still loads (falsify:
      pass the wrong `bake` → the bounding box flips); the two instances hold separate
      parses of one path; a flip re-renders and the warmer's next call reaches the other
      instance; no PUT and no local write with the pill off either (falsify by removing
      the guard)
- [ ] 3.2 Preconditions: `features.thumbWrites: false` in `~/.config/model-browser/config.json`,
      dev instance restarted, `rm -rf client/dist`, no other browser on 3177 (a pre-guard
      bundle would write past the client guard; the server's refusal is the belt).
      Masa's test window: the pill on and off over the real library — Pikachu (stored
      camera + axis), Main_Complete (`-z` stored), Benchy (posed, no framing), Head
      (`+Y` posed), an OBJ if one is at hand. Known during the window (D7): an orbit is
      not durable across navigation, the library tab's reset count moves for framings
      never stored, a bulk generate reports every entry skipped, and a browser framing
      migrated in an earlier session reads a quarter turn off with the pill on. Record
      what was looked at and any difference seen beyond the shadow penumbra here, before
      the pill is removed

## 4. The harness (D6)

- [ ] 4.1 `scripts/frame-ab/`: `run.mjs`, the page, the sample list, the OBJ fixture
      generator, the diff and contact sheet; a config file for the playwright-core and
      chromium paths; a README naming the port, the config, the tolerance and its basis
      (≤ 2 % pixels, no delta > 96 — measured ≤ 1.8 % / ≤ 60, count spread 6.4 % across
      processes), and stating plainly that the STL samples are this machine's library
      through a live dev server and only the OBJ fixture travels;
      `renderThumbnailCanvas` in `renderer.ts` as the lossless path
- [ ] 4.2 Run it on main after 1.x: every sample within tolerance; paste the table here
      with the max per sample. A sample outside tolerance is a finding, not a threshold to
      widen

## 5. Migrate, remove, land

- [ ] 5.1 Stop the dev server (both guards were in force through the window, Migration
      Plan step 4); `bun run scripts/migrate-frames.ts` over **every** directory in
      `~/.cache/model-browser/` (four on 2026-09-10 — 18,428 / 1,507 / 122 / 40 sidecars,
      74 framed entries in all — 54 camera+axis, 20 axis-only, 0 camera-only — all STL,
      `0f680186` the only one with `x`-family axes); record each run's seven counts here
      (label-only is expected 0 everywhere); `--undo` then re-run on one id reports the
      same counts both ways
- [ ] 5.2 Delete the pill, `bakeToggle.ts`, the second LRU and the loader's `bake`
      argument, the legacy table, the legacy pose mapping and every branch on the flag,
      including the `putThumb` guard and the getters' second instance;
      `grep -rn "legacyBake\|bakeToggle\|toSceneSpace\|bakeLru\|meshLoader(" client/src` is
      empty and `parseModel` is back to two parameters; suites green; 4.2 re-run; restore
      `thumbWrites` in the local config and restart; start the server; open Pikachu and
      Main_Complete and confirm the stored view is the one shown and their cached renders
      are served as hits (no re-render)
- [ ] 5.3 `bun run typecheck` and both suites green on merged main
- [ ] 5.4 Records: `docs/web-demo-notes.md` if it names an axis convention;
      `deploy/demo/README.md`: browsers migrate local framings on first read, and demo
      framings are expendable on a client rollback (Risks); CLAUDE.md's thumbnail-cache
      bullet gains `frame` beside `rig`/`posed`, the `.frame-migration.json` marker, and
      the rule "run `--undo` before rolling the server back"; issue #8 closed with a comment (Masa posts or approves the text):
      the pill now names the file axis, the contact sheet and the pill agree, the
      cross-check is a `+Y` model reading Y with no flip
- [ ] 5.5 `openspec validate file-frame-spindle --strict`; archive dry run on a fresh copy;
      after archiving, the applied `model-viewer`, `model-thumbnails` and `semantic-search`
      text carries no change-scoped prose
