## Context

Greenfield app. A personal 3D-print model library browser: point it at a directory, see every STL/3MF/OBJ as an orbitable thumbnail, step into zips as if they were folders. Runs locally (server reads arbitrary local paths), single user, no auth. All architectural decisions below were settled in an explore session; this document records them and their rationale.

## Goals / Non-Goals

**Goals:**
- Browser UI served by a local Bun server; `bun run dev` is the whole setup.
- Thumbnails feel live: hover pre-warms, mousedown orbits instantly, released orientation persists across sessions and browsers.
- Zips browse like folders with nothing written into the browsed directory.
- Every seam needed for a later Electron port exists from day one, at near-zero extra cost.

**Non-Goals:**
- Electron shell itself (only the seams for it).
- AI chat backend (panel is a placeholder).
- Hosted/multi-user deployment; any security hardening beyond localhost binding.
- Decimated proxy meshes or handling for pathological file counts (scale target: dozens of files per directory, 1–100MB each).

## Decisions

### D1: Local Bun + Hono server with browser UI (not Electron, not pure-browser)
Pure browser (File System Access API) cannot accept a typed path or reveal real paths — it kills the editable path bar. Electron is heavier dev experience for no v1 benefit. A local server fits the stack (Bun/Vite/React/TS/Tailwind), allows arbitrary path reads, and is where a future AI-chat API key will live.

**Electron-readiness constraints:**
- API layer is Hono, which runs identically on Bun and Node (Electron main is Node).
- No Bun-only APIs (`Bun.serve` internals, `Bun.file`) leak into shared app logic; isolate runtime-specifics at the entry point.
- Frontend performs all I/O through an `ApiClient` interface (`listDir`, `getFile`, `getThumb`, …) — never raw `fetch` in components. Electron later swaps the implementation (HTTP → IPC) or keeps localhost HTTP unchanged.

### D2: Thumbnails are static PNGs; orbit uses one shared live overlay canvas (option B)
Browsers cap live WebGL contexts (~8–16), so per-tile canvases collapse at ~40 files. Full-page scissor-rect rendering (every tile live) is more machinery than the feel requires. Instead: grid tiles are `<img>` PNGs; on mousedown over a tile, the single shared WebGL canvas overlays that tile and drives OrbitControls. One context total, feels like every thumbnail orbits.

### D3: Client renders thumbnails; server persists them
Server-side WebGL means headless-gl (fragile native deps, shaky under Bun) or hidden-Chrome puppeteer. The client already has a GPU and the exact three.js scene (same loaders, materials, lighting) as the orbit view, so thumbnails match the live view pixel-for-pixel. The full-mesh load this implies is unavoidable wherever rendering happens (you cannot rasterize unloaded triangles), transfers are loopback, and the cost is paid once per file version. Bytes loaded for thumbnailing seed the mesh LRU.

Flow: on cache miss, a render queue (limited concurrency, geometry discarded after snapshot) loads → parses → renders → POSTs the PNG to the server.

### D4: Cache keying — thumbnails by `path + mtime`, camera state by `path` only, both server-side
- Thumbnail keyed by `path + mtime`: file content changed → pixels stale → regenerate.
- Camera state keyed by `path` only: re-exporting a model should keep its saved orientation; only the pixels regenerate (using the saved camera).
- Both live server-side (e.g. `~/.cache/model-browser/`), stored together per file as `{png, cameraState}`. localStorage would strand orientation per-browser while server-side thumbnails claimed otherwise — same class of data, same store.
- On orbit release (and lightbox close), client saves camera state + re-snapshotted PNG in one request.

### D5: Hover-warmed, byte-budgeted mesh LRU
On tile hover (after ~120ms linger debounce), fetch + parse the mesh into a client-side LRU so mousedown-orbit is instant. Concurrency cap (~2 parses in flight) prevents hover-storms. LRU budget is measured in **bytes** (default ~1GB, configurable), not entry count — with 1–100MB files, "last N entries" is meaningless as a bound, and a budget much below 1GB couldn't hold even one larger directory's worth of meshes. Mousedown before warm completes → brief spinner in the overlay (no worse than the unwarmed baseline).

