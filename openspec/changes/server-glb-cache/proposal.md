## Why

Binary STL is a wasteful wire format: 50 bytes per triangle, every vertex stored three times unindexed, and a facet normal the viewer already ignores and recomputes from winding. Serving the same geometry as an indexed GLB cuts the bytes the browser downloads per model without touching a single file on disk. The blockers recorded in issue #4 — the mini-classify index join, `MODEL_EXT`, mime/slicer association, and up-axis provenance — all dissolve when GLB is treated as a *derived cache artifact* rather than a stored format: STL stays the on-disk, indexed, listed, openable file, and GLB exists only on the path from the server to the viewer.

## What Changes

- Add a server route that serves an STL model's geometry as an indexed GLB, converting on demand from the source STL and caching the result per library, keyed by library path + mtime — the same staleness contract thumbnails use.
- On a cache miss the server converts and serves the GLB; the whole STL is **never** streamed to the browser for viewing.
- The conversion welds vertices by `(position, winding-derived facet normal)`, so the shading is byte-for-byte the faceted result the client already produces from STL today — no smoothing, no pixel change, no `RIG_VERSION` bump, thumbnails untouched.
- The client viewer requests the GLB for STL models and parses it with a new `GLTFLoader` arm in `parseModel`; `obj` and `3mf` keep their current `/api/file` + `parseModel` path unchanged.
- The source STL files, the search index, `MODEL_EXT`/`modelFormat`, listing, and mime/slicer association are all untouched. No new user-facing format, no new file on disk beside the model.

## Capabilities

### Modified Capabilities
- `model-viewer`: the viewer's STL delivery path changes — the client renders a server-baked indexed GLB instead of parsing the STL itself, and the winding-derived-normals guarantee moves to the server bake while holding end to end.

## Impact

- **Server**: new `/api/model.glb` route and an STL→GLB converter (`three` STLLoader + `BufferGeometryUtils.mergeVertices` for the geometry, a hand-written GLB container writer); reuses the per-library cache directory (`ThumbCache` dir, keyed by `sha256(libPath)` + mtime). `three` becomes a server-workspace dependency; both pieces used are DOM-free and run on Node and Bun (honors D1).
- **Client**: `meshLoader` (App.tsx) requests GLB for `stl`; new `glb` arm in `parseModel` (three/models.ts) via `GLTFLoader`; `ApiClient.fetchModelGlb`.
- **Unchanged**: mini-classify, `file-search`, `directory-browsing`, `app-launch`/slicer association, `MODEL_EXT`, `model-thumbnails` recipe/pixels.
- **D5 (mesh LRU)**: indexed geometry shrinks decoded `geometryBytes` — recheck the LRU byte budget.
