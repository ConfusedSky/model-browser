# Design — search-view-reducer

Line citations are against `b382ed9`.

## Context

App.tsx holds the search/view state in ~20 `useState` cells and ~16 refs. The refs form three families: stale-closure escape hatches (`matchingRef`/`kindsRef`/`modeRef`/`tuningRef`/`queryRef`/`destRef`, plus the popstate everything-mirror `stateRef`, App.tsx:719), request bookkeeping stored out-of-band (`requestRef`:217, `landedQueryRef`:230, `restoreReqRef`:235, `hasLandedRef`:238, `standInRef`:656), and genuine effect handles (`semanticAbortRef`, `tuningTimerRef`). Every transition hand-maintains reset/compare/restore/serialize lists over the same fields, and ten confirmed bugs (seven from the 2026-08-21 code review, three from the design review) are each one list missing one field. Constraints: the recorded decisions in CLAUDE.md (notably D1 ApiClient-only I/O, D2 renderer singleton with queue suspension, D3 in-flight `dest` vs committed `path`) and the archived url-navigation design's rejection of a shared "restoring" boolean (archive/2026-08-18-url-navigation-state/design.md, "by request id, not by a boolean").

## Goals / Non-Goals

**Goals:**
- One pure reducer owns the view, the in-flight question, the landed answer, and the index availability; the ten findings become impossible states or single-rule rejections, pinned by unit tests on the pure reducer.
- One serializer writes every history entry; one rule accepts or rejects every response.

**Non-Goals:**
- The viewer session (orbit overlays, render sessions, teardown, persist) stays outside the reducer — D2's machinery is untouched.
- `find`-in-listing beyond what transitions already touch; SidePanel's internal edit buffers; any server change.
- Fixing the pre-existing double-Back double-persist (ViewerLayer.tsx:351-357 de-dupes only an unchanged `closeSignal`); recorded here as known, out of scope.

## Decisions

### R1 — Assert vs answer

State shape:

```ts
{
  view: View                 // the question the app currently asserts; the URL projects it
  inflight: { view: View, asked: View, id: number,
              source: 'user' | 'restore', standIn?: true } | null
                             // `asked` is the question as sent, never patched: acceptance
                             // compares against it, while `view` carries the fetchless
                             // patches made since and is what the landing asserts
  phase: 'idle' | 'deferred' // "fetching" is not a phase: it is inflight !== null,
                             // and a deferral can have a stand-in fetch in flight
  result: { forView: View, source, entries, truncated,
            scope?, weak?, capped?, poses? } | null   // the question that was answered
  failure: { forView: View, message: string } | null
  index: IndexAvailability | null
  drafts: { queryText: string, ... }                  // only text the reducer itself reads
}
```

