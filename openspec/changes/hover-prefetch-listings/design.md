## Context

**Unparked 2026-09-08**: `public-deployment` archived that day, which was the condition.
What remains before §2 is a *measurement*, and the origin to take it against is
`demo-infrastructure`'s (Caddy, HTTP/2), not the SSH tunnel the CX23 was driven through —
that tunnel opens a fresh connection per request and the notes call its numbers an upper
bound, which would flatter the thumbnail half in particular.

Re-check every citation below against the source before starting; this was drafted
2026-09-03, four changes have archived since, and the request effect in `App.tsx` is
edited often.

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

Measured on this machine against the running dev server (2026-09-03, this session;
`curl -w %{time_total}` against 127.0.0.1:3177). **Re-take these before relying on them**:
the run recorded no library root, and it predates `listing-tree-cache`'s emission-time
filling, which puts preview cells and their thumbnail facts inside each directory entry —
so today's payload for the same listing is larger than the figure below and its server
time includes work this table never measured.

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

One correction to that sequence, from the 2026-09-08 review: a plain listing is not only
a round trip. `/api/dir`'s plain branch runs `fillAnnotations` under its 300 ms budget the
first time it sees a directory, so the click's wait is the trip *plus* that fill. It
strengthens the case — a hover spends the fill too — and it means the join path (a click
arriving while the warm is still in flight) is the common case rather than the edge, which
is what D3 must be read as optimising.

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
but it changes `onModelHover`'s signature, which two test files drive
(`tileDisplayNames.test.tsx`, `thumbView.test.tsx` — `interaction.test.ts` drives the
factory, not App), for no behavioural gain. Two instances never both have a live timer: leaving a tile of either
kind fires that kind's `leave()`.

*Zips*: included. They go through the same branch, the same `navigate` and the same
`listDir`. A first draft claimed the server's archive cache makes their listing as cheap
as a directory's; it does not — `listZipDir` reads the central directory per request, and
only the flat walk passes a zip cache. So a zip warm costs a little more than a folder's,
and is still one bounded read the click would have paid for. Moot on the demo, whose
corpus ships no archives.

### D2. A tiny client-side store keyed on what the click will ask

`lib/listingPrefetch.ts` exports a `ListingPrefetch` class:

- **The warm fires only while the view is not flat, and the key carries no `flat`.** A
  flat listing is a recursive walk under a 20k-step budget; firing one on a hover is the
  uncancellable traversal `search-cancellation` exists to prevent, and D5's claim that a
  hover fetch is "bounded by construction" is only true of the plain shape. So a hover in
  flat mode warms nothing, and the store never holds a flat answer.
- `key(path, folderMatching)` — the plain-request key. `q` is always empty for a hover and
  the click's request is plain too: `navigate` sets `subject: none` and takes
  `folderMatching` from `ownPrefs()`. Build it through the reducer's own recipe
  (`requestOf` over `{ ...ownPrefs(), path, subject: none }`) rather than by hand, so the
  warm cannot drift from what the request effect keys on — and read `liveView(state)`, not
  `state.view`, since they differ while a flat toggle is in flight.
- `warm(key, fetch)` — starts `fetch()` unless a fresh entry or an in-flight promise
  exists for the key; files the promise; on resolution files `{ listing, at }`, and **on
  rejection evicts the entry**. A filed rejection would otherwise be handed to the click by
  `take`, which fails the navigation without it ever fetching — a transient 503 while the
  library is unsettled would turn into a click that does nothing. **At most
  `PREFETCH_INFLIGHT_MAX` (2) fetches in flight**; a warm beyond that is dropped, not
  queued — the click pays the trip it would have paid anyway.
- `take(key)` — returns the filed listing, or the in-flight promise, or `undefined`; a
  filed listing is consumed on take (one-shot) and expires after `PREFETCH_TTL_MS`
  (30 s) untaken. The store holds at most `PREFETCH_MAX` (8) filed listings, oldest
  dropped.

The listing is filed as the server answered it. A first draft of this decision built a
case on the `stale` marker riding along — and that case was empty: `stale` is set only by
`ListingCache.list`, which `/api/dir` reaches only inside its `if (flat)` branch, so a
plain listing is never marked stale and a plain-only warm can never hold one. The rule
that survives is narrower and needs no scenario: whatever the answer carries, the landing
carries, because it is the same landing.

One consequence of that is worth writing down, because it would be a bug rather than a
subtlety: a stale landing's follow-up asks for the same key it just landed. The request
effect therefore **skips the store for a follow-up request**. Without that, a follow-up
could be answered from the very entry it is trying to refresh, and the refreshing
affordance would stay up until the user navigated away.

*Alternative*: no store — fire the request on hover purely to warm the server's tree
cache. Rejected: the server's cache is already warm (5–8 ms), and the round trip is the
cost; a warm that does not remove the click's trip removes nothing on the demo.

*Alternative*: file into the reducer as a real landing at hover time. Rejected: a landing
writes the URL and the recents and swaps the grid; the pointer resting on a tile is not a
navigation.

### D3. Consumed in the request effect, in front of `listDir`; the reducer is untouched

In the request effect's plain-listing branch, before `api.listDir`:

