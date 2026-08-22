# Tasks — search-view-reducer

**Hard ordering (archive-level):** the `semantic-search` change (complete, 41/41) and `semantic-search-tuning` MUST archive before this change archives — our `specs/semantic-search/spec.md` delta ADDs a requirement to the capability spec the first creates and the second MODIFYs. `entry-context-menu` (not started) rebases on top of this change after it lands: its url-navigation delta and its 34 tasks were written against pre-reducer App.tsx and must be re-read against the new state core before any of them are implemented.

## 1. The pure reducer (commit 1 — App still on useState)

- [x] 1.1 Create `client/src/state/` with the state shape from design R1 (`view`, `inflight` with id + source, `phase`, `result` with `forView`, `failure`, `index`, `drafts`) and the action types for every transition: navigate, submit, toggleFlat, setMode, setTuning, setKinds, setFolderMatching, clear-input, cancel-deferred, restore, landing, failure, index-probe, model open/close/drop — with `sameView` (serialization equality, R1) as the one View comparison
- [x] 1.2 Implement the reducer pure: preferences arrive as action payload (never read from `searchOptions` module state inside the reducer, design R2); assertion at dispatch for unfailable transitions, at landing for failable ones (R1); acceptance by `(id, forView)` against `inflight` (R2); result replaced wholesale, never spread with rebuilt entries (R5)
- [x] 1.3 Implement the corpus decision (name / meaning / defer) as one function of `(view, index)` used by both the submit and mode-flip transitions (R6)
- [x] 1.4 Implement selectors: `dest` (`inflight?.view.path ?? view.path`), `busy` (`inflight !== null || (phase === 'deferred' && result === null)`, R6), `byKind`/notice/label inputs reading `result.forView` — never `view` (R1 corollary)
- [x] 1.5 Unit-test the reducer with the findings as named cases: deferred cancelled by navigate/clear/name-search; deferral fires only for its view; tuning survives restore compare and restore; stale index impossible (index is state); lightbox/model-drop/deferred/setKinds URLs carry the whole view; residue dies with its result; mode flip defers; stand-in stays nested; flat toggle survives a search; navigate re-seeds all four options from the stored preferences on the action (R2)
- [x] 1.6 Unit-test the acceptance races: stale identical-view response rejected by id; response after navigation rejected by forView; two rapid restores; landing during a fetchless view patch keeps the patched field
- [x] 1.7 Decide the find-trio placement (design Open Question: `findText`/`findOpen`/`findFocus` in `drafts` vs component-local) by whichever leaves fewer touch points, and record the decision in design.md

## 2. URL projection and parsing

- [x] 2.1 Move the "options exist only alongside a committed query" gate into `serializeView`; remove `parseUrl`'s `flat`-from-`q` inference; `flat` param now records the toggle (design R3/R4 — BREAKING for URLs, old search links still parse, their `flat` now honestly meaning flat)
- [x] 2.2 Implement the projection effect: fires only on URL-owning dispatches **that asserted something** (the URL runs ahead of the view after a Back, so writing an unadvanced view is not the no-op it looks like); `replace` from `result.source === 'restore'`; `history.state` lightbox marker from model-transition provenance (R2/R3); the model-drop path keeps its read-live-URL-and-patch shape (bridge 4, R7)
- [x] 2.3 Adjust tests only where the new semantics are the point: `urlState.test.ts`'s "a query implies flat" case is replaced by one pinning the derived request shape (a `flat`-less search view still issues `flat: true` to the API); **all 14** exact-args `listDir` assertions gain the signal argument (fileNameSearch ×4, searchOptionsUi ×6, flatToggleInFlightTarget ×2, flatToggle, urlNavigation — the arity fix is mechanical, so "every other assertion passes unchanged" means the non-`listDir` ones); semanticSearch's "the deferred query runs itself once the index answers" drove the availability re-read by *navigating*, which this change's own delta spec makes a cancel — rewritten to let the warming poll deliver `ready`; every other assertion in `urlNavigation`/`urlLightbox`/`searchOptionsUi` passes unchanged

