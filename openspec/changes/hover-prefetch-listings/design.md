## Context

**Parked until `public-deployment` lands** — see the proposal. Re-check every citation
below against the source before starting; this was drafted 2026-09-03 and the request
effect in `App.tsx` is edited often.

How a folder opens today, by symbol:

- A non-model tile's `onClick` calls `onEnter(entry)` (`Grid.tsx`, the
  `entry.kind !== 'model'` branch); App's `enterEntry` reaches `navigate`, which dispatches
  `{ type: 'navigate' }`. The reducer's `navigate` case builds the view and calls `ask`,
  which bumps `lastId` and sets `inflight`.
- `pendingRequest(state)` derives `request` from `inflight`; the request effect keyed on
  `requestId` builds an `AbortController`, defines `land` and `fail`, and for a plain
  request calls `api.listDir(path, { flat, q, folderMatching }, signal)`. `land` guards on
  the controller, calls `pushRecent`, sets `urlIntent`, and dispatches `landing`, which
  the reducer admits through `accepts` (same id, same view).
- The landing's `entries` reach `useThumbnails`, whose seeding step reads each entry's
  `thumb` annotation, applies `usable` under the client's rig constants and the current
  `ao` variant, and for a passing render sets the tile's URL from `api.thumbImageUrl`
  without a lookup. The tile draws it with `<img loading="lazy">`; the server answers
  `/api/thumb/image` for a current generation with
  `Cache-Control: public, max-age=31536000, immutable`.
- A model tile's `onPointerEnter` calls `onModelHover(path)`, which App routes to a
  `createHoverWarmer` instance (`lib/hover.ts`, `HOVER_LINGER_MS` = 120) whose callback is
  `lru.warm`. `createHoverWarmer` is generic: one timer, `enter(path)` re-arms it,
  `leave()` clears it, the callback fires once the pointer has lingered.

Measured on this machine against the running dev server on the demo corpus
(2026-09-03, this session; `curl -w %{time_total}` against 127.0.0.1:3177):

| listing | server time | payload |
|---|---|---|
| library root, 288 entries | 8 ms | 324 KB raw, 37 KB gzipped |
| one nested kit, 1 entry | 5 ms | < 1 KB |

So the local wait is not the listing. The hosted wait is: `docs/web-demo-notes.md`
(Measurements, EU paragraph) puts a US visitor's cost at ~90–150 ms per round trip, and
the click-to-populated sequence is listing → (mount) → thumbnails, two trips deep, with
the stale follow-up a possible third. The notes' own bake decision (preview paths
attached to dir entries) already collapses listing → peek → thumbs to listing → thumbs
on the demo; this change takes the listing trip off the click.

Constraints in force: all client I/O through `ApiClient` (D1); the render queue serves
the visible grid and hover must not compete with it (D2/D3); `listDir` is the one
listing transport and the Hono app runs on Node unchanged, so nothing here adds a route.

## Goals / Non-Goals

**Goals:**

- A click on a folder or zip tile the pointer has rested on lands its listing with no
  round trip, through the same `landing` action a fetch would produce.
- The first screenful of that listing's already-rendered thumbnails is in the browser
  cache, or in flight, before the click.
- A wandering pointer costs a bounded number of cheap requests and no renders.
- No server change; no behaviour change for a click that was not preceded by a hover.

**Non-Goals:**

- Rendering thumbnails that do not exist yet for an off-screen folder. That is the
  render queue's work for the grid on screen, and on the demo every render exists.
- Prefetching flat listings, search results, or similarity views. Hover on a folder tile
  under any of those still prefetches the folder's *plain* listing, because that is what
  the click asks for (`navigate` clears the subject and keeps `flat`).
- Warming the folder sheet's peek locally. Locally a sheet is a per-tile request the
  grid's observer already issues when the tile is on screen; on the demo the bake attaches
  preview paths to the entries, and those ride the listing prefetch for free.
- Touch: no hover, nothing fires, nothing regresses.

## Decisions

### D1. A second `createHoverWarmer`, not a kind-dispatching one

App holds `hover` (models → `lru.warm`). This adds `dirHover`, a second instance of the
same factory with the same `HOVER_LINGER_MS`, whose callback is the listing warm, and
Grid's non-model branch gains `onPointerEnter`/`onPointerLeave` calling a new
`onDirHover(path | null)` prop shaped like `onModelHover`.

