## Context

`parseModel` (`client/src/three/models.ts`) applies `geometry.rotateX(-π/2)` to every STL
so that a Z-up print file stands in what was once a Y-up scene. Since `Per-model orbit
spindle` landed nothing in the scene depends on a fixed up: `ViewerSession` locks the
camera's up to the spindle, `stageModel` places the shadow floor perpendicular to it, and
the rig is camera-space. The bake survives as a coordinate change that three stores and
one mapping are read through: the thumbnail sidecar's `axis` and the local framing's
`axis` are scene axes; `toSceneSpace` in `three/pose.ts` turns the index's file-space `up`
and `azimuth_zero` into scene space before `axisOf` and `cameraForPose` read them; the axis
pickers show scene letters. Issue #8 is the user-visible symptom.

The bake's comment says the 3MF loader "does this itself". The three.js `3MFLoader` in
`client/node_modules` applies no rotation. 3MF is Z-up by specification, so today a 3MF
stands about the wrong axis under the `y` default. The library on this machine is all STL
(500 of 500 at the root and its flat listing); OBJ and 3MF are supported formats with no
samples here, which is why the spike generated an OBJ control.

**What was measured** (spike, 2026-09-10, worktree `agent-af1bc1b75df6032ae`, commit
`f3442dd`, report `spike/frame-ab/REPORT.md`; the harness ships with this change so every
number below can be re-run): nine root STLs, two of them also without AO, and a generated
L-bracket OBJ; lossless pixels from `renderThumbnail`'s own staging read back before the
WebP encode; noise floor 0/0 between two baseline renders in one process, including an
interleaved re-measure. Conditions: the bake on with today's frames (C0); the bake off with
frames redefined as the bake's image (CB, strategy B); the bake off with today's frames and
the stored camera untouched (CA0); the same with the camera re-expressed by a derived
azimuth offset (CA1, strategy A).

## Goals / Non-Goals

**Goals:**
- Render every model in its file's coordinates; the spindle, the sidecar, the index and
  the pickers name one direction one way.
- Per-format default spindle from a single definition.
- Existing stored framings keep drawing the view they drew, migrated once by a script.
- The pixel comparison that justified the frame strategy stays rerunnable.
- A temporary in-app switch to compare the two renderings during the change's test.

**Non-Goals:**
- Changing what the pickers look like or how the flip pill composes with a letter press.
- Re-rendering the thumbnail cache. The measured residual is invisible and cached pixels
  stay valid; a `RIG_VERSION` bump is not warranted (see D3).
- Any change to mini-classify or the index's pose format.
- Provenance of the axis (index / stored / default) in the UI — issue #8's suggestion,
  made unnecessary by the pill and the contact sheet agreeing.

## Decisions

### D1: Drop the bake, do not relabel over it

The alternative was to keep the bake and translate letters at the two pickers. That leaves
`axis: "y"` in a sidecar meaning the file's Z, keeps `toSceneSpace`, and adds a second
mapping on top of the first. Masa's call (2026-09-10): stored data must read as reality,
even at the cost of a migration. So the rotation goes, and every axis in the client is a
file axis. `parseModel` for STL is then parse, normals from winding, done; OBJ and 3MF are
unchanged in code and correct by construction.

### D2: Default spindle per format, from one function

`defaultAxisFor(format: ModelFormat): OrbitAxis` in `three/camera.ts` — `z` for `stl` and
`3mf`, `y` for `obj` — replaces every `?? 'y'` and `= 'y'` fallback: `renderThumbnail`,
`statePosition`/`applyState`, `ViewerSession`'s constructor, `ViewerLayer`'s open and
close paths, `useThumbnails`' render site, `bulkJobs`' discard path, and `entryActions`'
`framingAfterDiscard` callers and `DEFAULT_ORBIT_AXIS`. The format is on every `DirEntry`
(`format`), which each of those sites already has in hand or one hop away. `OrbitAxis`'s
doc comment stops saying "Default 'y'".

### D3: Redefine the six frames as the bake's image — strategy B

Camera angles are measured in a per-spindle basis (`FRAMES` in `three/camera.ts`). With
the bake gone an STL's spindle `y` becomes `z`, and if `z` kept today's basis the same
stored angles would look at the model from its side: the spike's CA0 column, 5k–45k pixels
different at max delta 255 for every `x`, `-x`, `y`, `-y` sample, the cat side-on in
`sheet__fat_cat.stl.png`. Two fixes were measured and **emit identical bytes** (CB vs CA1:
0 differing pixels on every probe sample):

