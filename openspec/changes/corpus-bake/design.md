## Context

See proposal.md — Why. What the design has to work with, as read from the source on
2026-09-14 and re-read 2026-09-15 (a citation here is by symbol; re-check it against the
file before relying on it):

- **The store.** `ThumbCache` (server/src/cache.ts) files one sidecar per model at
  `<cache>/<library id>/<sha256(library path)>.json`, the occluded render at
  `<key>.webp` and the unoccluded one at `<key>.noao.webp` (`renderFile`). The sidecar's
  top-level labels describe the occluded render, `noao` the other; both carry `mtime`
  (the model file's), `lighting`, `rig`, `posed` and, where a pose framed the render,
  `poseKey` (`RenderLabels`, `Meta`). The key is the **library** path and the `mtime`
  label is the file's own, so a sidecar written locally is a hit on the box exactly
  when the relative path and the mtime agree there. That equality is the whole ship,
  and it holds only against the tree the box actually serves. The corpus moved to
  `miniatures/decimated` on 2026-09-15 (`8cb6683`) and every file in that tree was
  regenerated on 2026-09-14 between 21:26 and 21:45 local, so
  `Player_Character_Pack_03_3750572/CatfolkRogue.stl` is 2026-09-15 04:26:15.358908391
  UTC and 2,500,084 bytes there against `clustered-hq`'s 2026-08-31 22:05:07.037828483
  UTC and 1,459,484 bytes: the 2026-09-14 bake is keyed to the latter and reads `stale`
  on every tile of the shipping corpus. `rsync -az` preserves mtimes to the nanosecond
  (measured on the 2026-09-14 clustered-hq ship), so the box agrees once the decimated
  corpus is there — which the ship proves by `stat`ing a model on the box (task 4.1),
  never assumes.
- **The two sweeps parse every `*.json` they find as a sidecar, and a JSON file that is
  not one breaks the sweep that reads it.** `maintain` lists the id directory,
  `readMeta`s every `.json` name (a bare `JSON.parse`, no shape check) and asks
  `sourceExists(meta.path)` of each. For a sidecar whose path does not resolve, the
  `LibraryError`/`VPathError` from `library.resolve` reads as false and the entry is
  removed. For a JSON object with **no `path` at all** — a manifest — `meta.path` is
  `undefined`, `library.resolve(undefined)` throws a `TypeError`
  (`libPath.startsWith`), `sourceExists` rethrows anything that is not one of the two
  library errors, and `maintain` has no catch around its loop. `index.ts` runs it as
  `void cache.maintain()`, so the rejection is unobserved: the sweep dies at that file,
  every sidecar listed after it is never `remember`ed (the memo that D3 relies on stays
  cold for them) and the size-cap pass never runs — silently, on every start. Probed
  2026-09-14 (cold review): a flat `bake.json` at the id level survives *and* aborts the
  sweep (`maintain: THREW TypeError … libPath.startsWith`); one at the cache top is
  removed by `sweepLegacy`, whose `parseVPathSafe(undefined)` answers null and whose
  loop `rm`s on that. So the manifest lives in a subdirectory (`bake/`), which both
  sweeps skip — `SNAPSHOT_DIR` (`snapshots/`) already lives under the id directory this
  way — **and** `maintain` gains a guard (D2, task 1.7): a `*.json` whose parse carries
  no string `path` is skipped and reported, never resolved. The subdirectory is the
  design; the guard is what keeps a stray file from taking the sweep down with it.
- **The memo.** `ThumbCache.facts` holds what this process last read or wrote per
  path, `null` for "looked for and absent". It is *written* on every read
  (`ThumbCache.read` → `remember`) and by `maintain`, and *read* by `annotate` alone —
  the listing annotation `listing-tree-cache` §6.2 emits. `read` itself always goes to
  disk (`readMeta` → `readFile`). On the client, `useThumbnails`' `start` short-circuits
  to the image route only when the annotated variant reads `hit` and `usable` passes;
  anything else — `miss`, `stale`, no annotation — pushes the `/api/thumb` lookup.
- **`maintain` runs at startup** (`index.ts`, `void cache.maintain()` once the library is
  ready) **and every `MAINTAIN_EVERY` (32) pixel writes** (`put`, `writesSinceMaintain`).
  On the box `put` is refused (`thumbWrites: false`), so after startup no sweep ever
  runs again.
- **The generate job.** `BulkJobs.enumerate` reads `/api/models?path=<scope>` (a
  maintenance route, refused where `maintenance` is off), asks the index for the poses
  the enumeration lacks — for a `generate` launch only; a `count` runs **no pose wave**
  (`needsPose` is true for `generate` alone) — reads the occlusion preference once
  (`this.deps.ao()`, the scan's `ao`) and derives the work list with `keeps('generate',
  …)` — every model whose render under that variant fails `isCurrentRender`. The
  `library` tab's button reads `Generate N missing thumbnails`; the count re-derives
  when the tab opens and when a job ends. The `ssao` pill (`App.tsx`, a button with
  `aria-pressed`) is the preference. **The wave's failure is silence**: `enumerate`
  ends the wave in `.catch(() => ({}))`, and `ApiClient.semanticPosesFor` already
  drops a failed chunk from its map, so a model whose pose ask did not land carries
  `pose: undefined` — unsettled — into the job, and `renderEntryThumbnail` draws it
  at the default with no `posed`/`poseKey` label, exactly the shape a settled `null`
  produces. On disk the two are indistinguishable; only the index can tell them
  apart (D1 step 8).
- **The job's end.** `BulkJobs.run` sets `phase: 'done'` and `settled: true` in one
  patch when its loop has finished; the chip (`JobChip`, `role="status"`) offers its
  Cancel button exactly while the phase is `deriving`, `confirming` or `running`, so
  "the chip no longer offers Cancel" is the DOM's reading of `settled`. The button's
  count reads zero as soon as the *next* derivation finds no work, which can be before
  the last in-flight entry has landed. And `renderEntryThumbnail` reads the preference
  **live** (`aoEnabled()`, after the queue gate — "a toggle made there is already in
  it") and `skipIfCurrent` then follows the new variant, so a pill toggled while an
  entry is still in flight files that entry under the other variant.
- **The pose route.** `POST /api/semantic/poses` (server/src/app.ts) answers the index's
  poses and, when the ask is *settled* — `answered`, or the status memo reading
  `absent`, `wedged` or `volume-gone` — files `null` for every asked path the index did
  not name (`filed[p] ??= null`). An **unsettled** path (the index warming, the memo
  cold) is **absent from the map**; a settled absence is **present and `null`**. So the
  same route the wave lands on can audit a finished bake: an unlabelled render is right
  exactly when its path comes back present-and-`null` from a ready index. The `wedged`
  and `absent` branches also file `null` — which is why the audit re-reads the index's
  readiness around its batches rather than trusting a `null` alone (D1 step 8).
- **The recipe.** `RIG_VERSION = 7`, `THUMB_LIGHTING = 'camera'`, `THUMB_SIZE = 256`
  (client/src/three/renderer.ts); `POSE_VERSION = 2` (client/src/three/pose.ts). The
  client's `poseKeyFor` (client/src/hooks/useThumbnails.ts) keys a render by the camera
  the pose resolves to, which reads `pose.front.azimuth_deg`/`elevation_deg`
  (`cameraForPose`, client/src/three/pose.ts).
- **The index.** The app maps the index's absolute collection root through the library
  (`mapCollectionRoot` → `library.libPathOf(realpath(root))`, server/src/semantic.ts)
  and reports it on `/api/semantic/status` as a library path, or `detail: 'the index
  covers a location outside the library'` (`OUTSIDE_LIBRARY`) with no root. That route
  relays `collection_root`, `covers`, `elapsed` and the failure text and nothing else;
  the index's own `/status` (mini-classify `src/api.py` `status`, at `DEFAULT_BASE`
  `http://127.0.0.1:8077` unless `MODEL_BROWSER_INDEX` says otherwise) also reports
  `cache_dir`, `views`, `elevations`, `up_axis`, `n_models` and `ready`. **Where a pose
  comes from** (read 2026-09-15, `~/Documents/tests/mini-classify`): `Collection.pose_of`
  (`src/collection.py`) takes the entry from `self.poses` — `pose-cache.json`, loaded by
  `load_pose_cache` — and derives `front` with `pose.front_view(entry, self.view_cfg)`,
  where `view_cfg = view_config(args)` (`src/cachedir.py`) is a token over the run's
  `views` and `elevations`, and those come from the cache directory's `run-params.json`
  through `apply_run_params`. So the poses the app sees are a function of **two** files
  in the cache directory: a re-embed rewrites `pose-cache.json`; a changed view
  configuration leaves it alone and moves every `front`, hence every `poseKey`, all the
  same ("an index cached at 8 views means nothing at 4", `pose_of`'s docstring). Both
  files are what README §3.3 rsyncs to `/srv/index/`. Locally the index must be started
  with the collection root **at `decimated`**, the tree the demo ships, not the
  `deduplicated` tree its `run-params.json` records: `cd ~/Documents/tests/mini-classify
  && .venv/bin/python serve_api.py ~/Documents/tests/test-models/miniatures/decimated
  --cache-dir embed-cache-test --no-volume --port 8077`. Starting the index is the
  user's act, not the script's. **The positional root is a string prefix and nothing
  more** (read 2026-09-15): under `--no-volume`, `Collection.load` takes the manifest
  branch, `load_embedding_matrix_from_poses` carries each `pose-cache.json` key into its
  row as the row's identity, `row_of` matches a caller's path lexically and `pose_of`
  looks up the identity it was handed, so no model file is ever stat'd and the answers
  do not depend on the bytes under the root. That is why the corpus could move from
  `clustered-hq` to `decimated` without re-embedding: the same 2,976 of 3,121 paths
  answer a pose and the same 145 answer a settled `null`, because that split is a
  property of which entries have an `.npy` under these run parameters. `/status` will
  report `n_models: 2976` and `collection_root` as the positional root.
- **A cache hit is a `blob:` URL too.** `ApiClient.getThumb` mints `pngUrl` from the
  answer's base64 with `base64ToBlobUrl` (`URL.createObjectURL`), so an `img` whose
  `src` is `blob:` is either a client render or a lookup hit; only a listing-annotated
  hit (`useThumbnails`' listing-drawn branch, `api.thumbImageUrl`) names
  `/api/thumb/image`. The mesh the client would render from comes over `/api/file`
  (`ApiClient.fetchModel`), and a render goes through `renderThumbnail`
  (client/src/three/renderer.ts) — those two are the tells of a client render, not the
  `src` scheme (task 4.3).
- **The box.** `deploy/demo/compose.yaml` mounts the cache at `/cache` from
  `$CACHE_DIR` (`/srv/cache`), the corpus at `/library`, the index's files at `/index`
  read-only. The host carries nothing but the container engine
  (`deployment-infrastructure`, *Reproducible from the checkout*): no Bun, no Node.
  The client is built inside `app.Dockerfile` from the checkout the box pulled.
- **`three` is the client's.** `server/package.json` depends on `fflate` and `hono`
  only; `three` resolves from `client/node_modules` alone. A server-suite cell that
  imports `client/src/three/renderer.ts` (which imports `three`) is importing across
  the workspace boundary; the constants are read by the client suite (task 2.1).
- **Local proof.** A dry run over one kit (15 models) on 2026-09-14 — the shape in D1,
  local GPU, headless SwiftShader Chromium (`--use-gl=angle --use-angle=swiftshader`):
  occlusion off 15 renders in 1.6 s (9.6/s), on 9.2/s, every PUT 200, every sidecar
  `rig: 7`, `posed: 2`, `poseKey` present, `mtime` equal to the box's (coordinator's
  run; conditions as stated, figures relayed).

## Goals / Non-Goals

**Goals**

- One command bakes the corpus, verifies the store whole — on disk and against the
  index — writes a manifest and says how to ship it; it is safe to re-run and leaves
  no process behind.
- A redeploy that would serve a client whose recipe differs from the bake is refused
  before the build, on the box, with no runtime on the host beyond `sh`.
- The shipped store answers hits for both variants from the first visit, with zero
  client renders on the first screen.

**Non-Goals**

- A served client refusing to boot against a mismatched store, or the server checking
  the manifest at startup (the server does not know the client's constants; moving
  them to `shared/` is an app change with its own CLAUDE.md constraint). The pin is an
  operator step.
- Baking on the box. It has no GPU, no browser and two vCPUs; the local machine renders
  at ~10/s.
- Crowd-warming, a bake endpoint, or writes of any kind on the deployment.
- Lighting variants (one producible mode), retina sizes, or the `deduplicated` tree.
- Backlog 1.10 (the library tab's *reset* under writes-off) — a `public-deployment`
  follow-up, untouched here.
- Hardening `maintain` beyond the one guard the manifest needs (D2). A sidecar with a
  string `path` that is malformed in some other way is the existing sweep's business.

## Decisions

### D1: A Bun TypeScript script, `scripts/bake-demo.ts`, that owns its server

`bun run scripts/bake-demo.ts --root <corpus top> --cache <scratch cache dir>
--index-cache <the index's cache dir> [--port 3199] [--client <scratch build dir>]
[--ship <user@host> --ship-dir </srv/cache/<box id>>]`.

TypeScript under `bun run` rather than an `.mjs`, for the reason `gen-overrides.ts`
gives: the script imports what it must agree with — `RIG_VERSION`, `THUMB_LIGHTING`,
`THUMB_SIZE` from client/src/three/renderer.ts, `POSE_VERSION` from
client/src/three/pose.ts, `SNAPSHOT_DIR` from server/src/snapshot.ts, `MARKER_DIR` from
server/src/library.ts, `POSES_MAX` from shared/types.ts — instead of restating any of
them, and its core (the sidecar verification, the pose audit's judgement, the manifest,
the rsync command) is exported and exercised by the server suite under Node, as
`genOverrides.test.ts` exercises that script. Node APIs only in the core; the driver may
use Bun. Playwright is found, not installed, exactly as `encoder-probe.mjs` finds it
(`findModule`/`findChrome`, `~/.npm/_npx` and `~/.cache/ms-playwright`); those two
functions move to `scripts/playwright-found.mjs` and both scripts import them.

The run, in order; each step's failure stops the run with the server killed:

1. **Build the client** to the scratch directory: `bunx vite build --outDir <dir>
   --emptyOutDir` from `client/` — never `client/dist`, which the dev instance on 3177
   serves (CLAUDE.md). Record `git rev-parse HEAD` and whether the tree is dirty
   (`git status --porcelain` non-empty) — the manifest says which commit's client
   rendered, and a dirty tree is recorded, not refused.
2. **Write the bake configuration** to a scratch file: `{root, listen: {host:
   '127.0.0.1', port}, features: {thumbWrites: true, maintenance: true, appLaunch:
   false, chatTab: false, hostDetails: true}}`. `hostDetails: true` because the script
   reads `/api/library`'s `top` and `id` and `/api/semantic/status`'s `detail`
   (`viewerState`, `viewerIndexStatus` withhold them otherwise).
3. **Start the server** as a child: `bun run server/src/index.ts` with
   `MODEL_BROWSER_CONFIG`, `MODEL_BROWSER_CACHE`, `MODEL_BROWSER_CLIENT` set and
   `MODEL_BROWSER_ROOT` unset. The child is killed on every exit path — normal end,
   thrown error, `SIGINT`/`SIGTERM` — so a bake interrupted at the keyboard leaves no
   server on the scratch port. Wait for `/api/library` to answer `ready`; refuse
   `nested`, `missing`, `unconfigured`. Refuse a port already in use before starting
   (the dry run's scratch instance on 3199 was found this way).
4. **Check the index, twice over.** Through the bake instance,
   `/api/semantic/status?fresh=true` must be `ready` with `collectionRoot === '/'`.
   `warming` is waited on (the index 503s for ~16 s while SigLIP loads); absent, or
   ready with any other root or with `OUTSIDE_LIBRARY` as `detail`, refuses with the
   message naming the root the index reported and the one wanted. This is the check
   that makes an unposed bake impossible: with the root at `deduplicated` the app asks
   for no poses and every render would be unposed corpus-wide. **It also catches a
   wrongly rooted bake**, which is why it cannot be skipped even when the index is
   known to be right: a marker left above `decimated` (a stray
   `.model-browser/library.json` in `test-models`, the CLAUDE.md symptom) makes the
   bake library's top `test-models`, every sidecar key `/miniatures/decimated/…` —
   wrong for the box, whose keys start at the kit — and `collectionRoot` reads
   `/miniatures/decimated`, not `/`. One check, both mistakes. The hazard is live but
   sideways here: markers exist under `clustered-hq` and `deduplicated`, which are
   *siblings* of `decimated` and which `findMarker`'s upward walk never sees.
   Then **directly**, the index's own `/status` at `MODEL_BROWSER_INDEX` (default
   `http://127.0.0.1:8077`): `ready: true`, and `cache_dir` must name the directory
   `--index-cache` points at. `/status` reports the string the index was started with
   (`str(args.cache_dir)` — `embed-cache-test`, relative to the checkout's cwd, in the
   command above), so the compare is: an absolute `cache_dir` must equal
   `realpath(--index-cache)`; a relative one must equal the basename of
   `realpath(--index-cache)`. Anything else refuses, naming both strings. The
   fingerprint (step 9) is taken from `--index-cache`, and this is
   what ties it to the index that actually framed the renders: a fingerprint of some
   other cache directory would pin the redeploy to poses nobody rendered under. The
   `/status` answer's `views`, `elevations`, `up_axis` and `n_models` are kept for the
   manifest.
5. **Enumerate**: `/api/models?path=/` — every model's library path and mtime, and
   `complete`; refuse an incomplete enumeration (the tree cache's bound would leave
   models unbaked and the count would never say so).
6. **Drive generate, twice.** Headless Chromium (`--use-gl=angle
   --use-angle=swiftshader`, the dry run's flags) opens the instance, opens the
   `library` tab (`[role="tab"]` with text `library`), reads the `Generate N missing
   thumbnails` button, presses it, and polls — reopening the tab between polls, since
   the count re-derives on open and on job end. **A pass is over when two things hold:
   the job is settled and a *primed* count derives nothing.** Settled is read off the
   chip (`role="status"` with no Cancel button; `BulkJobs.run`'s last patch sets
   `phase: 'done'` and `settled: true` together) — not off the count, which reads zero
   while the last entries are still in flight.
   **Corrected 2026-09-15, against the DOM (W4's check-in, verified by the
   coordinator):** this step used to say the button is pressed once more and the
   stopping rule is a *launch* settling at `Generated 0 of 0 in the library`. That
   press is impossible — `SidePanel`'s `libraryOps.map` renders the button
   `disabled={n === null || n === 0}`, and Chromium fires no click on a disabled
   control, so no launch can ever derive zero. What the relaunch was wanted for was
   never the launch: it was the **pose wave**, which `BulkJobs.enumerate` runs for a
   `generate` purpose and skips for a `count` (`needsPose`), and without which a model
   whose pose has not landed is judged `current` and its work hidden. So the driver
   runs that wave by hand: at a settled count of zero it enumerates `/api/models`,
   POSTs every entry with `pose === undefined` to `/api/semantic/poses` in `POSES_MAX`
   batches — the route records what it answers through `layers.recordPoses`, and the
   listing's `annotate` reads it back through `layers.poseFor`, so the next
   enumeration carries the poses a launch would have fetched — and reopens the tab.
   **Zero from that primed count is the stopping rule; a bare count of zero is not.**
   If the primed count reads more than zero, the button is enabled again and the pass
   continues. Only after the primed zero is the
   `ssao` pill toggled, the tab reopened, and the same done for the other variant. The
   order matters because `renderEntryThumbnail` reads `aoEnabled()` live: a pill
   toggled with an entry in flight files that entry under the new variant and
   `skipIfCurrent` judges it against the new variant, so the first pass would end
   short by however many were in flight. The job renders under the preference in
   force (the scan's `ao`), which is why the pill, not a query parameter, selects the
   variant. Which variant runs first is the pill's initial state; the script records
   which, and each pass's render count and elapsed time. A pass whose count stops
   falling for a bounded time (a failed model is counted and retried by a relaunch,
   per `thumbnail-jobs`) is relaunched once, then refused with the count that stuck.
7. **Verify on disk** (`verifyBake`, the tested core): for every enumerated model, the
   sidecar at `<cache>/<id>/<sha256(path)>.json` exists; both `<key>.webp` and
   `<key>.noao.webp` exist; top-level and `noao` labels each carry `mtime` equal to
   the model's, `lighting === THUMB_LIGHTING`, `rig === RIG_VERSION`; where the
   sidecar carries `posed` it equals `POSE_VERSION` and `poseKey` is present, on both
   renders alike. Every miss is listed; any miss refuses the manifest. The posed and
   unposed counts are reported; a posed count of zero refuses too — it is the unposed
   corpus-wide bake by another road.
8. **Audit the unposed against the index** (`auditUnposed`, the tested judgement over
   a fetched answer). The disk cannot say whether an unlabelled render is right: the
   index answered `null` for that model (a settled absence, a hit under
   `pose-rerender`'s rule), or its pose ask never landed (the wave's silent failure,
   Context) and the render should have been posed. The second ships a tile the box
   re-renders on every visit — `usable` reads the listing's pose against a render with
   no `posed` — unhealable with writes off, and step 7 passes it. So the script POSTs
   every unlabelled path to the bake instance's `/api/semantic/poses`, at most
   `POSES_MAX` (1024) per request, batched, and requires each path to come back
   **present and `null`**. A path absent from the answer is unsettled — the index was
   not asked or did not answer — and refuses; a path answering a pose is a render that
   should have been posed and refuses; either way the list is printed. Before the
   first batch and after the last, `/api/semantic/status?fresh=true` must read
   `ready`: the route files `null` under an `absent`/`wedged`/`volume-gone` memo too,
   and a `null` from an index that went away mid-audit is not the absence this step is
   looking for. A batch that fails is retried once, then refuses. The 145 unlabelled
   per variant in D-cost's run pass this audit (the coordinator asked `/poses`
   directly for them, 2026-09-14: all `null`; relayed — the script's own run, task
   3.2, re-asks).
9. **Write the manifest** (D2) after the server is stopped, so no sweep of the bake
   instance is running while it lands. The fingerprint hashes `pose-cache.json` **and**
   `run-params.json` under `--index-cache` (Context: the poses are a function of both).
10. **Run the pin check** (`deploy/demo/check-bake.sh`) against the manifest just
    written — the same script the box will run, so the extraction it does by `grep`
    is proven against the constants the bake imported, on every bake.
11. **Print the ship commands** (D4), or run them behind `--ship` (D5).

The library id the bake instance writes locally differs from the box's, and **neither
is known in advance**. `decimated/` carries no `.model-browser/` at all, so the bake
mints a marker there on its first start; `5358d071-…` is `clustered-hq`'s id and is not
it. The box mints its own under the decimated root the same way (`54c0a4e9-…` was the
clustered-hq era's, and its `/srv/cache` directory is left behind holding `snapshots/`).
The script reads the local id from `/api/library` and never assumes it; the box's is
read from its startup line, `library <id> at /library/miniatures/decimated` (task 4.1).

### D2: The manifest lives in `bake/`, the sweep tolerates a stranger, and the pin check is POSIX sh on the box

`<cache>/<id>/bake/bake.json`, written by `manifestFor` as `JSON.stringify(manifest,
null, 2)` and nothing else — two-space indent, every key on its own line, arrays
broken one element per line — because the check on the box reads it line by line with
`sed`, and a writer that ever put two keys on one line would break a read that is
right today. The shape, as the writer emits it (the sha256 keys are distinct on
purpose: two `"sha256"` lines under two parents would each match a line-oriented
read twice):

```json
{
  "version": 1,
  "date": "2026-09-14T00:00:00.000Z",
  "client": {
    "commit": "<sha>",
    "dirty": false
  },
  "recipe": {
    "rig": 7,
    "poseVersion": 2,
    "lighting": "camera",
    "size": 256
  },
  "library": {
    "id": "<local id>",
    "root": "<local fs top>"
  },
  "models": 3121,
  "renders": {
    "ao": 3121,
    "noao": 3121
  },
  "posedModels": 2976,
  "unposedModels": 145,
  "rate": {
    "ao": 7,
    "noao": 8.6
  },
  "elapsed": {
    "ao": 442,
    "noao": 361,
    "total": 815
  },
  "index": {
    "collectionRoot": "/",
    "cacheDir": "<as /status reports it>",
    "models": 2976,
    "views": 8,
    "elevations": [
      20
    ],
    "upAxis": "auto",
    "poseCacheSha256": "<sha256 of pose-cache.json>",
    "runParamsSha256": "<sha256 of run-params.json>"
  }
}
```

Names: `recipe.poseVersion` is the pose mapping version (`POSE_VERSION`), never
`posed` — the sidecar's `posed` label is that same number, but a manifest key that
collides with a count's name in the same file (`posedModels`) was the reviewer's
misread waiting to happen. Counts are `posedModels`/`unposedModels`. The `index`
block records what the index's own `/status` said at bake time (D1 step 4) beside the
two hashes; `index.models` is that answer's `n_models` — how many models the index can
answer a pose for — and is **not** the enumeration's top-level `models`. On this corpus
they differ (2,976 against 3,121), which is the same split `posedModels` reports from
the other side.

**In a subdirectory**, not beside the sidecars and not at the cache top: both are
enumerated by sweeps that treat every `*.json` as a sidecar (Context, second bullet),
and at the id level the consequence is not deletion but an aborted sweep. `snapshots/`
is the precedent. The rsync ships the directory (D4).

**The guard in `maintain`** (task 1.7, the one application code change): in the loop
over `files`, a parsed sidecar whose `path` is not a string is skipped with one
`console.warn` naming the file, before `sourceExists` is asked. Placed in the loop
rather than in `sourceExists` so the cap pass never receives such an entry either.
This is in scope because this change is the one that puts files beside sidecars: a
`bake.json` copied one level up by a hand (`cp bake/bake.json .` while inspecting)
would otherwise take the box's startup sweep down silently — every sidecar after it
unremembered, D3's first listing a `miss` for those — and nothing would say so. The
guard makes that a warning line and a sweep that finishes. `sweepLegacy` and
`migrate` need none: their `parseVPathSafe(undefined)` already answers null and the
file is removed, which is the pre-library directory's rule.

**The check**, `deploy/demo/check-bake.sh <manifest> [<index dir>]`, POSIX sh with
`grep`, `sed` and `sha256sum` — the box has no Bun, and `deployment-infrastructure`
promises the host carries nothing but the container engine, so the check cannot be a
TypeScript program there. It:

- extracts `RIG_VERSION` and `POSE_VERSION` from the two source files by pattern
  (`^export const RIG_VERSION = ([0-9]+)`), and **refuses when a pattern matches
  anything but exactly one line** — a moved or renamed constant breaks the check
  loudly rather than letting it compare against nothing;
- reads `"rig"`, `"poseVersion"`, `"poseCacheSha256"` and `"runParamsSha256"` from the
  manifest by line (`^ *"rig": [0-9]*,\{0,1\}$` and the like — the writer's formatting
  is pinned above), under **the same exactly-one-line guard** as the source reads: a
  manifest a hand edited onto one line, or a future key that shares a name, refuses
  rather than comparing against nothing or against the wrong line. No `jq` on the box;
- when an index directory is given (on the box, `/srv/index`), hashes
  `<dir>/pose-cache.json` and `<dir>/run-params.json` and compares each with its
  manifest line; a missing file is a disagreement, not a skip;
- exits 0 silently when all agree, else prints each disagreement as `rig: checkout 8,
  bake 7` and exits 1; a missing manifest is exit 1 with `no bake manifest at <path>`.

**What "refuses" means for `docker compose up --build`:** the README's §6 line becomes
`git pull && sh deploy/demo/check-bake.sh /srv/cache/<id>/bake/bake.json /srv/index
&& docker compose -f deploy/demo/compose.yaml up -d --build`. The `&&` is the
refusal: the build does not start, the running stack keeps serving, and the message
says which of the four moved. **The rollback line carries the same check** —
`git checkout <rev> && sh deploy/demo/check-bake.sh … && docker compose … up -d
--build` — since the delta says a rollback across a bump is refused and a line without
the check would not refuse it. There is no override flag — the two ways past are a
re-bake (the answer) or leaving the check off the line (visible in the shell history,
and the README says what it costs). §4's first deploy runs without the check, because
it precedes the bake by construction (the id directory does not exist until the app
has written the marker, `demo-infrastructure` D4). **So does the one redeploy that
moves `root`** (recorded 2026-09-15 from W5's check-in): the box mints a new id on
that start, no manifest can exist under it yet, and the check would refuse with `no
bake manifest` — refusing the very deploy the bake depends on. The exemption is
scoped to the *absent id directory*, never to a check that answered no; it is §4's
reason arriving on §6's line, and the README says so on both.

**The commit is recorded, the versions are enforced.** A redeploy whose commit differs
from the bake's at equal versions proceeds: CLAUDE.md routes every pixel change through
`RIG_VERSION`, and `POSE_VERSION` names the pose mapping, so equal versions are the
recipe's own statement that the pixels are the same; refusing on the commit would
demand an eleven-minute bake for every copy change. So the check prints
`commit: checkout <a>, bake <b>` when they differ and **does not change its exit code** —
the one line in the script that reports without refusing. It needs `git` and a checkout
to answer, so it stays silent when `git rev-parse HEAD` fails or when the manifest
carries no `client.commit`: a silent line is neither a pass nor a failure, only an
absence of information, and the four enforced values are unaffected either way.

**Where the cells live.** `server/test/checkBake.test.ts` spawns `sh` on the script
against manifests that `manifestFor` produced in a temp dir — never hand-written JSON,
so a fixture cannot drift from the writer's formatting the reads depend on. The cell
that pins the extraction to the *live* constants imports `RIG_VERSION` and
`POSE_VERSION` from the client modules, and `renderer.ts` imports `three`, which the
server workspace does not have (Context); so that one cell is the client suite's
(`client/test/checkBake.test.ts`), and the server cells read the constants the way the
script does — by the same pattern over the same files — which is the extraction under
test, not a second copy of the number.

Alternatives weighed: a check inside the Docker build (rejected — the build sees no
mount, and `--build-arg` plumbing would carry the number by hand); the server reading
the manifest at start and refusing to serve (rejected — the server does not know the
client's constants, and refuse-to-start conflicts with "the link is never dead" as
`public-deployment` D2 already argued); a TypeScript check run locally over SSH before
pushing (rejected as the only check — the redeploy happens on the box, and a check
that lives elsewhere is the sentence in the README again, one hop removed; the bake
script does run the sh check itself, so the extraction is exercised where Bun is).

### D3: The store is seen without a restart; the app is restarted anyway, for the annotation

Verified against the code, not assumed. Files rsynced under the running app **are
served**: `ThumbCache.read` calls `readMeta`, which reads the sidecar from disk on every
call and only then `remember`s it; the memo is never consulted on the read path. So
`/api/thumb` and `/api/thumb/image` answer a hit for a sidecar that arrived a moment
ago. The memoised `null` the doc comment describes ("a sidecar that was looked for and
was not there … a reader can skip asking") reaches the client only through `annotate`,
and the client does **not** skip asking on it: `useThumbnails`' `start` takes the
listing-drawn branch solely on an annotated `hit`; an annotated `miss` pushes the
`/api/thumb` lookup like an entry with no annotation at all. No TTL is involved — the
memo has none and is refreshed by the very lookup the `miss` provokes.

What a restart buys is the **first listing**. Every path the box's process has looked
up since 2026-09-09 and found absent — every tile a visitor has scrolled onto — is
memoised `null`, and no sweep will refresh it, because `maintain` runs at startup and
every 32 `put`s and `put` is refused. Without a restart, the first visit to each such
listing after the ship annotates those tiles `miss`, and each pays one JSON lookup (the
base64 body, `no-store`) before its memo is corrected; only the *second* listing of
that path annotates `hit` and goes to the immutable image route. With a restart,
`index.ts` runs `cache.maintain()` at startup, which `remember`s every sidecar in the id
directory, so the first listing **after that sweep has completed** annotates every tile
`hit` and the first screen is the image route from the first visit — the whole point of
the bake. The sweep is `void`ed, not awaited: the app serves while it walks the 3,121
sidecars, and a listing served in that window annotates only what the walk has reached
(the rest fall to the lookup, once). Task 4.3 measures after it is done.

So the ship step restarts the app — `docker compose -f deploy/demo/compose.yaml restart
app`, not `up --build`, since nothing in the image changed. The startup sweep also
walks the shipped sidecars through `sourceExists`, resolving each `path` through the
box's library: the relative paths are identical on both machines, so nothing is
removed; the size cap (`DEFAULT_CAP`, 2 GB) is two orders of magnitude above the store
(32.3 MB of images, 33 MB with sidecars by byte count, 56 MB as `du` counts 9,363 small
files in 4 KiB blocks — measured on the scratch cache, 2026-09-15).

### D4: What ships, and what does not

Three things, said in full:

- **Ships**: the local id directory, whole, minus `snapshots/` — which today means
  the `*.json` sidecars, the `*.webp` and `*.noao.webp` renders and `bake/`, and
  tomorrow means whatever else the store files under its id, since the command is an
  exclusion, not a list — rsynced **into the box's id directory**, whose name differs
  and which each side minted for itself: the local one is read from `/api/library`, the
  box's from its startup line (the `54c0a4e9-…`/`5358d071-…` pair was the clustered-hq
  era's and neither survives the move). The command is
  `rsync -az --info=progress2 --exclude 'snapshots/' <local cache>/<local id>/
  <user@host>:<box cache>/<box id>/` — trailing slashes on both, no `--delete`
  (nothing on the box is removed by a ship; a stale sidecar is overwritten by key).
  The script prints the command with both ids filled in, since the id mapping is the
  part a hand gets wrong.
- **Does not ship**: `snapshots/`. The tree snapshot is the box's own (`SnapshotStore`,
  filed under the same id directory) and carries its own root and stats; the box
  revalidates it at startup.
- **Nothing to ship**: contact sheets — `layers.ts`'s previews are derived in memory
  from the listing per folder, in milliseconds, and are not stored; and poses — they are
  the index's, already on the box under `/srv/index`, and the sidecars carry each
  render's `poseKey` for the client's compare.

### D5: One lighting mode, both occlusion variants, the client build that ships

Camera-fixed is the only producible lighting label (`model-thumbnails`, *Recipe-labelled
thumbnails*), so there is one lighting. Both occlusion variants are baked (notes item 8:
the demo bakes both, so the adaptive default and the pill switch instantly), one
*Generate* pass per pill state.

"The client build that ships" is the checkout's commit: the box builds the client in
`app.Dockerfile` from the commit it pulled, and the bake builds it from the same
source. The manifest records the commit; the check enforces the versions (D2). A bake
run on a dirty tree is recorded as such.

`--ship` runs the rsync, the restart and the two hit checks (task 4.2) in sequence,
because the verification needs the model list the script already holds and the id
mapping it already printed. Without the flag it prints them. Argued over print-only:
the three commands plus the GETs are the recipe an operator would otherwise retype
from the README, and the id mapping is exactly the kind of thing that gets typed
wrong; argued over ship-always: an operator may want to inspect the store first, and a
bake with no box in reach (a rehearsal against `deploy/demo/README.md` §8's local
stack) must not fail for want of a host.

### D6: What triggers a re-bake

- `RIG_VERSION` or `POSE_VERSION` moves — every stored render fails `usable` on every
  visit; the check refuses the redeploy until the store is re-baked.
- The corpus changes: a new kit (its models have no sidecar — a miss the client renders
  per visit), or a re-exported file (the mtime moves, the `mtime` label no longer
  matches, `statusFor` says `stale`). A bake is incremental by the job's nature
  (*Generate is incremental by nature*), so a re-bake after a corpus change renders
  only what changed — but it must be run, and the manifest's model count is what a
  later reader compares.
- **The index's poses change — by re-embedding or by view configuration.** The client
  compares the render's `poseKey` with the pose the index now holds (*The source's
  opinion of a model changes*) and re-renders per visit, unhealable with writes off —
  the same shape as a rig bump, per model. A pose the app sees is a function of two
  files in the index's cache directory (Context, *The index*): `pose-cache.json` holds
  the entries, and `run-params.json`'s `views`/`elevations` key the `front_view` each
  entry resolves to, from which the client's `poseKey` is derived. So the manifest's
  fingerprint is the SHA-256 of **both** files — the two README §3.3 ships to
  `/srv/index` — and the check compares both, so an index rsync that changes either is
  refused at the next redeploy until the corpus is re-baked. The assumption D6 carried
  on 2026-09-14 (that `pose-cache.json` is the poses' only home) was read against
  mini-classify's source on 2026-09-15 and found half right: `Collection.pose_of` reads
  the entry from the pose cache and the `front` from the view configuration. Task 1.4
  records the symbols.

### D-cost: What the bake costs

Projected from the dry run: 6,242 renders at ~10/s ≈ 11 min plus mesh loads on the
larger models. The full run started 2026-09-14 at ~10 PUTs/s (`Generate 3102 missing
thumbnails` at its start — 3,121 less the dry run's 19).

**Measured on `clustered-hq`, 2026-09-14 — superseded as the ship's store by the decimated re-run (task 3.2):** this machine (local GPU; headless Chromium via playwright-core with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), a scratch instance on 3199 rooted at `clustered-hq` with writes on and its own cache directory, the index at 8077 on `embed-cache-test` rooted at `clustered-hq` with `--no-volume`, driven by an ad-hoc driver before the script existed (the script's first run is task 3.2 proper; these are the figures it must reproduce): variant A (occlusion off) `Generate 3102 missing thumbnails` → 3,106 PUTs in 361 s = 8.6 renders/s; variant B (on) `Generate 3088` → 3,106 PUTs in 442 s = 7.0/s; wall 815 s for 6,212 PUTs, zero non-200; the id directory holds 3,121 sidecars and 6,242 WebP renders — 32,314,572 bytes of WebP (32.3 MB, 5.2 KB per render), 875,080 bytes of sidecars, 33.9 MB apparent with `snapshots/`, 56 MB as `du -sh` reports it (4 KiB blocks; re-measured 2026-09-15 on the scratch cache, `find -printf '%s'` summed). Labels: every sidecar `rig: 7`, `lighting: camera` on both variants; 2,976 per variant `posed: 2` with a `poseKey`; 145 per variant unlabelled — the index answers `null` for those paths (bases, terrain: `/Werewolf_Miniatures_3712197/werewolfmalebase.stl` and the like; the coordinator asked `/poses` directly for all 145 on 2026-09-14 and every one came back present-and-`null`, which is D1 step 8's audit passed by hand — relayed, and re-run by the script in task 3.2), which under `pose-rerender`'s rule is a settled absence over an unlabelled render, a hit. No sidecar holds a camera or an axis. The dry run's 9.6/s over one small kit was the ceiling; the corpus mean is lower because mesh load and decode share the queue with the render.

**Superseded, 2026-09-15.** The corpus moved to `miniatures/decimated` (`8cb6683`) and
that tree's files carry 2026-09-14 mtimes, so every sidecar above reads `stale` against
the shipping corpus and the store cannot ship. It is kept at
`~/.cache/model-browser-bake/2026-09-14/`, with the ad-hoc driver, its config and its
log, as the driver's precedent and the cost scale only. What carries over is structural:
3,121 models and 6,242 renders (the two trees hold the same 3,121 relative paths), and
2,976 posed with 145 settled-null per variant — that split is the index's property, not
the tree's, since `--no-volume` answers from the cache's records and never reads a model
file (Context, *The index*). What does not carry over is the rate: decimated's meshes are
the larger of the two on this corpus (`CatfolkRogue.stl` 2.5 MB against 1.46 MB) and mesh
load shares the render queue, so task 3.2 records its own figures rather than reproducing
these.

**Measured on `decimated` — the script's own run, 2026-09-15.** The shipping bake.
796 s wall on this machine, headless SwiftShader Chromium, a scratch instance on 3199
rooted at `decimated` with writes on, the index at 8077 on `embed-cache-test` rooted at
`decimated` with `--no-volume` (`n_models: 2976`). **3,122 models** enumerated — the
corpus holds 3,122 `*.stl`, and the 3,121 above is the 2026-09-14 run's own count, one
short of its own tree. Pass 1 (noao) 3,122 renders in 355 s = 8.8/s; pass 2 (ao) 3,120 in
437 s = 7.1/s; zero non-200 PUTs. On disk: 3,122 sidecars, 6,244 WebP, 34.0 MB apparent,
57 MB by `du`; `rig` ∈ {7}, `lighting` ∈ {camera}, **2,976 posed with a `poseKey` on both
renders, 146 unposed and every one present-and-`null` from the index** — step 8's audit
passed by the script rather than by hand. `check-bake.sh` passed; the ship moved 9,367
files and 33,300,403 bytes in 8 s. The rate is below the clustered-hq run's because
decimated's meshes are the larger ones (2.5 MB against 1.46 MB on `CatfolkRogue.stl`) and
mesh load shares the render queue, as predicted.

**What this run proved about step 6, live.** After the `ssao` pill toggled, the button's
own count read zero while the entire ao variant was still unrendered, and the by-hand
pose wave found the work — `pass 2 (ao) the pose wave found 3109 more`. A stopping rule
that trusted the bare count would have ended pass 2 there and shipped an empty ao
variant. The correction recorded in D1 step 6 is not a paper equivalence; it is what made
the second half of this bake happen.

## Risks / Trade-offs

- **The check reads source by pattern.** A refactor that spells `RIG_VERSION` any other
  way makes the extraction match zero lines — refused loudly, by design, and the fix is
  the pattern. A refactor that leaves an *old* spelling somewhere makes it match two —
  also refused. The cell in `checkBake.test.ts` runs the extraction against the
  checkout on every suite run. The manifest reads carry the same guard, and the
  manifest's formatting is the writer's (`JSON.stringify(m, null, 2)`) — a manifest
  produced any other way is refused, not misread.
- **A rollback across a bump is refused too.** Checking out a revision whose constants
  differ from the bake fails the same check — the rollback line carries it (D2); the
  store on the box is one bake deep (no `--delete`, but overwritten by key). A rollback
  that must serve the old recipe needs that recipe's bake — kept locally in its scratch
  cache if the operator kept it. Said in the README.
- **The pose fingerprint is two whole-file hashes.** Any rewrite of `pose-cache.json`
  or `run-params.json` — including one that changes no pose, or a `run-params.json`
  re-written with the same values in another key order — refuses the redeploy.
  Conservative on purpose; the cost is a re-bake that renders nothing new (incremental)
  and takes as long as the enumeration, the two passes' counts reaching zero and the
  pose audit take.
- **The pose audit trusts the index of the moment.** It asks the same index the bake
  rendered under, minutes later; an index restarted on another cache between the
  passes and the audit would be caught by step 4's `cache_dir` check only if the script
  re-ran it, which it does around the audit (the `ready` re-read), but a cache swapped
  *under a running index* is not detectable from here and not a case anyone has built.
- **SwiftShader renders are the shipped pixels.** The dry run and the full run used
  `--use-angle=swiftshader`; a GPU-backed headless run would draw the same rig through a
  different driver. Rig tests pin the recipe, not the rasteriser; if a shipped tile looks
  wrong the first thing to compare is a local GPU render of the same model.
- **The bake instance's sweeps run during the bake** — every 32 writes, each reading
  ~3,121 sidecars and statting two renders. Paid in the dry run's rate already; not
  optimised here.
- **`--ship` restarts a container on the box from a developer machine.** Printed by
  default; the flag is the operator's explicit act.
- **The `maintain` guard is one line in a sweep with a documented invariant** ("the
  index tracks the store by construction"). A skipped file is by definition not an
  entry, so nothing is left unremembered that a listing could ask about; the warning
  is what stops the skip from becoming silence of its own.

## Migration Plan

1. Land the script, the check, the guard and the cells (tasks §1–§2).
2. Run the first full bake locally (§3), against `decimated`. The coordinator's
   2026-09-14 run was against `clustered-hq` and is superseded (D-cost): its figures are
   the scale, not a reproduction target, and its store cannot ship. The invariants the
   run must reproduce are the structural ones — 3,121 sidecars, 6,242 renders, 2,976
   posed and 145 settled-null per variant, zero failures — with the audit passing.
3. Ship: rsync, `restart app`, the hit checks and the first-visit measurement (§4).
4. Records (§5), then the redeploy and rollback lines carry the check from the next
   redeploy on.

Rollback: the store on the box can be emptied (`rm /srv/cache/<id>/*.json
/srv/cache/<id>/*.webp; rm -r /srv/cache/<id>/bake`) and the app restarted — the demo
is then exactly as it was on 2026-09-14, unbaked. The guard in `maintain` stays; it is
inert on a directory with no strangers.

## Open Questions

None that change what is built. The figures in D-cost and task 3.2 are the
coordinator's to fill in; the script's own run re-derives them.
