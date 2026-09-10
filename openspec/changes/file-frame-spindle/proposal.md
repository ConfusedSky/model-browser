## Why

Every STL is rotated a quarter turn about X when it is loaded — a bake from before the
turntable existed, when the scene's up was fixed to Y and a Z-up print file had to be turned
to stand. Since the per-model spindle landed, the scene has no intrinsic up: the camera's up
locks to the spindle, the shadow floor is perpendicular to it, and the light rig follows the
camera. The bake now buys nothing and costs a hidden coordinate change that every stored
axis, every index pose, and the axis pill are read through: a print-bed model whose height
runs along its file's Z shows `Y` in the lightbox, mini-classify's contact sheet says `+Z`
for the same file, the thumbnail sidecar says `axis: "y"`, and the override store's pose
says `up: [0,0,1]` — four spellings of one direction (issue #8). The bake's comment also
claims the 3MF loader rotates on its own; it does not, so 3MF files, Z-up by specification,
currently stand on the wrong axis under the `y` default.

Axes should be the file's own, end to end: what the user sees, what the sidecar stores and
what the index reports should agree without a mapping.

## What Changes

- The load-time rotation is removed. A model is rendered in its file's own coordinates,
  and the orbit spindle names a file axis.
- The default spindle is per format: `+Z` for STL and 3MF (both Z-up by convention), `+Y`
  for OBJ. One function replaces the sixteen hard-coded `'y'` fallbacks in the client.
- The six spindle frames — the azimuth basis each spindle's camera angles are measured in —
  are redefined as the image of today's frames under the inverse of the bake. Measured
  in the change's own A/B harness: under these frames an STL's stored camera and its
  default view draw the same picture as today (shadow-penumbra residual aside), and
  `cameraForPose` returns the same angles it does today, so posed thumbnails need no
  version bump. The alternative — keeping the frames and adding an azimuth offset to
  every stored camera — emits identical bytes but also needs a `cameraForPose` patch and a
  pose-version bump, so it loses on migration cost, not on pixels.
- The index pose is read in file coordinates directly: the scene-space mapping in the pose
  module is deleted, and an index `up` of `[0,0,1]` is spindle `z`.
- **BREAKING for stored data, migrated once**: a stored axis on an STL or 3MF entry means a
  scene axis today and a file axis after; a one-shot script re-labels every such axis
  (`y→z`, `-y→-z`, `z→-y`, `-z→y`, `x`/`-x` unchanged) and leaves the camera untouched,
  and re-expresses the stored camera of any OBJ entry at an `x`, `-x`, `z` or `-z` spindle
  by the frame swap's offset, since OBJ was never baked and its frame moved. Sidecars gain
  a `frame: 2` label — stamped only by writes that carry a camera or an axis, carried
  through every other write — so an entry is migrated once and a pre-migration entry is
  recognisable; a marker file in the cache directory lets the script refuse a directory a
  rolled-back server has written to. Cached renders stay valid and are not touched.
  Browsers' local framings (the demo, where server writes are off) carry the same
  transform under the same label, applied on read since no script reaches them.
- The pixel A/B that decided the frame strategy ships as a rerunnable harness
  (`scripts/frame-ab/`), with the baseline renders checked in and a tolerance from the
  measured residual, so the claim "same picture" can be re-checked on the machine it was
  measured on (the samples are the real library's files; the OBJ fixture alone travels).
- **Temporary, removed before archive**: a corner pill beside `ssao` that flips the live
  app between the bake and the file frame, so both can be seen in the grid and the
  lightbox while the change is under test. No thumbnail write reaches the server while
  the pill exists, on either side of it.
- Issue #8 closes with this change: the pill and the contact sheet then name the same axis.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-viewer`: *Upright model display* — no parse-time conversion for any format;
  upright follows from the spindle default; *Per-model orbit spindle* — the spindle is a
  file axis and the default is the format's convention, not +Y.
- `model-thumbnails`: *Camera state stored alongside thumbnails* — a missing axis is
  rendered as the format's default; stored axes are file axes; entries written before
  this change are migrated once and labelled.
- `semantic-search`: *A pose orients the model without becoming its stored camera* — the
  index's up axis is the spindle, literally, with no coordinate mapping between them.

## Impact

- Client: `shared/frames.ts` (new: the frames as plain triples, the derivation, the
  migration arithmetic), `three/models.ts` (the bake), `three/camera.ts` (`FRAMES`, and a
  `defaultAxisFor(format)`), `three/pose.ts` (`toSceneSpace` deleted, `axisOf` an exact
  lookup on the file vector), the sixteen `'y'` fallbacks (`camera`, `renderer`,
  `session`, `ViewerLayer`, `useThumbnails`, `bulkJobs`, `entryActions`, `App`) through
  a `formatOfEntry` seam, `api/localFramings.ts` (the on-read
  migration), the lightbox and menu axis pickers (unchanged in code — they show the
  spindle, which is now a file axis).
- Server: `cache.ts` (`frame` label on the sidecar, carried through `put`, never interpreted; not
  on the wire — no client reads it).
- Scripts: `scripts/migrate-frames.ts` (one-shot over a cache directory), `scripts/frame-ab/`
  and `client/spike/ab.{html,ts}` (the A/B harness and its page, from the spike).
- Tests: camera/pose/models units (frames, defaults, migration transform), client cells for
  the pickers' labels and the default spindle per format, server cells for the label, the
  A/B harness as a task with recorded numbers.
- Data: this machine's four caches under `~/.cache/model-browser/` (74 framed entries,
  all STL; the primary holds 29 stored axes and 12 cameras across 18,428 sidecars) run
  through the script; the demo
  box has no server-side framings (writes are off) and its browsers migrate on read.
- Records: `docs/web-demo-notes.md` if it names the axis anywhere; issue #8 closed with a
  comment pointing here.
