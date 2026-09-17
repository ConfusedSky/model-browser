## Context

See proposal.md — Why. Current state of the pieces this change touches:

- **`/api/file`** (server/src/app.ts) resolves a library path via `library.resolve` to `{fsPath, entry}`. A zip entry (`foo.zip!/x.stl`, D6) is extracted with `extractEntry` and served whole; a plain file is refused unless `modelFormat(libPath)` names a format (404 "missing", so a distinct status cannot confirm existence), then streamed with `content-type: application/octet-stream` + `x-content-type-options: nosniff`, honoring HTTP Range.
- **`parseModel(bytes, format)`** (client/src/three/models.ts) is synchronous and dispatches by format: `stl` → `STLLoader().parse`, then `deleteAttribute("normal"); computeVertexNormals()` (flat facet normals on a **non-indexed** geometry), wrapped in a `Mesh` via `makeMaterial()` + `withShadows`. **No rotation is applied to any format** — uprightness comes from the orbit spindle default (`defaultAxisFor`, shared/frames.ts). `meshLoader(api, …)` (App.tsx) is the `MeshLru` loader: `formatOf(path)` → `api.fetchModel(path)` → `parseModel` → `geometryBytes`. The LRU is keyed by **path alone**; the loader has no mtime.
- **Thumbnail cache** (server/src/cache.ts, `ThumbCache`): per-library dir `<MODEL_BROWSER_CACHE|~/.cache/model-browser>/<library.id()>/`, entries keyed `sha256(libPath)` hex. Its `maintain` sweep parses every `*.json` at that level as a sidecar and ignores subdirectories, which is why `bake/` and `snapshots/` (`snapshot.ts`, its own store class over the same dir) live there untouched. The server never renders thumbnails; it only serves cached bytes.
- Constraints: the Hono app must run on Node unchanged, Bun-only APIs only in index.ts (D1); mesh LRU eviction must `geometry.dispose()` (D5); any change to thumbnail pixel output must bump `RIG_VERSION` (this change is designed to produce **none**).

## Goals / Non-Goals

**Goals:**
- Cut the bytes the browser downloads to open an STL model, with the source STL and every index/listing/association path untouched.
- Pixel-identical rendering to today's client STL parse — no `RIG_VERSION` bump, no thumbnail re-render.
- Reuse the existing per-library cache directory and its path+mtime staleness contract.
- No new dependency in either workspace.

