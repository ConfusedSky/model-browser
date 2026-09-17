## Context

See proposal.md — Why. Current state of the pieces this change touches:

- **`/api/file`** (server/src/app.ts) resolves a library path via `library.resolve`, refuses non-models (`modelFormat(libPath) === undefined` → 404 "missing"), and streams the file with `content-type: application/octet-stream` + `x-content-type-options: nosniff`, honoring HTTP Range.
- **`parseModel(bytes, format)`** (client/src/three/models.ts) dispatches by format: `stl` → `STLLoader().parse`, then `deleteAttribute("normal"); computeVertexNormals()` (flat facet normals, **non-indexed**), wrapped in a `Mesh`. **No rotation is applied to any format** — uprightness comes from the orbit spindle default (`defaultAxisFor`, shared/frames.ts). There is no `GLTFLoader`. `meshLoader(api, ...)` (App.tsx) is the mesh LRU loader: `formatOf(path)` → `api.fetchModel(path)` → `parseModel`.
- **Thumbnail cache** (server/src/cache.ts, `ThumbCache`): per-library dir `<MODEL_BROWSER_CACHE|~/.cache/model-browser>/<library.id()>/`, entries keyed `sha256(libPath)` hex, staleness derived at read time by comparing a stored `mtime` in the `.json` sidecar against the requested mtime. The server never renders thumbnails; it only serves cached bytes.
- Constraints: the Hono app must run on Node unchanged, Bun-only APIs only in index.ts (D1); mesh LRU eviction must `geometry.dispose()` (D5); any change to thumbnail pixel output must bump `RIG_VERSION` (this change is designed to produce **none**).

## Goals / Non-Goals

**Goals:**
- Cut the bytes the browser downloads per STL model, with the source STL and every index/listing/association path untouched.
- Pixel-identical rendering to today's client STL parse — no `RIG_VERSION` bump, no thumbnail re-render.
- Reuse the existing per-library cache and its path+mtime staleness contract.

