# URL Navigation State

## Why

Every view in the app — a directory, its flat listing, a committed search, an open lightbox — is reachable only by re-driving the UI: the browser's back/forward buttons do nothing, a view cannot be bookmarked or shared, and a reload lands on the localStorage last-path rather than what was on screen. The app already has a precise, small definition of "where the user is" (committed `path`, `flat`, committed `query`, open lightbox model); it just never reaches the URL.

## What Changes

- **The URL reflects the committed view**: query parameters on the app's single route — `path` (directory or zip vpath), `flat` (present when on), `q` (committed deep-search query), `model` (open lightbox's vpath). The live filter, in-flight navigation target, lighting mode, and AO preference stay out: the first two are ephemeral, the last two are device preferences, not places.
- **History entries per committed view**: landing a navigation, toggling flat, committing or clearing a search, and opening the lightbox each push a history entry; back/forward replay them through the existing request path (latest-wins, skeleton, and the in-flight `dest` machinery unchanged). Failed and superseded requests never touch history — the URL only ever names a view that actually rendered.
- **Deep links**: loading a URL with parameters restores that view — directory, flat/search state, and lightbox (once its entry is present in the listing). A bare URL keeps today's localStorage behavior and seeds the URL via `replaceState`.
- **Lightbox joins history**: entering lightbox mode pushes — by either route, the keyboard's `openLightbox` or the pointer's promotion out of the orbit overlay, which is how most opens actually happen. All three close affordances (✕, Escape, backdrop click) go through `history.back()` so back-closes-lightbox and forward-reopens behave like every other modal on the web, and closing always runs the existing persist-on-teardown. The exception is a lightbox deep-linked at load: with no in-app entry behind it, closing drops the parameter instead of going back, so ✕ never ejects the user from the app. The transient orbit overlay stays out of history.

## Capabilities

### New Capabilities

- `url-navigation`: the URL as a faithful, shareable record of the committed view, and browser history as first-class navigation over it.

### Modified Capabilities

None — existing capabilities keep their requirements; the new capability layers history/URL semantics over the views they define. (Ordering note: this change references deep-search behavior that `file-name-search` introduces and edits the same `App.tsx` regions — it is implemented after that change archives, which it now has — the ordering constraint is satisfied; see tasks.)

## Impact

- `client/src/lib/urlState.ts` (new) — parse/serialize the four parameters, diff-aware push/replace helpers; unit-testable without a DOM.
- `client/src/App.tsx` — URL writes on commit (in `fetchListing`'s resolution and on the transition into lightbox mode, which both entrances share), a `popstate` handler that restores composite view state (path + flat + query together, not `navigate()` which clears search state by design), and URL-over-localStorage boot precedence.
- `client/src/viewer/ViewerLayer.tsx` — its three close affordances route through history, and it answers App's close request by running its own `closeLightbox` teardown; the persist chain stays where it is, since the session it needs is private to this component.
- `client/test/` — urlState unit tests; component tests on the shared harness for push/replay/deep-link/lightbox-back behavior (happy-dom provides `history`/`popstate`).
- No server, API, or cache changes; camera/thumbnail persistence untouched.