*Alternative*: one warmer whose callback receives the entry and dispatches on kind. It
would be one timer instead of two, which is also correct (a pointer rests on one tile),
but it changes `onModelHover`'s signature, which three test files drive, for no
behavioural gain. Two instances never both have a live timer: leaving a tile of either
kind fires that kind's `leave()`.

*Zips*: included. They go through the same branch, the same `navigate`, and the same
`listDir`, and the server's archive-directory cache makes their listing as cheap as a
directory's.

### D2. A tiny client-side store keyed on what the click will ask

`lib/listingPrefetch.ts` exports a `ListingPrefetch` class:

- `key(path, flat, folderMatching)` — the plain-request key. `q` is always empty for a
  hover, and the click's request will be plain too: `navigate` sets `subject: none`,
  keeps `liveView(state).flat`, and takes `folderMatching` from `ownPrefs()`. The warm
  reads the same two values at hover time (`state.view.flat`, `ownPrefs()`), so key
  mismatch is only possible if the user toggles between hover and click, in which case
  the click fetches as today.
- `warm(key, fetch)` — starts `fetch()` unless a fresh entry or an in-flight promise
  exists for the key; files the promise; on resolution files `{ listing, at }`.
  **At most `PREFETCH_INFLIGHT_MAX` (2) fetches in flight**; a warm beyond that is
  dropped, not queued — the click pays the trip it would have paid anyway.
- `take(key)` — returns the filed listing, or the in-flight promise, or `undefined`; a
  filed listing is consumed on take (one-shot) and expires after `PREFETCH_TTL_MS`
  (30 s) untaken. The store holds at most `PREFETCH_MAX` (8) filed listings, oldest
  dropped.

The listing is filed **as the server answered it, `stale` included**. A stale-marked
answer taken by a click lands stale, `staleId` changes, and the one follow-up fires
exactly as for a fetched stale landing (`listing-cache` §5.2). That follow-up is a trip,
but it is the same trip the click would have spent, and dropping stale answers instead
would make the warm useless for the first visit to any root in the server's
revalidation window — which on a fresh demo instance is every visit.

*Alternative*: no store — fire the request on hover purely to warm the server's tree
cache. Rejected: the server's cache is already warm (5–8 ms), and the round trip is the
cost; a warm that does not remove the click's trip removes nothing on the demo.

*Alternative*: file into the reducer as a real landing at hover time. Rejected: a landing
writes the URL and the recents and swaps the grid; the pointer resting on a tile is not a
navigation.

### D3. Consumed in the request effect, in front of `listDir`; the reducer is untouched

In the request effect's plain-listing branch, before `api.listDir`:

```ts
const hit = prefetch.take(key)
const answer = hit ?? api.listDir(request.path, opts, controller.signal)
Promise.resolve(answer).then(res => land({ entries: res.entries, truncated: res.truncated, stale: res.stale }), fail)
```

A filed listing lands on the next microtask; an in-flight hover promise is joined; a
miss fetches exactly as today. `land`'s own controller guard still applies, so a hover
promise that resolves after the user has navigated elsewhere is dropped by the effect
cleanup's abort — the fetch itself is not aborted (it carries no signal, D5), it simply
lands nowhere. `pushRecent`, `urlIntent`, `dispatch(landing)` and `accepts` are unchanged
because the landing is the same call with the same arguments.

The `hit` case is what keeps *In-flight listing feedback* true without a spec change:
`useDelayedFlag` reveals the skeleton only after 200 ms continuously in flight, and a
microtask landing is under it by three orders of magnitude.

### D4. The thumbnail warm is an `Image`, for the first `PREFETCH_TILES` usable entries

When a hover fetch resolves, `ListingPrefetch` calls its `warmImages(entries)` hook,
which App supplies as: walk `entries` in listing order, take the first `PREFETCH_TILES`
(24 — a screen of tiles at the default column count, generous rather than exact) model
entries whose `thumb` annotation passes `usable` under the current `ao` (`aoEnabled()`),
and for each set `new Image().src = api.thumbImageUrl(path, mtime, ao, gen)`. The
`Image` objects are held in a short array on the store entry so they are not collected
mid-flight, and dropped when the entry is taken or expires; the browser's HTTP cache is
what persists the bytes, keyed on the same URL the tile's `<img>` will use.