```ts
// A follow-up is asking to refresh the very key it just landed; the store must
// not answer it with what it is refreshing.
const hit = request.followUp === true ? undefined : prefetch.take(key)
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

### D4. The thumbnail warm is not in this change

It was, and the 2026-09-08 review took it out for two reasons that both survive
implementation.

**It would have fetched nothing where it mattered.** Since `listing-tree-cache`, a
directory entry carries its sheet cells *nested* in `entry.preview`, so the walk this
decision described — take the first `PREFETCH_TILES` model entries of `entries` — skips
every cell. On the demo root, and on every kit parent, that is a folder-of-folders: zero
images warmed, by a decision whose own last paragraph asserted the opposite.

**And its win is the part the infrastructure is already removing.** The listing trip is
serial and nothing else can remove it: `/api/*` is not edge-cacheable and HTTP/2 does not
collapse a dependency. The thumbnail fetches are a fan-out *after* mount — exactly what
Caddy's HTTP/2 shrinks to one connection and what a CDN would shrink to an edge hop, the
notes' still-open "EU compute, US bytes" question. Spending this change's complexity
budget there, before that question is answered, is spending it on the half most likely to
be redundant.

It is drafted as `hover-prefetch-thumbnails`, gated on this change's after-measurement
showing the residual gap is the image fan-out, and on the CDN decision. Splitting cost
nothing: it was always its own ADDED requirement.

### D5. No abort signal on the hover fetch; a cap instead

`listDir` accepts a signal so a superseded *flat walk* stops server-side
(`search-cancellation`). A hover fetch carries none — and the reason that is safe is D2's
plain-only rule, not the shape of `listDir`: a plain listing reads one directory, like
`peek`, while a flat one walks a subtree under a step budget with the request held open.
Warming a flat listing would put an uncancellable traversal behind a pointer, which is
why the warm does not fire in flat mode at all. What
bounds a wandering pointer is the linger (nothing fires for a tile crossed in under
120 ms) and `PREFETCH_INFLIGHT_MAX`. The cap is per store, not per key: two folders
warming while the pointer moves to a third drops the third's warm.

### D6. The linger constant is shared, deliberately, and measured before it is tuned

`HOVER_LINGER_MS` was tuned for local mesh loads. A hover fetch on the demo costs a trip's
worth of bandwidth, so the question is whether 120 ms fires too readily on a folder
grid. Decision: share the constant and **measure the fire rate on a real cursor sweep**
(tasks §1) before deciding whether a separate `DIR_LINGER_MS` earns its existence. The
same sweep measures the premise the whole change rests on and which nothing here has ever
measured: hover-to-click dwell. With a 120 ms linger, a 90–150 ms trip and up to 300 ms of
annotation fill, whether a click lands on a filed answer or joins an in-flight one is
decided by that distribution, and the two are worth very different amounts. A
second constant with no measurement behind it is exactly the kind of number this repo's
CLAUDE.md says not to write.

## Risks / Trade-offs

- [A warmed listing goes out of date between hover and click] → `PREFETCH_TTL_MS` is
  30 s and the entry is one-shot; a warm older than a click-through is at most as stale as
  the server's own answer would be, and whatever the answer carried the landing carries.
- [The user toggles folder-matching between hover and click] → key mismatch, miss,
  ordinary fetch. No wrong listing can land: the key is the request's own fields. A flat
  toggle cannot mismatch, because the warm does not fire in flat mode and the key does not
  carry `flat` (D2).
- [Hover under a committed search prefetches the folder's plain listing the click will
  not ask for] → it *is* what the click asks for: `navigate` drops the subject. Verified
  against the reducer's `navigate` case; re-verify at implementation time.
- [Image fetches per hovered folder on a metered connection] → moved out with the
  thumbnail half (D4). For the record, since the number was wrong here for a day: after
  `webp-thumbnails` a render is ~5 KB, not the "≈100 KB PNG" this bullet claimed, so a
  whole first screen of ~114 images is ~0.57 MB — which weakens this risk rather than
  supporting the cap it argued for.
- [A rejected warm is handed to the click] → evicted on rejection (D2); the click fetches
  as it would have. A cell pins it, because the failure mode is a click that does nothing.
- [Two warmers double the timers in the test doubles] → `createHoverWarmer` is injected
  with `setTimer`/`clearTimer`; `interaction.test.ts` covers the factory itself, and the
  App-level wiring goes through `appHarness.tsx` (`mountApp`, its shared `listDir` mock,
  `tiles()`), which is where a cell can see a warm and a click as one sequence.
- [A hovered tile unmounts without a `pointerleave`] → a keyboard or URL navigation
  removes the tile under the pointer, so the timer survives its grid and the warm fires
  for a directory the user has left. Harmless (one listing filed, then expired) but the
  model warmer has the same hole today; `navigate` calling both `leave()`s closes both.
- [The change is judged locally and looks like nothing] → it is nothing locally, which is
  why tasks §1 gates the rest on a measurement — and now that the parking condition has
  passed, on a measurement taken against the real origin rather than the SSH tunnel, whose
  connection-per-request shape flatters any prefetch.

## Open Questions

- Whether `HOVER_LINGER_MS` fires too readily on folder grids (D6) — answered by the
  sweep measurement, not by argument.
- Whether the join path or the filed path dominates in practice (D6's dwell measurement).
  If clicks almost always join an in-flight warm, the store's TTL, cap and one-shot rules
  matter far less than the fact that a request was started early, and §2 can shrink.
- Moved out with the thumbnail half (D4): what a screenful actually is on the demo layout,
  and whether a CDN in front of the origin makes that half redundant.
