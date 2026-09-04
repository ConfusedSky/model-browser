## Why

> **Parked** (Masa, 2026-09-03): drafted now so the shape is recorded while the reasoning
> is fresh, but not to be worked until `public-deployment` has landed and there is a
> hosted instance to measure against. Against a local server the change is invisible.

Entering a folder is a waterfall of round trips before it looks populated: the click
fetches the listing, the listing mounts the grid, and only then can the visible tiles
fetch their thumbnails — two serial trips, three where the server answers from a tree
it has not revalidated within its window and the client spends a follow-up request
(`listing-cache` §5.2). On the machine the app runs on today a listing answers in
5–8 ms and none of this is perceptible. On the hosted demo it is the whole cost:
`docs/web-demo-notes.md` records ~90–150 ms per round trip for a US visitor on an EU
origin, **per trip, not per byte**, and names trip count as the first-class design
lever for that deployment.

The app already knows how to spend a hover on the next click: model tiles warm their
mesh into the LRU after the pointer lingers ~120 ms (`model-viewer`, *Hover-warmed mesh
LRU*), so a press-to-orbit starts instantly. Folder and zip tiles do nothing on hover.
Hover-to-click is typically a few hundred milliseconds of human time — enough to hide
one trip entirely and start the second — so the same gesture, applied to the tiles that
navigate, removes the first serial trip from every folder open and lets the thumbnail
trip begin before the click.

## What Changes

- **Folder and zip tiles warm their listing on hover.** After the same linger threshold
  the model tiles use, the client requests the tile's plain listing exactly as the
  eventual click would (same path, the flat and folder-matching options the click will
  carry, no query) and files the answer in a small, short-lived client-side store. A
  navigation whose request matches a filed answer lands from it without a fetch; a
  navigation that arrives while the hover's fetch is still in flight joins that fetch
  rather than issuing a second. Everything downstream of a landing — the URL write, the
  recent-directories push, the pose wave, the stale follow-up — runs exactly as it does
  for a fetched landing, because the landing is the same action.
- **A warmed listing warms its first screenful of thumbnails.** For the leading entries
  of the filed listing whose annotation says a current, usable render exists (the
  `model-thumbnails` rule *A listing-known thumbnail is drawn without a lookup*, under the
  client's own constants and the occlusion variant currently in force), the client
  starts an image fetch of the same URL the tile will draw from. The image route already
  answers immutable-cacheable by key, so the tile's later `<img>` is a browser-cache hit.
  Renders that do not exist are not produced on hover: the render queue serves the grid
  on screen, and nothing here competes with it.
- **Sweeping the cursor across a grid of folders triggers nothing**, by the same linger
  rule as the mesh warm, and the number of hover fetches in flight at once is capped, so
  the worst a wandering pointer costs is a bounded handful of cheap requests.
- **No server change.** No new route, no new header, no change to what a listing
  carries. The local app gets the same behaviour and pays a few milliseconds for it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: ADDs two requirements — a folder or zip tile hovered past the
  linger threshold warms its listing, and a click on it lands from that warm answer
  without a fetch; and a warmed listing warms the thumbnails its first screenful will
  draw. Nothing existing is MODIFIED: *In-flight listing feedback* holds unchanged (a
  warm landing resolves under the reveal delay, so it is the "fast navigation" case that
  requirement already states), and `search-cancellation`'s ADDED *Concurrent and abandoned
  listing work* is not touched — a hover fetch is bounded and carries no abort signal, for
  the reason `peek` carries none.

## Impact

- **Client only**: `client/src/components/Grid.tsx` (hover callbacks on the non-model
  tile branch), `client/src/App.tsx` (a second hover warmer; the request effect consults
  the store before `listDir`), a new `client/src/lib/listingPrefetch.ts` (the store, the
  join-in-flight rule, the thumbnail warm), and `client/src/hooks/useThumbnails.ts`
  exports its `usable` test so the warm and the tile agree on which render to fetch.
- **Specs**: `openspec/specs/directory-browsing/spec.md` gains two requirements.
- **Docs**: `docs/web-demo-notes.md`'s trip-reduction paragraph and `web-demo-backlog`'s
  list point here (done in this draft).
- **Ordering**: after `public-deployment` — not for any code dependency, but because the
  measurement that justifies the change (tasks §1) needs a hosted origin, and a change
  judged against localhost would be judged on nothing. Independent of `search-cancellation`
  (different requirement, no shared symbols beyond `listDir`'s existing signature).