`usable` moves from a module-private function in `useThumbnails.ts` to an export, so the
warm cannot drift from the tile: the render it fetches is the render the tile will draw,
and a render the tile would refuse (rig, lighting, posedness) is never fetched.

*Alternative*: `<link rel="prefetch">`. Rejected: prefetch priority and whether the
response is reused for an `<img>` vary by browser and by cache partitioning rules; an
`Image` is the tile's own fetch, same key, same partition, guaranteed hit.

*Alternative*: `fetch()` with `priority: 'low'`. Same reuse question, plus it would be
the one image fetch in the client not made by an `<img>`, and `useThumbnails`'s release
rules (it releases only object URLs it minted) do not need a new case.

On the demo, where every render is baked and the bake attaches preview paths to dir
entries, the first screenful includes the folder sheets' cells too — they are ordinary
entries with `thumb` facts — so a warmed listing's whole first screen paints from cache.

### D5. No abort signal on the hover fetch; a cap instead

`listDir` accepts a signal so a superseded *flat walk* stops server-side
(`search-cancellation`). A hover fetch is a plain listing served from the tree cache —
bounded by construction, like `peek`, which carries none for the stated reason. What
bounds a wandering pointer is the linger (nothing fires for a tile crossed in under
120 ms) and `PREFETCH_INFLIGHT_MAX`. The cap is per store, not per key: two folders
warming while the pointer moves to a third drops the third's warm.

### D6. The linger constant is shared, deliberately, and measured before it is tuned

`HOVER_LINGER_MS` was tuned for local mesh loads. A hover fetch on the demo costs a trip's
worth of bandwidth, so the question is whether 120 ms fires too readily on a folder
grid. Decision: share the constant and **measure the fire rate on a real cursor sweep**
(tasks §1) before deciding whether a separate `DIR_LINGER_MS` earns its existence. A
second constant with no measurement behind it is exactly the kind of number this repo's
CLAUDE.md says not to write.

## Risks / Trade-offs

- [A warmed listing goes out of date between hover and click] → `PREFETCH_TTL_MS` is
  30 s and the entry is one-shot; a warm older than a click-through is at most as stale
  as the server's own answer would be, and the `stale` marker rides along unchanged.
- [The user toggles flat or folder-matching between hover and click] → key mismatch,
  miss, ordinary fetch. No wrong listing can land: the key is the request's own fields.
- [Hover under a committed search prefetches the folder's plain listing the click will
  not ask for] → it *is* what the click asks for: `navigate` drops the subject. Verified
  against the reducer's `navigate` case; re-verify at implementation time.
- [Twenty-four image fetches per hovered folder on a metered connection] → each is a
  ≈100 KB PNG at most, fired only after a linger, capped by `PREFETCH_TILES`, and every
  one of them is a fetch the click would have made; a hover the user abandons wastes at
  most one screenful. If measurement (tasks §1) shows abandoned hovers dominate,
  `PREFETCH_TILES` drops before the listing warm does.
- [`Image` prefetch and `<img loading="lazy">` do not share a cache entry] → they do
  (same origin, same URL, same partition); asserted by the E2E cell in tasks §4, which
  reads the tile image's `transferSize` from the resource timing entry.
- [Two warmers double the timers in the test doubles] → `createHoverWarmer` is injected
  with `setTimer`/`clearTimer`; the existing hover tests cover the factory, and the new
  tests drive the App-level wiring with fake timers as `interaction.test.ts` already does.
- [The change is judged locally and looks like nothing] → it is nothing locally; that is
  why it is parked, and why tasks §1 gates the rest on a hosted measurement.

## Open Questions

- Whether `HOVER_LINGER_MS` fires too readily on folder grids (D6) — answered by the
  sweep measurement, not by argument.
- `PREFETCH_TILES` = 24 is a guess at a screenful; the right number is the grid's
  visible tile count at the demo's default viewport, which `Grid` could report. Decide
  after measuring whether the guess over- or under-fetches on the demo layout.
- Whether a CDN in front of the origin (the notes' "EU compute, US bytes" option) makes
  the thumbnail half redundant: an edge-cached thumbnail is one short trip, not one long
  one, and the listing half alone might then be the whole change.
