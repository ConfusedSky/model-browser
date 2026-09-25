## Context

See proposal.md for why. The grid today (`Grid` in `client/src/components/Grid.tsx`) renders
every entry as a memoized `Tile` inside one CSS grid whose columns are `auto-fill` over a
per-size minimum (`GRID_CLASS`). The scroller is App's `<main>` (`mainRef`, passed as
`scrollRoot`). Four things read the DOM on the assumption that every tile is in it:

- **Bands and peeks.** `Grid`'s observer effect builds two `IntersectionObserver`s rooted at the
  scroller — one with `FAR_ROOT_MARGIN` (`200% 0px 200% 0px`, two viewport heights either side),
  one without — over every `[data-dir-tile], [data-model-tile]`. `publish` turns their records
  into a band per path (`visible` / `near` / `far`, preview cells one step farther via
  `CELL_BAND`) and calls `onBands`; the margined observer calls `onPeek` for folders. App's
  `reportBands` adds `far` for entries a filter hid and hands the map to `useThumbnails`'
  `setBands`, which drops a map equal to the last one (`sameBands`). The same observer effect
  sets `data-offscreen` on each tile for the stylesheet's animation pause.
- **Placement** (`client/src/lib/placement.ts`). `measureIn` walks `tilesIn(scroller)` for the
  first tile crossing the scrollport's top edge; `applyIn` finds the anchor with `findTile` and
  sets `scrollTop` from its rect. App calls `measureIn` in `recordNow` and `applyIn` in the
  layout effect that settles `pendingPlacement` (retrace, reveal centring, top).
- **Keyboard.** `Grid`'s `onKeyDown` steps over `tilesIn(gridRef)` with `columnCount` read from
  tile rects; its document listener focuses `tilesIn(...)[0]`. App's arrival effect
  (`arrivalFocusRef`) focuses `findTile(main, child) ?? tilesIn(main)[0]` with
  `preventScroll`; `focusFirstTile`, `closeFind` and the weak set's "Show all" do the same by
  DOM lookup.
- **Lightbox.** `viewer.originEl` is the pressed tile. `navigateSibling` re-points it at
  `findTile(main, entry.path)` on each step; `closeViewer` calls `originEl?.focus()` (native
  scroll-into-view). The open rect is read from the pressed tile, which is always mounted.

The probe (uncommitted, `probeOn("virtual")` in `Grid`) proved the performance with
`@tanstack/react-virtual`; it re-built both observers on every range change and left the rest
broken.

## Goals / Non-Goals

**Goals:**

- Mount a bounded number of tiles whatever the listing's length, on every view the grid draws
  (listing, flat, search, similarity).
- Keep every behaviour in `directory-browsing`'s new requirement and every existing band,
  peek, placement and focus rule, with the tests on the production path.
- Keep the probe's numbers (proposal.md) on a bench that lives in the repo.

**Non-Goals:**

- Virtualizing the in-flight `SkeletonGrid` — it draws a fixed, small number of placeholders.
- Browser find-in-page over unmounted tiles (proposal.md, known limit).
- Announcing the listing's full length to assistive technology (`aria-rowcount` and the like);
  the grid carries no grid role today and gains none here.
- Changing how tiles look, their sizes, or the responsive column rule.

## Decisions

### D1. Rows over the existing scroller, with `@tanstack/react-virtual`

The listing is chunked into rows of `cols` entries; `useVirtualizer` virtualizes the rows
against `scrollRoot` with `scrollMargin` set to the grid's offset inside the scroller, so the
header and results line above the grid stay ordinary content. Each mounted row is its own
one-row CSS grid carrying the same column rule as today (`ROW_CLASS`, `GRID_CLASS` less its
vertical padding, with the row gap as bottom padding), positioned by `translateY` inside a body
whose height is `getTotalSize()`.