**Non-Goals:**
- Shrinking the shipping tree / OCI image (STL stays on disk; this is a runtime-delivery optimization, not a storage one — issue #4's headline 5.8x is a shipping-size number this change does not target).
- Converting `obj` / `3mf` (they keep their current delivery).
- Draco/meshopt compression, or any lossy geometry step.
- A user-supplied-GLB format, mime association, or slicer support for GLB.

## Decisions

### D1: GLB is a derived cache artifact, not a stored format
Treat GLB exactly like a thumbnail: computed from the source, cached per library keyed by path+mtime, never listed or opened. This is what dissolves every issue #4 blocker at once — the index still walks `foo.stl` and joins by `rel_path` against files that still exist; `MODEL_EXT`/`modelFormat`, listing, and `MIME_BY_FORMAT`/slicer association all keep operating on the STL. GLB touches only the server→viewer path.

*Alternative — GLB as a stored format (issue #4 as literally written):* extend `MODEL_EXT`, mini-classify coverage, the mime table, and settle up-axis provenance. Rejected: far larger blast radius, and it forces the index-join decision the issue flags as an unresolved blocker.

### D2: Convert server-side; never send the whole STL on a miss
The client requests the GLB; on a miss the server converts synchronously and returns the GLB in the same response. The browser never receives raw STL for viewing. First request for a model pays the conversion cost (parse + weld + serialize, milliseconds to ~100ms for large meshes); every later request is a cache hit.

*Alternative — client-side bake (client parses STL, exports GLB, PUTs it back, thumbnail-style):* rejected per the user's requirement — a miss would ship the whole STL to the browser, defeating the point.

### D3: Weld by `(position, winding-derived facet normal)` to stay pixel-identical
STL stores the normal **per face** (12 B); GLB stores it **per vertex**. A naive non-indexed GLB is therefore *larger* than the STL (72 B/tri vs 50). The size win requires sharing vertices — but sharing by position alone averages normals across edges, smoothing the model, changing pixels, and forcing a `RIG_VERSION` bump. Welding by the full `(position, normal)` tuple merges only vertices that are already identical in both, so coplanar-adjacent triangles collapse (the win) while hard edges stay split (faceted shading preserved). This reproduces the client's current `computeVertexNormals()`-on-non-indexed result exactly.

Concretely: `STLLoader().parse` → `deleteAttribute("normal")` → `computeVertexNormals()` → `BufferGeometryUtils.mergeVertices(geometry)`. `mergeVertices` welds by *all* attributes, which for this geometry is exactly `(position, normal)`.

### D4: Reuse `three` for geometry, hand-write the GLB container
`three` is already a repo dependency. `STLLoader` (three/examples) and `BufferGeometryUtils.mergeVertices` are both DOM-free and run on Node and Bun, honoring the Node-clean-Hono constraint. Skip `GLTFExporter`/`node-three-gltf`: stock `GLTFExporter.parse` touches `Blob`/`FileReader`/`document` (the reason `node-three-gltf` exists), and adopting a second three.js copy on the server risks silent geometry-math drift from the client's `three`. A binary GLB is a trivial container — 12-byte header + JSON chunk + BIN chunk with one mesh, a `POSITION` accessor, a `NORMAL` accessor, and a `indices` accessor — ~80 lines, no dependency beyond the `three` already present. The client reads it with `GLTFLoader` (three/examples), a new arm in `parseModel`; the `glb` arm does **not** recompute normals (they are already the winding-derived facet normals baked in).

*Alternative — `node-three-gltf` + `GLTFExporter`:* rejected for the second-three-copy drift risk and the `Blob`/`FileReader` shim surface; hand-writing the container is smaller than adopting the shim.

*Alternative — pure-JS STL parse + weld with no `three`:* rejected because reimplementing `mergeVertices`'s all-attribute weld is the one non-trivial part and pure risk when it ships in `three`.

### D5: Cache location and route
Store the GLB beside the thumbnail entry: `<cache dir>/<library.id()>/<sha256(libPath)>.glb`, with mtime carried so staleness is derived the same way thumbnails do. New route `GET /api/model.glb?path=<libPath>&mtime=<n>`: hit (stored mtime matches) → serve cached bytes; miss/stale → convert, write cache, serve. `application/octet-stream` + `nosniff`, mirroring `/api/file`. If the cache dir is unwritable (read-only deployment), convert-and-serve without persisting rather than failing the request. No client `PUT` and no feature-flag gate — the server authors this cache itself, unlike thumbnail writes.

### D6: Client wiring
`ApiClient.fetchModelGlb(path, mtime)` (client/src/api/client.ts); `meshLoader` (App.tsx) calls it for `formatOf(path) === "stl"` and passes `"glb"` to `parseModel`; `obj`/`3mf` keep `fetchModel` + their existing arms. `formatOf`/`MODEL_EXT` are **not** changed — the model is still an `.stl` for every other purpose; only the *delivery* differs. `defaultAxisFor` keeps keying the spindle on the source `.stl` path, so the default axis is unchanged.

## Risks / Trade-offs

- **Conversion cost on first view** → milliseconds–~100ms per model, paid once, then cached; matches the thumbnail "first visit slow" contract users already experience.
- **`three` version drift between client and server** → pin the same `three` version across workspaces; both use the same loaders/`mergeVertices`, so geometry math matches by construction. A round-trip test (parse STL both ways, compare positions/normals) guards it.
- **`mergeVertices` float precision changing which vertices merge** → merging affects only *which* vertices are shared, never their values or normals, so shading is invariant to the merge decision; a mismatch would only change GLB size, not pixels. Covered by a pixel-parity assertion in the render tests.
- **Cache dir growth** → same LRU/size story as thumbnails; the GLB files live under the same per-library dir and can share the existing `maintain()` sweep, or a parallel budget. Decide during implementation (see tasks).
- **D5 mesh LRU budget** → indexed geometry shrinks decoded `geometryBytes`; the budget is a byte cap, so smaller meshes simply mean more fit — no correctness risk, but re-verify the cap is still sensible.
- **Corrupt/edge-case STL** (empty, truncated, ASCII STL) → conversion failure must surface as a model-load error the viewer already renders, not a 200 with empty geometry. Covered by a spec scenario and a route test.

## Open Questions

- Whether GLB cache entries join the thumbnail `maintain()` LRU sweep or get a separate byte budget — deferrable; does not change the route contract or the specs.
