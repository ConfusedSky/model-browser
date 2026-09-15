## Why

The folder grid has no arrow-key navigation (issue #9, priority: high, demo). A keyboard
user reaches the tiles with Tab, one tile per press, in listing order — there is no way to
move by row or to cross a wide grid quickly, and no spatial sense of the grid at all. The
lightbox is gaining prev/next stepping (`lightbox-sibling-stepping`); the grid it opens from
should be navigable by the same keys the rest of the app is about to teach.

## What Changes

- Arrow keys move keyboard focus between grid tiles when a tile is focused. `ArrowLeft` /
  `ArrowRight` move to the previous / next tile in listing order; `ArrowUp` / `ArrowDown`
  move by one row — up or down a column — where the column count is whatever the responsive
  grid is currently showing.
- Focus movement stops at the grid's edges: the first tile does not move left/up past
  itself, the last does not move right/down past itself.
- Arrow keys act only when a grid tile already has focus. Arrows pressed in the path bar,
  the find input, or anywhere else are untouched, and Tab still walks tiles as it does today.
- Moving is focus movement between the existing tile buttons — the same buttons Enter and
  Space already activate. No selection state, no separate "current tile" concept, and the
  lightbox's own arrow stepping is unaffected (its focus is trapped in the dialog, so no
  grid tile is focused while it is open).

Not in this change: the lightbox prev/next stepping (`lightbox-sibling-stepping`, which
shares no files with this change); a roving-tabindex ARIA grid (Tab keeps walking every
tile); type-ahead; touch (issue #10); Home/End/PageUp/PageDown.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `directory-browsing`: a new requirement, *Arrow-key focus movement across the grid* — the
  keys, the row step over the responsive columns, the edge stops, and acting only from a
  focused tile.

## Impact

- `client/src/components/Grid.tsx` only: an `onKeyDown` on the grid container that moves DOM
  focus among the tile buttons (`data-entry-tile`), deriving the column count from live tile
  geometry for the row step. No App changes, no new props.
- Tests: `client/test/gridArrowNav.test.tsx` (new). Note: happy-dom applies no layout, so
  the row step's geometry cannot be unit-tested there; Left/Right and the guards are, and
  the row step is verified by hand (recorded in `design.md`).
- Records: issue #9 (this change closes its grid half; the lightbox half is
  `lightbox-sibling-stepping`).
