## Why

Opening a model in the demo's lightbox downloads its whole binary STL: 50 bytes per triangle, every vertex stored three times, plus a facet normal the viewer discards and recomputes from winding. Caddy's `encode zstd gzip` barely helps, because decimated meshes are float noise — a 2.5 MB miniature still crosses the wire at ~2 MB. Serving the same geometry as an indexed, position-only GLB cuts that to roughly a third gzipped (0.24x raw), measured on the demo corpus. Latency of that first lightbox open is the target; nothing on disk changes.

The blockers issue #4 records — the mini-classify index join, `MODEL_EXT`, mime/slicer association, up-axis provenance — all dissolve when GLB is a *derived cache artifact* rather than a stored format: STL stays the on-disk, indexed, listed, openable file, and GLB exists only on the path from the server to the viewer.

## What Changes

- Add a server route that serves an STL model's geometry as an indexed GLB, converting on demand from the source STL (plain file or zip entry) and caching the result per library beside the thumbnail cache, stale when the source's mtime moves.
- On a cache miss the server converts and serves the GLB in the same response; the whole STL is **never** streamed to the browser for viewing.
- The GLB carries **positions and indices only**, welded by exact float bits. Normals are not shipped: the client de-indexes and recomputes flat facet normals from winding, which is byte-for-byte the input today's STL parse produces — no pixel change, no `RIG_VERSION` bump, thumbnails untouched, mesh LRU accounting unchanged.
- The client viewer requests the GLB for STL models and parses it with a `glb` arm in `parseModel`; `obj` and `3mf` keep their current `/api/file` + `parseModel` path unchanged.
- The source STL files, the search index, `MODEL_EXT`/`modelFormat`, listing, and mime/slicer association are all untouched. No new user-facing format, no new file on disk beside the model, no new dependency in either workspace.

## Capabilities

### Modified Capabilities
- `model-viewer`: the viewer's STL delivery path changes — the client renders a server-baked indexed GLB instead of downloading the STL. The winding-derived-normals requirement is untouched: normals are still computed on the client, from the same vertices in the same order.

## Impact

- **Server**: new `/api/model.glb` route; an STL→GLB converter (binary and ASCII STL parse, exact-bit position weld, GLB container writer) in `shared/glb.ts` so the client reader is its matched pair; a `MeshCache` under the per-library cache directory in the pattern of `snapshot.ts`. Pure TypeScript on Node and Bun (honors D1).
- **Client**: `meshLoader` (App.tsx) requests GLB for `stl`; new `glb` arm in `parseModel` (three/models.ts) reading the container via `shared/glb.ts`; `ApiClient.fetchModelGlb`.
- **Unchanged**: mini-classify, `file-search`, `directory-browsing`, `app-launch`/slicer association, `MODEL_EXT`, `model-thumbnails` recipe/pixels, the mesh LRU budget (the client geometry after de-indexing is the same size it is today).
