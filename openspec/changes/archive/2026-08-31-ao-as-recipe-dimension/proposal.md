## Why

Ambient occlusion is a performance preference — the pill turns it off in the live view for
GPUs that feel it (measured 17 → 56 fps on an orbit drag, `viewer-ssao`). Thumbnails ignore
the preference by design: they always render the occluded shipped recipe, so the cache and
`RIG_VERSION` never depend on it. The cost of that design is paid at handoff: with the pill
off, every tile the user touches opens an overlay that renders *without* occlusion over a
thumbnail rendered *with* it, and the model visibly changes shading under the pointer. The
"Handoff stays seamless" scenario is exactly what the preference suspends.

That was tolerable while the pill was a comparison instrument used by one person. Two
things ahead make it the default experience for many: an adaptive AO default that turns
occlusion off by measurement on weak GPUs (`adaptive-ao-default`), and a public demo whose
weakest visitors are phones. Both need thumbnails that match the live view *whichever* way
the preference is set. `docs/web-demo-notes.md` item 8 records the reasoning, including
why "just default it off" was rejected — it pays the handoff jump on every machine.

## What Changes

- **Thumbnails follow the ambient-occlusion preference.** A tile is rendered — and looked up
  — under the recipe the live view would use at handoff, occluded or not. Handoff is
  seamless in both states.
- **The cache holds both renders of a model.** Occlusion becomes a dimension of the
  thumbnail key, not a label: the occluded PNG and the unoccluded PNG are siblings under one
  entry, each with its own recipe labels and its own place in the size-cap LRU, sharing the
  model's camera and axis. Switching the preference back finds the other render instead of
  re-rendering it — **unless the model was orbited in between**: a write that changes the shared orientation invalidates the other render (both, when it carries no pixels), so the shared camera is never shown at two different angles; a write that carries only pixels never touches the other render.
- **No migration.** Every existing PNG is the occluded render and keeps its file name; the
  unoccluded render is a new sibling file. No `RIG_VERSION` bump: neither recipe's pixels
  change — the recipe *set* grows.
- **Lazy on visit, like every other recipe input.** A directory visited under a preference
  whose render is not cached re-renders through the normal queue, camera and axis preserved.
  Making the *pill* refresh the grid in place is `ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`), re-targeted
  to this dimension after this lands.
- **Explicitly not in this change:** the eager refresh on toggle, the adaptive default, and
  baking both variants for the demo (the deployment change does that; this is what makes it
  possible).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: **MODIFY** *Ambient-occlusion shading* — thumbnails follow the preference
  instead of always rendering occluded; the handoff scenario holds in both states; the
  "in both lighting modes" clause goes (there is one, after `remove-axis-lighting`).
- `model-thumbnails`: **ADD** *A thumbnail exists per occlusion recipe* — the occluded and
  unoccluded renders as siblings under one entry, keyed by the preference, each carrying its
  own labels and evicted independently, sharing camera and axis. *Server-side thumbnail persistence* and *Bounded, self-maintaining cache* are left as they are: the key gains a dimension. *Recipe-labelled thumbnails* is not modified, but the new requirement states one exception to its "a write not replacing a PNG leaves the labels alone" rule: sibling invalidation clears them.

## Impact

**Wire and shared**

- `GET /api/thumb?path&mtime` gains `ao=on|off` (absent = `on`, so an old client reads what
  it read before); `ThumbGetResponse` is per requested render, camera and axis shared.
- `ThumbPutRequest` gains `ao: boolean` beside `png`; a PNG PUT without it is the occluded
  render, as every PUT has been.

**Server**

- `cache.ts` (`ThumbCache`): the occluded render stays `<key>.png` with its labels on the
  sidecar as today; the unoccluded render is `<key>.noao.png` with its labels under a
  `noao` field of the same sidecar. `get`/`put` take the render; `maintain` treats each
  PNG as its own LRU file and the sidecar as one entry.
- `app.ts`: parse `ao`; validate.

**Client**

- `three/renderer.ts` `renderThumbnail(object, state, axis, ao)` passes `ao` to the thumb
  chain's `render` — the argument already exists on the chain and the live view already
  uses it.
- `hooks/useThumbnails.ts`, the two re-render commands in `lib/entryActions.ts`,
  `ViewerSession.snapshot` (which goes through `renderThumbnail`, not the live chain) and
  `App.tsx`'s `persist` (which PUTs every orbit-release and lightbox-close snapshot): read
  `aoEnabled()` once per render, request and PUT under it. Today a snapshot is rendered
  occluded whatever the pill says — a standing mismatch between the overlay and the tile
  it persists into, which this closes.
- `api/client.ts`: `getThumb(path, mtime, ao)`, `putThumb` carries `ao`.
- `viewer/aoToggle.ts` unchanged: still the one preference, still per profile.

**Ordering (hard)**

- After `remove-axis-lighting` (its `model-viewer` delta rewrites a sibling requirement in
  the same file and retires the lighting mode this delta stops mentioning) and after
  `library-root` (its cache migration moves `<key>.*` files — the sibling file must be
  covered by "every file of the key", which its tasks say).
- Before `ao-refreshes-thumbnails` is re-targeted — this is the dimension it will
  refresh — and before `adaptive-ao-default`, which flips the preference the thumbnails
  now follow.
