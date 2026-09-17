## 1. Server: STL→GLB converter

- [ ] 1.1 Add `three` as a server-workspace dependency, pinned to the same version the client uses, and verify `bun install` succeeds and `bun run typecheck` passes with `STLLoader` and `BufferGeometryUtils` importable server-side.
- [ ] 1.2 Implement `stlToGlb(bytes: ArrayBuffer): ArrayBuffer` in the server: `STLLoader().parse` → `deleteAttribute("normal")` → `computeVertexNormals()` → `BufferGeometryUtils.mergeVertices` → hand-written binary GLB (header + JSON chunk + BIN chunk; POSITION, NORMAL, indices accessors). Verify a unit test converts a small STL and the result is valid GLB (magic `glTF`, version 2, chunk lengths consistent).
- [ ] 1.3 Round-trip test: parse the same STL via `stlToGlb` + `GLTFLoader`, and via the client `stl` arm of `parseModel`; assert positions and normals are equal within float precision. Verify the test passes.
- [ ] 1.4 Faceted-shading test: convert an STL with large flat faces and hard edges; assert coplanar triangles share vertices (index count < 3× triangle count) while edge vertices stay split (no normal averaged across an edge). Verify it passes.
- [ ] 1.5 Failure test: `stlToGlb` on empty/truncated bytes throws (does not return empty geometry). Verify the test asserts the throw.

## 2. Server: cache + route

- [ ] 2.1 Add GLB storage to the per-library cache dir (`<cache>/<library.id()>/<sha256(libPath)>.glb`) with mtime carried for staleness, reusing `ThumbCache`'s keying. Verify a unit test writes and reads back a GLB and reports hit only when mtime matches.
- [ ] 2.2 Add `GET /api/model.glb?path=&mtime=`: hit → cached bytes; miss/stale → convert, cache, serve; `application/octet-stream` + `nosniff`. Verify a route test gets GLB bytes on first call and a cache hit (no reconvert) on the second.
- [ ] 2.3 Read-only cache dir: convert-and-serve without persisting instead of erroring. Verify a test with an unwritable dir still returns valid GLB bytes.
- [ ] 2.4 Unreadable/unparseable source → error response the client maps to a model-load failure (not 200 with empty body). Verify a route test for a deleted/corrupt source returns the failure.

## 3. Client: GLB delivery path

- [ ] 3.1 Add a `glb` arm to `parseModel` (client/src/three/models.ts) using `GLTFLoader`, wrapping the mesh in `makeMaterial()` with shadows; do **not** recompute normals. Verify a client test parses a GLB fixture into a `Mesh` with the baked normals.
- [ ] 3.2 Add `ApiClient.fetchModelGlb(path, mtime)` (client/src/api/client.ts) going through `ApiClient` (no raw fetch, D1). Verify the apiClient test covers it.
- [ ] 3.3 Wire `meshLoader` (App.tsx): for `formatOf(path) === "stl"` fetch GLB + parse as `glb`; `obj`/`3mf` keep `fetchModel` + their arms. Verify STL tiles load via `/api/model.glb` and other formats via `/api/file` (test or observed network).
- [ ] 3.4 Confirm `MODEL_EXT`/`modelFormat`/`formatOf`/`defaultAxisFor` are unchanged and the STL spindle default is still +Z. Verify by test that the source path is still classified `stl` and the default axis is unchanged.

## 4. Pixel parity + integration

- [ ] 4.1 Render-parity test: thumbnail render of a model via the GLB path equals the render via the direct STL parse, pixel for pixel. Verify it passes and that `RIG_VERSION` is **not** bumped.
- [ ] 4.2 Manual: with a real library rooted at an STL kit, open a tile in the lightbox; confirm it downloads `/api/model.glb`, the model stands upright with correct faceted shading and AO, and a previously cached thumbnail is a cache hit (not re-rendered). Confirm the source `.stl` is byte-unchanged and still listed/openable.
- [ ] 4.3 Re-verify D5 mesh LRU byte budget against the smaller indexed `geometryBytes`; adjust the cap only if the smaller meshes make the current cap nonsensical. Verify by inspecting the eviction test.
- [ ] 4.4 Decide GLB cache eviction (join thumbnail `maintain()` sweep vs separate budget) and implement it; verify a sweep test bounds the GLB cache size.
- [ ] 4.5 Update docs/platform-surface.md only if a new OS-specific surface was added (none expected — note "no change" if so). Verify by review.