Alternatives: TanStack's `lanes` (one lane per column) positions items itself and would need
the gap and the fractional widths the CSS grid computes today re-derived in JS. `react-window`'s
grid wants one fixed cell size (folder and model rows differ) and owns the scroll container,
which `<main>`, the placement code and the header all assume they share. `react-virtuoso`'s grid
expects uniform items. A bespoke virtualizer would own resize, measurement and scroll-correction
bugs TanStack already handles. `content-visibility: auto` was measured and judged weaker on the
phone (proposal.md), and keeps every element in the DOM.

**The first commit mounts rows.** A fresh virtualizer's scroll rect is its `initialRect`, 0×0 by
default, so its first render mounts nothing and the rect arrives only in TanStack's own layout
effect — after App's placement layout effect in the same commit, which would find no tile.
`Grid` therefore passes `initialRect` (the scroller's client size, or the window's while
`scrollRoot.current` is still null on App's first commit; the viewport under the seam) and
`initialOffset: () => scroller.scrollTop`, without which TanStack scrolls a scrolled `<main>` back
to 0 when a grid mounts into it. (Stage A check-in, 2026-09-25.)

### D2. The column count comes from the CSS, through a measuring row

An empty, zero-height element carries `ROW_CLASS[size]`; its computed `grid-template-columns`
has one track per column the `auto-fill` rule yields, observed with a `ResizeObserver`. The
responsive rule stays in one place (the class strings), and the count is exactly what a row
will display. `columnCount` (tile rects) is deleted.

In production the count is read in the measuring row's layout effect, so a freshly mounted grid's
first commit is chunked at one column and corrected before paint. Anything that places or focuses
in that same commit would read the wrong rows, so `Grid` exposes `colsReady` (true from the first
render under the seam, after the first read in production) and the handle (D6) defers `place` and
`focusEntry` until it is true. No module-level seed of the last count is kept: it would still be
wrong on the first mount and would hide the dependency. (Stage A check-in, 2026-09-25.)

Alternative: arithmetic from the scroller's width, the rem minimums and the gap — a second copy
of the CSS rule that drifts the day either changes.

### D3. What is mounted: the range, the first row, the last-focused row, and a pinned row

The mounted rows are TanStack's range with a small overscan (in rows; the probe's 3), extended
by a `rangeExtractor` with:

- **the first row**, always — so the keyboard entering the grid from the header with Tab lands
  on the first tile, as it does today, and the first-tile focus rules find a real element;