- (A) keep the table, add an azimuth offset per axis pair to every stored camera
  (`x` +90°, `-x` −90°, `y` −90°, `-y` +90°, `z` 0°, `-z` 0°) — and also patch
  `cameraForPose`, since under today's table its derived offset lands exactly that far
  off (Benchy 90°→0°, bod_test_cube 405°→315°), which would need a `POSE_VERSION` bump
  and a re-render of every posed thumbnail (3,077 in the primary cache).
- (B) redefine the table as the image of today's under the inverse bake
  R⁻¹: (x, y, z) ↦ (x, −z, y) applied to `s`, `a`, `b`, re-keyed by the axis the spindle
  vector then names. Derived in code by the spike, matching the coordinator's derivation
  on all six:

  | new key | s | a | b | image of today's |
  |---|---|---|---|---|
  | `z` | (0,0,1) | (1,0,0) | (0,−1,0) | `y` |
  | `-z` | (0,0,−1) | (0,−1,0) | (1,0,0) | `-y` |
  | `-y` | (0,−1,0) | (0,0,1) | (1,0,0) | `z` |
  | `y` | (0,1,0) | (1,0,0) | (0,0,1) | `-z` — equal to today's `y` |
  | `x` | (1,0,0) | (0,−1,0) | (0,0,1) | `x` |
  | `-x` | (−1,0,0) | (0,0,1) | (0,−1,0) | `-x` |

  Under (B) an STL's stored camera is untouched, the default view is the same picture, and
  `cameraForPose` returns today's axis-migrated answer with the same az/el on all seven
  posed samples, because both its basis and `u₀` pass through R⁻¹ together and the dot
  products it derives the offset from are invariant. No pose-version bump.

(B) it is. Its one cost: OBJ was never baked, so its stored cameras were measured in
today's table, and the table moved for four of six spindles. Measured on the L-bracket:
0/0 at spindle `y` (the new `y` equals the old, so every un-posed OBJ at the default is
untouched), 36,716 px / 255 at spindle `z`, restored to 0/0 by the swap offset. The
migration (D5) covers it.

**Not pixel-identical, and why that is fine.** CB differs from C0 on 0.4–1.8 % of pixels
per STL (240–1147 of 65,536), max channel delta 28–60, mean ≈ 4, 73–85 % of them on an
edge already present in the baseline. Isolated by elimination: with the key light not
casting, three of four samples go to 0/0 and the fourth from 1008 to 53 (to 4 with AO off);
MSAA 1 vs 4 changes nothing; float32 rounding of the bake is excluded (≤ 6.1e-17 relative,
and a `rotateX(+π/2); rotateX(−π/2)` round trip under C0 gives 0/0). It is the shadow
map's texel grid landing sub-texel differently in the rotated world. So cached thumbnails
are not re-rendered: nothing structural moves and no pixel differs by more than 60/255.
`RIG_VERSION` is not bumped, on the same reasoning the AO-dimension change used — a
render that is visibly the same picture is not a new recipe.

### D4: The pose is read in file coordinates, exactly

`toSceneSpace` is deleted. `axisOf` looks the file-space `up` up in `AXES` by exact
match as it does now; `cameraForPose` derives its offset from `azimuth_zero` against the
(new) frame for that axis. The semantic-search requirement's sentence "mapped to that
spindle directly" becomes literally true. `POSE_VERSION` stays at 2: the spike shows the
same az/el for every posed sample, so a posed thumbnail rendered before the change is
the picture the code would render after it.

### D5: One-shot migration script, and a frame label

