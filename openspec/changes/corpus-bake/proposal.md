## Why

The demo's thumbnail store is empty. The 2,254 renders of 2026-09-05 were filed under
the previous library identity; the corpus re-sync of 2026-09-09 had the box write a new
marker (`library.json` dated 2026-09-09 06:10 on the box), and the new id directory
`/srv/cache/54c0a4e9-…/` holds only `snapshots/` (coordinator, 2026-09-14, read on the
box). With `thumbWrites: false` a visitor's client renders every tile in its own browser
and stores nothing, so every first visit pays the unbaked cost the notes measured — the
one thing `web-demo-backlog` 1.7 exists to remove. The shape was decided 2026-09-02
(notes, "1.3's bake shape"): preview paths on directory entries, which
`listing-tree-cache` delivered, and "the caches fully warmed, shipped read-only, one code
path with the local app". What is left is the warming, the shipping, and the pin that
`public-deployment`'s Risks named and left as a sentence in a README: with writes off a
visitor cannot heal a stale store, so a client build whose recipe has moved past the bake
re-renders every tile on every visit, forever, and looks exactly like a cache that never
warms.

## What Changes

- **A bake script**, `scripts/bake-demo.ts`, run on the developer machine against the
  local copy of the corpus: it builds the client to a scratch directory, starts its own
  bake server (writes on, maintenance on) on a scratch port with a scratch cache, refuses
  to proceed unless the semantic index at 8077 is ready with a collection root that maps
  to `/` of the bake library (an unposed bake is worse than none) and reports, on its own
  `/status`, the cache directory the pose fingerprint will be taken from, drives the
  `library` tab's *Generate* job under both occlusion settings in headless Chromium until
  each pass has settled and a relaunch finds nothing to do, verifies on disk that every
  model has both renders at the shipping `RIG_VERSION`, `POSE_VERSION` and lighting
  label, asks the index about every render that carries no pose and refuses the bake
  unless each is a settled absence (an unlabelled render whose pose ask never landed
  would re-render on every visit on the box, and the disk cannot tell the two apart), and
  writes a manifest. It owns the server it starts and kills it on exit; it never starts
  the index and never touches the dev instance.
- **A manifest**, `bake/bake.json` under the library's id directory: client commit,
  the three recipe constants, model and render counts, renders per second, the index's
  cache directory and view configuration and the fingerprint of its two pose files, the
  date. In a subdirectory because the store's sweeps parse every `*.json` beside the
  sidecars as a sidecar — and, at the id level, a JSON file with no `path` does not get
  deleted, it makes the startup sweep throw and stop (design Context).
- **One application code change**: `ThumbCache.maintain` skips and reports a `*.json`
  whose parse carries no string `path` instead of resolving `undefined` and dying on the
  `TypeError` — silently, since the startup sweep is `void`ed, and leaving every later
  sidecar unremembered. In scope because this change is what puts files beside sidecars.
- **The pin, enforced**: `deploy/demo/check-bake.sh`, POSIX sh so it runs on the box
  where there is no Bun, compares the checkout's `RIG_VERSION` and `POSE_VERSION` and the
  index's two pose-file hashes against the manifest and exits non-zero when any differs.
  The README's redeploy line — and its rollback line — runs it before `docker compose …
  up -d --build`, joined by `&&`, so a build whose recipe has moved past the bake does
  not start. The bake script runs the same check as its last step.
- **The ship step**: the id directory minus `snapshots/`, rsync'd into the box's own id
  directory (the tree snapshot is the box's and carries its own root); then `docker
  compose restart app`, so the startup sweep indexes the shipped sidecars and, once it
  has completed, the first listing annotates every tile a hit instead of paying one
  lookup per tile per path (design D3). Printed by default, run behind `--ship`.
- **Records**: `deploy/demo/README.md` §7 rewritten around the script and the check, §6's
  redeploy and rollback lines gain the check, `docs/web-demo-notes.md` and
  `web-demo-backlog` 1.7 updated with the bake's figures, `docs/platform-surface.md`
  names the tools the bake and the check assume.

No breaking changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment-infrastructure` — ADDED: the deployment's thumbnail store is baked by a
  repeatable script against the shipping recipe and verified whole, on disk and against
  the index; what ships and how; a redeploy or rollback is refused when the recipe or
  the index's poses have moved past the bake. Its Purpose already covers how the
  deployment is "fed", and its marker scenario already names "a later bake". ADD-only,
  so nothing here collides with `entry-stat-revalidation`'s `public-deployment` delta
  (*The environment overrides single keys*) or any other active change; no active
  change carries a `deployment-infrastructure` delta.
- `model-thumbnails` — ADDED: the maintenance sweep survives a JSON file that is not a
  sidecar. ADD-only; no active change carries a `model-thumbnails` delta.

## Impact

- New: `scripts/bake-demo.ts`, `scripts/playwright-found.mjs` (the Playwright discovery
  lifted out of `scripts/encoder-probe.mjs`, which then imports it),
  `deploy/demo/check-bake.sh`, `server/test/bakeDemo.test.ts`,
  `server/test/checkBake.test.ts`, `client/test/checkBake.test.ts` (the one cell that
  imports the client's constants — `three` is the client workspace's alone).
- Edited: `server/src/cache.ts` (`maintain`'s guard, task 1.7) and its cells,
  `scripts/encoder-probe.mjs` (uses the lifted finder), `deploy/demo/README.md`
  (§3.2's ordering note, §6 both lines, §7), `docs/web-demo-notes.md`,
  `docs/platform-surface.md`, `openspec/changes/web-demo-backlog/tasks.md` (1.7),
  CLAUDE.md (the cache bullet, task 5.3).
- Touched on the box, by the operator: `/srv/cache/<id>/` gains 6,242 renders and their
  3,121 sidecars — 32.3 MB of WebP, 33 MB with the sidecars by byte count, 56 MB as `du`
  counts 9,363 small files in 4 KiB blocks (design D-cost, measured on the first bake's
  scratch cache) — and `bake/bake.json`; the app container is restarted once. Nothing in
  an image changes.
- Depends on the archived `bulk-thumbnail-jobs` (the *Generate* job, its count and its
  `settled` state), `listing-tree-cache` (the enumeration and the listing annotation),
  `ao-as-recipe-dimension` (the second variant), `pose-rerender` (`poseKey`, the settled
  `null` the audit reads) and `demo-infrastructure` (the cache mount, the marker on the
  box).
