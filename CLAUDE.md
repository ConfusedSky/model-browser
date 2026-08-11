# model-browser

3D-print model library browser: Bun+Hono server (127.0.0.1:3177) + React/Vite/three.js
client (5173, proxies /api). Spec-driven via OpenSpec — specs in openspec/, workflow via
/opsx:* commands; design rationale in the change's design.md (decisions D1–D10).

## Commands

- `bun run dev` - start server + client together
- `bun run test` / `bun run typecheck` - vitest + tsc across workspaces
- `scripts/spec-diff.sh [change | capability change [requirement]]` - diff delta specs
  vs main specs (no args = all active changes; prints `new spec <path>` for new capabilities)
- `openspec validate <name>` takes the change name positionally (`--change` works on
  status/instructions, not validate)

## Workflow

- Parallel Claude sessions implement/archive changes concurrently — re-read files and
  `git status` before planning or editing against earlier reads
- Work is committed directly to `main` — no feature branches
- design.md cites specific code (classes, call sites, geometry) — re-check those citations
  against the source when reviewing; plausible-sounding ones have been wrong
- A dev instance is usually already running (ports 3177/5173, EADDRINUSE on a second
  `bun run dev`) — server (`bun --hot`) and client (Vite HMR) pick up edits live
- Archive changes with plain `openspec archive` (it applies delta specs); if the deltas
  were already synced via /opsx:sync, archive with `--skip-specs` or it errors on collisions

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
  bump RIG_VERSION in client/src/three/renderer.ts AND the renderer mock factories in tests

## Testing

- Component tests: `// @vitest-environment happy-dom` pragma, render with plain
  react-dom (no testing-library), vi.mock `three/renderer` (no WebGL in tests) —
  see client/test/orbitHandoff.test.tsx
- Run vitest from the workspace dir (`cd client && bunx vitest run …`) — from the
  repo root bunx fetches an unpinned vitest that can't resolve workspace deps
- Server tests via Hono app.request() MUST pass a loopback `host` header — the
  same-origin guard 403s requests without one
- Zip fixtures: fflate zipSync (see server/test/helpers.ts); cache dir per-test via
  MODEL_BROWSER_CACHE env var; ad-hoc `bun -e` fixture scripts must run from server/
  (fflate is a workspace dep, not a root one)
- Manual/E2E: Playwright MCP works here including headless WebGL
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
  - Dev servers bind IPv6-only: curl 127.0.0.1:5173 refuses while localhost/[::1] works
  - Generated STL fixtures need real outward normals: zero normals render black, inverted
    normals mirror lighting left/right (false bugs in lighting assertions)
