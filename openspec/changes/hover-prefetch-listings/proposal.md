## Why

> **Unparked** (2026-09-08): the condition was `public-deployment`, which archived that
> day. The measurement in tasks §1 still gates the build, and should be taken against
> `demo-infrastructure`'s origin rather than the SSH tunnel used for the gate-3.3 probe.

Entering a folder is a waterfall of round trips before it looks populated: the click
fetches the listing, the listing mounts the grid, and only then can the visible tiles
fetch their thumbnails — two serial trips, three where the server answers from a tree
it has not revalidated within its window and the client spends a follow-up request
(`listing-cache`, *Age is disclosed, and staleness converges*). On the machine the app runs on today a listing answers in
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
- **The thumbnail half is not in this change** (2026-09-08). It warmed the images a
  listing's first screen would draw; it left for `hover-prefetch-thumbnails` because its
  win is the fan-out *after* mount — the part Caddy's HTTP/2 collapses onto one connection
  and a CDN would move to an edge hop — while the listing trip is serial and nothing else
  can remove it. It was also wrong as drafted: it walked top-level entries for model
  entries, and since `listing-tree-cache` a folder's sheet cells are nested inside
  `entry.preview`, so a folder-of-folders would have warmed nothing.
- **A warm is a plain listing and nothing else.** It does not fire while the flat view is
  on: a flat listing walks a subtree under a step budget with the request held open, and
  putting an uncancellable traversal behind a pointer is what `search-cancellation` exists
  to prevent. Sweeping the cursor across a grid triggers nothing, by the same linger rule
  as the mesh warm; in-flight warms are capped; and a warm whose request fails is
  discarded rather than handed to the click.
- **No server change.** No new route, no new header, no change to what a listing
  carries. The local app gets the same behaviour and pays a few milliseconds for it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: ADDs one requirement — a folder or zip tile hovered past the
  linger threshold warms its listing, and a click on it lands from that warm answer
  without a fetch. (The second, the thumbnail warm, left with the half that owns it.)
  Nothing existing is MODIFIED: *In-flight listing feedback* holds unchanged (a
  warm landing resolves under the reveal delay, so it is the "fast navigation" case that
  requirement already states), and `search-cancellation`'s ADDED *Concurrent and abandoned
  listing work* is not touched — a hover fetch is bounded and carries no abort signal, for
  the reason `peek` carries none.

## Impact

- **Client only**: `client/src/components/Grid.tsx` (hover callbacks on the non-model tile
  branch), `client/src/App.tsx` (a second hover warmer; the request effect consults the
  store before `listDir`, except for follow-ups), and a new
  `client/src/lib/listingPrefetch.ts` (the store, the join-in-flight rule). No change to
  `useThumbnails`: the export it was going to need belonged to the half that left, which
  in any case wants the already-exported `isCurrentRender`.
- **Specs**: `openspec/specs/directory-browsing/spec.md` gains two requirements.
- **Docs**: `docs/web-demo-notes.md`'s trip-reduction paragraph and `web-demo-backlog`'s
  list point here (done in this draft).
- **Ordering**: `public-deployment` archived 2026-09-08, so nothing blocks this but its
  own measurement, which needs a real origin — `demo-infrastructure`'s, when it stands.
  A change judged against localhost would be judged on nothing. Independent of
  `search-cancellation` (different requirement, no shared symbols beyond `listDir`'s
  existing signature), and the plain-only rule above is what keeps that true.