### D6: Zip-as-virtual-folder via central directory; no extraction to the browsed directory
The zip central directory (tiny, at end of file) lists contents without decompressing anything. Entering a zip reads only that; entries render in the grid like a normal folder. Individual entries are decompressed server-side on demand when bytes are requested. Virtual path scheme: `<zip-path>!/<entry-path>` (e.g. `models/foo.zip!/parts/lid.stl`) so the rest of the app treats zip entries as ordinary paths. Decompressed bytes are throwaway; the persisted thumbnail is the durable artifact, so zip re-entry never re-decompresses just for thumbs. Zip library: fflate (or equivalent) on the server.

### D7: Formats — STL, 3MF, OBJ via three.js loaders, parsed client-side
Server streams raw bytes; client parses with STLLoader / ThreeMFLoader / OBJLoader. 3MF packages that embed `/Metadata/thumbnail.png` use it as an instant placeholder; our own render replaces it for visual consistency and rotation-state support.

### D8: UI structure
- **Path bar**: editable text input; server-backed autocomplete (directory-listing endpoint); recents in localStorage. Native system picker deferred to Electron (browsers cannot yield absolute paths).
- **Grid**: responsive thumbnail grid of subdirectories, zips, and model files; tiles pop in as the render queue completes.
- **Lightbox**: expanded view as a modal overlay with full orbit/zoom; Esc/click-out closes; closing persists camera + thumbnail like orbit release.
- **Chat panel**: collapsible right-side panel, placeholder message UI only.

### D9: Vite + React SPA + Hono over Next.js (considered exception to stack preference)
Next.js was considered (it's in the preferred stack) and rejected for this app:
- The UI is a single-page, fully client-interactive WebGL app — every component would be `"use client"`; SSR/SEO/routing buy nothing on localhost.
- The server is a filesystem service (streaming large files, zip decompression, thumbnail cache), not page rendering; Hono expresses it with less framework around it.
- Next-in-Electron is awkward in exactly the wrong way: static export (`output: 'export'`) strips API routes — requiring a separate API server anyway — while embedding a Next production server in Electron means bundling it into the asar and managing ports. A Vite SPA builds to static files Electron loads directly, and Hono drops into Electron's Node main (or a sidecar) unchanged.
- Node-vs-Bun doesn't affect this: Hono runs identically on both, so "run it on Node" is already supported by D1.

Revisit if this ever becomes a hosted, multi-page, SEO-visible web app (explicitly a non-goal).

## Risks / Trade-offs

- [First visit to a fresh folder loads every mesh (potentially ~600MB over loopback)] → one-time per file version; queue + tile pop-in reads as progressive, not broken; loopback bandwidth makes transfer negligible.
- [Very large meshes (>100MB) may cause parse/render hitches] → limited-concurrency queue bounds memory; accepted at this scale; decimation is explicitly deferred.
- [Server reads and serves arbitrary local paths] → bind to 127.0.0.1 only; acceptable for a personal localhost tool; revisit before any non-local deployment.
- [`!/` virtual path separator could theoretically collide with a real filename] → `!` in directory names is vanishingly rare; accepted.
- [Bun-specific APIs creeping into shared code erodes the Electron seam] → Hono everywhere, runtime-specifics quarantined to the server entry point, code review against it.
- [Shared overlay canvas must track tile position during scroll/resize] → overlay is dismissed on scroll/resize rather than repositioned (simplest correct behavior).

## Migration Plan

Greenfield — no migration. Rollback = don't ship. Electron port is future work enabled by D1's seams, not part of this change.

## Open Questions

- None blocking. Deferred decisions (Electron shell, chat backend, decimation) are recorded as non-goals.
