## Context

`Grid` (`client/src/components/Grid.tsx`) renders one `<button>` per entry — folders and zips
as one kind, models as another — into a CSS grid,
`grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]`, so the column count is viewport-derived
and changes with window width. Every tile carries `data-entry-tile` (models also
`data-model-tile`); the buttons are natively focusable and already activate on Enter/Space
(the model tile's `onKeyDown` opens the lightbox, dir/zip tiles enter). The grid's only
focusables are these tile buttons — the find input and the path bar render in `<main>`
*outside* `gridRef`. There is no focus, selection, roving-tabindex, or arrow handling
anywhere in the grid today; tiles participate only in the native Tab order.

The lightbox is gaining its own arrow stepping (`lightbox-sibling-stepping`). The two do not
collide: while the lightbox is open its focus is trapped in the dialog, so no grid tile is
`document.activeElement` and no keydown reaches the grid handler.

## Goals / Non-Goals

**Goals:**
- Move keyboard focus between tiles with the arrow keys: Left/Right by one tile in listing
  order, Up/Down by one row across the current column count.
- Stop at the grid's edges; leave every non-grid arrow and native Tab untouched.
- Do it with the least machinery that is correct and standards-aligned.

**Non-Goals:**
- A full ARIA grid with roving tabindex (only the active cell tabbable) — it is more state,
  and it would change today's "Tab walks every tile", which nothing has asked for.
- Type-ahead, Home/End/Page keys, wrap at row ends, and touch (issue #10).
- Any selection concept distinct from focus.

## Decisions

### D1: Move DOM focus between the existing buttons — no new state

The tiles are already focusable buttons that activate on Enter/Space. Arrow navigation is
therefore *moving focus between them*, not inventing a "selected tile". The handler reads the
live tile buttons, finds the focused one, computes the target index, and calls `.focus()` on
it. No React state, no roving tabindex, no new props, and Enter/Space keep working because
the focused element is a real tile button. This is the smallest change that is also the
standards-aligned one: focus *is* the current-cell notion. A roving-tabindex ARIA grid is the
fuller pattern but adds state and changes Tab behaviour (D-non-goal); it stays a possible
follow-up.

### D2: Left/Right are linear; Up/Down step by the live column count; vertical edges stop

`ArrowRight` / `ArrowLeft` move to the next / previous tile in listing (DOM) order, clamped
at the ends — geometry-free, and rolling naturally across row boundaries. `ArrowDown` /
`ArrowUp` move by ±(column count). `ArrowUp` from the top row is a **no-op** — not a clamp to
tile 0, which would move focus *sideways* and read as neither "up" nor "stop" — so the target
is taken only when `idx - cols >= 0`. `ArrowDown` from the last row is a no-op when
`idx + cols` exceeds the last index, except that a down step landing past the end because the
final row is short SHALL land on the last tile (there is a row below; it is just partial).
Both vertical edge rules are stated in the requirement, since APG grids leave the top/bottom
row's vertical arrows as no-ops and a reader should not have to infer it.

The column count is derived from live geometry rather than assumed, because the grid is
`auto-fill`: `columnCount(tiles)` counts the leading tiles whose
`getBoundingClientRect().top` equals the first tile's — the tiles are uniform (`aspect-square
w-full`), so the top-row count is the column count. `columnCount` is a pure function over the
tile rects so it can be unit-tested with stubbed rects (Risks). Reading geometry per keypress
is cheap at grid sizes here and needs no resize bookkeeping.

### D3: The handler is scoped to the grid; act only from a focused tile; ignore modifiers

The `onKeyDown` sits on the grid container (`gridRef`), whose only focusables are the tile
buttons — so a keydown from the find input or the path bar (both outside `gridRef`) never
reaches it. That container scoping, not a guard, is what isolates the other fields, and it is
also why the handler is silent while the lightbox is open (focus is trapped in the dialog).
The handler still checks that `document.activeElement` is one of the grid's tiles: this is how
it *finds the index to move from* and how it declines when focus is on the container itself
rather than a tile — kept as the index computation, not credited as the isolation mechanism.
The handler ignores any arrow pressed with `altKey`/`ctrlKey`/`metaKey`, so Alt+ArrowLeft
stays the browser's Back. When it does move focus it calls `preventDefault`, so the arrow
moves focus instead of scrolling the surrounding `<main>` — the browser still scrolls the
newly focused tile into view, which is wanted.

## Risks / Trade-offs

- [happy-dom has no layout] → `getBoundingClientRect` returns zeros by default, but it is a
  method on each button and can be stubbed per tile (`t.getBoundingClientRect = () => ({ top:
  Math.floor(i / cols) * H, ... })`) to fake a known column count. So the row step and the
  top-row no-op ARE unit-testable once `columnCount` is a pure function over rects (D2); the
  tests stub a 3-column layout and assert Down-from-1-lands-on-4 and Up-from-the-top is inert.
  The reveal-mark highlight and the anchor ring are box-shadow only, so they do not disturb
  the top-equality method.
- [Focus lands on a tile scrolled out of view] → the browser scrolls a focused element into
  view by default; no extra scroll handling is needed, and the spec allows the scroll.
- [A re-render between keypresses reorders tiles] → the handler reads the live DOM each
  press, so it always operates on what is currently shown.

## Migration Plan

Pure client change, one component, additive. No wire, store, or deploy step.

## Open Questions

- None. Scope (grid only; the lightbox is `lightbox-sibling-stepping`) and the
  no-roving-tabindex approach were settled with Masa on 2026-09-14.