- **the row of the tile that last held focus** — `Grid` records a tile's path on `focusin` (as
  state, since TanStack memoises its indexes on the extractor's identity, which is a callback
  over the focused and pinned rows) and
  keeps it until another tile takes focus or the entry leaves `entries`, *not* only while focus
  is inside the grid. A focused tile is then never unmounted by scrolling away (the
  requirement's *Focus is not lost by scrolling away*), and every control that hands focus back
  to the element it came from finds that same, still-connected element: `PathBar`'s Escape
  (`cameFrom`, `back.isConnected`), `EntryMenu`'s close, the find bar;
- **a pinned row** — set by the handle (D6) for the one action it is completing, cleared once
  that action has run. It holds an *entry* index, not a row index, so a re-chunk cannot point it
  at the wrong row.

Rows render in index order, so DOM order is a *subsequence* of listing order: with the
last-focused row far from the view, the tiles between it and the mounted range are not in the
document, and native Tab would jump over them. Tab is therefore handled by the grid (D7), not
left to DOM order. `measureIn`'s walk is unaffected: it stops at the first tile crossing the
scrollport's top edge, which is in a visible row, and a far row before it lies wholly above that
edge. Two known limits are recorded rather than handled:

- Shift+Tab into the grid from a control after it lands on the last mounted tile rather than
  the listing's last tile. The side panel, when open, is the only thing after the grid in tab
  order; Shift+Tab out of it into the grid is accepted as landing there.
- The last-focused tile's *element* does not survive a column change: tiles are keyed by path
  within a row and rows by index, so a re-chunk moves the entry under a different row element
  and React remounts it. A control holding the old element — `PathBar`'s `cameFrom`, if the
  window is resized while the path is being edited — then finds it disconnected and falls back
  as it does today for a vanished element (Escape blurs). Resizing while typing in the path bar
  is the only way to reach it.

### D4. Bands and peeks are arithmetic over the row layout

The two `IntersectionObserver`s, `bandStateRef` and the "heard by both observers" guard are
removed. After every commit of `Grid` (which TanStack causes on a range change, a row measurement
or `measure()`, and props cause on a listing, previews or thumbnail change) and on the D11 scroll
frame callback (at most one `requestAnimationFrame` per frame, coalesced, and on window resize),
`Grid` computes from the
virtualizer's row offsets (`measurementsCache`, measured where drawn, estimated otherwise), the
scroll offset and the viewport height:

- the **visible** row range — rows meeting the viewport;
- the **near** row range — rows meeting the viewport grown by `NEAR_SCREENS` (2) viewport
  heights on each side, replacing `FAR_ROOT_MARGIN`'s string with the same extent.

A pure function, `bandsForRows`, maps those ranges and the rows to `Map<path, Band>` — every
entry gets a band, preview cells one step farther through the existing `CELL_BAND` and nearest
wins through `NEARNESS`, exactly as `publish` does now — and it is published only when either
range changed or the listing or previews did; each of those calls is O(log rows) plus a compare,
and O(entries) work happens only on a publish, whose App re-render finds the ranges unchanged and
publishes nothing further. `onPeek` is derived from the published map: every folder whose band is
visible or near and was not in the previous published map (dropped with the listing, so a new
listing re-peeks everything in range) — the same moment as "its row entered the near range", and
it lets a mutation of `bandsForRows` reach the peek cells. App's existing guard drops repeats.
Since positions are known rather than awaited, a grid publishes at mount. (Stage B check-in,
2026-09-25.) App's `reportBands` is unchanged:
it still adds `far` for filtered-away entries and never overwrites a reported band.

Why not keep the observers: an unmounted tile cannot be observed, so every entry outside the
mounted rows would be unreported — which the thumbnail spec ranks *ahead* of far work — unless
the mounted range were grown to the whole near band (five screens mounted, and observer churn
on every range change). The layout is known to the grid anyway.

### D5. The off-screen marker moves to rows

Each mounted row gets `data-offscreen` when it lies outside the visible range from D4. The
stylesheet's `[data-offscreen] *` pause rule is unchanged; it now covers overscan and pinned
rows. The per-tile toggle in the observer effect goes with the observers, and so does the prose
that describes them: the rule's comment in `index.css` ("`Grid`'s view observer sets the
marker") and `Grid`'s `Props` docs for `scrollRoot`, `onPeek` and `onBands`.

### D6. A grid handle replaces DOM lookups outside the grid

`Grid` takes a `handle` ref (React 19 ref-as-prop; `Grid` stays `memo`) exposing:

- `place(resolved: Resolved): void` — `top` writes `scrollTop = 0`. For `anchor` and `center`
  the entry's row is pinned and brought near the view by a **raw `scrollTop` write** to the
  row's (possibly estimated) offset, as `applyIn` itself writes it; then, in the layout effect
  after that row mounts, the existing `applyIn` runs against the real tile rect, so the landing
  is exact whatever the estimates above it were. TanStack's `scrollToIndex` and `scrollToOffset`
  are not used here: both schedule a reconcile that re-aligns to *their* target for up to five
  seconds whenever a row's start moves (`reconcileScroll`, `MAX_RECONCILE_MS`), which the first
  measurement of an overscan row above the anchor causes, and would discard the offset `applyIn`
  just landed. A first-measure adjustment made against TanStack's own stale offset is corrected
  by `applyIn`, provided the rows around the anchor have been measured before it runs — which in
  a browser is *not* the commit that mounts them: that commit comes from the `scroll` event with
  TanStack's `isScrolling` set, its ref-time measurement is skipped, and the rows are measured by
  the `ResizeObserver` after the commit. The landing therefore waits for them (below).
- `focusEntry(target: string | number, options?: FocusOptions): boolean` — the entry (by path
  or by index into the shown entries) is pinned, and in the layout effect after its row mounts
  `focus(options)` runs on its tile. Native focus scrolling is kept or suppressed exactly as
  the caller's options say, so each call site keeps today's scrolling. Returns false when the
  entry is not shown, so callers keep their fallbacks.

Where no grid is mounted — the error notice, the library messages, the skeleton —
`handle.current` is null and the call sites fall through exactly as `applyIn` returning false and
an absent tile do today. A grid showing its own empty state is mounted and keeps its handle:
`place(top)` zeroes the scroll and `focusEntry` answers false.

**How a landing runs** (stage C check-in, 2026-09-25). The handle keeps two pending slots,
`placing` and `focusing` — the ↑ landing places the parent's anchor and focuses the child folder in
the same landing, and the two may lie in different far rows — each tagged with the entries it was
raised against and dropped when they change; the range extractor keeps both rows mounted. `place`
does no DOM work itself: App places in exactly the commit where a fresh grid may still be chunked
at one column (D2), so everything waits for `colsReady`. A layout effect after every commit then
converges: while TanStack's offset has not caught up with `scrollTop` it waits; while the target
row is not visible it writes `scrollTop` raw to the row's current start (the first pass is the
phase 1 above); while a measurement has moved the row since this commit drew it, it waits again;
and while any row in the visible range is still unmeasured, or a D10 `measure()` is pending, it
waits too; then `applyIn` lands it. (Implementation review, pass 1, 2026-09-25: without that wait
a far anchor below rows of a composition not yet measured drifts after landing.) Measuring the
rows around a write, and D10's `measure()` on a
composition's first height, can both move a far row after a one-shot `applyIn`, which is why the
landing converges rather than applying once. It is bounded: at most four passes, re-checked every
animation frame while pending (not only on `scroll`, which a write equal to the current offset
never fires), and after a fixed number of frames `applyIn` runs and the slot clears, so a missed
event cannot leave a grid unlanded or a row pinned. `focusEntry` focuses synchronously when the
columns are known and the tile is mounted — every case that is mounted today keeps today's
timing — and otherwise defers through `focusing`. With no grid mounted, App still writes
`scrollTop = 0` for a `top` landing, as `applyIn` did on the empty notice.

