## Why

A visitor who opens one model expects to step through the rest of the folder without
leaving the view — arrow keys, or on-screen arrows, the way every image lightbox on the
web behaves (issue #9, priority: high, demo). Today the lightbox handles Escape and Tab
and nothing else: the arrow keys do nothing, there is no prev/next affordance, and the
only way to the next model is to close the lightbox, find the next tile, and open it —
losing the framing and the flow each time. The demo is live and this is the coarsest
gap in the viewing experience.

## What Changes

- The lightbox steps to the previous or next model in the same folder on `ArrowLeft` /
  `ArrowRight`, and by two on-screen arrow affordances beside the model. The lightbox
  stays open; the view swaps to the sibling.
- Stepping walks the models the grid is showing, in the grid's order — the shown listing
  narrowed to `kind === 'model'`, so a find filter or a similarity anchor is respected:
  you page among what you can see, not among what the folder happens to hold.
- Stepping stops at the ends. At the first model `ArrowLeft` does nothing and the previous
  affordance is shown but disabled; at the last, `ArrowRight` does nothing and the next
  affordance is disabled. There is no wrap. (A disabled control at the end keeps focus
  steady and shows where the ends are, rather than vanishing under the user's focus.)
- A step persists exactly as a close does (`pose-rerender` D4): if the view was
  manipulated — an orbit, a zoom, or an axis change — the current model's camera, axis and
  thumbnail are written before the view swaps; an untouched view writes nothing.
- The model URL parameter follows the step in place — `replaceState`, not a new history
  entry — so the address bar names the model on screen and a share/reload reproduces it,
  while the browser back button still closes the lightbox onto the listing it opened from
  rather than retracing every arrow press.

Not in this change: arrow-key navigation of the grid itself (a separate change,
`grid-arrow-navigation`, which shares no files with this one); wrap-around at the folder
ends; touch/swipe gestures (issue #10 owns the touch pass); stepping across folder
boundaries.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-viewer`: a new requirement, *Lightbox steps between sibling models* — the keys and
  affordances, model-only stepping in shown order, the end stops, and persist-on-step.
- `url-navigation`: a new requirement, *Stepping updates the model parameter in place* —
  the parameter follows the step by `replaceState`, adding no history entry.

## Impact

- `client/src/App.tsx`: a memoised model-only sibling list off `shownEntries`; the prev/next
  entry resolution where `<ViewerLayer>` renders; a `navigateSibling` callback that swaps
  `viewer.entry` (updating `originEl` to the shown model's tile so a later close returns
  focus there), commits the model parameter with `replace`, and refuses to commit unless a
  lightbox is still up; three new props to `ViewerLayer`.
- `client/src/viewer/ViewerLayer.tsx`: the new props and a `goTo` read through refs (not
  effect deps — the lightbox key effect re-`focus()`es the dialog whenever it re-runs, and
  the session changes on every step); one `goTo(entry)` that reproduces `closeLightbox`'s
  settle→persist branch, snapshots the current viewer across its awaits and bails if a close
  raced in, then navigates; a step that resets `session`/`loadError` so the neighbour draws
  a spinner rather than the leaving model's frozen frame; `ArrowLeft` / `ArrowRight` (ignored
  with a modifier) in the existing `onKey`; a conditional dialog focus that does not steal
  focus from the on-screen controls; two `aria-label`led arrow buttons (disabled at the
  ends) placed so their pointer/wheel events never orbit or zoom.
- Tests: `client/test/lightboxPrevNext.test.tsx` (new).
- Wire: none — no route changes; the same `modelOpen` commit the lightbox already writes,
  with `replace`.
- Records: issue #9 (this change closes its lightbox half; the grid half is
  `grid-arrow-navigation`).
