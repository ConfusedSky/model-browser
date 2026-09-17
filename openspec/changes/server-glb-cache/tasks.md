## 1. Shared: STL→GLB converter and its reader (`shared/glb.ts`)

- [x] 1.1 Implement `stlToGlb(bytes: ArrayBuffer): ArrayBuffer`: detect binary STL the way `STLLoader` does (`84 + 50·n` equals the length), else parse ASCII; weld vertices by the exact bit pattern of their three `float32` coordinates; emit `uint16` indices when the welded count is at most 65 536, else `uint32`; write the GLB container (header, JSON chunk with `asset`/`buffers`/`bufferViews`/`accessors` incl. `POSITION` `min`/`max`/`meshes`/`nodes`/`scenes`/`scene`, BIN chunk). No `three` import. Verify a unit test converts a small binary STL and an ASCII STL of the same triangles to byte-identical GLB, and that the result has magic `glTF`, version 2, and chunk lengths consistent with the total.
- [x] 1.2 Implement `readGlb(bytes: ArrayBuffer): { positions: Float32Array; index: Uint16Array | Uint32Array }` as the matched reader: check magic and version, parse the JSON chunk, read exactly the two accessors 1.1 writes, throw on anything else. Verify a round-trip test (`stlToGlb` → `readGlb`) returns positions and triangle order equal to the STL's.
- [x] 1.3 Weld test: an STL whose triangles share corners yields a welded vertex count below `3 × triangles`, and every position in the output is bit-identical to one in the input (no coordinate moved). Verify it passes.
- [x] 1.4 Index-width test: `uint16` holds indices 0…65535, so a mesh with exactly 65 536 welded vertices gets a `uint16` index accessor and one with 65 537 gets `uint32`. Verify both cells pass, so the branch is `count <= 65536`, not `<`.
- [x] 1.5 Failure test: `stlToGlb` on empty, truncated, and non-STL bytes throws (does not return empty geometry). Verify the test asserts the throw.

## 2. Server: cache + route

- [x] 2.1 Add `MeshCache` (server/src/meshCache.ts) in the pattern of `snapshot.ts`: `<cache>/<library.id()>/mesh/<sha256(libPath)>.glb`, file mtime set to the source's via `utimes`, hit iff `stat(cached).mtimeMs` equals the source's, write via temporary sibling + rename. Verify a unit test writes and reads back a GLB, reports a hit only while the mtime matches, and reports stale after the source mtime changes.
- [x] 2.2 Add `GET /api/model.glb?path=`: `canonicalLibPath` → `library.resolve`; a zip entry is extracted with `extractEntry` and its staleness taken from the zip's mtime; a plain path 404s "missing" unless `modelFormat(libPath) === "stl"`; hit → cached bytes; miss/stale → convert, cache, serve; `application/octet-stream` + `nosniff`. Verify route tests: GLB bytes on first call and no reconversion on the second (spy on `stlToGlb`); a zip-entry STL served as GLB; a `.obj` path answers 404 "missing".
- [x] 2.3 Read-only cache dir: convert and serve without persisting instead of erroring. Verify a test with an unwritable dir still returns valid GLB bytes.
- [x] 2.4 Failure paths: a deleted source answers the same 404 `/api/file` gives; a source that exists but cannot be parsed answers `422 {error}`. Verify route tests for both.
- [x] 2.5 Confirm `ThumbCache.maintain` and the legacy sweep leave `mesh/` alone (they parse `*.json` at the id level only). Verify by a test that runs `maintain` with a populated `mesh/` and asserts the GLB is still there.

## 3. Client: GLB delivery path

- [x] 3.1 Add a `glb` arm to `parseModel` (client/src/three/models.ts): `readGlb` → `BufferGeometry` with `POSITION` + index → `toNonIndexed()` → `computeVertexNormals()` → `Mesh` via `makeMaterial()` + `withShadows`, exactly as the `stl` arm wraps its geometry. Verify an attribute-parity test over **two fixtures, one binary and one ASCII STL of the same triangles**: for each, `parseModel(stlToGlb(stl), "glb")` and `parseModel(stl, "stl")` produce equal `position` and `normal` arrays and equal `geometryBytes`. The ASCII cell pins that the converter's ASCII triangle order matches `STLLoader`'s, which the binary cell cannot.
- [x] 3.2 Add `ApiClient.fetchModelGlb(path)` (client/src/api/client.ts) going through `ApiClient` (no raw fetch, D1), non-2xx → `errorOf`. Verify the apiClient test covers a success and a 422.
- [x] 3.3 Wire `meshLoader` (App.tsx): `formatOf(path) === "stl"` → `fetchModelGlb` + `parseModel(bytes, "glb")`; `obj`/`3mf` keep `fetchModel` + their arms. Verify by test that an STL path calls `fetchModelGlb` and never `fetchModel`, and that a `.3mf` path still calls `fetchModel`.
- [x] 3.4 Confirm `MODEL_EXT`/`modelFormat`/`formatOf`/`defaultAxisFor` are unchanged and the STL spindle default is still +Z. Verify by test that the source path is still classified `stl` and `defaultAxisFor("stl")` is unchanged.