**Non-Goals:**
- Shrinking the shipping tree / OCI image (STL stays on disk; this is a runtime-delivery optimization, not a storage one — issue #4's headline 5.8x is a shipping-size number this change does not target).
- Converting `obj` / `3mf` (they keep their current delivery).
- Draco/meshopt compression, or any lossy geometry step.
- A user-supplied-GLB format, mime association, or slicer support for GLB.
- A general glTF reader or writer: the container written here has one mesh, one primitive, two accessors, and the client reads exactly that.

## Decisions

### D1: GLB is a derived cache artifact, not a stored format
Treat GLB exactly like a thumbnail: computed from the source, cached per library keyed by path+mtime, never listed or opened. This is what dissolves every issue #4 blocker at once — the index still walks `foo.stl` and joins by `rel_path` against files that still exist; `MODEL_EXT`/`modelFormat`, listing, and `MIME_BY_FORMAT`/slicer association all keep operating on the STL. GLB touches only the server→viewer path.

*Alternative — GLB as a stored format (issue #4 as literally written):* extend `MODEL_EXT`, mini-classify coverage, the mime table, and settle up-axis provenance. Rejected: far larger blast radius, and it forces the index-join decision the issue flags as an unresolved blocker.

### D2: Convert server-side; never send the whole STL on a miss
The client requests the GLB; on a miss the server converts synchronously and returns the GLB in the same response. The browser never receives raw STL for viewing. First request for a model pays the conversion cost (parse + weld + serialize), paid once, then a cache hit.

*Alternative — client-side bake (client parses STL, exports GLB, PUTs it back, thumbnail-style):* rejected per the user's requirement — a miss would ship the whole STL to the browser, defeating the point.

### D3: Positions and indices only; the client recomputes normals
The GLB carries a `POSITION` accessor and an index accessor and **no normals**. Vertices are welded by the exact bit pattern of their three `float32` coordinates, so no coordinate moves. The client's `glb` arm calls `toNonIndexed()` and then `computeVertexNormals()` — the same call today's `stl` arm makes on the same positions in the same triangle order. The geometry handed to the material is therefore byte-for-byte what it is today, and pixel parity holds by construction rather than by test.

Why not ship normals: STL stores one normal per face and the viewer recomputes it, so a GLB carrying per-vertex normals can only share a vertex between faces whose normals are bit-identical. On the miniatures corpus that is almost none of them — measured on 40 decimated STLs (68.1 MB), a `(position, normal)` weld gave 108.0 MB of GLB (1.59x *larger*), while position-only gave 16.2 MB (0.24x). Issue #4's 59.9 MB figure is ~17.7 bytes per triangle, which is position-only-indexed with no normals; it was never a faceted weld.

Index width is `uint16` when the welded vertex count is at most 65 536 (indices 0…65535), else `uint32` — 6 bytes per triangle on small meshes for one branch.

*Alternative — weld by `(position, winding-derived normal)` and bake normals server-side:* rejected by the measurement above. It also needed a tolerance-based weld (`BufferGeometryUtils.mergeVertices` rounds by `~~(v * hashMultiplier + hashAdditive)` and keeps the first vertex it saw), which moves coordinates up to the tolerance and breaks the byte-identical positions the spec promises.

### D4: Pure TypeScript converter and reader in `shared/glb.ts`, no `three` on the server
With normals gone, the converter is a binary/ASCII STL triangle reader, a `Map` from 12-byte position key to vertex index, and a GLB container writer (12-byte header, JSON chunk, BIN chunk; `asset`, one `buffer`, two `bufferViews`, two `accessors` with `min`/`max` on `POSITION`, one `mesh`/`node`/`scene`). The client reader is the matched pair in the same module: check magic and version, parse the JSON chunk, read the two accessors it wrote, build a `BufferGeometry`. Both halves are DOM-free and run under vitest, Node and Bun; a round-trip test covers them together. Binary STL is detected the way `STLLoader.isBinary` does it — header plus `84 + 50·n` bytes equals the file length, or the file does not begin with `solid` — and only the rest is parsed as ASCII, so a file the client renders today still renders, including a binary file padded past its face count; a binary header claiming more facets than the bytes hold is a conversion error, not a read past the end. The corpus is 3122 binary and 0 ASCII files, but the library beyond it is not audited.

*Alternative — `three` on the server (`STLLoader` + `mergeVertices`) and `GLTFLoader` on the client:* rejected. `mergeVertices` is the wrong weld (D3), `GLTFLoader.parse` is callback-asynchronous where `parseModel` is synchronous, it is 110 KB of source for a two-accessor container this repo writes itself, and it would put a `three` copy on a server that today depends on `hono` and `fflate` alone.

### D5: Cache location, staleness, and bound
`MeshCache` (server/src/meshCache.ts, in the pattern of `snapshot.ts`) stores `<cache dir>/<library.id()>/mesh/<sha256(libPath)>.glb`. Staleness is the source's mtime: the file's own mtime is set to the source's with `utimes` after the write, and a hit is the cached file's `mtimeMs` within 1 ms of the source's — `utimes` from a `Date` stores whole milliseconds, while a source `mtimeMs` can be fractional, so exact equality would never hit. A miss or a stale entry converts, writes to a temporary sibling and renames over the old name, so a concurrent reader never sees a torn file; two concurrent misses both convert, and the second rename wins harmlessly. The `mesh/` subdirectory keeps the files out of `ThumbCache.maintain`'s glob the way `bake/` and `snapshots/` are.

No LRU. The cache holds at most one GLB per model, overwritten in place when stale, so it is bounded by the library at ~0.24x its STL bytes; an orphan from a deleted model is removed with the id directory, as a thumbnail's is. If the cache dir is unwritable (read-only deployment), convert and serve without persisting rather than failing the request.

### D6: Route
`GET /api/model.glb?path=<libPath>` — no `mtime` parameter, because `meshLoader` has none and the server has the source in hand anyway. Resolution mirrors `/api/file`: `canonicalLibPath`, `library.resolve`, a zip entry (D6 of the zip design) extracted with `extractEntry` and its staleness taken from the **zip file's** mtime, a plain path refused with the same 404 "missing" unless `modelFormat(libPath) === "stl"`. Hit → cached bytes; miss/stale → convert, cache, serve. `application/octet-stream` + `nosniff`, mirroring `/api/file`. A source that exists but cannot be parsed answers `422 {error}`; the client's `errorOf` already turns any non-2xx into the load failure the viewer renders. No client `PUT` and no feature-flag gate — the server authors this cache itself, unlike thumbnail writes.

### D7: Client wiring
`ApiClient.fetchModelGlb(path)` (client/src/api/client.ts); `meshLoader` (App.tsx) calls it for `formatOf(path) === "stl"` and passes `"glb"` to `parseModel`; `obj`/`3mf` keep `fetchModel` + their existing arms. The `glb` arm reads the container (D4), calls `toNonIndexed()` then `computeVertexNormals()`, and wraps the result exactly as the `stl` arm does. `geometryBytes` sees the de-indexed geometry, the same size as today's, so the mesh LRU budget is untouched. `formatOf`/`MODEL_EXT` are **not** changed — the model is still an `.stl` for every other purpose; only the *delivery* differs. `defaultAxisFor` keeps keying the spindle on the source `.stl` path, so the default axis is unchanged.

## Risks / Trade-offs

- **Conversion cost on first view** → one pass over the triangles and a `Map` of the welded vertices, paid once per model per mtime, then cached; matches the thumbnail "first visit slow" contract users already experience. On the demo box (2 vCPU) the whole decimated corpus converts in the background of normal browsing, one model per lightbox open.
- **Pixel parity** → holds by construction (D3): same positions, same triangle order, same `computeVertexNormals`. Guarded by an attribute-parity test (positions and normals arrays equal between the `glb` and `stl` arms), not a pixel test — vitest has no WebGL (client/test/CLAUDE.md); the pixel comparison is a manual Playwright step.
- **A cached GLB written by an older writer** → the reader checks magic, version and the accessor layout it expects and throws otherwise; a change to the container layout renames the cache subdirectory (`mesh/` → `mesh2/`, one constant in `MeshCache`) so old entries miss rather than misparse into a load error on every model.
- **Clock skew / mtime granularity** on the `utimes` staleness check → the same contract thumbnails already rely on; a filesystem that truncates mtime does so for both the source and the cache file.
- **Zip entries** → the entry is extracted into memory on every miss, as `/api/file` does today for every request; a hit does not open the zip at all, which is a cost `/api/file` never saves.
