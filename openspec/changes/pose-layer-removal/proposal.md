## Why

The server's in-memory pose layer memoises, for five minutes, what the index answers from
its own store in **1.4–1.7 ms for 33 paths and 16–19 ms for 500** (measured 2026-09-11,
loopback to mini-classify on :8077) — it saves nothing measurable and costs three things:
a changed index opinion takes up to five minutes plus a navigation to reach the client;
`/api/peek` deliberately drops the poses it just learned, so the client asks for exactly
the peeked cells ~100 ms later (a cold `/Loot Studios`, 31 folders: 19 client peeks, then
5 pose POSTs naming 76 paths, 74 of them answered); and emission collects its ask only
from the listing's own models, so after the horizon a revisit of the root pays a client
POST for all 71 carried preview cells. Masa, 2026-09-11: "What does saving the pose in
memory even buy? It's just a disk lookup. I think cache was the wrong solution to the
problem."

## What Changes

- **Emission asks the index fresh, gated on the status memo it already reads.** For every
  model on a listing and every cell of the sheets it carries, one batched ask with a
  bounded wait; what returns within the bound rides the listing, as a pose or as an
  explicit "the index has none". A memo that is not `ready`, an ask that times out or
  fails — the listing is emitted unposed and the client's wave covers that landing exactly
  as today. Masa: "Can't you do an immediate status on dir and if it doesn't respond
  continue, otherwise wait for a poses response?"
- **The peek attaches the poses it learns to its cells.** A preview cell may carry `pose`
  exactly as a listing's model may — that shape is now the rule, so the "wire change to a
  shape another capability owns" objection under which `/api/peek` discarded its answer no
  longer holds.
- **The pose half of the derived layers is deleted** — no in-memory pose memo, no TTL, no
  recording side effect on the pose proxy routes. The preview-choice layer (contact sheets)
  stays: a sheet is a derivation the index does not answer; a pose is one it does.
- **The preview cap rises** so emission covers a typical folder's sheets: `FILL_PREVIEW_MAX`
  12 → 32 (design D3), still under the same time budget and concurrency cap.
- **The client keeps its waves** as the fill for a not-ready index and a timed-out ask; its
  skip rule (`pose !== undefined`) is unchanged. `pose-rerender`'s pose key is what makes a
  fresh emission-time pose re-render a tile drawn under the old one — the companion change,
  cited, not modified.

No wire field is added or removed: `DirEntry.pose` keeps its three states, and
`POST /api/semantic/poses` keeps its shape. What changes is *when* the server has a pose to
attach (every emission the index answers, instead of once per five minutes) and *where* a
preview cell's pose comes from (the peek's own answer, instead of a later client POST).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `listing-cache`: MODIFIED *Derived annotations ride the listing* — emission asks the index
  at emission and attaches what it answers within a bound, rather than recording answers in
  a layer; the peek's cells carry poses; the wave remains for an unready index and a missed
  bound. MODIFIED *Derived layers live beside the tree and die with their sources* — only the
  preview-choice layer remains; a pose is never held.
- `semantic-search`: MODIFIED *The index's orientations reach every listing* — a listing may
  carry the index's orientations when the index is ready and answers within the bound; the
  paths endpoint and the client's wave remain for what a listing did not carry; a listing
  still never fails or slows for an unhealthy index.
- `directory-browsing`: MODIFIED *Folder tiles preview their contents* — a preview's cells
  carry the orientations the peek's own ask answered, exactly as a listing's models do.

## Impact

- Server: `server/src/layers.ts` (`recordPoses`, `poseKnown`, `poseFor`, `held`,
  `POSE_ANNOTATION_TTL_MS`, `HeldPose`, the pose half of `reroot`/`dropAll`/`size` — deleted);
  `server/src/app.ts` (`fillOnce`/`fillPoses` become one bounded ask whose answer `annotate`
  attaches; `fillPreviews` and `/api/peek` attach `learned`; the two pose proxy routes lose
  `recordPoses`; `collectionRoot()` loses its pose callers; `FILL_PREVIEW_MAX`);
  `server/src/semantic.ts` (`posesAsked`/`askPoses` take the caller's timeout;
  `posesListingAsked` unchanged).
- Client: no behaviour change. Comments that describe the pose layer (`ApiClient`'s pose
  methods, `DirEntry.pose` in `shared/types.ts`, `App.tsx`'s `carriedPoses` and the two
  waves) are reworded.
- Tests: `server/test/layers.test.ts` (the pose-layer block, the TTL block, and the §6.9
  block's memo cells — named in tasks 1.6); `server/test/poses.test.ts` gains a peek cell;
  `client/test/listingRefresh.test.tsx` already holds "a listing whose models all carry poses
  asks nothing at all".
- Records: `docs/web-demo-notes.md`'s round-trip paragraph; `pose-rerender` D1's "the
  server's five-minute pose memo is the bound" (superseded: the bound is the next emission).
  `CLAUDE.md` does not name the layer (checked 2026-09-11).
