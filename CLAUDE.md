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
- Zip entries use virtual paths `foo.zip!/entry`, one level only — nested zips are
  rejected by design (D6)

## Testing

- Server tests via Hono app.request() MUST pass a loopback `host` header — the
  same-origin guard 403s requests without one
- Zip fixtures: fflate zipSync (see server/test/helpers.ts); cache dir per-test via
  MODEL_BROWSER_CACHE env var
- Manual/E2E: Playwright MCP works here including headless WebGL
