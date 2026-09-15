## Context

See proposal.md — Why. What the design has to work with, as read from the source on
2026-09-14 (a citation here is by symbol; re-check it against the file before relying on
it):

- **The store.** `ThumbCache` (server/src/cache.ts) files one sidecar per model at
  `<cache>/<library id>/<sha256(library path)>.json`, the occluded render at
  `<key>.webp` and the unoccluded one at `<key>.noao.webp` (`renderFile`). The sidecar's
  top-level labels describe the occluded render, `noao` the other; both carry `mtime`
  (the model file's), `lighting`, `rig`, `posed` and, where a pose framed the render,
  `poseKey` (`RenderLabels`, `Meta`). The key is the **library** path and the `mtime`
  label is the file's own, so a sidecar written locally is a hit on the box exactly
  when the relative path and the mtime agree there — which they do: `rsync -az`
  preserved mtimes to the nanosecond (coordinator, 2026-09-14, e.g.
  `Player_Character_Pack_03_3750572/CatfolkRogue.stl` 2026-08-31 22:05:07.037828483 UTC
  on both machines).
- **The two sweeps parse every `*.json` they find as a sidecar.** `maintain` lists the
  id directory and `readMeta`s every `.json` name; an entry whose `path` does not
  resolve is removed (`sourceExists` → `library.resolve`, a `LibraryError`/`VPathError`
  read as false → `rm`). `sweepLegacy` and `migrate` do the same over the **top** of the
  cache directory (`parseVPathSafe` → null → `rm`). A manifest named `bake.json` at
  either level is therefore deleted on the next start. Subdirectories are skipped —
  `SNAPSHOT_DIR` (`snapshots/`) already lives under the id directory this way.
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
  the enumeration lacks, reads the occlusion preference once (`this.deps.ao()`) and
  derives the work list with `keeps('generate', …)` — every model whose render under
  that variant fails `isCurrentRender`. The `library` tab's button reads `Generate N
  missing thumbnails`; the count re-derives when the tab opens and when a job ends.
  The `ssao` pill (`App.tsx`, a button with `aria-pressed`) is the preference.
- **The recipe.** `RIG_VERSION = 7`, `THUMB_LIGHTING = 'camera'`, `THUMB_SIZE = 256`
  (client/src/three/renderer.ts); `POSE_VERSION = 2` (client/src/three/pose.ts).
- **The index.** The app maps the index's absolute collection root through the library
  (`mapCollectionRoot` → `library.libPathOf(realpath(root))`, server/src/semantic.ts)
  and reports it on `/api/semantic/status` as a library path, or `detail: 'the index
  covers a location outside the library'` (`OUTSIDE_LIBRARY`) with no root. Locally the
  index must be started with the collection root **at `clustered-hq`**, not the
  `deduplicated` tree its `run-params.json` records: `serve_api.py
  ~/Documents/tests/test-models/miniatures/clustered-hq --cache-dir embed-cache-test
  --no-volume --port 8077` (coordinator, 2026-09-14). Starting the index is the user's
  act, not the script's.
- **The box.** `deploy/demo/compose.yaml` mounts the cache at `/cache` from
  `$CACHE_DIR` (`/srv/cache`), the corpus at `/library`, the index's files at `/index`
  read-only. The host carries nothing but the container engine
  (`deployment-infrastructure`, *Reproducible from the checkout*): no Bun, no Node.
  The client is built inside `app.Dockerfile` from the checkout the box pulled.
- **Local proof.** A dry run over one kit (15 models) on 2026-09-14 — the shape in D1,
  local GPU, headless SwiftShader Chromium (`--use-gl=angle --use-angle=swiftshader`):
  occlusion off 15 renders in 1.6 s (9.6/s), on 9.2/s, every PUT 200, every sidecar
  `rig: 7`, `posed: 2`, `poseKey` present, `mtime` equal to the box's (coordinator's
  run; conditions as stated, figures relayed).

## Goals / Non-Goals

**Goals**

- One command bakes the corpus, verifies the store whole, writes a manifest and says
  how to ship it; it is safe to re-run and leaves no process behind.
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

## Decisions

### D1: A Bun TypeScript script, `scripts/bake-demo.ts`, that owns its server

`bun run scripts/bake-demo.ts --root <corpus top> --cache <scratch cache dir>
--index-cache <the index's cache dir> [--port 3199] [--client <scratch build dir>]
[--ship <user@host> --ship-dir </srv/cache/<box id>>]`.