`measureIn` stays a DOM walk (D3).

Call sites move as follows. Each keeps its existing deferral: the weak set's "Show all" still
focuses inside `requestAnimationFrame`, because index `WEAK_SHOWN` is not in `entries` until the
re-render that `setAllGuessesFor` causes, and `closeFind` still defers past the find input's
unmount.

| today | becomes |
|---|---|
| App's placement layout effect: `applyIn(main, resolved)` | `grid.place(resolved)` |
| arrival effect: `findTile(child) ?? tilesIn[0]` with `preventScroll` | `focusEntry(child, {preventScroll})`, else `focusEntry(0, {preventScroll})` |
| `focusFirstTile` | `focusEntry(0)` |
| `closeFind`: `findTile(back)` else first | `focusEntry(back)` else `focusEntry(0)` |
| weak set "Show all": `tilesIn[WEAK_SHOWN]` | `focusEntry(WEAK_SHOWN)` |
| `Grid`'s document arrow listener: `tilesIn[0].focus()` | `focusEntry(0)` |
| `closeViewer`: `originEl?.focus()` | `focusEntry(viewer.entry.path)` when the view returns focus (D8) |

`PathBar`'s Escape and `EntryMenu`'s close need no change: they hold the element, and D3 keeps
it connected.

### D7. Arrow keys and Tab are index arithmetic

`onKeyDown` finds the focused tile's index in `entries` (by its `data-entry-tile` path) and:

- for the arrows, applies today's rules with `cols` from D2 — right/left by one, down/up by
  `cols`, the short-final-row landing, the inert edges — and calls `focusEntry(target)`, whose
  native focus scrolls the target into view as `tiles[target].focus()` does today;
- for an unmodified Tab or Shift+Tab, calls `focusEntry(index ± 1)` and prevents the default
  when that neighbour exists, and leaves the key to the browser at the listing's first and last
  tile, so the keyboard leaves the grid at its edges as it does now. This is what keeps Tab in
  listing order when the last-focused row is far from the mounted range (D3).

