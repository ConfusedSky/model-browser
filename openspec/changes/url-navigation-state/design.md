# Design — url-navigation-state

## Context

`App` (client/src/App.tsx) holds the entire navigable state: committed `path` (set only in `fetchListing`'s `.then`), the optimistic `target`/`dest` pair every header control keys off, `flat`, the `filter`/`query` split (live text vs committed search), and `viewer` (`'orbit'` overlay vs `'lightbox'`, opened by `openLightbox`, closed by setting it null). Boot reads localStorage last-path (`lib/recents.ts`) and navigates there. Nothing touches `location` or `history` today; the client is a Vite SPA on one route, and the future Electron shell (D1 seam) loads the same bundle — so URL state must not depend on server-side routing.

## Goals / Non-Goals

**Goals:**
- The URL always names the view actually on screen; back/forward, reload, bookmark, and share all reproduce it.
- History semantics ride the existing request machinery — latest-wins, the skeleton, `dest` — without a parallel navigation path.

**Non-Goals:**
- A router library or path-segment routes: four query parameters on one route need neither, and path-segments would demand server fallbacks the Electron seam can't promise.
- URL state for the live filter, orbit overlay, lighting mode, AO preference, or camera poses — ephemeral or preference state, not places.
- Scroll restoration.

## Decisions

### D1: Query parameters on the single route, written only on commit

The URL is `/?path=<vpath>&flat&q=<query>&model=<vpath>`, serialized by a new `lib/urlState.ts` (parse, serialize, and "push if different / replace" helpers — pure functions plus two thin `history` wrappers, unit-testable). Writes happen where views become real: `fetchListing`'s `.then` (path/flat/q as landed) and the transition into and out of lightbox mode (`model` — see D3, which is specific about where those transitions actually are). The optimistic `dest` never reaches the URL: the path bar may show where the user is *going*, but a URL is a shareable claim about what *rendered* — and pushing on request would record failed and superseded navigations, exactly the states the label/`target` machinery works to keep out of view. `URLSearchParams` does the encoding, on its own — `set`/`toString` already percent-encode spaces and the zip `!/` separator, so an `encodeURIComponent` pass on top of it would double-encode (`/a b/c!/d.stl` → `%252Fa%2520b…`) and the value would come back out wrong. One encoder, not two.

*Alternative — hash routing:* survives even non-SPA static hosting, but query params already work under Vite's SPA fallback and Electron's file loading, and they read/share cleaner.

### D2: One history entry per committed view change; popstate restores composite state

`fetchListing`'s `.then` compares the landed `{path, flat, q}` against the current URL: different → `pushState`, same → nothing (a reload of the same view must not stack entries). A `popstate` handler parses the URL and restores the *composite* view in one request — `setFlat`, `setQuery`/`setFilter`, then `fetchListing(path, flat, q)`, whose `.then` must `replaceState` rather than push (back must not create forward-erasing entries).

That "this one is a restoration" mark is carried **by request id, not by a boolean**. A module-level `restoring` flag would have to stay set across the whole async fetch, and any ordinary commit landing in that window — a click on a tile while the back-triggered listing is still walking — would read the flag as its own and `replaceState` over the entry it should have pushed, silently losing a history step. `fetchListing` already stamps every request with `++requestRef.current` (App.tsx:67/84) and discards all but the newest; recording *which* request id is a restoration and comparing it in the `.then` reuses that existing latest-wins identity instead of racing it. Plain `navigate()` is deliberately not reused for popstate: it clears filter and query by design (D2/D3 of file-name-search), which is correct for user navigation and wrong for history restoration of a search view.

The failure path stays quiet: a popstate-triggered fetch that fails shows the error over the prior grid exactly like any navigation; the URL then names a view that failed to render, and the next successful commit corrects it. Accepted — the alternative (rewriting the URL on failure) fights the browser's own back/forward position.

### D3: The lightbox is a modal history entry; the orbit overlay is not

**The push hooks the transition into `'lightbox'` mode, not `openLightbox`.** There are two entrances and only one of them is that function. `openLightbox` (App.tsx:223) is wired to `Grid`'s `onModelOpen`, which fires from a single place: the tile's `onKeyDown` (Grid.tsx:74-78) — the *keyboard* route. The pointer route, the one most users take, never calls it: `onModelPointerDown` opens the orbit overlay, and a release without a drag calls `onPromote` (ViewerLayer.tsx:209), which App turns into `setViewer((v) => ({ ...v, mode: 'lightbox' }))` in place (App.tsx:463). Hanging the history push off `openLightbox` would therefore leave every mouse-opened lightbox with no entry and no `model` param — and then a ✕ routed through `history.back()` would pop the *directory* entry instead, closing the modal and navigating the grid backwards in one press. Both entrances funnel through the same state transition, so that is where `model=<entry.path>` is pushed.

**Closing is one path, owned by `ViewerLayer`.** Three affordances close a lightbox today — ✕ (ViewerLayer.tsx:523), Escape (:267), and a backdrop pointerdown (:398-400) — and all three already funnel into `closeLightbox` (:293-300), which awaits `s.settle(renderNow)`, awaits `onPersist(s)`, and only then calls `onDismiss()`. That `s` is `sessionRef.current`, private to `ViewerLayer`: App cannot run this chain. So the `popstate` handler does **not** close the viewer itself — reaching for the only thing it can reach, `closeViewer` (App.tsx:296, a bare `setViewer(null)`), would skip settle and persist, losing the camera capture that this decision explicitly promises. Instead popstate raises a close *request* that `ViewerLayer` consumes in an effect and answers by running its own `closeLightbox`, ending at `onDismiss()` exactly as a ✕ does. Whoever initiates — button, key, backdrop, or browser-back — there is one teardown, and it is the async one that persists.

**Direction of travel, and the deep-link exception.** In-app affordances close by calling `history.back()`, so back and ✕ converge and forward re-opens. The exception is a lightbox that was *restored from the URL on boot* (D4): that entry is the first in the session, so `history.back()` would leave the app entirely. A lightbox therefore remembers whether its own entry was pushed; if it was not, closing drops `model` via `replaceState` and runs the same teardown, leaving history untouched.

Re-opening from a URL (deep link or forward) finds the entry in the current listing by path and enters lightbox mode through the same transition; if the listing doesn't contain it (stale link into a changed directory), the `model` param is dropped via `replaceState` — never an error modal over a healthy grid. The orbit overlay stays out of history entirely: it lives between pointerdown and release, and a history entry per drag would shred the back stack. Note the asymmetry this creates and accept it — a drag opens an overlay that is not a place, while a tap promotes it into one.

### D4: Boot precedence — URL over localStorage, then seed

On load: URL has `path` → restore that view (including `flat`/`q`/`model`) and skip last-path; bare URL → today's behavior (last-path or nothing), then `replaceState` the resolved view in so the first back-target and any copied URL are truthful. A `model` restored this way is marked as *not pushed by us*, which is what D3's close path reads to decide between `history.back()` and dropping the param — the boot entry has nothing behind it to go back to. `pushRecent` keeps feeding localStorage on every commit either way — recents and last-path behavior are unchanged.

## Risks / Trade-offs

- [Back/forward re-fetches listings rather than restoring from memory] → accepted: listings are cheap, the mesh/thumbnail caches make re-render fast, and a state-cache layer would add staleness semantics the app deliberately avoids.
- [`model` deep link races the listing load] → the lightbox-open effect keys on the loaded listing; until the entry exists there is simply no lightbox, and the param is dropped only after a *successful* listing that lacks the entry.
- [Two writers to history (navigation and lightbox) can interleave with in-flight requests] → all writes funnel through urlState helpers that read the live URL at write time and only push on difference; restoration is identified per-request (D2), so a commit landing mid-restore is classified by its own id rather than by shared mutable state.
- [This change and `file-name-search` both edit App.tsx's fetch/commit path] → hard ordering: implement after file-name-search archives (declared in tasks.md); its committed-`query` semantics are load-bearing for D2.
- [The lightbox now has two entrances and three exits, and the history hook must catch all of them] → the push moves to the single mode transition and the close funnels through `ViewerLayer.closeLightbox`, so both are one hook each rather than five call sites (D3); task 3.1 asserts each affordance individually, because a missed one fails silently — a stale `model` param and a dangling forward entry, with the modal visibly closed.

## Open Questions

- **Does `pushState` with a changed query string work under the Electron seam?** D1 rejects hash routing partly on the claim that query params "already work under Vite's SPA fallback and Electron's file loading". The Vite half is certain. The Electron half is not: Chromium throws `SecurityError` on `history.pushState` when the document's origin is opaque, which is what a plain `file://` load gives — the app would have to be served from a custom protocol or `http://localhost` inside the shell for query-param history to work at all. This does not block implementation (the browser is the shipping target today, and D1 of the architecture keeps the Hono app Node-runnable for that future shell), but it must be answered before the shell is built, and if it comes back negative, hash routing is the fallback that is immune to it — a `urlState.ts` that owns parse/serialize keeps that swap to one file.