TypeScript under `bun run` rather than an `.mjs`, for the reason `gen-overrides.ts`
gives: the script imports what it must agree with — `RIG_VERSION`, `THUMB_LIGHTING`,
`THUMB_SIZE` from client/src/three/renderer.ts, `POSE_VERSION` from
client/src/three/pose.ts, `SNAPSHOT_DIR` from server/src/snapshot.ts, `MARKER_DIR` from
server/src/library.ts — instead of restating any of them, and its core (the sidecar
verification, the manifest, the rsync command) is exported and exercised by the server
suite under Node, as `genOverrides.test.ts` exercises that script. Node APIs only in the
core; the driver may use Bun. Playwright is found, not installed, exactly as
`encoder-probe.mjs` finds it (`findModule`/`findChrome`, `~/.npm/_npx` and
`~/.cache/ms-playwright`); those two functions move to `scripts/playwright-found.mjs`
and both scripts import them.

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
4. **Check the index through the bake instance**: `/api/semantic/status?fresh=true`
   must be `ready` with `collectionRoot === '/'`. `warming` is waited on (the index
   503s for ~16 s while SigLIP loads); absent, or ready with any other root or with
   `OUTSIDE_LIBRARY` as `detail`, refuses with the message naming the root the index
   reported and the one wanted. This is the check that makes an unposed bake
   impossible: with the root at `deduplicated` the app asks for no poses and every
   render would be unposed corpus-wide.
5. **Enumerate**: `/api/models?path=/` — every model's library path and mtime, and
   `complete`; refuse an incomplete enumeration (the tree cache's bound would leave
   models unbaked and the count would never say so).
