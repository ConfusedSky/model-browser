## Why

The index computes an orientation for every model it holds, but a pose reaches the
client only as a rider on search hits — so a plain listing renders every unowned model
at the default three-quarter view, and the same model stands up straight on a meaning
grid and lies back down on the listing. The AO sequence built everything downstream of
supply: the `posed`/`POSE_VERSION` label and applied-only staleness are spec'd, the
sibling-pose invalidation keeps the two occlusion renders at one angle, and the sweep's
reconciler compares poses by value and re-evaluates image-preservingly — poses arriving
as a second wave is the case it was built for. Only the supply is missing.

Two things make it now: the demo bake must run after this or every tile bakes un-posed
corpus-wide (`wantsPose` gates on supply — verified in the notes), and Masa asked
(2026-08-31) for folder contact sheets to prefer posed entries, which needs posedness
known outside a search.

## What Changes

- **mini-classify** gains `POST /poses` — paths in, `pose | null` per path out, a pure
  pose-cache lookup (no embedding, no GPU): the fifth call on a four-call surface.
- **The server** gains `GET /api/semantic/poses?path=<dir>` — the listing's models'
  poses, keyed by library path, confined like search hits, index-optional: absent or
  warming index answers like search does and costs the listing nothing.
- **The client** fetches poses after a plain listing lands and merges them into the same
  `poses` state a meaning landing populates. `wantsPose` is unchanged — it becomes true
  wherever a pose now exists, which is the point. Tiles re-evaluate through the
  reconciler, keeping their images.
- **Folder contact sheets prefer posed models** (Masa, 2026-08-31): the peek walk stops
  at four *posed* models instead of four models, within the same entry bound, falling
  back to unposed finds when the bound or tree runs out — and to exactly today's
  selection when the index is not answering.
- **Explicitly not here**: the override store's pose field as an override source —
  `library-overrides` ships the field; whichever change lands second wires the
  precedence (stored camera > store pose > index pose > default) and says so in both.

## Capabilities

### Modified Capabilities

- `semantic-search`: **ADD** *The index's orientations reach every listing* — poses for
  a listing's models on request, index-optional, confined; the existing *A pose orients
  the model without becoming its stored camera* governs what a pose does once supplied
  and is not touched.
- `directory-browsing`: **MODIFY** *Folder tiles preview their contents* — the walk
  prefers posed models within its existing bound; determinism becomes "deterministic
  given the index's answer"; all scenarios carried.

## Impact

Cross-repo: `~/Documents/tests/mini-classify` (`/poses` endpoint, its api surface doc,
tests per that repo's conventions). Here: `server/src/semantic.ts`, `app.ts` (route +
peek ranking), `client/src/App.tsx` (the second wave), `api/client.ts`, tests. No
`RIG_VERSION` bump; no cache or label changes — the labels were built for this.
Ordering: after the archived AO sequence (uses its reconciler and labels); coordinate
with `library-overrides` (drafted, unapplied) on the pose-precedence seam; **before any
demo bake**.
