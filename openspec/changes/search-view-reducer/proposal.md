# Search View Reducer

## Why

The 2026-08-21 code review of the week's work confirmed seven bugs that are all one disease: the search/view state in `client/src/App.tsx` is scattered across ~20 `useState` cells and ~16 refs, so every transition hand-maintains its own reset, compare, restore, and serialize lists — and each bug is one list missing one field. Those seven were deliberately deferred rather than point-fixed because their call sites are exactly what a structural fix rewrites. An adversarial design review (2026-08-21) then confirmed three *more* instances of the same disease nobody had reported. Point fixes provably do not hold the line here; the state model has to.

## What Changes

- App.tsx's search/view state moves into a pure reducer (`client/src/state/`), with App reduced to dispatch + render. The state shape: `view` (the question the app currently asserts), `inflight` (the question last asked, with a monotonic id and `source: 'user' | 'restore'`), `phase` (`idle | deferred`; fetching is `inflight !== null`), `result` (the landed answer, carrying `forView` and owning `scope`/`weak`/`capped`/`poses`), `failure`, `index`, and reducer-read drafts.
- The URL becomes a projection of the asserted view: one serializer writes every history entry, option gating ("options exist only alongside a committed query") moves into `serializeView`, and push-vs-replace, the lightbox `history.state` marker, and localStorage writes all derive from action provenance — never from a shared flag or from view changes.
- Answer acceptance is by asking-event: a response is accepted iff its `(id, forView)` matches `inflight` — replacing the `requestRef` counter, the deferred-fire guards, and the debounce-fire guards with one rule.
- The deferred meaning query becomes `phase: 'deferred'` with an explicit cancel transition; the corpus decision (name vs meaning vs defer) becomes one function of `(view, index)` used by both submit and mode-flip.
- **BREAKING (URL semantics):** `parseUrl` stops inferring `flat` from `q`. `View.flat` records the flat *toggle*; the flat request shape a search needs is derived (`q ? true : flat`). A search URL round-trips the toggle, so clearing a deep-linked search's query lists nested like a typed search does, instead of flattening the whole volume. Caveat: links shared before this change carry an explicit `flat=1` (today's commits always wrote it), so old links keep flattening on clear — the round-trip applies to URLs written from this change on.
- The effect layer aborts superseded fetches — listings too, not just semantic queries — which is what makes `search-cancellation`'s server-side "cancel when nobody waits" actually reachable.
- Fixes structurally: the seven deferred findings, plus the three review-confirmed extras (Forward into a deferred entry fetches the stand-in flat; `navigate()` restores only two of the four options from storage; the deferred commit omits tuning from the URL).
- One visible behavior change to sign off: `toggleFlat` no longer blanks the results label optimistically — the label reads the landed answer, so it persists until the plain listing lands.

## Capabilities

### New Capabilities

None — the reducer is implementation. All observable behavior lands in existing capabilities.

### Modified Capabilities

Both deltas are pure **ADDED** requirements: the two requirements other active changes MODIFY ("The URL names the committed view", touched by `semantic-search` and `entry-context-menu`; "Meaning search is a mode of the search input", touched by `semantic-search` and `semantic-search-tuning`) are deliberately not targeted, per the collision rule.

- `url-navigation`: ADD a requirement that every history write names the whole view — lightbox opens, stale-model drops, and deferred commits carry the view's options instead of hand-built subsets; and the `flat` param records the toggle rather than being implied by `q`. (Duplicate-entry dedup stays owned by the existing main-spec requirement — deliberately not restated.)
- `semantic-search`: ADD a requirement giving the deferred meaning query a lifecycle — cancelled by navigation, emptying the input, or a name search; fired on index-ready only for the view still on screen; deferral (not silent name-search substitution) when the mode is flipped to meaning while the index is not ready; and a *nested* stand-in listing on restore. **Note:** this capability's spec still lives in the unarchived `semantic-search` change — see ordering in tasks.md.

`file-search` needs no delta: its existing scenarios ("History restores the options a view ran under", "A shared link does not reconfigure the recipient", "Leaving the search restores browsing … honoring the flat toggle's state") already require the behavior findings 2 and 8 and the deep-link flat divergence violate — those are spec violations this change fixes, not spec changes.

## Impact

- `client/src/App.tsx` — major rewrite of the state core (~20 `useState`, ~16 refs collapse; the transition functions become dispatches). Render/JSX and the viewer layer largely untouched.
- New `client/src/state/` — pure reducer + selectors, unit-testable without the DOM; the ten findings become its test suite.
- `client/src/lib/urlState.ts` — option gating moves into `serializeView`; `parseUrl` flat inference removed (its "a query implies flat" unit test is replaced by one pinning the derived request shape).
- `client/src/api/client.ts` — `listDir` gains an `AbortSignal` parameter (`semanticSearch` already has one); exact-args `listDir` assertions in existing tests gain the argument.
- `client/src/components/SidePanel.tsx` — props only; its field-local edit buffers (`topText`/`scoreText`) deliberately stay local.
- `client/src/viewer/ViewerLayer.tsx` — unchanged; four named boundary bridges in design.md (`history.state` marker read, `closeSignal` handshake, orbit-before-lightbox window, model-drop live-URL patch).
- Tests — existing DOM suites should pass near-unchanged (none read App internals); new pure-reducer suite added.
- **Ordering (hard):** the `semantic-search` change (complete, 41/41) and `semantic-search-tuning` must archive before this change archives, so our `semantic-search` delta ADDs to a main spec. `entry-context-menu` (not started) rebases on top of this change after it lands — its url-navigation delta and 34 tasks were written against pre-reducer App.tsx. `search-cancellation` gains its client-side abort dependency from this change (noted there, no file overlap).