## 3. The swap (commit 2 — App on useReducer)

- [x] 3.1 Replace the state cells and transition functions in App.tsx with dispatches; delete the ref families (`matchingRef`/`kindsRef`/`modeRef`/`tuningRef`/`queryRef`/`destRef`/`stateRef`; `requestRef`/`landedQueryRef`/`restoreReqRef`/`hasLandedRef`/`standInRef` — twelve gone); keep `tuningTimerRef` in the effect layer, its re-run guarded by `sameListing` against the view that scheduled it (R8). `semanticAbortRef` becomes the fetch effect's own `AbortController`, one per asking event, so listings are cancellable on the same handle
- [x] 3.1a Delete App's duplicate `sameAvailability` (the reducer's runs on the `index` action) and reset the find trio beside the `navigate` and `restore` dispatches (design's answered Open Question)
- [x] 3.2 Wire the effect layer: fetches tag their landing actions with `(id, forView, source)`; superseded fetches are aborted — listings included, not just semantic queries, which means `listDir` gains an `AbortSignal` through ApiClient (D1); this is what makes `search-cancellation`'s server-side cancellation reachable (note it against that change)
- [x] 3.3 popstate becomes a single dispatch of the parsed view with `source: 'restore'`; the deferred-restore stand-in fetches nested; localStorage writes hang only off control-originated user actions (R2 — a restore or link never writes storage)
- [x] 3.4 Viewer boundary: `view.model` asserted on lightbox promotion and cleared by close/restore transitions; render-queue suspension, LRU, and pose lookup stay keyed off `viewer` (R7's forbidden list); `closeSignal` handshake unchanged
- [x] 3.5 Full suites green from the workspace dirs plus typecheck; the pre-existing DOM tests listed in design R9 — `persistPut.test.tsx` included, it mounts App directly — are the regression gate and pass without semantic edits (except 2.3's)
- [x] 3.6 Add the dev-only action log in the dispatch wrapper (design's debuggability mitigation) — also off under the test runner, where `DEV` is true and the log would bury the assertions it exists to explain

## 4. Sign-off and follow-through

- [x] 4.1 Judge the visible behavior change: `toggleFlat`'s label persists until the plain listing lands instead of blanking optimistically — try it against the e2e fixtures on a slow (cold-cache) walk and confirm it reads as truthful rather than stuck; not done until the pixels are judged
      (judged 2026-08-21, 100ms-sampled toggle over a 551-tile root search: the side
      panel's live line empties at click+100ms — the click visibly registers — while
      the grid label persists exactly as long as the answer's own tiles and leaves
      with them when the skeleton takes over at ~320ms; label and grid can never
      disagree, so it reads truthful)
- [x] 4.2 Manual E2E pass over the deferral lifecycle with the real index (start `mini-classify`, kill it, defer a query, navigate, restart it): confirm no hijack, banner honesty, cancel paths
      (run 2026-08-21 with availability intercepted at the API boundary rather than
      killing the peer session's index: deferred boot holds a nested stand-in with an
      honest banner; navigating away cancels — zero queries fire when ready arrives
      and the URL drops the search instantly; emptying the input cancels the same
      way; kept views fire exactly one query when ready lands; the real index dying
      mid-test bonus-verified the warming→absent banner transition. Known limit,
      pre-existing: in `absent` state nothing re-probes without an interaction, so an
      absent-index deferral's "runs as soon as the index answers" overpromises)
- [x] 4.3 Update `search-cancellation`'s proposal impact note ("No client change") to record that client-side listing aborts now exist and feed its `c.req.raw.signal` premise
- [x] 4.4 Delete the `reducer-refactor-owns-deferred-findings` memory and re-run a review of the reducer with a different model than the implementer
      (both commits implemented by opus and line-reviewed by fable before merging:
      commit 1's review read all 1,035 lines, commit 2's walked the projection fence,
      fetch/popstate/model effects, resolveView and the debounce guard; two of the
      four in-flight check-ins were themselves review-driven corrections)
