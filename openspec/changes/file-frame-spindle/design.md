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
`3mf`, `y` for `obj` — replaces the fifteen `?? 'y'` and `= 'y'` fallbacks: `camera.ts`'s
`statePosition`, `applyState` and `captureState` (which take `axis` as required instead —
they have no format in scope); `renderThumbnail`; `ViewerSession`'s constructor;
`ViewerLayer`'s open, catch, close and discard paths; `useThumbnails`' render site;
`bulkJobs`' discard path; `entryActions`' `framingAfterDiscard` callers and
`DEFAULT_ORBIT_AXIS`, retired, whose one consumer in `App` (the tile menu's marked letter,
`thumbs.get(path)?.axis ?? DEFAULT_ORBIT_AXIS`) takes the entry's format. `OrbitAxis`'s
doc comment stops saying "Default 'y'".

`DirEntry.format` is **optional** in `shared/types.ts` ("present when kind === 'model'"),
so the call sites hand an optional to a strict function. The seam is `formatOfEntry(entry:
DirEntry): ModelFormat` beside `formatOf`: `entry.format ?? formatOf(entry.path)`, and if
that is `null` it throws naming the path. Throwing is right, not a fallback: the server
assigns `kind: 'model'` only through `MODEL_EXT` (`listing.ts`), the same three
extensions `formatOf` matches, so a model entry with an unclassifiable path is a
programming error on the wire, and a silent default would be exactly the hidden
convention this change removes. `defaultAxisFor` itself never sees `null` or `undefined`.

### D3: Redefine the six frames as the bake's image — strategy B

Camera angles are measured in a per-spindle basis (`FRAMES` in `three/camera.ts`). With
the bake gone an STL's spindle `y` becomes `z`, and if `z` kept today's basis the same
stored angles would look at the model from its side: the spike's CA0 column, 5k–45k pixels
different at max delta 255 for every `x`, `-x`, `y`, `-y` sample, the cat side-on in
`sheet__fat_cat.stl.png`. Two fixes were measured and **emit identical bytes** (CB vs CA1:
0 differing pixels on every probe sample):

- (A) keep the table, add an azimuth offset per axis pair to every stored camera
  (keyed by the **pre-migration scene axis**: `x` +90°, `-x` −90°, `y` −90°, `-y` +90°,
  `z` 0°, `-z` 0°; not the same six as D5's `swapOffset`, which is keyed by an OBJ's
  unchanged axis) — and also patch
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

  Two fixed points: the new `y` equals today's `y`, and the new `-y` (image of today's
  `z`) equals today's `-y`. Every row keeps `a × b = −s`, since R⁻¹ is a proper rotation
  and the re-key uses R⁻¹s itself, so no spindle's drag direction reverses (the
  reviewer's numerical check, all six rows).

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

`CameraState.target` is the one part of a stored camera that is **not** spindle-relative:
`captureState` writes it as `target − bounds.center` in world axes, so under R⁻¹ a non-zero
target would point at a different part of the model. It is left unmigrated deliberately:
every one of the 74 stored cameras on this machine has a zero target (the reviewer's census),
nothing pans today, and mapping it would be code for a case that does not exist. The
sentence stays here so the first change that pans knows the target needs R⁻¹ too.

### D4: The pose is read in file coordinates, exactly

`toSceneSpace` is deleted. `axisOf` looks the file-space `up` up in `AXES` by exact
match as it does now; `cameraForPose` derives its offset from `azimuth_zero` against the
(new) frame for that axis. The semantic-search requirement's sentence "mapped to that
spindle directly" becomes literally true. `POSE_VERSION` stays at 2: the spike shows the
same az/el for every posed sample, so a posed thumbnail rendered before the change is
the picture the code would render after it.

### D5: One-shot migration script, and a frame label

`scripts/migrate-frames.ts <cache-dir> [--undo]` walks every sidecar in a library's cache
directory. For an entry with a stored `axis` or `camera` and no `frame` label:
- format from the sidecar's `path` extension (`formatOf`; a path it cannot classify is
  reported and left untouched — never guessed);
