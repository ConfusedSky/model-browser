# model-browser

3D-print model library browser: Bun+Hono server (127.0.0.1:3177) + React/Vite/three.js
client (5173, proxies /api). Spec-driven via OpenSpec — specs in openspec/, workflow via
/opsx:* commands; design rationale in the change's design.md (decisions D1–D10).

## Commands

- `bun run dev` - start server + client together
- Semantic search needs a second server, not started by `bun run dev`:
  `cd ~/Documents/tests/mini-classify && .venv/bin/python serve_api.py --cache-dir embed-cache2 --port 8077`
  — it answers `/status` at once with `ready:false` and 503s queries for ~16s
  while SigLIP loads, so a connection refusal means not started, not warming
- `bun run test` / `bun run typecheck` - vitest + tsc across workspaces
- `scripts/spec-diff.sh [change | capability change [requirement]]` - diff delta specs
  vs main specs (no args = all active changes; prints `new spec <path>` for new capabilities)
- `openspec validate <name>` takes the change name positionally (`--change` works on
  status/instructions, not validate)

## Workflow

- Parallel Claude sessions implement/archive changes concurrently — re-read files and
  `git status` before planning or editing against earlier reads
- Before writing delta specs, read other active changes' specs/ deltas: two changes
  MODIFYing the same requirement collide at archive — ADD a separate requirement for a
  new concern, and declare hard ordering in tasks.md when changes share files/constants
- Work is committed directly to `main` — no feature branches
- design.md cites specific code (classes, call sites, geometry) — re-check those citations
  against the source when reviewing; plausible-sounding ones have been wrong
- A dev instance is usually already running (check first — not always up; ports 3177/5173,
  EADDRINUSE on a second `bun run dev`) — server (`bun --hot`) and client (Vite HMR) pick
  up edits live
- tasks.md lines that bundle code with a visual-tuning clause ("tune … then freeze") are not
  done when the code lands — leave them open until the pixels are judged
- Archive changes with plain `openspec archive` (it applies delta specs); if the deltas
  were already synced via /opsx:sync, archive with `--skip-specs` or it errors on collisions
- `openspec archive` needs `--yes` non-interactively, and refuses to drop a scenario the
  MODIFIED block does not carry (MODIFIED replaces prose *and* scenarios). Gate every
  archive on a dry run — `T=$(mktemp -d); cp -r openspec $T/; (cd $T && openspec archive
  <change> --yes)` — **one fresh copy per change**: a successful archive mutates the copy,
  so a loop over one copy reports phantom blocks for later changes. Main moves under
  long-lived deltas, so nothing is wrong when they are written. To retire a scenario a
  change invalidates, rewrite its body under the same title — RENAMED/REMOVED exist for
  requirements, never for scenarios
- A tasks.md line claiming test coverage is not coverage — grep the test file before
  checking it off; `search-options` 5.1 claimed the truncation notice was tested, it was
  not, and the notice contradicted its own requirement through two reviews

## Architecture constraints (violating these breaks recorded design decisions)

- Bun-only APIs allowed ONLY in server/src/index.ts — the Hono app must run on Node
  unchanged (Electron seam, D1)
- All client I/O goes through ApiClient (client/src/api/client.ts) — never raw fetch in
  components (D1)
- Exactly one WebGLRenderer app-wide (client/src/three/renderer.ts); the render queue
  suspends while orbit/lightbox is active (D2/D3)
- Mesh LRU eviction must call geometry.dispose() — dropping the reference leaks VRAM (D5)
- Camera state is bounds-relative, never world coords; thumbnails keyed path+mtime,
  camera by path only (D4)
- Thumbnails always capture 512² at aspect 1 (three/renderer.ts); the live view uses its
  host's aspect — a non-square viewer host persists a thumbnail framed unlike what was seen
- Zip entries use virtual paths `foo.zip!/entry`, one level only — nested zips are
  rejected by design (D6)
- Any change that alters thumbnail pixel output (rig lights, materials, tone mapping) must
  bump RIG_VERSION in client/src/three/renderer.ts — never re-declare its value in a test
  mock (spread the real module; a literal silently masks the bump)
- Scene population goes through `stageModel` (three/renderer.ts) for both thumbnails and
  live sessions — it pivots the model's bounds to the origin and fits the key light found
  by name (KEY_LIGHT); a light added to makeScene without that name is silently never fitted
- Scene teardown (renderThumbnail's finally, ViewerSession.close) disposes every
  DirectionalLight — shadow maps are VRAM; the model is LRU-owned and never disposed there

## Testing

- Suite-specific conventions live with the tests: client/test/CLAUDE.md, server/test/CLAUDE.md
- Run vitest from the workspace dir (`cd client && bunx vitest run …`) — from the
  repo root bunx fetches an unpinned vitest that can't resolve workspace deps
- Manual/E2E: Playwright MCP works here including headless WebGL
  - E2E fixture models: `.superpowers/sdd/tasks/e2e-models/` — six STLs spanning small
    (Enforcer), large-flat (paint-rack), flat-faced (bod_test_cube, the acne/AO test), and
    organic (fat_cat) cases
  - Thumbnail cache: `~/.cache/model-browser/<hash>.{png,json}`; the .json sidecar carries
    `{path, mtime, lighting, rig, posed}` — grep it to map fixtures to hashes or verify a
    RIG_VERSION sweep; `rm -rf` the dir to force re-renders during visual tuning
  - Orbit/lightbox E2E persists path-keyed cameras — tile thumbnails later re-render from
    the new angles; that is not a pixel regression. The pointerup also queues a full
    thumbnail re-render (persist), so wait ~5s before frame-time measurements
  - Playwright MCP writes files only under the repo root or `.playwright-mcp/`; and
    `browser_run_code_unsafe` has no require()/import — move bytes via in-page fetch/canvas,
    or serve them over localhost with a CORS header
  - Model tiles respond only to PointerEvents: dispatch pointerdown on the tile, wait
    ~300ms for the overlay to mount its window listeners, then pointerup on window —
    same-tick release is silently missed. Dir/zip tiles take normal clicks.
  - Grant clipboard upfront via `context.grantPermissions(['clipboard-read',
    'clipboard-write'])` — clipboard calls otherwise hang forever on a permission
    prompt in the headed MCP browser
  - Set React-controlled inputs via the native value setter + `input` event; for
    path-bar navigation, focus the input first and press Enter on the input itself
  - The MCP script sandbox has no setTimeout/setImmediate: page.route handlers, delays, and
    locator-click retry loops die with "setTimeout is not defined". Do waits/interception
    inside page.evaluate (in-page timers); a crashed route handler persists across reloads
    and silently hangs every matched request — recover with page.unrouteAll()
  - browser_evaluate runs in an isolated world (own window.* and fetch); run_code_unsafe's
    page.evaluate is the main world — install fetch wrappers/globals there
  - Vite (5173) binds IPv6-only: curl 127.0.0.1:5173 refuses while localhost/[::1]
    works; the API (3177) binds IPv4 127.0.0.1
  - Verify layout claims by measuring (`getBoundingClientRect` via `browser_evaluate`), not
    screenshots — the MCP screenshot file may not land anywhere findable in the repo
  - Generated STL fixtures need outward *winding* (vertex order): parsing ignores stored
    facet normals and recomputes from winding, so a zeroed normal field is fine — but
    inverted winding still mirrors lighting left/right (false bugs in lighting assertions)
