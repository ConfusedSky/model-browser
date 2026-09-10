## 1. Frames and defaults (pure, additive — existing suites byte-unchanged until 1.4)

- [ ] 1.1 `three/camera.ts`: `FRAMES` becomes the D3 table, derived in code from the
      current table by R⁻¹ (`unbake(x,y,z) = (x, −z, y)`, re-keyed by the spindle vector's
      axis) with the derivation kept as the source of truth and the six entries asserted in
      a unit cell against the design's table; `defaultAxisFor(format)` (D2); `migrateAxis`
      and `swapOffset` derived from the two tables and exported through `shared/` for the
      script and `localFramings` (D5). Cells: the six entries; `migrateAxis`'s six pairs;
      `swapOffset`'s six values in degrees; a camera round-trip about every spindle still
      exact
- [ ] 1.2 `three/pose.ts`: delete `toSceneSpace`; `axisOf` matches the file vector;
      `cameraForPose` unchanged otherwise. Cells: `up [0,0,1]` → `z`, `[0,1,0]` → `y`,
      `[0,0,-1]` → `-z`; the seven posed root samples' (axis, az, el) from the spike's
      table reproduced (Benchy `z` 90° 20°, bod_test_cube `-x` 405° 20°, …) — falsify by
      restoring `toSceneSpace`
- [ ] 1.3 `three/models.ts`: the STL bake removed; the comment about 3MF corrected (the
      loader rotates nothing; the format is Z-up by specification, which is why its default
      is `z`). Cell: an STL fixture's bounding box after parse equals its file's
- [ ] 1.4 Every `'y'` fallback replaced by `defaultAxisFor(entry.format)` — `renderThumbnail`,
      `statePosition`/`applyState`, `ViewerSession`, `ViewerLayer` (open, close, discard),
      `useThumbnails`' render site, `bulkJobs`' discard, `entryActions` (`framingAfterDiscard`
      callers, `DEFAULT_ORBIT_AXIS` retired or made a function), `OrbitAxis`'s doc comment.
      Existing cells that assert `'y'` for an STL are adjusted to `'z'` — each named in
      the report as semantics-is-the-point. New cells: an un-framed STL opens at `z` and
      the lightbox marks Z; an un-framed OBJ opens at `y`; the tile menu's axis group marks
      the same letter as the lightbox for each

## 2. The stores

- [ ] 2.1 Server `cache.ts`: `frame?: number` on `Meta`, stored and echoed like `rig`;
      every write stamps `frame: 2`; `/api/thumb` answers carry it. Cells: a write stamps it;
      a read echoes it; an old sidecar without it reads as before
- [ ] 2.2 `scripts/migrate-frames.ts <cache-dir> [--undo]` (D5): walks sidecars, applies
      `migrateAxis` / `swapOffset` by `formatOf(path)`, stamps `frame: 2`, writes
      atomically, reports the five counts. Cells (server/test): an STL `y` + camera →
      `z`, camera untouched; an STL `-z` → `y`; an STL camera with no axis → label only,
      axis still absent (falsify: make the script default a missing axis to `y` → fails); an OBJ `z` + camera → `z`, az + 90°; an OBJ
      at `y` untouched; a labelled entry untouched and counted; `--undo` inverts and
      clears the label; a sidecar with neither axis nor camera is skipped and not
      labelled. Falsify: swap two rows of `migrateAxis` → the STL cells fail
- [ ] 2.3 `api/localFramings.ts`: on read, an entry without `frame` is transformed the
      same way (format from the path) and written back labelled; an entry with it is
      served as is. Cells: the same four shapes as 2.2 through the read path; a read
      under a storage that refuses writes still serves the transformed framing

## 3. The compare pill (temporary — D7; deleted in 5.1)

- [ ] 3.1 `three/bakeToggle.ts` module flag; `parseModel` applies the rotation when on;
      the frame lookup uses the legacy table when on; the pose read applies the legacy
      mapping when on. Pill `bake` beside `ssao`, same shape; flipping clears the mesh
      LRU, drops the thumbs map, closes the lightbox. Framing PUTs withheld while on (the
      `thumbWrites` path). Cells: the flag off is the default; on, an STL parses rotated;
      on, a PUT is not sent — falsify by removing the guard
- [ ] 3.2 Masa's test window: the pill on and off over the real library — Pikachu (stored
      camera + axis), Main_Complete (`-z` stored), Benchy (posed, no framing), Head
      (`+Y` posed), an OBJ if one is at hand. Record what was looked at and any difference
      seen beyond the shadow penumbra here, before 5.1 removes the pill

## 4. The harness (D6)

- [ ] 4.1 `scripts/frame-ab/`: `run.mjs`, the page, the sample list, the OBJ fixture
      generator, the diff and contact sheet, a README naming the port, the browser path and
      the tolerance; `renderThumbnailCanvas` in `renderer.ts` as the lossless path.
      Baselines: the spike's C0 PNGs for the nine STL samples (two also without AO) and
      the L-bracket at `y` and `z`, copied from worktree commit `f3442dd` into
      `scripts/frame-ab/baseline/`, with the spike's `results.json` beside them as the
      record of the run that produced them
- [ ] 4.2 Run it on main after 1.x: every sample within tolerance (≤ 2 % pixels, no delta
      > 64); paste the table here with the max per sample. A sample outside tolerance is
      a finding, not a threshold to widen

## 5. Migrate, remove, land

- [ ] 5.1 Delete the pill, `bakeToggle.ts`, the legacy table, the legacy pose mapping and
      every branch on the flag; `grep -rn "legacyBake\|bakeToggle\|toSceneSpace"
      client/src` is empty; suites green
- [ ] 5.2 Stop the dev server; `bun run scripts/migrate-frames.ts` over each
      `~/.cache/model-browser/<id>` on this machine (three ids present 2026-09-10; the
      primary holds 29 axes and 12 cameras across 18,428 sidecars); record each run's
      five counts here; start the server; open Pikachu and Main_Complete and confirm the
      stored view is the one shown; a `--undo` then a re-run on one id reports the same
      counts both ways
- [ ] 5.3 `bun run typecheck` and both suites green on merged main; 4.2 re-run after 5.1
- [ ] 5.4 Records: `docs/web-demo-notes.md` if it names an axis convention;
      `deploy/demo/README.md` a line that browsers migrate local framings on first read;
      CLAUDE.md's thumbnail-cache bullet gains `frame` beside `rig`/`posed`; issue #8
      closed with a comment (Masa posts or approves the text): the pill now names the file
      axis, the contact sheet and the pill agree, the cross-check is a `+Y` model reading Y
- [ ] 5.5 `openspec validate file-frame-spindle --strict`; archive dry run on a fresh copy;
      after archiving, the applied `model-viewer`, `model-thumbnails` and `semantic-search`
      text carries no change-scoped prose