- STL / 3MF with a stored axis: `axis ← migrateAxis(axis)` where `migrateAxis` is
  `y→z, -y→-z, z→-y, -z→y, x→x, -x→-x` — derived in code from the two tables (the spindle
  vector's image under R⁻¹), never typed; camera untouched. A camera with **no** axis
  gains none: the entry drew about the old default `y` and will draw about the new
  default `z`, whose frame is the old `y` frame, so the camera reads unchanged — and
  writing an axis would withhold an index pose the entry never suppressed;
- OBJ: axis untouched; if a camera is stored and the spindle (stored or the old default
  `y`) is one whose frame moved, `camera.az += swapOffset(axis)` with `swapOffset` derived
  the way `cameraForPose` derives its own, from the old and new bases of that spindle
  (keyed by the OBJ's **unchanged** axis: `x` −90°, `-x` +90°, `z` +90°, `-z` −90°, `y`
  and `-y` 0°; the sign matches `captureState`'s `az = atan2(dir·a, dir·b)`, azimuth
  measured from `b` toward `a`);
- writes `frame: 2` (1 being the unlabelled scene-axis convention) atomically, the way
  the cache writes sidecars, and reports counts: read, migrated by relabel, migrated by
  offset, label-only (camera without axis — 0 of the 74 on this machine, so 5.2's
  recorded zero is expected and the unit cell is what exercises the branch), already
  labelled, unclassifiable, skipped (no framing);
- writes `<cache-dir>/.frame-migration.json` — `{convention: 2, at, counts}` — a file
  old code never touches (old `put` rebuilds sidecars, nothing else in the directory).
  On a later run the script **refuses** when the marker exists, a framed sidecar is
  unlabelled, and that sidecar's file mtime is newer than the marker's `at`: the
  conjunction means "a framing written after the migration by code that does not know
  the label", which is a rolled-back server, and relabelling it would turn a file axis
  into `-y`. Unlabelled sidecars older than the marker are the ordinary unframed ones
  the script skipped. (An earlier draft keyed this on `rig`; `RIG_VERSION` is 7 before
  and after, so that signal could never fire — the reviewer's catch.)

**Cached renders are not deleted.** Under strategy B the relabelled axis with the
untouched camera draws the same view (D3's measurement), so the 74 renders on this
machine stay valid: 54 camera+axis entries read the same camera in the same frame, 20
axis-only entries read `DEFAULT_CAMERA` in the same frame, and there are no
camera-only entries. An earlier revision deleted them as a belt against renders written
between the pill's removal and the script; the Migration Plan closes that window by
ordering instead — the script runs while the write guard is still in the code.

**The label is stamped only by a write that itself carries a camera or an axis**, and it
is carried through every other write. Two facts about the stores decide this. First,
`ThumbCache.put` keeps the previous axis on a pixels-only write (`merged(opts.axis,
prev?.axis)`), so a server that stamped every write would mark a still-scene axis as
migrated on the first tile re-render and the script would skip it forever. Second, `put`
builds its sidecar fresh — nothing is spread from `prev` — so a field it does not know is
dropped by the next write; `frame` therefore joins `Meta` explicitly, `put` carries
`prev.frame` when the write does not set it — in **both** of `put`'s hand-built
sidecars, the main one and the `png === null` deletion branch (`bulk-thumbnail-jobs`
D3); the size-cap write-back and the library re-key spread the previous meta and carry
a new field for free — and a **discard** (`camera: null` / `axis: null`) counts as a
framing write and stamps, since it states the entry's framing as much as a value does;
and the browser store's `LocalFraming`,
its read pick and `writeLocalFraming`'s merge carry it the same way. Without that, the
first orbit after migration erases the label and the next script run relabels `z` to
`-y`. A cell on each store pins "framing write after migration keeps the label".

A stored axis of `y` today is mostly **not a choice**: the orbit-release persist sends
the session's axis, which for an un-framed model is the default, so a user who merely
orbited an STL stored `axis: 'y'` — 24 of the primary cache's 29. Migration relabels
them `z`; they were stored before and are stored after, so they withhold an index pose
exactly as they did. A relabel, not a semantic change.

The same transforms run **on read** in the browser store (`readLocalFraming`, at the
store boundary — never inside a React updater, which `useThumbnails` documents must be
pure) for an entry without the label, written back labelled, sharing the functions with
the script through `shared/` so there is one implementation. The transform is
value-idempotent, so two readers in one tick converge on the same answer.

Why a script and not on-read for the server cache: Masa's call (2026-09-10). The local
cache is on this machine and a run is one command; on-read migration would leave the
server carrying a compatibility path forever. Browsers are the exception because no
script can reach them, and the demo's framings live only there.

**Census** (the reviewer's probe, 2026-09-10, `~/.cache/model-browser/*/`): four ids, not
three — 18,428 / 1,507 / 122 / 40 sidecars holding 12+34+1+7 cameras and 29+36+2+7 stored
axes, 74 framed entries in all, every one `.stl`, `0f680186` the only one with `x`-family
axes (2 × `-x`, 1 × `z`). The task iterates the directory, not a written-down list.

### D6: The A/B harness ships as a script

`scripts/frame-ab/` — the spike's `run.mjs` and `client/spike/ab.{html,ts}`, tidied:
Vite on a spare port, playwright-core and chromium found from a config file rather than
hard-coded paths, the sample list, the OBJ fixture generator, the per-pixel diff, the
contact sheet. Baseline renders (C0, from the pre-change code) are checked in under
`scripts/frame-ab/baseline/` as lossless PNGs so the comparison does not need the old
code to exist: the spike's eleven STL frames (nine samples, two also without AO,
522,728 bytes) and the L-bracket at `y` and `z`, which the spike wrote only into contact
sheets and which task 4.1 captures as single frames from the spike worktree **before**
the bake is removed — after that the old code is gone and C0 cannot be regenerated.

**Where it runs.** This machine, and only this machine as shipped: the STL samples are
nine files at the root of the real library, not in the repo and not redistributable, and
the page reads them through a live dev server on 3177. The README says so. The claim
the harness supports is "the same picture on the machine the change was measured on";
a machine without the library can run the OBJ fixture alone, which pins the frame math
but not the shadow residual.

**Tolerance**: ≤ 2 % of pixels differing and no channel delta above **96**. The measured
residual is ≤ 1.8 % and ≤ 60; the count's cross-process spread in the spike's five
launches was 235–250 on the cube, a 6.4 % spread (the spike report's "≈ 1 %" was wrong,
the reviewer's arithmetic), and the magnitude is driver codegen the change does not
control, so 64 gave 6 % headroom on the number most likely to move. 96 is a bound on
"a shadow edge moved a texel", still far below the 255 a rotated model produces; the
README records this basis so a later widening has to argue against it. The runtime
switches the spike added (`setBake`, `setFrames`, `setPoseMapping`, `setShadows`,
`setThumbSamples`) do **not** ship; the harness compares against stored baselines
instead. `renderThumbnailCanvas` (the lossless read-back) does ship, as the harness's
render path, beside `renderThumbnail`.

### D7: A temporary compare pill, removed before archive

Masa wants to see both renderings in the app while testing (2026-09-10). A module-level
flag `legacyBake` (`three/bakeToggle.ts`, mirroring `viewer/aoToggle.ts`) read by
`parseModel` (apply the rotation when on), by the frame lookup (today's table when on),
and by the pose mapping (`toSceneSpace` when on), with a pill beside `ssao` labelled
`bake`.

**No thumbnail write reaches the server while the pill exists** — on either side of it
(Masa, 2026-09-10). One guard at `ApiClient.putThumb`, which every write path goes
through (`useThumbnails`' persist, `ViewerLayer`'s close, `bulkJobs`, the three
`entryActions` commands, the orbit-release persist in `App`), the way the demo's
`thumbWrites: false` withholds them. The reason is the cache key: AO is a key
*dimension* (`<key>.webp` beside `<key>.noao.webp`), so its toggle re-keys and needs no
invalidation, but the bake has no key dimension — both conventions would file pixels
under one key, and `statusFor` never checks the axis, so a legacy-convention render
written during the test would be served as a valid hit after it. Withholding pixels as
well as framings closes that, and it also closes the window D5's label rule guards:
nothing the test session does can stamp or strip a label. The migration script deletes
renders for framed entries (D5); un-framed entries were rendered about the default, whose
new frame is the old one, so their pixels stay valid.

Flipping the pill does not clear the mesh LRU: `MeshLru.clear` has no in-use guard, and
the grid's orbit overlay and any in-flight thumbnail render hold acquired objects across
an await. Instead there are **two LRU instances** for the test window, one per
convention, built in `App` from one loader factory `meshLoader(api, bake: boolean)` —
`parseModel` takes `bake` as an argument rather than reading the flag — and every
consumer that takes `lru` (`ViewerLayer`, `useThumbnails`, `bulkJobs`, the hover warmer,
the 3MF placeholder hook) is handed `legacyBake ? bakeLru : lru` at call time. Keys stay
bare paths, so `formatOf(path)` in the loader, `fetchModel`, `lru.warm(p)` and the
placeholder's `slotsRef.get(path)` all keep working — a key suffix (`<path>#bake`, an
earlier revision) would have failed `formatOf`'s end-anchored regex and thrown on every
load with the pill on. Each instance has its own byte budget; the doubled ceiling is
accepted for a test-only window. The flip closes an open lightbox and the orbit overlay
and drops the thumbs map so tiles re-render into memory only.

**What the withheld writes cost the test window** (the reviewer's trace): tiles do not
go stale — the displayed pixels come from the locally rendered blob and the PUT's answer
is used only for the generation, which `useThumbnails` treats as unknown when absent —
but an orbit is not durable across navigation (the thumbs map is memory-only, so leaving
and returning shows the server's old render), the library tab's reset count still moves
for a framing that was never stored, and a bulk generate job reports every entry
skipped, since `putThumb`'s `{dropped: true}` reads as `skipped`. Task 3.2 says so.

**A framing migrated on read is in file convention.** With the pill on, a browser framing
that was already migrated in an earlier session is read under legacy frames and shows a
quarter turn off. That is accepted for a test-only pill and recorded here; the server
cache is not exposed to it because the script runs after the pill is gone (Migration
Plan). The pill, the flag, the legacy table, the LRU key suffix and `toSceneSpace` are
deleted in the change's last code task, and the archive dry run is gated on `grep`
finding none of them.

## Risks / Trade-offs

- [A stored OBJ camera at a moved spindle is missed by the migration] → the script
  reports the offset-migrated count; the local cache today holds 0 OBJ entries, so the
  count here is expected to be 0 and a non-zero is a finding to look at. The L-bracket
  unit cell pins the transform.
- [The migration runs twice] → the frame label, carried through every write of both
  stores (D5) and stamped only by framing writes; the script's report names "already
  labelled" so a second run reads as a no-op.
- [A server rolled back to old code writes to a migrated cache] → old `put` rebuilds the
  sidecar and drops `frame`, so a later script run would relabel a file axis again
  (`z → -y`). The marker file (D5) makes the script refuse that directory, naming the
  sidecars newer than the marker; the tasks say to run `--undo` before any rollback of
  the server on this machine.
- [Demo browsers have no rollback] → a client rolled back would read file-convention
  framings as scene axes, a quarter turn off, undetectably. Decided (Masa, 2026-09-10):
  demo framings are expendable on rollback — they are per-browser conveniences the demo
  never promised to keep — and the deploy README says so.
- [A framing migrated on read is shown under the pill's legacy side] → accepted for the
  test window (D7).
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

1. Capture the OBJ baselines from the spike worktree (D6) while the old code exists.
2. Land the code with the pill in place. The server writes nothing while the pill exists
   (D7), so the cache on this machine is untouched through the whole test window.
3. Masa's test window: the pill on and off against the real library; the harness passes
   against its baselines with the pill off (the harness only reads).
4. Stop the dev server **with the write guard still in the code**, so no server that ran
   in between could have written. Run `bun run scripts/migrate-frames.ts` over every
   directory in `~/.cache/model-browser/`; record each run's counts in tasks.
5. Remove the pill, the legacy paths and the guard; suites and the harness green.
6. Start the server. Open models with stored framings (Pikachu, Main_Complete) and confirm
   the stored view is the one shown and their cached renders are served as hits (no
   re-render, by D5). Archive.
7. Demo: redeploy; browsers migrate their local framings on first read.

Rollback: the sidecar transform is invertible (relabel back, subtract the offset) and the
label says which entries to invert; the script takes `--undo`. Run it **before** any
rollback of the server, since old code erases the label (Risks). Demo browsers are not
rolled back (Risks).

## Open Questions

- None blocking. Whether the demo's `deploy/demo/README.md` needs a line about browsers'
  local framings migrating on read is decided at the record task.