## 4. Integration

- [x] 4.1 Manual: with a real library rooted at an STL kit, open a tile in the lightbox; confirm the network panel shows `/api/model.glb` and no `/api/file` for it, the model stands upright with faceted shading and AO indistinguishable from `main`, and a previously cached thumbnail is a cache hit (sidecar untouched, no re-render). Confirm the source `.stl` is byte-unchanged and still listed/openable, and that `RIG_VERSION` is **not** bumped.
- [ ] 4.2 Manual: open an STL inside a zip; confirm it is served as GLB and that a second open does not re-read the zip (no `extractEntry` call — log or spy in dev). *Not exercisable on the demo corpus (0 zips); covered by the route unit test (`serves an STL zip entry as GLB`).*
- [x] 4.3 Measure on the demo posture (`bun run dev:demo`, decimated corpus): transferred bytes for one lightbox open before and after, and first-open server time for a 50k-triangle model. Record both in this file's review section; the design's 0.24x is the raw ratio, gzipped will differ.
- [x] 4.4 Update docs/platform-surface.md only if a new OS-specific surface was added (none expected — note "no change" if so). Verify by review.

## Review

### Measurements (4.3)

In-process (`app.request` against the real decimated corpus, no port bind), STL served by `/api/file` vs GLB by `/api/model.glb`:

| model | tris | STL | GLB | raw | STL gz | GLB gz | gz | miss | hit |
|---|---|---|---|---|---|---|---|---|---|
| Shelf1and3-Left-Minitaire | 1 400 | 70 KB | 17.3 KB | 0.247 | 15.2 KB | 11.4 KB | 0.751 | 4.3 ms | 0.27 ms |
| Night_Dragon…WING_up | 7 996 | 400 KB | 96.6 KB | 0.242 | 187.5 KB | 74.5 KB | 0.397 | 9.7 ms | 0.38 ms |
| catmini (50k target) | 50 000 | 2.50 MB | 601 KB | 0.240 | 1.91 MB | 551 KB | 0.289 | 65.2 ms | 1.12 ms |

Raw ratio holds at the design's 0.24x for every size. The gzipped win grows with triangle density — small flat parts compress well as STL so GLB's edge there is modest (0.75x), but a dense 50k-triangle mesh (float noise, poorly compressible) drops to **0.29x gzipped**, ~1.35 MB saved on the wire for one open. First-open conversion is 65 ms for 50k triangles, paid once; a hit is ~1 ms.

### Notes

- `meshLoader` was extracted from `App.tsx` to `client/src/three/meshLoader.ts` for a direct unit test of the routing (STL → `fetchModelGlb`, others → `fetchModel`).
- `parseModel`'s parameter widened to `ModelFormat | "glb"`; `ModelFormat` (and so `MODEL_EXT`/`modelFormat`/listing) is unchanged — GLB is never a stored format.
- **4.1 verified live** on the `dev:demo` server (localhost:5173, decimated corpus). Opening `catmini.stl` (50k tris) in the lightbox: the network panel shows `GET /api/model.glb …catmini.stl` 200 and **no `/api/file`** for the model; the tile drew from an `/api/thumb` cache hit (no re-render); the model stands upright on its base (+Z spindle, axis Z), faceted with the camera-fixed red/blue rim accents and AO in its crevices and contact shadow — indistinguishable from `main`. The panel still reports `format STL, 2.4 MB`, and the source `.stl` is byte-identical (size, mtime, sha-256) before and after the request.
- **4.2 not exercisable here** — the demo corpus has 0 zips. Covered by the route unit test (`serves an STL zip entry as GLB`); the MeshCache hit path never calls `extractEntry`, so a second open re-reads nothing.