**`view` is asserted at dispatch for transitions that cannot fail (setKinds, the deferred submit, model open/close) and at landing for those that can (any fetch).** This one sentence replaces the three carve-outs an "advances only on landing" rule needed. The stand-in listing (today App.tsx:672, `keepUrl=true`) is the proof case: `view` keeps naming the meaning search while `result.forView` names the plain listing — a *legitimate steady state*, not an error. Corollary invariant: **the grid, filters, and notices read `result.forView`; only the URL projection and the deferred banner read `view`** (today's deferred path nulls `query` at App.tsx:559 to fake this; `byKind` gates on it at :876-884).

Optimism lives entirely in `inflight` (the PathBar's `dest` becomes `inflight?.view.path ?? view.path`, preserving D3). Failure = keep `view`, set `failure`, clear `inflight` — the `landedQueryRef` revert machinery (App.tsx:230, :310) is deleted, not relocated. A fetchless view change patches its field in `view`, in `inflight.view` (never `path`/`q`), so a concurrent landing cannot revert it (today's equivalent: `kindsRef` read at land time, App.tsx:298) — **and in `result.forView`: a fetchless change belongs to the answer it stands beside**, which is the landing's own sentence read from the other side. Found in commit 2 (2026-08-21) by tracing the kind control: the render reads `result.forView`, so a patch that stopped at `view` left that control inert once anything had landed — the URL said `kinds=models` while the grid went on showing the folders — and left `stoodIn` claiming a stand-in after every lightbox open. The `setTuning` `run: false` case is the nuance and is accepted rather than carved out: for the debounce window the landed answer claims to have run under a tuning it did not, bounded by that window, corrected by the re-query, and read by nothing.

**View equality is one function everywhere it appears:** `sameView(a, b) = serializeView(a) === serializeView(b)` — the comparison urlState.ts:111-113 already makes, justified by its comment at :103-110. It is what acceptance's `forView` match means (R2), what the `commitUrl` dedupe compares (urlState.ts:125), and what the stood-in predicate `!sameView(result.forView, view)` means (R6). Never reference or field-wise comparison: fetchless patches mint new objects, so identity comparison would misfire on the first `setKinds`. Two consequences recorded from commit 1: (a) the restore compare asks it of the view *minus the model* (`sameListing`), because which model is open says nothing about which entries the view contains (R7's two truths) and a history entry differing only there must patch that field rather than re-ask for a listing — this replaces today's popstate `changed` list at App.tsx:764-770, whose omission of tuning is a finding; (b) `dest`'s "in flight if there is one, else asserted" rule is the general one (`liveView`), read for `path` by the PathBar and for every option by the controls — a stand-in is skipped, because it is not the question.

### R2 — Acceptance by asking-event, provenance on the action

A response action carries `(id, forView)` and is accepted iff `id === inflight.id` and `sameView(action.forView, inflight.asked)` — the question *as asked*, because the effect layer captured `forView` when the request went out and knows nothing of any fetchless patch made since (commit 1, 2026-08-21). The landing then sets `result.forView = inflight.view`, the patched assert-view, never the action's `forView`: rendering reads `result.forView` and must see the patched field. Value-equality alone is rejected because it inverts latest-wins for identical re-submissions: stale R1 accepted → inflight cleared → fresh R2 rejected. The id is `requestRef` moved into state. `source: 'user' | 'restore'` rides the action and lands on the result; `replace` vs push derives from `result.source` — **never** a `lastTransition` cell, which is the shared boolean the url-navigation design explicitly rejected (its D2; implemented today as `restoreReqRef`:235/283). The same provenance decides the `history.state` lightbox marker (today `suppressViewerPushRef`:241) and localStorage writes: **storage is written only by control-originated user actions** — a restore or a link never writes it (pinned today by searchOptionsUi.test.tsx:116-134; stated at searchOptions.ts:12). Preferences enter the reducer as action payload, never read inside it (`optionsOf` reading module state at App.tsx:76-80 is impure under StrictMode). `navigate()` re-seeds **all four** options — mode, tuning, folderMatching, kinds — from the stored preferences carried on the action; today it re-seeds only two (App.tsx:384-388), which is how a link's mode and tuning outlive the view they named, violating file-search's "A shared link does not reconfigure the recipient". `listing-tree-cache`'s reconciliation is a client *follow-up request* (its tasks.md:31), so it arrives as an ordinary landing under its own id — no special case in the acceptance rule.

### R3 — The URL is a projection, with a fence

