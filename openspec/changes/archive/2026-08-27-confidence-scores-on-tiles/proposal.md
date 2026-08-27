## Why

The semantic index computes two numbers per result — a pooled cosine and a robust z — and
this app throws both away at the hit→tile join. The user judging a meaning search has only
the ranking to go on, which answers "which is best" but never "is any of this good", and the
set-level `weak` flag answers that once for sixty tiles rather than per tile. Reading the
numbers is also the only way to tell a query that found one strong match followed by filler
from one that found sixty comparable matches, and those two sets look identical today.

D10 of `semantic-search` decided against showing them, on a measurement that remains true:
model-to-model cosines run 0.85–0.99 while text-query cosines run ~0.1, so a `/similar`
0.912 beside a `/query` 0.107 invites a comparison neither number supports. This change
does not dispute that measurement — it answers it by labelling the number with the scale it
came from, so the two never present as one measurement.

## What Changes

- The server carries the index's per-hit `score` and `z` through the hit→tile join instead
  of dropping them, as a per-path sidecar map beside the existing `poses` — not as new
  `DirEntry` fields, so ordinary directory listings are untouched by construction.
- Model tiles that came from a scored query show two corner badges over the thumbnail:
  **k** (the pooled cosine) top-left, **z** (the robust z) top-right. Always visible.
- The k badge is **labelled by provenance**: `k` in a meaning search, `sim` in a Find-similar
  view. Raw values in both, no rescaling. The z badge is labelled `z` in both.
- Numbers render at fixed precision: k to 3 decimals (`0.107`), z to 2 (`3.14`).
- The tile's **accessible name carries both numbers** with their scales named in full
  (`cosine` / `similarity`, `z`). A tile states its accessible name rather than composing it
  from its contents, so a badge drawn inside it is otherwise announced to no one — and the
  spoken form is also where `k` stops colliding with the `k` that means neighbour count.
- The lightbox info panel shows the same two values as rows in its metadata list, under the
  same provenance labels, for a model opened from a scored result.
- Tiles from a plain directory listing show no badges and reserve no corners. The
  Find-similar **anchor** tile — the model the neighbours were computed from — has no hit and
  therefore no badges; the index excludes it from its own ranking by design.
- **Reverses a recorded decision**: `semantic-search`'s "Weak matches are shown and marked"
  currently forbids exactly this ("the client SHALL NOT display a per-result score or z
  value"). Its prohibition is lifted; its set-level weak marking is unchanged.

## Capabilities

### New Capabilities

None. Both surfaces are behaviour of an existing capability.

### Modified Capabilities

- `semantic-search`: **MODIFY** "Weak matches are shown and marked" — lift the per-result
  score prohibition, keeping the set-level weak marking and the retired scenario's title.
  **ADD** a requirement covering what a scored tile shows, where, and under which label.

## Impact

**Server**

- `Hit` (`server/src/semantic.ts`) already carries `score` and `z`; nothing upstream changes.
- `hitsToEntries` gains a third returned map, keyed by the same resolved path the entry is
  keyed by, so a hit that resolves to nothing contributes neither an entry nor a score.
- Both call sites in `server/src/app.ts` — the semantic branch of the search route and the
  `/similar` route — forward the new map.

**Shared**

- `SemanticListing` and `SimilarListing` (`shared/types.ts`) gain the sidecar field.
  `SimilarListing`'s doc comment currently asserts "order carries strength, so there is
  nothing to say per tile either" and must be corrected rather than left contradicting the
  type beneath it.

**Client**

- `ApiClient` returns the widened shapes; no new call, no raw fetch (D1).
- The landed-result path — reducer, `selectors`, `App`'s `poses` read — threads the map the
  way `poses` is already threaded.
- `Tile` (`client/src/components/Grid.tsx`) draws the corners inside its existing
  `data-tile-content` element, which is already a positioned containing block. Badge props
  follow the per-tile-value pattern `marked`/`anchor` use, so unrelated tiles stay out of
  re-renders.
- `ViewerLayer`'s info panel `<dl>` gains two rows, fed the way `pose` already is.
- Two existing tests assert the prohibition being lifted — `findSimilar.test.tsx`'s "shows no
  score, no z…" and `semanticSearch.test.tsx`'s "…no per-result score on any tile" — and are
  rewritten to guard what they were actually for. Their fixtures are widened first: mocked at
  the wire, they pass unchanged while badges render nowhere.

**Explicitly not affected**

- Thumbnail pixels. The badges are DOM over the image, never rendered into it, so
  `RIG_VERSION` does not move and no cached thumbnail is invalidated.
- `DirEntry`, and therefore every directory, flat-search, and zip listing.
- The set-level `weak` flag and the "Results are assembled from this app's own view of the
  tree" requirement, both unchanged.

**Ordering**

- `thumbnail-sweep-priority` also edits `client/src/components/Grid.tsx`. The two must not
  be in flight over that file at once — see `tasks.md`.