`scripts/migrate-frames.ts <cache-dir>` walks every sidecar in a library's cache
directory. For an entry with a stored `axis` or `camera` and no `frame` label:
- format from the sidecar's `path` extension (`formatOf`);
- STL / 3MF with a stored axis: `axis ← migrateAxis(axis)` where `migrateAxis` is
  `y→z, -y→-z, z→-y, -z→y, x→x, -x→-x` — derived in code from the two tables (the spindle
  vector's image under R⁻¹), never typed; camera untouched. A camera with **no** axis
  gains none: the entry drew about the old default `y` and will draw about the new
  default `z`, whose frame is the old `y` frame, so the camera reads unchanged — and
  writing an axis would withhold an index pose the entry never suppressed;
- OBJ: axis untouched; if a camera is stored and the spindle (stored or the old default
  `y`) is one whose frame moved, `camera.az += swapOffset(axis)` with `swapOffset` derived
  the way `cameraForPose` derives its own, from the old and new bases of that spindle
  (`x` −90°, `-x` +90°, `z` +90°, `-z` −90°, `y` and `-y` 0°);
- writes `frame: 2` (1 being the unlabelled scene-axis convention) atomically, the way
  the cache writes sidecars, and reports counts: read, migrated by relabel, migrated by
  offset, already labelled, skipped (no framing).

Idempotent by the label. The server stores and echoes `frame` like `rig` and `posed` —
never interprets it — and stamps `frame: 2` on every write from now on, so a sidecar
without the label is one the script has not seen. The client's `localFramings` applies
the same two transforms on read to an entry without the label and writes it back
labelled, sharing the transform functions with the script through `shared/` so there is
one implementation.

Why a script and not on-read for the server cache: Masa's call (2026-09-10). The local
cache is on this machine and a run is one command; on-read migration would leave the
server carrying a compatibility path forever. Browsers are the exception because no
script can reach them, and the demo's framings live only there.

### D6: The A/B harness ships as a script

`scripts/frame-ab/` — the spike's `run.mjs` and `client/spike/ab.{html,ts}`, tidied:
Vite on a spare port, playwright-core from the npx cache, chromium-1228, the sample list
and the OBJ fixture generator, the per-pixel diff, the contact sheet. Baseline renders
(C0, from the pre-change code) are checked in under `scripts/frame-ab/baseline/` as PNGs
so the comparison does not need the old code to exist. The check: for every sample, the
current render vs its baseline differs on ≤ 2 % of pixels with no channel delta > 64 —
bounds set from the measured residual (≤ 1.8 %, ≤ 60) with headroom for the ≈ 1 %
cross-process wobble the spike saw in the count. The runtime switches the spike added
(`setBake`, `setFrames`, `setPoseMapping`, `setShadows`, `setThumbSamples`) do **not**
ship; the harness compares against stored baselines instead. `renderThumbnailCanvas`
(the lossless read-back) does ship, as the harness's render path, beside
`renderThumbnail`.

### D7: A temporary compare pill, removed before archive

Masa wants to see both renderings in the app while testing (2026-09-10). A module-level
flag `legacyBake` (`three/bakeToggle.ts`, mirroring `viewer/aoToggle.ts`) read by
`parseModel` (apply the rotation when on), by the frame lookup (today's table when on),
and by the pose mapping (`toSceneSpace` when on), with a pill beside `ssao` labelled
`bake`. Flipping it clears the mesh LRU (`MeshLru.clear`, so the next acquire re-parses
under the other convention), invalidates the thumbs map so tiles re-render, and closes an
open lightbox. **While the pill is on, framings are read-only**: every PUT of camera or
axis is withheld, the way `thumbWrites: false` withholds them on the demo — a session
under the old convention must never write scene axes into a store the migration has
already converted. The pill, the flag, the legacy table and `toSceneSpace` are deleted in
the change's last code task, and the archive dry run is gated on `grep` finding none of
them.

## Risks / Trade-offs

- [A stored OBJ camera at a moved spindle is missed by the migration] → the script
  reports the offset-migrated count; the local cache today holds 0 OBJ entries, so the
  count here is expected to be 0 and a non-zero is a finding to look at. The L-bracket
  unit cell pins the transform.
- [The migration runs twice, or against a cache the new server has already written to]
  → the frame label; the script's report names "already labelled" so a second run reads
  as a no-op.
- [A browser's local framing migrated on read while the pill is on] → the pill's
  read-only rule withholds the write-back too; migration on read happens only under the
  new convention.
- [A cached thumbnail differs from a fresh render in the shadow penumbra] → measured
  ≤ 60/255 on ≤ 1.8 % of pixels; not visible; recorded here so a future pixel comparison
  against an old cache does not read it as a regression.
- [The harness's baseline PNGs rot when the rig changes] → they are baselines for *this*
  change's claim; a later `RIG_VERSION` bump regenerates them with its own sweep, and the
  README in `scripts/frame-ab/` says so.
- [3MF's default becomes `z` with no sample to check] → the loader applies no rotation
  (read, `node_modules/three/examples/jsm/loaders/3MFLoader.js`), and the format is Z-up
  by specification; a generated 3MF fixture is out of scope, so this is reasoned, not
  measured, and the tasks say so.

## Migration Plan

1. Land the code with the pill in place; test with the pill on and off against the real
   library; the harness passes against its baselines with the pill off.
2. Stop the dev server. Run `bun run scripts/migrate-frames.ts ~/.cache/model-browser/<id>`
   for each library id on this machine; record the counts in tasks.
3. Start the server; open models with stored framings (Pikachu, Main_Complete) and confirm
   the view is the one that was stored.
4. Remove the pill and the legacy paths; run the harness again; archive.
5. Demo: redeploy; browsers migrate their local framings on first read.

Rollback: the sidecar transform is invertible (relabel back, subtract the offset) and the
label says which entries to invert; the script takes `--undo`.

## Open Questions

- None blocking. Whether the demo's `deploy/demo/README.md` needs a line about browsers'
  local framings migrating on read is decided at the record task.