One effect serializes `state.view` and commits. The "options exist only alongside a committed query" gate moves from the call sites (App.tsx:291-299, :527) into `serializeView` itself, or the projection writes `?kinds=folders` onto plain listings (forbidden by searchOptionsUi.test.tsx:307-311). The projection fires only on dispatches that own the URL (landings, fetchless assertions, deferred submit) **and only when that dispatch actually advanced the view** — compared against the last view the projection wrote, never against the live URL, which runs ahead of the view for the whole of a restoration (the browser rewinds the address bar on Back while the fetch is still out). Commit 2 found the difference: most controls *ask* rather than assert, so projecting their unadvanced view looks like a dedupe no-op and is one — except mid-restore, where it pushes the view the user just left back on top of history (urlNavigation.test.tsx:98-127). Not on every state change — because lightbox teardown is async (`PERSIST_HOLD_MS = 1500`, ViewerLayer.tsx:58; close awaits settle + persist, :332-346) and a wholesale write during that window can `replaceState` over a history entry the user already Backed off. Model-close dispatches therefore never project: clearing `view.model` reaches history only through the patch path (bridge 4, R7). This kills three of the **four** hand-built view literals (App.tsx:835 lightbox commit, dropping mode/kinds/tuning; :564 deferred commit, dropping kinds/folderMatching/tuning; :528-535 setKinds, dropping tuning); the fourth, the pendingModel drop (:822), is fixed differently — it becomes a read-live-URL-and-patch like :857/:1029, not a projection.

### R4 — `flat` is the toggle; the request shape is derived

`View.flat` records the flat toggle. A search's request shape derives as `q !== null ? true : flat`; `parseUrl` stops inferring `flat` from `q` (today urlState.ts:56 destroys the toggle: `p.has('flat') || q !== undefined`). This is the actual fix for review finding 5 — "submitSearch forgot setFlat" was the symptom; the disease is two meanings in one slot, which is why a deep-linked search's cleared query lists the whole volume today while a typed search's lists nested (boot from `boot.flat`, App.tsx:137 vs clear-path reading the toggle, :424).

### R5 — The result owns its residue, wholesale

`scope`/`weak`/`capped`/`poses` live inside `result`; a landing replaces the whole object and no reducer branch ever spreads it with rebuilt `entries` (the rule is about that identity, so R1's `forView`-only spread is not an exception to it) — `useThumbnails` resets every thumb to `loading` on `entries` identity change (useThumbnails.ts:102-105), and `poses` is read inside that effect but absent from its deps (safe only because listing and poses land together, App.tsx:341-346; the wholesale rule makes that structural).

### R6 — Deferral is a phase with an exit; the corpus decision is one function

`deferred` + `standInRef` become `phase: 'deferred'` (+ derivable "have I stood in": `result !== null && !sameView(result.forView, view)`, R1). An explicit cancel transition fires on emptying the input, navigating, or a name search — today there is no exit (`handleQueryTextChange` refetches only when `query !== null`, App.tsx:422, and the deferred path nulls it at :559). The name/meaning/defer decision becomes one function of `(view, index)` shared by submit and mode-flip — otherwise finding 7 (setMode silently substituting a name search, App.tsx:479-485 vs :551-566) is fixed only by convention. A landing never touches `phase` (commit 1): leaving the deferral is the job of the transition that asked something else, and a landing that quietly tidied the phase would hide a cancel path that forgot to — it did, until the unit test for it was falsified. Busy-ness derivation: `busy = inflight !== null || (phase === 'deferred' && result === null)` — a deferral and an in-flight stand-in coexist (phase stays `'deferred'` while the stand-in request runs). Booting into a meaning deep link fetches *nothing* until the availability probe answers — semanticSearch.test.tsx:509-529 pins that `listDir` is never called in that window and the semantic query runs once ready (the rule lives only in code today, App.tsx:588-591; the delta spec now carries it). The restore stand-in fetches **nested** — today's popstate stand-in passes `v.flat` (App.tsx:802), flattening the volume, which the code's own comment at :669-671 forbids.

### R7 — The viewer boundary: two truths, four bridges

`view.model` = "the model the URL names"; `viewer` = "what is mounted". They disagree for the whole async teardown (~1.7s worst case). Forbidden: keying the render-queue suspension (App.tsx:598-601), the mesh LRU, or pose lookup off `view.model` — those stay on `viewer`. Named bridges: (1) the `LIGHTBOX_ENTRY` `history.state` marker is written by the projection, read by close-intent — `history.state` cannot live in a reducer; (2) `closeSignal` stays a counter handshake because teardown is private to ViewerLayer (D2); (3) the orbit overlay exists before lightbox promotion, so `viewer` leads `view.model` by one transition; (4) the model-drop path keeps its read-live-URL-and-patch shape (App.tsx:857, :1029 pattern) rather than projecting, per R3's fence.

### R8 — Drafts and debounce

`drafts` holds only text the reducer reads (`queryText`, consumed by submit, App.tsx:540). SidePanel's `topText`/`scoreText` stay component-local — they exist so a half-typed number is not a value (SidePanel.tsx:73-82), and hoisting them would dispatch per keystroke into the memoized grid. The tuning debounce timer is keyed by the view that scheduled it — the live view with the recorded value already applied — and dropped the moment `sameListing` says that is no longer the question on screen. A plain view-equality guard becomes trivially true once tuning is itself a view field, and would miss a popstate restoring different tuning mid-debounce; keying by a global dispatch id (commit 2's first reading) over-corrects the other way, cancelling the re-run on any unrelated landing or availability tick inside the 300ms window. `sameListing` is the comparison the change already owns: a navigation, another search, or a restored tuning drops the timer, while a landing or a lightbox open — which the comparison ignores, the model saying nothing about the query — leaves it armed.

