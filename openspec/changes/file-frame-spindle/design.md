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
- The pixel comparison that justified the frame strategy stays rerunnable.
- A temporary in-app switch to compare the two renderings during the change's test.

**Non-Goals:**
- Migrating stored framings: the app is unreleased and no store holds any that matter (D5).
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
even at the cost of a migration (a cost that turned out not to fall due — D5). So the rotation goes, and every axis in the client is a
file axis. `parseModel` for STL is then parse, normals from winding, done; OBJ and 3MF are
unchanged in code and correct by construction.

### D2: Default spindle per format, from one function

`defaultAxisFor(format: ModelFormat): OrbitAxis` in `three/camera.ts` — `z` for `stl` and
`3mf`, `y` for `obj` — replaces the sixteen `?? 'y'` and `= 'y'` fallbacks in two groups.
**Axis becomes required** where no format is in scope, the default pushed to the caller:
`camera.ts`'s `statePosition`, `applyState` and `captureState`; `renderThumbnail`
(`three/renderer.ts`) and `ViewerSession`'s constructor (`viewer/session.ts`), which take
a parsed `Object3D` and nothing that names the file. **`defaultAxisFor(formatOfEntry(entry))`**
where an entry is in hand: `ViewerLayer` ×5 — the `sessionAxis` state seed
(`useState<OrbitAxis>('y')`, which becomes the entry's default at mount), `savedPromise`'s
resolved branch, its `.then`, its `.catch`, and `liveFramingView`'s `s?.axis ?? axis ?? 'y'`;
`useThumbnails`' render site; `bulkJobs`' discard path; `entryActions` ×4 — the
`framingAfterDiscard` callers and `DEFAULT_ORBIT_AXIS`, retired, whose one consumer in
`App` (the tile menu's marked letter, `thumbs.get(path)?.axis ?? DEFAULT_ORBIT_AXIS`) takes
the entry's format. `OrbitAxis`'s
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
  (keyed by the **scene axis**: `x` +90°, `-x` −90°, `y` −90°, `-y` +90°,
  `z` 0°, `-z` 0°; not the same six as `swapOffset` in `shared/frames.ts`, which is keyed
  by an OBJ's unchanged axis) — and also patch
  `cameraForPose`, since under today's table its derived offset lands exactly that far
  off (Benchy 90°→0°, bod_test_cube 405°→315°), which would need a `POSE_VERSION` bump
  and a re-render of every posed thumbnail (3,077 sidecars carrying `posed` in the
  primary cache, the coordinator's census of 2026-09-10 over the same 18,428 sidecars).
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
untouched), 36,716 px / 255 at spindle `z`, restored to 0/0 by the swap offset. No store
holds an OBJ camera (D5), so nothing is re-expressed; `swapOffset` records the offset for
the harness (D6).

**Not pixel-identical, and why that is fine.** (Within one process; across processes an
AO-noise floor sits on top — D6.) CB differs from C0 on 0.4–1.8 % of pixels
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

### D5: No stored-data migration

The app is unreleased — Masa, 2026-09-11: "I haven't released this yet so the migration
task doesn't apply anywhere." This machine's caches were deleted before any migration ran
(tasks 0.2 and 5.1); the demo's server-side cache holds no framings, since writes are off
there; and its visitors' browser framings are expendable (Risks). So there is no frame
label, no script and no on-read migration: a stored axis is a file axis, full stop, and a
framing held from before the change reads a quarter turn off — nowhere on this machine,
and on the demo a per-browser convenience the demo never promised to keep.

What was built and removed: a `frame: 2` label on the sidecar and the local framing,
stamped by framing writes and carried through the rest; `scripts/migrate-frames.ts` with
its `.frame-migration` marker, its rolled-back-server refusal and its `--undo`; and
`readLocalFraming`'s on-read transform with write-back — built, reviewed twice, removed on
the decision (the commit that rewrote this section). `SCENE_FRAMES`, `migrateAxis` and
`swapOffset` in `shared/frames.ts` stay: `FILE_FRAMES` is derived from the scene table
(D3), the harness (D6) uses the two functions to express the spike's scene-convention
framings in file terms, and `client/test/frames.test.ts` pins them. `shared/frames.ts` holds the six frames as plain
`[number, number, number]` triples and the derivation (`unbake`, the re-key, `migrateAxis`,
`swapOffset`) as plain arithmetic, with no import of `three`: `shared/` already carries
runtime values (`CAMERA_EPSILON`, which `server/src/cache.ts` imports as a value;
`shared/names.ts`'s `baseName`), both `tsconfig`s include `../shared`, and the server's
(`"types": ["node"]`) has no `three`, so a `three` import there breaks `bun run typecheck`.
`camera.ts` builds its `THREE.Vector3` `FRAMES` from the shared triples — one source, and
the unit cell that asserts D3's table reads the shared one.

### D6: The A/B harness ships as a script

`scripts/frame-ab/` — the spike's `run.mjs`, the sample list, the OBJ fixture generator,
the per-pixel diff, the contact sheet, a config file for the playwright-core and chromium
paths. The page stays under the client, at `client/spike/ab.{html,ts}`: it imports the
app's own modules through Vite, so it needs the client's root and config, and is served by
`bunx vite --port 5174 --strictPort` from `client/`. It does not ship — `vite.config.ts`
sets no `build.rollupOptions.input`, so the build's only entry is `client/index.html` — and
it is typechecked by adding `spike` to `client/tsconfig.json`'s `include`. Baseline
renders (C0, from the pre-change code) are checked in under
`scripts/frame-ab/baseline/` as lossless PNGs so the comparison does not need the old
code to exist: the spike's eleven STL frames (nine samples, two also without AO,
522,728 bytes) and the L-bracket at `y` and `z`, which the spike wrote only into contact
sheets and which task 0.1 captures as single frames from the spike worktree **before**
the bake is removed — after that the old code is gone and C0 cannot be regenerated. These
are the repository's first tracked binaries (`git ls-files` matches no image or model
today); half a megabyte of fixtures that cannot be regenerated is the reason to start.

**Where it runs.** This machine, and only this machine as shipped: the STL samples are
nine files at the root of the real library, not in the repo and not redistributable, and
the page reads them through a live dev server on 3177. The README says so. The claim
the harness supports is "the same picture on the machine the change was measured on";
a machine without the library can run the OBJ fixture alone, which pins the frame math
but not the shadow residual.

**Tolerance**: ≤ 2 % of pixels differing and no channel delta above **96**, on every row
the harness gates. The measured bake residual is ≤ 1.8 % and ≤ 60 (the spike, raw RGBA;
≤ 1.87 % / ≤ 15 composited over the ground in the harness's runs), so 2 % bounds the count
and 96 bounds "a shadow edge moved a texel" with room, still far below the 255 a rotated
model produces. Which rows are gated depends on the mode, because of a floor the spike did
not see, having measured within one process: **the AO pass is not deterministic across
browser processes.** `GTAOPass` builds its noise texture from an unseeded `SimplexNoise`,
whose permutation table comes from `Math.random`, so two processes render the same scene
with different AO noise while one process renders it the same way every time (the spike's
noise floor, 0/0). The L-bracket the task-0.1 worker measured put that floor at ≈ 4.6 %
(three fresh processes, AO on: 1,788–3,035 px / max 14–27 between any pair; AO off: 0/0),
but the bracket has little occluded area: on the real STLs the plumbing run of 2026-09-10
(task 4.1, baseline mode) found **5–23 % of the frame** — the same code in two fresh
Chromium processes differing by 22.40 % on `bod_test_cube_5s`, 13.62 % on
`Pikachu_X_Kakashi`, 5.37 % on `xyzCalibration_cube`, and 0/0 on each with AO off — which
no bound absorbs without also passing a mis-framed model. So the harness has two modes.
**In-process mode** (2026-09-10, task 4.2; TEMPORARY, it goes with the pill at 5.2) renders
C0 in the same page through the pill's flag (`setLegacyBake`; `parseModel` with `bake`,
`frameFor`'s legacy table, the legacy pose mapping — the spike's C0 by construction, and
checked pixel-identical to the spike's stored `-noao` frames, 0/0 on all four) and gates
**every** row, AO on and off, STL and OBJ: 22 rows, 0 failed, the STLs at 0.38–1.87 % /
max 7–15. **Baseline mode**, the one that survives, compares a fresh process against
`baseline/` and gates the `-noao` rows only — all nine STLs, once the in-process run had
written the seven `-noao` C0s the spike had not — printing the AO-on rows as reference
(2026-09-10: 22 rows, 0 failed, 11 reference; the nine `-noao` rows at the in-process
run's counts exactly, the AO-on rows at 3.9–23.1 %). Seeding the AO noise would make the
AO-on rows gateable across processes, but it changes production pixels and is a
`RIG_VERSION` matter for another change. The README records this basis so a later widening
has to argue against it. The runtime
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

**No thumbnail write reaches any store while the pill exists** — on either side of it
(Masa, 2026-09-10). Two guards, because one is not enough. The client's is the **first
line of `LocalFramingClient.putThumb`**, before the `keepsFramingsLocally` branch — so a
withheld write reaches neither the wire nor `localStorage` (a local framing written under
the pill's legacy side would be a scene axis stamped as a file one). It is not a second
outer decorator: `LocalFramingClient` is deliberately a class of explicit delegates so a
new `ApiClient` method fails to compile there, and a throwaway twin of it would be twenty
one-liners deleted again at 5.2; the first line of the one decorator is outermost for the
write path, which is the only path that matters. Every write path goes through it — the
six `putThumb` sites `App` already counts: `useThumbnails`' persist, `bulkJobs`, the
three `entryActions` commands, and the orbit-release `persist` in `App` (the lightbox's
close reaches the wire through that last one, not through `ViewerLayer` itself). The server's is the
shipped one: `features.thumbWrites: false` in `~/.config/model-browser/config.json` for
the test window (restart required), which makes the route refuse. The server-side guard
exists because the client one only covers bundles that carry it: 3177 serves a stale
`client/dist` whenever one exists (CLAUDE.md), a tab opened before the guard landed keeps
its bundle, and other sessions restart the dev instance — any of those writes past a
client-only guard. With the feature off, the shipped `LocalFramingClient` would divert
framings to `localStorage`, which is why the client guard sits in front of that branch.
The reason is the cache key: AO is a key
*dimension* (`<key>.webp` beside `<key>.noao.webp`), so its toggle re-keys and needs no
invalidation, but the bake has no key dimension — both conventions would file pixels
under one key, and `statusFor` never checks the axis, so a legacy-convention render
written during the test would be served as a valid hit after it. Withholding pixels as
well as framings closes that. Cached renders are never deleted: every entry, framed or
not, draws the same picture under the new frames (D3).

The flag mirrors into React state the way `ssao` does (`useState(aoEnabled)` beside the
module flag, both set on click), so a flip re-renders `App` — without that no consumer
would ever be handed the other instance. `BulkJobs` takes `lru` as a **getter**
(`lru: () => MeshLru`), the precedent its own `ao: () => boolean` sets, because its
construction captures the value today and a flip would otherwise rebuild a job mid-run.
The hover warmer needs nothing: `createHoverWarmer` takes a `warm(path)` callback, not an
`lru`, and `App` builds it in a `useMemo` keyed on `[lru]`, so a flip that re-renders with
the other instance rebuilds the warmer around it. `useThumbnails`
keeps `lru` in its sweep deps, so a flip tears the sweep down and restarts it, cancelling
in-flight lookups — accepted, since the flip drops the thumbs map anyway. `ViewerLayer`
re-runs its open effect, and the flip closes it first.

Flipping the pill does not clear the mesh LRU: `MeshLru.clear` has no in-use guard, and
the grid's orbit overlay and any in-flight thumbnail render hold acquired objects across
an await. Instead there are **two LRU instances** for the test window, one per
convention, built in `App` from one loader factory `meshLoader(api, bake: boolean)` —
`parseModel` takes `bake` as an argument rather than reading the flag — and every
consumer that takes `lru` (`ViewerLayer`, `useThumbnails`, `bulkJobs`, the hover warmer)
is handed `legacyBake ? bakeLru : lru`. The 3MF placeholder (`App`'s `placeholderRef`,
called from inside the loader closure) is not an `lru` consumer and needs nothing. Keys
stay bare paths, so `formatOf(path)` in the loader, `fetchModel`, `lru.warm(p)` and the
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

**A stored framing is in the file convention.** With the pill on, a browser framing
written under the file convention is read under legacy frames and shows a quarter turn
off. That is accepted for a test-only pill and recorded here; the server cache is not
exposed to it because both guards hold through the window (Migration Plan). The pill,
the flag, the pill's legacy frame **lookup**, the second LRU instance, `parseModel`'s
`bake` argument and `toSceneSpace` are deleted in the change's last code task, and the
archive dry run is gated on `grep` finding none of them. The pre-bake triples in
`shared/frames.ts` are **not** deleted: `FILE_FRAMES`, `migrateAxis` and `swapOffset`
are derived from the old table and the new, and the harness reads the two functions
(D5/D6).

## Risks / Trade-offs

- [A demo browser holds a framing from before the change] → it reads a file axis where a
  scene axis was stored, a quarter turn off, undetectably. Decided (Masa, 2026-09-10 and
  2026-09-11): demo framings are expendable — they are per-browser conveniences the demo
  never promised to keep — and the deploy README says so. The same goes for a client
  rolled back after the change.
- [A file-convention framing is shown under the pill's legacy side] → accepted for the
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
2. Set `features.thumbWrites: false` in the local config, `rm -rf client/dist`, restart
   the dev instance — **before** the code lands, so the server never runs the new code
   with only the client guard.
3. Land the code with the pill in place; both guards are in force (D7), so the cache on
   this machine is untouched through the whole test window. Masa's test window: the pill
   on and off against the real library; the harness passes against its baselines with the
   pill off (the harness only reads).
4. Masa's test window (task 3.2), both guards in force throughout.
5. Remove the pill, the legacy paths and the guard; suites and the harness green.
6. Start the server; restore `thumbWrites`. Archive.
7. Demo: redeploy. Nothing stored is converted (D5).

Rollback: nothing stored needs inverting (D5); a framing written after the change and read
by code from before it is a quarter turn off, which is the accepted cost (Risks).

## Open Questions

- None.