6. **Drive generate, twice.** Headless Chromium (`--use-gl=angle
   --use-angle=swiftshader`, the dry run's flags) opens the instance, opens the
   `library` tab (`[role="tab"]` with text `library`), reads the `Generate N missing
   thumbnails` button, presses it, and polls the button — reopening the tab between
   polls, since the count re-derives on open and on job end — until it reads `Generate
   0 missing thumbnails`. Then the `ssao` pill is toggled, the tab reopened, and the
   same is done for the other variant. The job renders under the preference in force
   (`enumerate`'s `scan.ao`), which is why the pill, not a query parameter, selects the
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
8. **Write the manifest** (D2) after the server is stopped, so no sweep of the bake
   instance is running while it lands.
9. **Run the pin check** (`deploy/demo/check-bake.sh`) against the manifest just
   written — the same script the box will run, so the extraction it does by `grep` is
   proven against the constants the bake imported, on every bake.
10. **Print the ship commands** (D4), or run them behind `--ship` (D5).

The library id the bake instance writes locally (`5358d071-…`, the marker under
`clustered-hq/.model-browser/`) differs from the box's (`54c0a4e9-…`); the script
reads the local one from `/api/library` and never assumes it.

### D2: The manifest lives in `bake/`, and the pin check is POSIX sh on the box

`<cache>/<id>/bake/bake.json`:

```json
{
  "version": 1,
  "date": "2026-09-14T…Z",
  "client": { "commit": "<sha>", "dirty": false },
  "recipe": { "rig": 7, "posed": 2, "lighting": "camera", "size": 256 },
  "library": { "id": "<local id>", "root": "<local fs top>" },
  "models": 3121,
  "renders": { "ao": 3121, "noao": 3121 },
  "posed": 3121, "unposed": 0,
  "rate": { "ao": 9.2, "noao": 9.6 },
  "elapsed": { "ao": 0, "noao": 0, "total": 0 },
  "index": { "collectionRoot": "/", "poseCache": { "file": "pose-cache.json", "sha256": "…" } }
}
```

**In a subdirectory**, not beside the sidecars and not at the cache top: both are
enumerated by sweeps that treat every `*.json` as a sidecar and delete what does not
resolve (Context, second bullet). `snapshots/` is the precedent. The rsync ships the
directory (D4).

**The check**, `deploy/demo/check-bake.sh <manifest> [<pose-cache.json>]`, POSIX sh
with `grep`, `sed` and `sha256sum` — the box has no Bun, and `deployment-infrastructure`
promises the host carries nothing but the container engine, so the check cannot be a
TypeScript program there. It:

- extracts `RIG_VERSION` and `POSE_VERSION` from the two source files by pattern
  (`^export const RIG_VERSION = ([0-9]+)`), and **refuses when a pattern matches
  anything but exactly one line** — a moved or renamed constant breaks the check
  loudly rather than letting it compare against nothing;
- reads `recipe.rig`, `recipe.posed` and `index.poseCache.sha256` from the manifest
  (a fixed-shape file this repository writes, read with `sed` — no `jq` on the box);
- hashes the pose cache file when one is given (on the box, `/srv/index/pose-cache.json`);
- exits 0 silently when all agree, else prints each disagreement as `rig: checkout 8,
  bake 7` and exits 1; a missing manifest is exit 1 with `no bake manifest at <path>`.

**What "refuses" means for `docker compose up --build`:** the README's §6 line becomes
`git pull && sh deploy/demo/check-bake.sh /srv/cache/<id>/bake/bake.json
/srv/index/pose-cache.json && docker compose -f deploy/demo/compose.yaml up -d --build`.
The `&&` is the refusal: the build does not start, the running stack keeps serving,
and the message says which of the three moved. There is no override flag — the two
ways past are a re-bake (the answer) or leaving the check off the line (visible in the
shell history, and the README says what it costs). §4's first deploy runs without the
check, because it precedes the bake by construction (the id directory does not exist
until the app has written the marker, `demo-infrastructure` D4).

**The commit is recorded, the versions are enforced.** A redeploy whose commit differs
from the bake's at equal versions proceeds: CLAUDE.md routes every pixel change through
`RIG_VERSION`, and `POSE_VERSION` names the pose mapping, so equal versions are the
recipe's own statement that the pixels are the same; refusing on the commit would
demand an eleven-minute bake for every copy change. The check prints both commits when
they differ, so the operator sees it.

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
directory, so the first listing after the restart annotates every tile `hit` and the
first screen is the image route from the first visit — the whole point of the bake.

So the ship step restarts the app — `docker compose -f deploy/demo/compose.yaml restart
app`, not `up --build`, since nothing in the image changed. The startup sweep also
walks the shipped sidecars through `sourceExists`, resolving each `path` through the
box's library: the relative paths are identical on both machines, so nothing is
removed; the size cap (`DEFAULT_CAP`, 2 GB) is two orders of magnitude above the store
(~35 MB at 5.6 KB per render).

### D4: What ships, and what does not

Three things, said in full:

- **Ships**: the local id directory's contents — `*.json` sidecars, `*.webp` and
  `*.noao.webp` renders, and `bake/` — rsynced **into the box's id directory**, whose
  name differs (`54c0a4e9-…` on the box against `5358d071-…` here). The command is
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
- **The index is re-embedded and its poses change.** The client compares the render's
  `poseKey` with the pose the index now holds (*The source's opinion of a model
  changes*) and re-renders per visit, unhealable with writes off — the same shape as a
  rig bump, per model. So a pose change on the index side is a re-bake trigger, and
  the manifest's pose fingerprint — the SHA-256 of the index cache's `pose-cache.json`,
  the file §3.3 ships to `/srv/index` — is what the check compares, so an index rsync
  that changes poses is refused at the next redeploy until the corpus is re-baked.
  Assumed, not verified: that `pose-cache.json` is the poses' only home on the index
  side (read from the README's rsync list, not from mini-classify's source); task 1.4
  confirms before the fingerprint is trusted.

### D-cost: What the bake costs

Projected from the dry run: 6,242 renders at ~10/s ≈ 11 min plus mesh loads on the
larger models. The full run started 2026-09-14 at ~10 PUTs/s (`Generate 3102 missing
thumbnails` at its start — 3,121 less the dry run's 19).

**Measured — the coordinator's full run, to be filled in when it ends:**
`[SLOT: renders per variant, elapsed per variant, renders/s per variant, wall time,
store size on disk, failures if any — from the manifest of the run, with the machine
and the Chromium flags]`.

## Risks / Trade-offs

- **The check reads source by pattern.** A refactor that spells `RIG_VERSION` any other
  way makes the extraction match zero lines — refused loudly, by design, and the fix is
  the pattern. A refactor that leaves an *old* spelling somewhere makes it match two —
  also refused. The cell in `checkBake.test.ts` runs the extraction against the
  checkout on every suite run.
- **A rollback across a bump is refused too.** Checking out a revision whose constants
  differ from the bake fails the same check; the store on the box is one bake deep (no
  `--delete`, but overwritten by key). A rollback that must serve the old recipe needs
  that recipe's bake — kept locally in its scratch cache if the operator kept it. Said
  in the README.
- **The pose fingerprint is a whole-file hash.** Any rewrite of `pose-cache.json` —
  including one that changes no pose — refuses the redeploy. Conservative on purpose;
  the cost is a re-bake that renders nothing new (incremental) and takes as long as the
  enumeration and the two passes' counts take to reach zero.
- **SwiftShader renders are the shipped pixels.** The dry run and the full run used
  `--use-angle=swiftshader`; a GPU-backed headless run would draw the same rig through a
  different driver. Rig tests pin the recipe, not the rasteriser; if a shipped tile looks
  wrong the first thing to compare is a local GPU render of the same model.
- **The bake instance's sweeps run during the bake** — every 32 writes, each reading
  ~3,121 sidecars and statting two renders. Paid in the dry run's rate already; not
  optimised here.
- **`--ship` restarts a container on the box from a developer machine.** Printed by
  default; the flag is the operator's explicit act.

## Migration Plan

1. Land the script, the check and the cells (tasks §1–§2).
2. Run the first full bake locally (§3) — already under way as the coordinator's run;
   its figures fill D-cost.
3. Ship: rsync, `restart app`, the hit checks and the first-visit measurement (§4).
4. Records (§5), then the redeploy line carries the check from the next redeploy on.

Rollback: the store on the box can be emptied (`rm /srv/cache/<id>/*.json
/srv/cache/<id>/*.webp; rm -r /srv/cache/<id>/bake`) and the app restarted — the demo
is then exactly as it was on 2026-09-14, unbaked.

## Open Questions

None that change what is built. The figures in D-cost and task 3.2 are the
coordinator's to fill in.