The `⋯` actions button beside each tile has `tabIndex={-1}` and is outside the tab order today,
so stepping tile to tile is exactly the sequence native Tab produced.

### D8. The lightbox returns focus by entry, not by element

`closeViewer` focuses the tile of `viewer.entry` through the handle. Today that happens exactly
when `originEl` is non-null at close: a view opened from a tile, or any view after a step whose
tile was in the grid (all of them were). The viewer state therefore carries
`returnsFocus: boolean` in place of `originEl` — true when opened from a tile, false for a view
restored from the URL, and set by `navigateSibling` when the stepped-to entry is shown; a
deep-linked view that was never stepped still returns focus to nothing. `originEl` is removed: the
open rect is taken from the pressed element passed to `onModelPointerDown`/`openLightbox`, and
nothing else read the field. (Stage C check-in, 2026-09-25.)

### D9. A column change keeps the top entry

`Grid` keeps, per scroll frame, the index of the first entry in the first visible row and that
row's offset from the scrollport top. When `cols` changes — a resize or a tile-size change — the
rows are re-chunked, `virtualizer.measure()` clears TanStack's size cache (keyed by row index,
so every index would otherwise keep the height of the row that held it before the re-chunk),
and, in the same layout pass, the entry is placed at that offset through the handle's own landing
(D6) — whose first pass is the raw `scrollTop` write, and whose convergence makes it exact where
the compositions reset on a column change and the estimates fall back to the per-size constant.
A place App raises in the same commit wins, since App's layout effect runs after the grid's. Tile size is
App state passed to `Grid` as `size`, so both causes arrive through the same `cols` change.

### D10. Estimated heights by row composition

`estimateSize(i)` returns the last measured height of a row of the same composition — all
folders, all models, or mixed — else of any row, else a per-size constant. TanStack re-asks
`estimateSize` only for the rows *after* one whose size changed, so rows above a composition's
first measurement would keep the old estimate; the first time a composition is measured `Grid`
calls `virtualizer.measure()` to re-estimate every row not yet drawn (at most three times per listing). The composition is model against non-model — a zip's
tile has a folder's shape — and the record resets when the entries, `cols` or `size` change.
`measure()` runs from a layout effect after the commit that first measured a composition, never
re-entrantly inside TanStack's `resizeItem`. `measure()` clears every measured height, the mounted
rows' included, and a mounted row is not re-measured until it resizes or remounts; so after a
`measure()` every row stands at its composition's height. That is exact in practice — `Grid`
records each composition's height itself, and tile names truncate to one line, so rows of one
composition are uniform — and a row that did deviate would sit at the estimate until it
remounted. In plain and flat listings the kinds are contiguous
(folders before models), so from then on the unmeasured rows' estimates are exact; a search that
interleaves them mixes compositions, where a row of one kind is off by one label line. Either
way, TanStack's correction when an item above the viewport changes size
(`shouldAdjustScrollPositionOnItemSizeChange`, left at its default) rarely has anything to
correct. This matters most on iOS, where a programmatic `scrollTop` write during momentum can
cut the fling short.

### D11. The scroll margin is re-read, not assumed

The grid's offset inside the scroller changes whenever content above it does (the results line,
a weak-set notice, a header message). `Grid` is memoized and does not re-render for those, so it
re-reads its body's position relative to the scroller in the same frame callback as D4 and on
resize, and updates `scrollMargin` when it moved. Rows are drawn relative to the body, so a stale
margin could only mis-state ranges and scroll targets, never draw a row in the wrong place.

### D12. A remounted tile's image is not re-spun

`ThumbView` starts with `everLoaded` false and shows its spinner over an `opacity-0` image until
`onLoad`. A tile remounted on scroll-back has its image in the memory cache, but would flash the
spinner for a frame. `ThumbView` checks `img.complete && img.naturalWidth > 0` in a layout effect
on mount and counts that as loaded. That a `loading="lazy"` image already in the memory cache
reports `complete` at mount is expected from the HTML "list of available images" step preceding
lazy-load deferral, but is not verified here; the browser check (tasks.md 6.3) confirms it, and
without it the fix is harmless — the spinner shows until `onLoad`, as now.

