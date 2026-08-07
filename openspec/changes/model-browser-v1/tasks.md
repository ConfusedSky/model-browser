## 1. Project Setup

- [ ] 1.1 Scaffold repo: Bun workspace with `server/` (Hono) and `client/` (Vite + React + TS + Tailwind), shared types package or folder, dev script running both
- [ ] 1.2 Add dependencies: hono, react, three, fflate, tailwind; configure Vite dev proxy to the API server
- [ ] 1.3 Define shared API types (dir entry, virtual path, thumbnail/camera payloads) and the client `ApiClient` interface wrapping all I/O (no raw fetch in components)

## 2. Server: Directory & File API

- [ ] 2.1 Implement `GET /api/dir` — list subdirectories, zips, and model files (stl/3mf/obj) with name, type, size, mtime; error responses for bad paths; bind server to 127.0.0.1
- [ ] 2.2 Implement `GET /api/file` — stream raw model file bytes
- [ ] 2.3 Implement `GET /api/complete` — subdirectory completions for a partial path

## 3. Server: Zip Virtual Folders

- [ ] 3.1 Implement virtual path parsing (`zip.zip!/entry`) shared by all endpoints
- [ ] 3.2 Extend `/api/dir` to list zip contents from the central directory only (fflate), including nested folders; handle corrupt zips with errors
- [ ] 3.3 Extend `/api/file` to decompress a single zip entry on demand, never persisting decompressed bytes

## 4. Server: Thumbnail & Camera Cache

- [ ] 4.1 Implement cache store in `~/.cache/model-browser/` holding `{png, cameraState}` per file — png keyed by path+mtime, cameraState by path only
- [ ] 4.2 Implement `GET /api/thumb` (returns png + camera or miss/stale) and `PUT /api/thumb` (stores png and/or camera in one request)

## 5. Client: Browsing UI

- [ ] 5.1 App shell layout: path bar, grid area, collapsible right chat panel (placeholder message list + input, no network calls, collapse state in localStorage)
- [ ] 5.2 Path bar: editable input with submit/error handling, server-backed autocomplete dropdown, recents from localStorage
- [ ] 5.3 Thumbnail grid: responsive grid of directory/zip/model tiles; navigation into directories, zips, and zip subfolders; up navigation through zip hierarchy

## 6. Client: Thumbnail Pipeline

- [ ] 6.1 Three.js scene module shared by thumbnails and viewer: loaders (STL/3MF/OBJ), materials, lighting, fit-to-bounds default camera; camera state serialization
- [ ] 6.2 Render queue: limited concurrency, on cache miss load → parse → render PNG → PUT to server; tiles show placeholder then pop in; broken files show error tile; geometry released after snapshot unless LRU keeps it
- [ ] 6.3 Cache integration: check `/api/thumb` per tile, skip pipeline on hit; re-render on mtime staleness using stored camera; 3MF embedded thumbnail as instant placeholder

## 7. Client: Orbit & Lightbox

- [ ] 7.1 Mesh LRU: byte-budgeted (~1GB default, configurable), hover linger (~120ms) prefetch with parse-concurrency cap, eviction by bytes
- [ ] 7.2 Shared orbit overlay: single WebGL canvas overlaying the active tile on mousedown, OrbitControls drag, spinner when mesh not yet warm, dismissed on pointer-leave/scroll/resize
- [ ] 7.3 Persist on release: save camera state + re-rendered snapshot via one PUT on orbit release and lightbox close
- [ ] 7.4 Lightbox: modal expanded view with full orbit/zoom, Esc/click-out close, same persist path

## 8. Verification

- [ ] 8.1 Server tests: dir listing, autocomplete, zip central-directory listing, entry decompression, virtual paths, cache keying (mtime staleness, path-keyed camera)
- [ ] 8.2 Client tests: LRU byte eviction, hover debounce, camera serialization round-trip, ApiClient contract
- [ ] 8.3 Manual pass against a real model folder (loose STLs + Printables zip): first-visit pop-in, instant second visit, orbit persistence across browsers, chat panel collapse persistence
