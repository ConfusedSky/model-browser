## 1. The handler (Grid)

- [x] 1.1 `Grid.tsx`: an `onKeyDown` on the grid container (`gridRef`). Ignore keys other
      than the four arrows, and ignore any arrow with `altKey || ctrlKey || metaKey` (leave
      Alt+Arrow to the browser, D3). Read the live tile buttons by reusing `tilesIn(gridRef
      .current)` from `lib/placement.ts` (exported for this, no duplicate query — the same
      reuse decision as Change 1's `findTile`), find the index of `document.activeElement`
      among them; if it is not a tile, return. Otherwise `preventDefault` and move focus:
      Right/Left → ±1 clamped to `[0, n-1]`; Down → `idx + cols` when that is `<= n-1`, else
      the last tile if a partial row is below (`idx` was in the last full row), else no-op;
      Up → `idx - cols` only when `>= 0`, else no-op (D2)
- [x] 1.2 `Grid.tsx`: `columnCount(tiles)` as a PURE exported function over the tile rects —
      count the leading tiles whose `getBoundingClientRect().top` equals the first tile's
      (D2). Empty grid returns 1 (safe denominator; guarded with `const first = tiles[0]; if
      (first === undefined) return 1`, since a `.length` check does not narrow under
      `noUncheckedIndexedAccess`). Exported so 2.1 can unit-test it with stubbed rects

## 2. Tests

- [x] 2.1 `client/test/gridArrowNav.test.tsx` (new), harness `mountApp` with several tiles:
      - `tiles()[0].focus()`; ArrowRight → `document.activeElement === tiles()[1]`; ArrowLeft
        → back to `tiles()[0]`
      - ArrowLeft at `tiles()[0]` stays; ArrowRight at the last tile stays (horizontal clamp)
      - an arrow handled on a focused tile has `defaultPrevented` true; `Alt+ArrowRight` does
        NOT move focus and is NOT prevented (D3)
      - stub `getBoundingClientRect` per tile to fake a 3-column layout, then: ArrowDown from
        `tiles()[1]` → `tiles()[4]`; ArrowUp from a top-row tile (not [0]) stays put; ArrowUp
        from `tiles()[4]` → `tiles()[1]`; ArrowDown from the last full row into a short final
        row → the last tile (D2). Also a direct `columnCount` unit call over stubbed rects
      - focus the find input (`openFind()` + `findInput()`); ArrowRight → `activeElement`
        stays the input, no tile moves. The find input renders outside `gridRef`, so its
        keydown never reaches the handler (container scoping, D3); the `idx === -1` check is a
        second, independent defense for non-tile focus that does reach the handler
      - Falsify (verified 2026-09-15): drop `preventDefault` → the defaultPrevented cell
        fails; clamp Up-from-top to 0 instead of no-op → the top-row "no sideways" cell fails.
        NOTE: moving the listener to `window` does NOT fail the find-input cell — with the
        `idx === -1` guard present, non-tile focus is rejected regardless of scoping, so the
        find input is protected by defense-in-depth (scoping + guard) and only the compound
        window+no-guard mutation breaks it. So the find-input cell is a behavioral regression
        assertion, not a single-mutant falsification; this was a contradiction in the original
        brief, resolved by keeping both defenses and reporting mutation 1 honestly

## 3. Land it

- [x] 3.1 `cd client && bunx vitest run` and `bun run typecheck` green (2026-09-15: full
      client suite 985/985; repo-root typecheck both workspaces exit 0)
- [ ] 3.2 Manual on 5173 (not 3177): Tab to a tile, then arrow left/right/up/down across a
      multi-row folder — focus moves tile by tile and row by row, stops at every edge (top-row
      Up and last-row Down do nothing), and Enter/Space still open the focused tile. Confirm
      arrows in the find input and path bar are unaffected, Alt+ArrowLeft still goes Back, and
      arrows do nothing while a lightbox is open
- [ ] 3.3 `openspec validate grid-arrow-navigation --strict`; archive dry run on a fresh
      copy; after archiving, confirm the applied `directory-browsing` text carries no
      change-scoped prose