### D13. Tests run the virtual path with fixed geometry

happy-dom lays nothing out and applies no Tailwind CSS, so `Grid` takes its geometry through a
test-only setter, `setGridGeometryForTests({ viewport, rowHeight, cols, gridTop })`, which is the
one source of numbers for everything that measures:

- TanStack's `observeElementRect`, `observeElementOffset` and `measureElement` options answer
  the viewport, the scroll offset and `rowHeight`;
- the column count stands in for D2's computed track list, which is `""` under happy-dom;
- a `HTMLElement.prototype.getBoundingClientRect` stub, installed by the setter and removed by
  its reset, answers the scroller (the viewport), the grid's body (`gridTop`, settable, less the
  scroll offset), rows, and tiles — a tile by its **listing** index (its `data-entry-tile` path's
  position in the shown entries) and `cols`/`rowHeight`, never by its position among the tiles
  in the document, which is a subsequence of the listing once rows are unmounted. So D11's
  margin read, `applyIn`'s landing and `measureIn`'s walk read numbers that agree with what
  TanStack was told. `retracePlacement.test.tsx`'s own `installGeometry` stub, which indexes
  tiles by DOM position, is replaced by the seam;
- the scroller's `clientHeight` is the viewport height, since `applyIn`'s `center` case reads it
  rather than a rect;
- by default the seam's `observeElementOffset` always reports `isScrolling: false`, and an opt-in
  `scrollTiming: "production"` instead reports scrolling on each `scroll` and stops a frame after
  the last, with a fake `ResizeObserver` delivering row measurements a frame after the commit, as
  a browser does — the landing's wait for measured rows is only falsifiable under it. The default: TanStack skips
  measuring a row while scrolling, and happy-dom's `ResizeObserver` never fires, so a row mounted
  during a test's scroll would never be measured; it also keeps TanStack's debounce timers from
  firing outside `act`;
- optional per-composition `rowHeights`, answered by the seam's `measureElement`, let a cell tell
  compositions apart (D10); the rect stub then places each mounted row at its own `translateY` and
  sizes it by its composition's height, as a browser lays it out — identical to a uniform stub
  when `rowHeights` is unset — so an estimate error is real under the seam and is corrected as
  rows are measured, rather than TanStack and the DOM disagreeing for good;
