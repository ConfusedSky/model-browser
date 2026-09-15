## Context

The lightbox is `ViewerLayer` (`client/src/viewer/ViewerLayer.tsx`). Its state,
`ViewerState`, holds one `entry` and no notion of a neighbour. Every per-model prop it
receives is looked up in `App.tsx` by `viewer.entry.path` — `camera` and `axis` off
`thumbs.get(viewer.entry.path)`, `pose` off `poses[...]`, `score` through `scoreFor(...)` —
and the 3D session rebuilds in a `useEffect` keyed `[viewer.entry.path, lru]` whose cleanup
`close()`s the old session. So the component re-derives its per-model surfaces when
`viewer.entry` changes — but only its *props* re-derive for free; its own `session` and
`loadError` state need resetting on the swap (D5).

The models are already in App, in grid order. `shownEntries` is what `<Grid>` renders —
`filteredListing` (the listing narrowed by the find text and the kinds option), with the
similarity anchor prepended when there is one. It mixes dirs, zips and models, and it can
change under an open lightbox (a background listing revalidation lands a fresh array).

Three App effects already couple the lightbox to history, and all three bear on stepping:

- The history push (comment "The lightbox history push hooks the transition INTO 'lightbox'
  mode") fires only on the orbit→lightbox transition (`prev !== 'lightbox'`), so a step that
  keeps the mode `'lightbox'` does not re-fire it — a step must write its own URL.
- The close-watcher (comment "The model left the view while a session is open") fires
  `setCloseSignal` — which tears the lightbox down — whenever `state.view.model !==
  viewer.entry.path` while open, once the model was named. So a step MUST move
  `state.view.model` and `viewer.entry.path` together, or it closes the lightbox instead of
  navigating it.
- The re-open effect (comment "model named but nothing mounted", calling
  `openRestoredLightbox`) mounts a lightbox for a `state.view.model` that has no viewer. A
  stray `modelOpen` commit after a close therefore re-opens the lightbox — the hazard D3
  guards.

App's `persist` (its `onPersist` prop) takes the pixels, camera and axis from the
`ViewerSession` it is handed, and captures the write *path* from `viewer?.entry` before its
awaits — but it then `await`s `session.snapshot`, `createImageBitmap` and a network
`api.putThumb`, a window of tens to hundreds of ms during which the lightbox is fully live.
`closeLightbox` already runs this branch — `if (s.everManipulated) { await s.settle
(renderNow); await onPersist(s) }`, then dismiss — as does an axis change while the lightbox
stays open. A step reuses the branch, and must survive a close landing inside that window
(D3).

## Goals / Non-Goals

**Goals:**
- Step to the previous/next model in shown order on the arrow keys and two on-screen
  affordances, keeping the lightbox open and re-deriving every per-model surface.
- Persist the leaving model's view on a step under the exact rule a close uses, safely
  across the persist's async window.
- Keep the URL model parameter on the model shown, without growing history, and without
  tripping the close-watcher.
- Stop at the ends with no wrap; keep focus steady throughout.

**Non-Goals:**
- Grid arrow-key navigation (`grid-arrow-navigation`).
- Wrap-around, touch/swipe (issue #10), and stepping out of the folder.
- Prefetching or warming the neighbour's mesh ahead of the step — the existing hover-warm
  LRU and the session rebuild already cover the swap; a neighbour prefetch is a later
  optimisation, not a correctness need.

## Decisions

### D1: Step among model siblings in shown order

The sibling list is `shownEntries.filter((e) => e.kind === 'model')`, memoised. Deriving it
from `shownEntries` — not the raw listing — means stepping honours the find filter and the
similarity anchor prepend: the user pages through what the grid is showing, which is what
"step through the listing" means when a filter is on. Only `kind === 'model'` entries are
steppable, so an interleaved dir or zip is skipped rather than opened (the lightbox has
nothing to show for one). The position is the index of `viewer.entry.path` in that list. When
the index is `-1` — the open model is no longer in the shown list, which a background listing
revalidation can cause — both neighbours resolve to `null`: stepping is inert until the model
is back in view, never teleporting to the list's first entry (which `siblings[idx+1]` would
do at `idx === -1`). `prevEntry`/`nextEntry` are otherwise the neighbours or `null` at the
ends.

### D2: No wrap; the affordance is present but disabled at the end it cannot serve

`prevEntry` is `null` at the first model, `nextEntry` at the last. Wrap was considered and
declined (issue #9, settled with Masa): a lightbox that silently loops gives no signal it has
reached the end, and folders here can be large. The end control is rendered **disabled**, not
removed (settled with Masa 2026-09-14): a control that vanishes under the user's focus drops
focus to `<body>` and empties the modal's focus trap, whereas a disabled control holds its
place, shows the end plainly, and keeps the trap populated. The key for a `null` neighbour is
a no-op — the lightbox stays open and unchanged.

### D3: A step persists like a close, before the swap, and survives a close landing mid-persist

The user's instinct governs: if you orbit a model and step away, the orbit is a decision and
must be kept, exactly as a close would keep it. The step reproduces `closeLightbox`'s branch
— `if (s.everManipulated) { await s.settle(renderNow); await onPersist(s) }` — inside
ViewerLayer's own `goTo(entry)`, *before* it calls App's navigate. Order is half the safety:
App's `persist` captures `viewer.entry` before its awaits, which is still the leaving model
until the swap lands, so the leaving model's pixels file under the leaving model's path.

The other half is the async window. During `onPersist`'s `putThumb`, a close affordance
(Escape / ✕ / backdrop) can run the full teardown and `setViewer(null)`. `goTo` therefore
snapshots the viewer it started on and, after its awaits, bails if the lightbox is gone or
changed (`if (viewerRef.current !== started || modeRef.current !== 'lightbox') return`),
following the file's own `dismissAfterPersist` idiom. And because the re-open effect is
App's, App owns the matching half: `navigateSibling` refuses to commit unless a lightbox is
still up (`viewerRef.current?.mode === 'lightbox'`), so a step that lost its race writes no
`modelOpen` and cannot re-open the lightbox over the listing the user backed onto. An
untouched view (`everManipulated` false) writes nothing, so arrowing through a folder without
touching anything is free — and its `goTo` has no await to race.

### D4: The entry and the URL parameter move together

`navigateSibling(entry)` in App does its writes in one handler, `setViewer` **before**
`commit` (the order matters — see below):
`setViewer((v) => v ? { ...v, entry, originEl: tileFor(entry) ?? v.originEl } : v)` and
`commit({ type: 'modelOpen', path: entry.path }, { replace: true, state: window.history.state
})`. React batches them into one render where `viewer.entry.path` and `state.view.model` are
both the new path, so the close-watcher sees them equal and stays quiet; even a split render
is safe, because the watcher's own `namedModelRef.current !== viewer.entry.path` guard is true
across the swap — *provided* `setViewer` ran first, so the guarded order is deliberate and
carries a comment. `replace` (not push) keeps the back button meaning "close the lightbox"
rather than "undo one arrow press", and carrying `window.history.state` forward preserves the
`LIGHTBOX_ENTRY` marker the close path reads. The history-push effect does not double-fire: it
early-returns while the mode stays `'lightbox'`.

`originEl` is updated to the shown model's own tile, so a close after stepping returns focus
to the model on screen rather than to the tile the lightbox first opened from (settled with
Masa 2026-09-14); with grid arrow navigation landing beside this, leaving focus twenty tiles
away from the last model viewed would be the wrong place to resume. The tile is found by
reusing `findTile(scroller, path)` from `lib/placement.ts` — exported for this (it already did
the exact match-by-`data-entry-tile`-attribute-value the reveal placement needs, avoiding a
CSS attribute selector because paths carry `!/`, spaces and quotes) rather than hand-writing a
second copy. It is called with `mainRef.current` as the scroller; when that is null or the
tile is not found (a filtered or off-screen sibling), `originEl` is left as it was.

### D5: A step resets the viewer's own state so the neighbour draws a spinner

The session effect's cleanup nulls `sessionRef` but does not clear the `session` *state*,
and the spinner, the axis group and the error block all gate on that state. Left as is, a
step would show the leaving model's last frame — and a stale `loadError` — beside the new
model's name and metadata until the new mesh landed, with no spinner and a dead axis group.
So the session effect clears both at its top on an entry change (`setSession(null);
setLoadError(null)`), which is what makes "a step shows a loading indicator if the mesh is
cold" true rather than aspirational. This is the one behaviour the "survives a swap" framing
missed: the held-dismissal case it was generalised from is an invisible overlay, not a modal
the user is watching.

### D6: The props and `goTo` reach the key handler through refs, and the dialog focus is conditional

`onNavigate`, `prevEntry`, `nextEntry` and `goTo` are read inside the lightbox key effect
through refs updated on render, not added to the effect's dependency array. The effect's deps
are `[viewer.mode, session]` and `session` changes on every step, so the effect re-runs each
step regardless; routing through refs keeps `onKey` from closing over a leaving render's
`onPersist` (the `endGestureRef` bug the file records — "the new tile's pixels under the old
tile's path") and keeps the deps unchanged. The effect's `containerRef.current?.focus()` is
made **conditional** — `if (!containerRef.current.contains(document.activeElement))` — so it
still grabs focus when the lightbox opens (focus is outside the dialog then) but does not
yank focus back to the dialog after each step, which would let a keyboard user activate the
on-screen *Next* control only once. Arrow keys with a modifier (`altKey`/`ctrlKey`/`metaKey`)
are ignored, so Alt+ArrowLeft stays the browser's Back — the very gesture that closes the
lightbox — rather than stepping.

## Risks / Trade-offs

- [A close lands inside a step's persist] → D3's snapshot-and-bail in `goTo` and the
  mode guard in `navigateSibling`; tested with a held `putThumb`.
- [A rapid double-arrow starts a second step mid-persist] → `settle`/`persist` only run when
  `everManipulated`; a fresh sibling has no session yet, so back-to-back steps without
  orbiting do not persist. If a race is ever observed, an in-flight guard ref is the fix; the
  snapshot-and-bail already prevents the harmful re-open.
- [The open model leaves the shown list] → D1's `-1 → both null`; stepping goes inert, the
  model stays shown, no teleport.
- [Stepping past a filtered-out model] → intended (D1): the list is what the grid shows.
- [The neighbour's mesh is cold] → D5's reset shows the spinner the first open shows; the
  hover-warm LRU often has it already. A prefetch is a non-goal.

## Migration Plan

Pure client change, additive. No wire, store, or deploy step. It lands with the suite green;
the demo picks it up on its next image build.

## Open Questions

- None. Scope (lightbox only; grid is separate), no-wrap, persist-on-step, disabled (not
  absent) end controls, and focus-return-to-the-shown-tile were settled with Masa across
  2026-09-14/15.
