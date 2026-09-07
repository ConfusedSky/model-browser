## Why

A thumbnail's bytes are the dominant cost of showing a directory to anyone who is not
on the same machine as the library. Measured on the CC-BY demo corpus (60 renders,
2026-09-05, `docs/web-demo-notes.md`): a 512² PNG averages **87 KB**, the same render
as 512² WebP at q0.8 **10 KB**, and at 256² **4 KB**. A first screen holds ~114 of
them, so the format alone decides whether opening the app across a network moves
9.6 MB or 0.57 MB. The same ratio empties disk locally: the demo box's baked cache of
2,254 renders went from 208 MB to 9.9 MB.

PNG was never chosen for this — it is what a canvas hands back by default, and the
size was chosen when a thumbnail was only ever read from the same disk that wrote it.

## What Changes

- **Thumbnails are rendered and stored as 256×256 WebP at quality 0.8**, replacing
  512×512 PNG. Alpha stays lossless so silhouettes keep their exact edge; only colour
  takes the lossy path.
- **BREAKING (cache-visible): `RIG_VERSION` 6 → 7.** Every stored render is stale on
  the first visit after this ships and is re-rendered through the normal queue, cameras
  and axes intact. This is the existing mechanism working, not new behaviour — but on a
  large library it is a one-time cost paid at browsing speed.
- **Stored renders are named for their encoding** (`<key>.webp`, `<key>.noao.webp`), and
  the image route types them `image/webp`.
- **A render in a superseded encoding is removed when found**, rather than left beside
  its replacement: the bounded cache can only evict what it can name, so without this
  every library keeps its old PNGs forever (208 MB, on the corpus measured).
- **Accepted, not fixed: 256 is soft on a high-density display.** A model tile draws at
  ~161 CSS px, so a 2× display would want 322. 320² was weighed and declined (D2).
- **Unchanged on the wire**: the PUT/GET field is still called `png`, and carries WebP
  bytes (D4).

## Capabilities

### Modified Capabilities
- `model-thumbnails`: the format and size a thumbnail is rendered and stored in; the
  content type the image route answers; and a new requirement that a render in a
  superseded encoding is removed rather than stranded.
- `model-viewer`: the occlusion requirement names the thumbnail's output as a PNG, and
  its transparency scenarios now have to hold through a lossy encoder.

## Impact

- `client/src/three/renderer.ts` — `THUMB_SIZE`, a new `THUMB_QUALITY`, `RIG_VERSION`,
  the `toBlob` call and the chain's docstrings.
- `client/src/api/client.ts` — the blob type a base64 render is revived under.
- `server/src/cache.ts` — the stored file's name, and the removal of a superseded one.
- `server/src/app.ts` — the image route's `Content-Type`.
- Tests in both workspaces that assert `.png` names, `image/png`, or the rig version.
- `CLAUDE.md`'s thumbnail constraint, and `docs/web-demo-notes.md`, which carries the
  measurements this change rests on.
- Every existing thumbnail cache on disk: re-rendered once, and its PNGs reclaimed.