### R9 — Migration: two commits, big-bang

Commit 1 extracts the pure reducer + selectors (`dest`, `busy`, `byKind`, label inputs) with App still on `useState`, and lands the reducer unit suite (the ten findings as cases). Commit 2 swaps the cells for `useReducer` and deletes the ref families. Strangler rejected: two state regimes in one component is a longer exposure than one reviewable swap, and no existing test reads App internals — all go through the DOM harness (appHarness.tsx:166-199), with one exception to include in the gate: persistPut.test.tsx mounts App directly. Commit 2's diff is judged by the existing suites: searchOptionsUi (storage vs URL, option gating), fileNameSearch:325-357 (buried superseded errors), urlNavigation:98-127 (restore by id), urlLightbox (six close paths), semanticSearch:509-529 (no fetch while probing).

## Risks / Trade-offs

- [Two truths for the open model during teardown] → R7's forbidden-couplings list; bridge 4 keeps history writes off the projection in that window.
- [One wholesale URL writer concentrates blast radius] → R3's fence (project only on URL-owning dispatches) plus the gating living in `serializeView`, where urlNavigation tests exercise it.
- [Optimism latency: labels read the landed answer] → visible on `toggleFlat` (today blanks instantly via `setQuery(null)`, App.tsx:406; under R1 the label persists until the plain listing lands — seconds on a cold removable-media walk). Accepted deliberately; tasks.md carries a sign-off item.
- [Debuggability: one nested state vs greppable cells] → dev-only action log in the dispatch effect; the pure reducer makes "which fields disagreed" a unit test rather than a console session.
- [Delta-spec collisions: `semantic-search` capability spec is unarchived; `entry-context-menu` carries a url-navigation delta] → hard ordering in tasks.md: archive `semantic-search` and `semantic-search-tuning` first; `entry-context-menu` rebases after this lands (user decision, 2026-08-21).

## Open Questions

- **Answered (commit 1, 2026-08-21): `find`-in-listing's ephemeral trio (`findText`/`findOpen`/`findFocus`) stays component-local.** R8's own rule decides it — `drafts` holds only text the reducer reads, and nothing reads `findText`; `findFocus` is a focus-signal counter, not text at all. The touch-point count seconds it: local costs two resets in commit 2, one beside the `navigate` dispatch and one beside the `restore` dispatch (today App.tsx:376-378 and :776-778), where `drafts` would cost three action types, three reducer cases, the same two resets, and rewiring FindBar's call sites to dispatch. It is the SidePanel `topText`/`scoreText` precedent again: ephemeral edit state that the reducer never consults stays where it is used.
