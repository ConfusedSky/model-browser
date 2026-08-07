## 1. Project Setup

- [x] 1.1 Scaffold repo: Bun workspace with `server/` (Hono) and `client/` (Vite + React + TS + Tailwind), shared types package or folder, dev script running both
- [x] 1.2 Add dependencies: hono, react, three, fflate, tailwind, vitest; configure Vite dev proxy to the API server
- [x] 1.3 Define shared API types (dir entry, virtual path, thumbnail/camera payloads) and the client `ApiClient` interface wrapping all I/O (no raw fetch in components)

## 2. Server: Directory & File API

- [x] 2.1 Implement `GET /api/dir` — list subdirectories, zips, and model files (stl/3mf/obj) with name, type, size, mtime; error responses for bad paths; bind server to 127.0.0.1
- [x] 2.2 Implement `GET /api/file` — stream raw model file bytes
- [x] 2.3 Implement `GET /api/complete` — subdirectory completions for a partial path
- [x] 2.4 Same-origin guard middleware on all `/api/*` routes: refuse non-loopback `Origin`, refuse non-loopback `Host` (DNS rebinding), never emit CORS headers; serve model bytes as `application/octet-stream` with `X-Content-Type-Options: nosniff` so ORB reliably blocks no-cors `<img>`/`<script>` embeds, which send no `Origin` and so pass the origin check

## 3. Server: Zip Virtual Folders

- [x] 3.1 Implement virtual path parsing (`zip.zip!/entry`) shared by all endpoints
- [x] 3.2 Extend `/api/dir` to list zip contents from the central directory only (fflate), including nested folders; handle corrupt zips with errors; list nested zips but reject entering them with a clear message
- [x] 3.3 Extend `/api/file` to decompress a single zip entry on demand, never persisting decompressed bytes

## 4. Server: Thumbnail & Camera Cache

- [x] 4.1 Implement cache store in `~/.cache/model-browser/` holding `{png, cameraState}` per file, entries filed under a hash of the path — png keyed by path+mtime (for zip entries, the containing zip's mtime), cameraState by path only
- [x] 4.2 Implement `GET /api/thumb` (returns png + camera or miss/stale) and `PUT /api/thumb` (stores png and/or camera in one request)
- [x] 4.3 Cache maintenance: delete superseded-mtime pngs, sweep entries whose source path is gone (virtual paths test the containing zip, not the entry), evict least-recently-read pngs over a configurable size cap (default 2GB); size-cap eviction spares camera state; the existence sweep removes whole entries including camera state

## 5. Client: Browsing UI

- [x] 5.1 App shell layout: path bar, grid area, collapsible right chat panel (placeholder message list + input, no network calls, collapse state in localStorage)
- [x] 5.2 Path bar: editable input with submit/error handling, server-backed autocomplete dropdown, recents from localStorage
- [x] 5.3 Thumbnail grid: responsive grid of directory/zip/model tiles; navigation into directories, zips, and zip subfolders; up navigation through zip hierarchy

## 6. Client: Thumbnail Pipeline

- [x] 6.1 Three.js scene module shared by thumbnails and viewer: loaders (STL/3MF/OBJ), materials, lighting, fit-to-bounds default camera; single shared `WebGLRenderer` used by both the queue and the overlay; bounds-relative camera state serialization (azimuth/elevation/distance-in-bounding-sphere-radii, target relative to the bounding box)
- [x] 6.2 Render queue: limited concurrency, on cache miss load → parse → render 512×512 transparent PNG via the shared renderer → PUT to server; suspend while an orbit overlay or lightbox is active and resume on dismissal; tiles show placeholder then pop in; broken files show error tile; geometry disposed after snapshot unless the LRU retains it
- [x] 6.3 Cache integration: check `/api/thumb` per tile, skip pipeline on hit; re-render on mtime staleness using stored camera; 3MF embedded thumbnail as instant placeholder

## 7. Client: Orbit & Lightbox

- [x] 7.1 Mesh LRU: byte-budgeted (~1GB default, configurable) against parsed geometry on the JS heap, hover linger (~120ms) prefetch with parse-concurrency cap, eviction by bytes calling `geometry.dispose()` on every evicted entry (three.js tracks GPU buffers in a WeakMap — dropping the reference leaks VRAM)
- [x] 7.2 Shared orbit overlay: single WebGL canvas overlaying the active tile on mousedown, OrbitControls drag, spinner when mesh not yet warm, dismissed on pointer-leave/scroll/resize; discriminate click from drag by a ~5px movement threshold — a sub-threshold release opens the lightbox instead of persisting an orbit
- [x] 7.3 Persist on release: save camera state + re-rendered snapshot via one PUT on orbit release and lightbox close
- [x] 7.4 Lightbox: opened by click-without-drag on a model tile (no separate expand affordance); modal expanded view with full orbit/zoom, loading indicator when opened before the mesh is warm, Esc/click-out close, focus trap while open and focus restored to the originating tile on close, same persist path

## 8. Verification

- [x] 8.1 Server tests (vitest): dir listing, autocomplete, zip central-directory listing, entry decompression, virtual paths, nested-zip rejection, cache keying (mtime staleness, zip-entry keys on zip mtime, path-keyed camera), cache sweep/eviction, origin+host guard (cross-origin refused, loopback allowed, model bytes carry `application/octet-stream` + `nosniff`)
- [x] 8.2 Client tests (vitest): LRU byte eviction including that every evicted geometry is disposed, hover debounce, click-vs-drag threshold, bounds-relative camera round-trip including a re-scaled model, ApiClient contract
- [x] 8.3 Manual pass against a real model folder (loose STLs + Printables zip): first-visit pop-in, instant second visit, orbit persistence across browsers, chat panel collapse persistence
