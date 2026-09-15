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
  to `/` of the bake library (an unposed bake is worse than none), drives the `library`
  tab's *Generate* job under both occlusion settings in headless Chromium until the app's
  own count reads zero for each, verifies on disk that every model has both renders at
  the shipping `RIG_VERSION`, `POSE_VERSION` and lighting label, and writes a manifest.
  It owns the server it starts and kills it on exit; it never starts the index and never
  touches the dev instance.
- **A manifest**, `bake/bake.json` under the library's id directory: client commit,
  the three recipe constants, model and render counts, renders per second, the index's
  pose fingerprint, the date. In a subdirectory because the store's sweeps parse every
  `*.json` beside the sidecars as a sidecar and delete what does not resolve.
- **The pin, enforced**: `deploy/demo/check-bake.sh`, POSIX sh so it runs on the box
  where there is no Bun, compares the checkout's `RIG_VERSION` and `POSE_VERSION` and the
  index's pose fingerprint against the manifest and exits non-zero when any differs. The
  README's redeploy line runs it before `docker compose … up -d --build`, joined by
  `&&`, so a build whose recipe has moved past the bake does not start. The bake script
  runs the same check as its last step.
- **The ship step**: the id directory's `*.json` and `*.webp` and the `bake/` directory,
  rsync'd into the box's own id directory (`snapshots/` excluded — the tree snapshot is
  the box's and carries its own root); then `docker compose restart app`, so the
  startup sweep indexes the shipped sidecars and the first listing annotates every tile
  a hit instead of paying one lookup per tile per path (design D3). Printed by default,
  run behind `--ship`.
- **Records**: `deploy/demo/README.md` §7 rewritten around the script and the check, §6's
  redeploy line gains the check, `docs/web-demo-notes.md` and `web-demo-backlog` 1.7
  updated with the bake's figures, `docs/platform-surface.md` names the tools the bake
  and the check assume.

No application code changes. No breaking changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment-infrastructure` — ADDED: the deployment's thumbnail store is baked by a
  repeatable script against the shipping recipe and verified whole; what ships and how;
  a redeploy is refused when the recipe or the index's poses have moved past the bake.
  Its Purpose already covers how the deployment is "fed", and its marker scenario
  already names "a later bake". ADD-only, so nothing here collides with
  `entry-stat-revalidation`'s `public-deployment` delta (*The environment overrides
  single keys*) or any other active change; no active change carries a
  `deployment-infrastructure` delta.

## Impact

- New: `scripts/bake-demo.ts`, `scripts/playwright-found.mjs` (the Playwright discovery
  lifted out of `scripts/encoder-probe.mjs`, which then imports it),
  `deploy/demo/check-bake.sh`, `server/test/bakeDemo.test.ts`,
  `server/test/checkBake.test.ts`.
- Edited: `scripts/encoder-probe.mjs` (uses the lifted finder), `deploy/demo/README.md`
  (§3.2's ordering note, §6, §7), `docs/web-demo-notes.md`, `docs/platform-surface.md`,
  `openspec/changes/web-demo-backlog/tasks.md` (1.7).
- Touched on the box, by the operator: `/srv/cache/<id>/` gains ~6,242 renders and their
  sidecars (~35 MB at the measured 5.6 KB per WebP) and `bake/bake.json`; the app
  container is restarted once. Nothing in an image changes.
- Depends on the archived `bulk-thumbnail-jobs` (the *Generate* job and its count),
  `listing-tree-cache` (the enumeration and the listing annotation),
  `ao-as-recipe-dimension` (the second variant), `pose-rerender` (`poseKey`) and
  `demo-infrastructure` (the cache mount, the marker on the box).