- happy-dom's `scrollTop` setter fires no `scroll` event, so the seam wraps the scroller's
  `scrollTop` setter to dispatch one, as the browser does; its `observeElementOffset` reads
  `scrollTop` on that event as TanStack's default does. The grid's own raw writes (`place`,
  D9's re-anchor) then reach TanStack with no test-only branch in production code.

The seam is split so that no DOM patching ships in the production bundle: a module under
`client/src/` holds the numbers (`setGridGeometryForTests`, read by `Grid` for TanStack's options
and `cols`, null in production), and a test helper under `client/test/` installs them together
with the rect stub and the `scrollTop` wrapper, and removes all three on reset. A vitest setup
file installs a tall default geometry before every happy-dom cell, so a cell that mounts the grid
outside the app harness never meets a 0×0 scroller; cells that need a short viewport install
their own.

There is no switch that turns virtualization off: every cell runs the production path.

- The seam lands **before** the virtual grid (tasks.md 2.1): without it TanStack sees a 0×0
  scroller and `cols` of 1, and every app-mount cell that counts `tiles()` goes red.
- The app harness's default geometry is a viewport tall enough to hold every row of its
  listings, with a fixed column count, so existing app-mount cells keep finding every tile.
- `folderSheets.test.tsx`'s band and peek cells set a short viewport and scroll it, through
  helpers that replace `report`/`intersect` (a tile is put on screen, near, or far by scrolling
  its row there). The cells about one observer having reported and the other not (`reportHalf`)
  test a race that no longer exists and are deleted with that reason in the commit. Falsified by
  making `bandsForRows` answer `visible` for every entry: the cells asserting that off-screen
  work is deferred, ranked behind visible work, or not yet peeked must fail; cells asserting
  that visible work is done are expected to stay green, and the commit names which is which.
- `bandsForRows` is unit-tested directly over row offsets, including an unmounted near folder
  (peeked) and an unmounted far model (far, not absent).
- `gridArrowNav.test.tsx` drops its rect stubs and sets `cols` through the seam.
- Placement, focus retention, lightbox close and resize cells get listings longer than the
  viewport, so their anchors start unmounted. Tab cells assert the grid's own Tab handling (D7):
  happy-dom has no sequential focus navigation, so a cell dispatches Tab on the focused tile and
  asserts which tile has focus — after scrolling the geometry away first, which fails when D7's
  Tab handling is removed.
- Behaviour the fixed geometry cannot show — real layout, native focus scrolling, native Tab
  into and out of the grid, momentum — is checked in a real browser on the production build
  (tasks.md 6.3).

### D14. The bench lives in the repo

`scripts/scroll-bench.mjs` (found Playwright, like `scripts/playwright-found.mjs`'s other users;
headless) opens a URL at 390×844 with touch, a 4× CPU throttle and `Emulation.
setTouchEmulationEnabled`, swipes by CDP touch events in the scroller's padding, and prints frame
p50/p95, frames over 33 ms and over 100 ms, main-thread task time, the distance scrolled, and the
tiles in the document. Run against `bun run preview:remote-demo` (or any production build).

Measured 2026-09-25 at 5d43a35 on the demo corpus (library `70b60f0d`, 454 folders, flat view 954
entries; baked thumbnails, index attached), headless phone emulation, 4× throttle. The probe
rows are the same profiler, same corpus, run earlier the same day:

| view | build | frames over 33 ms | p95 | main-thread | scrolled | tiles in document |
|---|---|---|---|---|---|---|
| flat | before (all tiles mounted) | 84 of 712 | 50 ms | 6.6 s | 4,806 px | 954 |
| flat | probe | 13 of 730 | 16.8 ms | 2.4 s | 7,372 px | 12–20 |
| flat | this change | 15 of 728 | 16.8 ms | 2.5 s | 8,594 px | 22 |
| folders | before | 57 of 725 | 33 ms | 4.4 s | 4,685 px | 454 |
| folders | probe | 43 of 712 | 33 ms | 4.7 s | 9,757 px | — |
| folders | this change | 34 of 725 | 16.8 ms | 3.8 s | 9,240 px | 22 |

`scripts/scroll-bench.mjs` on the same build, two runs each: flat 9–16 frames over 33 ms of 467,
main 1.9–3.0 s; folders 23–25 of 467–477, main 2.9–3.1 s; 22 tiles either way. Before the change
the same script read flat 88–95 over 33 ms, main 5.9 s, 954 tiles (tasks.md 5.1).

## Risks / Trade-offs

- **Estimated rows move under a fling on iOS** → D10 keeps estimates exact after one row of each
  kind; the bench and a phone check on a long flat view are part of verification.
- **happy-dom geometry diverges from real layout** → the geometry seam is only a source of
  numbers; D4's arithmetic is unit-tested, and placement, focus scrolling and Tab are verified in
  a real browser.
- **A far focused or pinned row is drawn at an estimated position** → it is off screen by
  definition; when scrolled to, it is measured and corrected like any row.
- **Browser find-in-page misses unmounted names** → accepted (proposal.md); Narrow covers the
  listing.
- **`hover-prefetch-listings` edits the same file** → no shared requirement; whichever lands
  second rebases `Grid.tsx`.
- **A new dependency** → headless, MIT, one package plus its core, no transitive runtime
  dependencies; it replaces code, the two observers, rather than adding a subsystem.

## Migration Plan

Client-only; nothing persisted changes shape. Deploy as any client change (`deploy/demo`
README's redeploy). Rollback is reverting the change's commits; no data to migrate either way.

## Open Questions

- The overscan in rows (3 in the probe) and `NEAR_SCREENS` stay as they are unless the bench says
  otherwise; tuning either changes no spec, approach or task.
