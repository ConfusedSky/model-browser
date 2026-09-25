import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import {
  defaultRangeExtractor,
  measureElement as measureRowElement,
  useVirtualizer,
  type Range,
  type Rect,
} from "@tanstack/react-virtual";
import { baseName } from "../../../shared/names";
import Icon from "./Icon";
import type { DirEntry, IndexScore } from "../../../shared/types";
import type { ThumbState } from "../hooks/useThumbnails";
import { formatCosine, formatZ } from "../lib/format";
import {
  bandsForRows,
  layoutRanges,
  sameRange,
  type RowRange,
} from "../lib/gridBands";
import { nativeMenuRequested } from "../lib/gesture";
import {
  gridGeometryForTests,
  observeSeamOffset,
  observeSeamRect,
  seamRowHeight,
  type RowComposition,
} from "../lib/gridGeometry";
import { applyIn, findTile, type Resolved } from "../lib/placement";
import {
  SCALE_BADGE,
  SCALE_SPOKEN,
  Z_LABEL,
  strengthOf,
  type ScoreScale,
} from "../lib/scoreScale";
import type { Band } from "../three/queue";

export type TileSize = "s" | "m" | "l";
/** Whole literals, one per size, so each reaches the stylesheet. */
const GRID_CLASS: Record<TileSize, string> = {
  s: "grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 px-3 pt-1 pb-6 sm:px-4",
  m: "grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 px-3 pt-1 pb-6 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:px-4",
  l: "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 px-3 pt-1 pb-6 sm:px-4",
};

const ARROWS = new Set(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]);

/** One mounted row: `GRID_CLASS` less its vertical padding, with the row gap
 *  as bottom padding, so a stack of one-row grids spaces like one grid. Whole
 *  literals, one per size, so each reaches the stylesheet. */
const ROW_CLASS: Record<TileSize, string> = {
  s: "grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 px-3 pb-2 sm:px-4",
  m: "grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 px-3 pb-3 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:px-4",
  l: "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 px-3 pb-4 sm:px-4",
};

/** A row's height before any row of this listing has been measured (D10). */
const ROW_ESTIMATE: Record<TileSize, number> = { s: 170, m: 220, l: 300 };

const OVERSCAN_ROWS = 3;

/** What App reaches the grid's tiles through, mounted or not (D6). */
export interface GridHandle {
  /** Land the grid as `applyIn` would, bringing the entry's row in first. */
  place(resolved: Resolved): void;
  /** Focus the entry's tile, by path or by index into the shown entries. False
   *  when the entry is not shown. */
  focusEntry(target: string | number, options?: FocusOptions): boolean;
}

/** A placement waiting for its row to be drawn where TanStack says it lies. */
interface Placing {
  resolved: Exclude<Resolved, { kind: "top" }>;
  tries: number;
  /** A column change's landing (D9): the share of the anchor's row scrolled
   *  past, which stands in for `offset` against the row's height at landing. */
  fraction?: number;
}
interface Focusing {
  path: string;
  options: FocusOptions | undefined;
}
/** Raw writes a placement may make toward its row before `applyIn` lands it:
 *  each can draw a composition for the first time and re-estimate the rows. */
export const MAX_PLACE_TRIES = 4;
/** Frames a placement may wait for TanStack to hear a scroll, so a missed
 *  event cannot leave the grid unlanded and the row pinned. */
export const MAX_PLACE_FRAMES = 10;

/** The columns a grid displays, from its computed `grid-template-columns`:
 *  one resolved size per track, line names aside (D2). `""` (no layout) and
 *  `none` count as one column. */
export function trackCount(template: string): number {
  const tracks = template.replace(/\[[^\]]*\]/g, " ").trim();
  if (tracks === "" || tracks === "none") return 1;
  return tracks.split(/\s+/).length;
}

/** Zips count with folders: both draw the non-model tile, one shape. */
function compositionOf(row: readonly DirEntry[]): RowComposition {
  const models = row.filter((e) => e.kind === "model").length;
  return models === 0 ? "dirs" : models === row.length ? "models" : "mixed";
}

/** The heights D10 estimates from, kept per listing, column count and size:
 *  a change of any of them can change what a composition measures. */
interface Compositions {
  entries: DirEntry[];
  cols: number;
  size: TileSize;
  heights: Map<RowComposition, number>;
  last: number | undefined;
  remeasure: boolean;
}

interface Props {
  entries: DirEntry[];
  thumbs: Map<string, ThumbState>;
  onEnter: (entry: DirEntry) => void;
  onModelPointerDown: (
    e: React.PointerEvent,
    entry: DirEntry,
    el: HTMLElement,
  ) => void;
  /** Keyboard activation (Enter/Space) — opens the lightbox directly. */
  onModelOpen: (entry: DirEntry, el: HTMLElement) => void;
  onModelHover: (path: string | null, mtime?: number) => void;
  /** A secondary press, or the platform's context-menu key. */
  onEntryMenu: (
    entry: DirEntry,
    el: HTMLElement,
    at: { x: number; y: number },
  ) => void;
  onImageError: (path: string) => void;
  /** Marked until the highlight fades. Never a view field (D8). */
  markedPath: string | null;
  /** Which rendered tile is the similarity subject; App prepends it. */
  anchorPath?: string;
  /** A guarded lookup rather than the raw map, so this component cannot draw a
   *  badge the anchor rule forbids. Returns the map's own object, which the
   *  memo compares by identity. */
  scoreFor: (path: string) => IndexScore | undefined;
  /** `null` where the view is not a scored one, and no tile draws a number (D3). */
  scoreScale: ScoreScale | null;
  /** What each folder tile previews (folder-contact-sheets D1). An absent path
   *  draws as an empty answer does — the folder's own icon. The arrays are the
   *  map's own, so `Tile`'s memo compares them by identity. */
  previews: ReadonlyMap<string, DirEntry[]>;
  /** Raised for a folder each time its band becomes visible or near — again
   *  after it scrolled far and back, and for every such folder of a new
   *  listing — so App's guard is the only thing dropping repeats (D1). */
  onPeek: (path: string) => void;
  /** Every entry's band, wholesale, taken from the row layout whether or not
   *  its row is mounted; raised only when the visible or near rows, the
   *  entries, the previews or the column count changed (grid-virtualization
   *  D4). */
  onBands: (bands: ReadonlyMap<string, Band>) => void;
  /** The element that scrolls the grid, which the rows are virtualized
   *  against and the bands measured in. A `RefObject` so it is stable in deps
   *  and populated during commit. */
  scrollRoot: RefObject<HTMLElement | null>;
  /** Filled while this grid is mounted, null otherwise (D6) — its own empty
   *  state ("Nothing here.") included, where `place` of the top writes 0 and
   *  `focusEntry` returns false. */
  handle?: Ref<GridHandle>;
  size?: TileSize;
  /** The raw score pair on each result, rather than the strength alone. */
  showScores?: boolean;
  /** The set's best is middling; strength words stop at "Fair". */
  modestSet?: boolean;
}

function menuAt(
  el: HTMLElement,
  e: { clientX: number; clientY: number },
): { x: number; y: number } {
  // A keyboard-raised menu reports (0, 0) — anchor it to the tile instead, so
  // it appears where the thing it acts on is.
  if (e.clientX !== 0 || e.clientY !== 0) return { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  return { x: r.left + 8, y: r.bottom - 8 };
}

/** Memoized, tiles included: a keystroke in the search box re-renders the app
 *  while nothing here changed, and a grid is hundreds of tiles. App holds the
 *  handlers by identity for exactly that. */
function Grid({
  entries,
  thumbs,
  onEnter,
  onModelPointerDown,
  onModelOpen,
  onModelHover,
  onEntryMenu,
  onImageError,
  markedPath,
  anchorPath,
  scoreFor,
  scoreScale,
  previews,
  onPeek,
  onBands,
  scrollRoot,
  size = "m",
  showScores = false,
  modestSet = false,
  handle,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Read by the listeners below, which must not resubscribe per render. */
  const scrollRootRef = useRef(scrollRoot);
  scrollRootRef.current = scrollRoot;
  const geometry = gridGeometryForTests();

  // The column count is what the measuring row's `auto-fill` rule yields (D2),
  // so the responsive rule lives only in the class strings.
  const [measuredCols, setMeasuredCols] = useState<number | null>(null);
  const cols = geometry?.cols ?? measuredCols ?? 1;
  /** False until the first read: before it, rows are chunked at one column,
   *  so the handle defers its landings on this. */
  const colsReady = geometry !== null || measuredCols !== null;
  const empty = entries.length === 0;
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (geometry !== null || el === null) return;
    const read = (): void =>
      setMeasuredCols(trackCount(getComputedStyle(el).gridTemplateColumns));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [geometry, size, empty]);

  const rows = useMemo(() => {
    const out: DirEntry[][] = [];
    for (let i = 0; i < entries.length; i += cols)
      out.push(entries.slice(i, i + cols));
    return out;
  }, [entries, cols]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const indexOf = useMemo(
    () => new Map(entries.map((e, i) => [e.path, i])),
    [entries],
  );
  /** Read by the handle, whose functions keep one identity. */
  const indexOfRef = useRef(indexOf);
  indexOfRef.current = indexOf;
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const colsReadyRef = useRef(colsReady);
  colsReadyRef.current = colsReady;

  /** The tile that last held focus stays mounted wherever the view goes (D3),
   *  so a control handing focus back finds the element it came from. Kept past
   *  a blur; replaced only by another tile's focus. */
  const [lastFocused, setLastFocused] = useState<string | null>(null);
  const focusedIndex =
    lastFocused === null ? undefined : indexOf.get(lastFocused);
  // The entry left the listing: forgotten, so its return is not kept either.
  if (lastFocused !== null && focusedIndex === undefined) setLastFocused(null);
  /** The handle's two actions, each keeping its entry's row mounted until it
   *  has run (D3): ↑ places the parent's anchor and focuses the child folder
   *  in one landing, often rows apart. */
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [focusing, setFocusing] = useState<Focusing | null>(null);
  // Dropped only when the entry is gone. A new array of the same entries is a
  // follow-up answering the same landing; any other landing raises its own.
  if (placing !== null && !indexOf.has(placing.resolved.path)) setPlacing(null);
  if (focusing !== null && !indexOf.has(focusing.path)) setFocusing(null);
  const rowOf = (path: string | undefined): number | null => {
    const i = path === undefined ? undefined : indexOf.get(path);
    return i === undefined ? null : Math.floor(i / cols);
  };
  const focusedRow =
    focusedIndex === undefined ? null : Math.floor(focusedIndex / cols);
  const placingRow = rowOf(placing?.resolved.path);
  const focusingRow = rowOf(focusing?.path);
  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      const keep = new Set(defaultRangeExtractor(range));
      // The first row, so Tab into the grid from above lands on the first tile.
      keep.add(0);
      for (const row of [focusedRow, placingRow, focusingRow])
        if (row !== null) keep.add(row);
      return [...keep].sort((a, b) => a - b);
    },
    [focusedRow, placingRow, focusingRow],
  );

  // D10: a row is estimated at the height last measured for its composition.
  const compositionsRef = useRef<Compositions | null>(null);
  /** Row elements measured at least once. A row a scroll draws is measured
   *  only by TanStack's `ResizeObserver`, after the commit that drew it. A row
   *  kept mounted through a re-chunk counts as measured before its re-measure. */
  const measuredRowsRef = useRef(new WeakSet<Element>());
  let compositions = compositionsRef.current;
  if (
    compositions === null ||
    compositions.entries !== entries ||
    compositions.cols !== cols ||
    compositions.size !== size
  ) {
    compositions = {
      entries,
      cols,
      size,
      heights: new Map(),
      last: undefined,
      remeasure: false,
    };
    compositionsRef.current = compositions;
  }
  const fallbackHeight = geometry?.rowHeight ?? ROW_ESTIMATE[size];
  const estimateSize = (i: number): number => {
    const c = compositionsRef.current;
    const row = rowsRef.current[i];
    return (
      (row === undefined ? undefined : c?.heights.get(compositionOf(row))) ??
      c?.last ??
      fallbackHeight
    );
  };

  // D11: rows are drawn relative to the body, and TanStack is told where the
  // body sits in the scroller.
  const [scrollMargin, setScrollMargin] = useState(0);
  const marginRef = useRef(0);
  /** True when the margin moved, so a re-render is on its way. */
  const readMargin = useCallback((): boolean => {
    const body = bodyRef.current;
    const scroller = scrollRootRef.current.current;
    if (body === null || scroller === null) return false;
    const margin =
      body.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    if (margin === marginRef.current) return false;
    marginRef.current = margin;
    setScrollMargin(margin);
    return true;
  }, []);
  useLayoutEffect(() => {
    readMargin();
  }, [readMargin, entries, size, cols]);

  /** Read once, at the first render: without it TanStack's first render sees
   *  a 0×0 scroller and mounts nothing, and a consumer in the same commit (the
   *  placement) finds no tile. The scroller's ref is attached in the commit
   *  that mounts both, hence the window's size as the fallback. */
  const initialRectRef = useRef<Rect | null>(null);
  if (initialRectRef.current === null) {
    const scroller = scrollRoot.current;
    initialRectRef.current =
      geometry !== null
        ? { width: scroller?.clientWidth ?? 0, height: geometry.viewport }
        : scroller !== null
          ? { width: scroller.clientWidth, height: scroller.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight };
  }
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRootRef.current.current,
    estimateSize,
    overscan: OVERSCAN_ROWS,
    scrollMargin,
    rangeExtractor,
    initialRect: initialRectRef.current,
    // Otherwise TanStack scrolls a scrolled scroller back to 0 when it
    // subscribes, which a retrace landing on a fresh grid would lose.
    initialOffset: () => scrollRootRef.current.current?.scrollTop ?? 0,
    measureElement: (el, entry, instance) => {
      const row = rowsRef.current[instance.indexFromElement(el)];
      const composition = row === undefined ? undefined : compositionOf(row);
      const height =
        geometry !== null
          ? seamRowHeight(geometry, composition)
          : measureRowElement(el, entry, instance);
      measuredRowsRef.current.add(el);
      const c = compositionsRef.current;
      if (c !== null && composition !== undefined) {
        if (!c.heights.has(composition)) c.remeasure = true;
        c.heights.set(composition, height);
        c.last = height;
      }
      return height;
    },
    ...(geometry !== null
      ? {
          observeElementRect: observeSeamRect(geometry),
          observeElementOffset: observeSeamOffset(geometry),
        }
      : {}),
  });
  // A reset of the record empties it, and the rows already drawn are not
  // measured again on their own: their ref is stable, and the observer does not
  // fire for a row whose size did not change. Measured here, before D10's
  // `measure()`, so the rows not drawn are estimated from them, not the fallback.
  const remeasuredRef = useRef<Compositions | null>(null);
  useLayoutEffect(() => {
    const c = compositionsRef.current;
    if (c === remeasuredRef.current) return;
    remeasuredRef.current = c;
    for (const el of virtualizer.elementsCache.values()) {
      if (!el.isConnected) continue;
      virtualizer.resizeItem(
        virtualizer.indexFromElement(el),
        virtualizer.options.measureElement(el, undefined, virtualizer),
      );
    }
  });
  // A measurement re-estimates only the rows after the one measured, so a
  // composition's first height re-estimates every row not drawn yet, those
  // above the view included. Deferred to after the
  // commit: `measure()` inside the measuring callback would clear the cache
  // under `resizeItem`, which then writes this row's size back over it.
  useLayoutEffect(() => {
    const c = compositionsRef.current;
    if (c === null || !c.remeasure) return;
    c.remeasure = false;
    virtualizer.measure();
  });
  const virtualRows = virtualizer.getVirtualItems();

  /** The rows on screen and near it, from TanStack's measurements (starts
   *  carry the scroll margin) — O(log rows). `calculateRange` first, which
   *  refreshes the memoised measurements, size and offset these read. */
  const readRanges = useCallback((): {
    visible: RowRange | null;
    near: RowRange | null;
  } => {
    virtualizer.calculateRange();
    return layoutRanges(
      virtualizer.measurementsCache,
      virtualizer.scrollOffset ?? 0,
      virtualizer.scrollRect?.height ?? 0,
    );
  }, [virtualizer]);
  /** What this render marks off screen (D5). The same rows as TanStack's own
   *  range whenever the grid meets the viewport, so the renders TanStack does
   *  on a range change keep the marker current. */
  const visibleRows = readRanges().visible;
  const renderedVisibleRef = useRef(visibleRows);
  renderedVisibleRef.current = visibleRows;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  /** Read by `sync`, which runs from a frame callback as well as effects. */
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const onBandsRef = useRef(onBands);
  onBandsRef.current = onBands;
  const onPeekRef = useRef(onPeek);
  onPeekRef.current = onPeek;
  const publishedRef = useRef<{
    entries: DirEntry[];
    rows: DirEntry[][];
    previews: ReadonlyMap<string, DirEntry[]>;
    visible: RowRange | null;
    near: RowRange | null;
    bands: Map<string, Band>;
  } | null>(null);
  /**
   * Bands and peeks from the layout (D4): published only when the visible or
   * near rows, the listing, its chunking or the previews changed — never for a
   * scroll that stays within the same rows. A publish re-renders App, and so
   * this grid, whose effect calls back in here; nothing compared below has
   * changed by then (a peek landing changes `previews` once, and its publish
   * peeks nothing new), so that second pass returns without publishing.
   */
  const sync = useCallback((): void => {
    const rows = rowsRef.current;
    const entries = entriesRef.current;
    // An empty report would read as "every path is unreported" over work the
    // last one had ranked.
    if (rows.length === 0) {
      publishedRef.current = null;
      return;
    }
    // A margin read but not yet rendered: TanStack still lays the rows out at
    // the old one, and the re-render on its way syncs. Without this the first
    // commit ranks and peeks as though the grid began at the scroller's top.
    if (virtualizer.options.scrollMargin !== marginRef.current) return;
    const { visible, near } = readRanges();
    const previews = previewsRef.current;
    const last = publishedRef.current;
    if (
      last !== null &&
      last.rows === rows &&
      last.previews === previews &&
      sameRange(last.visible, visible) &&
      sameRange(last.near, near)
    )
      return;
    const bands = bandsForRows(rows, visible, near, previews);
    // A new listing starts from nothing, so every folder in range is new.
    const before =
      last !== null && last.entries === entries ? last.bands : null;
    publishedRef.current = { entries, rows, previews, visible, near, bands };
    onBandsRef.current(bands);
    for (const entry of entries) {
      if (entry.kind !== "dir" || bands.get(entry.path) === "far") continue;
      const was = before?.get(entry.path);
      if (was === undefined || was === "far") onPeekRef.current(entry.path);
    }
  }, [readRanges, virtualizer]);
  // After every commit: a range change, a row measurement, and a change of
  // listing, previews or columns all arrive as renders.
  useEffect(sync);

  /** An entry of the top row and the share of that row scrolled past, as of
   *  the last scroll frame (D9). A share, because a column change changes the
   *  row's height and a pixel offset can exceed the new one. The top row is
   *  the first with at least half of itself showing: a sliver above it is not
   *  what the user is reading. */
  const topRef = useRef<{
    entries: DirEntry[];
    index: number;
    path: string;
    fraction: number;
  } | null>(null);
  const recordTop = useCallback((): void => {
    virtualizer.calculateRange();
    // TanStack's starts carry the margin it last drew; a margin read this
    // frame is not drawn yet, so the offset is taken back into that frame.
    const at =
      (virtualizer.scrollOffset ?? 0) -
      (marginRef.current - virtualizer.options.scrollMargin);
    const { visible } = layoutRanges(
      virtualizer.measurementsCache,
      at,
      virtualizer.scrollRect?.height ?? 0,
    );
    const cache = virtualizer.measurementsCache;
    let row = visible?.first;
    if (row !== undefined) {
      const first = cache[row]!;
      if (first.end - at < first.size / 2 && cache[row + 1] !== undefined)
        row += 1;
    }
    const item = row === undefined ? undefined : cache[row];
    if (row === undefined || item === undefined) {
      topRef.current = null;
      return;
    }
    const entries = entriesRef.current;
    const cols = colsRef.current;
    // The entry a column change kept stays the one kept while its row is on
    // top; the row's first entry instead would wander with every change.
    const kept =
      topRef.current === null
        ? undefined
        : indexOfRef.current.get(topRef.current.path);
    const index =
      kept !== undefined && Math.floor(kept / cols) === row ? kept : row * cols;
    const entry = entries[index];
    topRef.current =
      entry === undefined
        ? null
        : {
            entries,
            index,
            path: entry.path,
            fraction: Math.max((at - item.start) / item.size, 0),
          };
  }, [virtualizer]);

  /** Every row on screen has been measured. A composition's first height is
   *  not checked here: D10's `measure()` runs in an earlier layout effect of
   *  the same commit, and the rows it moves fail the caller's moved-row test. */
  const settledOn = (visible: RowRange | null): boolean => {
    if (visible === null) return true;
    for (let i = visible.first; i <= visible.last; i++) {
      const el = virtualizer.elementsCache.get(
        virtualizer.options.getItemKey(i),
      );
      if (el === undefined || !measuredRowsRef.current.has(el)) return false;
    }
    return true;
  };

  const placeFramesRef = useRef(0);
  const place = useCallback((resolved: Resolved): void => {
    if (resolved.kind === "top") {
      setPlacing(null);
      const scroller = scrollRootRef.current.current;
      if (scroller !== null) scroller.scrollTop = 0;
      return;
    }
    // Not shown: as `applyIn` finding no tile, the landing stays fresh.
    if (!indexOfRef.current.has(resolved.path)) {
      setPlacing(null);
      return;
    }
    placeFramesRef.current = 0;
    setPlacing({ resolved, tries: 0 });
  }, []);
  const focusEntry = useCallback(
    (target: string | number, options?: FocusOptions): boolean => {
      const entries = entriesRef.current;
      const index =
        typeof target === "number" ? target : indexOfRef.current.get(target);
      const entry = index === undefined ? undefined : entries[index];
      if (entry === undefined) return false;
      // Before the first column read the rows are about to be re-chunked, which
      // remounts the tile under a new row.
      const grid = gridRef.current;
      const tile =
        colsReadyRef.current && grid !== null
          ? findTile(grid, entry.path)
          : null;
      if (tile !== null) {
        setFocusing(null);
        tile.focus(options);
        return true;
      }
      setFocusing({ path: entry.path, options });
      return true;
    },
    [],
  );
  useImperativeHandle(handle, () => ({ place, focusEntry }), [
    place,
    focusEntry,
  ]);

  // D9: a new column count keeps the entry that was at the top where it was,
  // through the same landing a placement takes. A placement already pending,
  // or App's in this same commit, is the more specific intent.
  const colsSeenRef = useRef(cols);
  useLayoutEffect(() => {
    if (colsSeenRef.current === cols) return;
    colsSeenRef.current = cols;
    // TanStack keys sizes by row index, and every index now holds another row.
    virtualizer.measure();
    const top = topRef.current;
    const entry = top?.entries === entries ? entries[top.index] : undefined;
    if (entry === undefined || placing !== null) return;
    placeFramesRef.current = 0;
    setPlacing({
      resolved: { kind: "anchor", path: entry.path, offset: 0 },
      tries: 0,
      fraction: top!.fraction,
    });
  });

  /**
   * The handle's pending actions, after every commit once the columns are
   * read (D2, D6). A placement is written raw toward its row until the row is
   * drawn on screen where TanStack's settled measurements put it, then landed
   * by `applyIn` against the tile itself. Drawing the rows around a write
   * measures them, and a composition measured for the first time re-estimates
   * every row not yet drawn, so a single write can miss by the estimates'
   * error. Never `scrollToIndex`: its reconcile would re-align to its own
   * target over `applyIn`'s landing.
   */
  useLayoutEffect(() => {
    if (!colsReady) return;
    const grid = gridRef.current;
    if (focusing !== null && grid !== null) {
      const tile = findTile(grid, focusing.path);
      if (tile !== null) {
        tile.focus(focusing.options);
        setFocusing(null);
      }
    }
    if (placing === null) return;
    const scroller = scrollRootRef.current.current;
    const index = indexOf.get(placing.resolved.path);
    if (scroller === null || index === undefined) {
      setPlacing(null);
      return;
    }
    const overdue =
      placing.tries >= MAX_PLACE_TRIES ||
      placeFramesRef.current >= MAX_PLACE_FRAMES;
    const row = Math.floor(index / cols);
    virtualizer.calculateRange();
    const item = virtualizer.measurementsCache[row];
    const resolved =
      placing.fraction === undefined || item === undefined
        ? placing.resolved
        : { ...placing.resolved, offset: -placing.fraction * item.size };
    if (!overdue) {
      // TanStack hears a write on the scroll event; until then it draws the
      // old offset's rows. The frame loop below checks again.
      if (Math.abs((virtualizer.scrollOffset ?? 0) - scroller.scrollTop) >= 1)
        return;
      const drawn = virtualRows.find((r) => r.index === row);
      const onScreen =
        visibleRows !== null &&
        row >= visibleRows.first &&
        row <= visibleRows.last;
      const target =
        item === undefined
          ? undefined
          : resolved.kind === "anchor"
            ? item.start - resolved.offset
            : item.start - (scroller.clientHeight - item.size) / 2;
      // An anchor offset past its row's estimated height lands the row just
      // above the view. Writing the same offset again fires no scroll and
      // measures nothing, so it waits below with a landing already there.
      const reached =
        onScreen ||
        (target !== undefined && Math.abs(scroller.scrollTop - target) < 1);
      if (item !== undefined && (!reached || drawn?.start !== item.start)) {
        if (!reached) scroller.scrollTop = target!;
        setPlacing({ ...placing, tries: placing.tries + 1 });
        return;
      }
      // Rows a scroll drew are measured after this commit, and a first
      // composition among them re-estimates the rows above: landing now
      // would be undone. The frame loop checks again.
      if (!settledOn(visibleRows)) return;
    }
    applyIn(scroller, resolved);
    setPlacing(null);
  });
  // A placement re-checks every frame, not only on the scroll events it
  // waits for, and gives up waiting after `MAX_PLACE_FRAMES`.
  useEffect(() => {
    if (placing === null) return;
    // Named: gridVirtualization.test.tsx counts this loop's frames by the
    // callback's name to prove a landing converged rather than timed out.
    let frame = requestAnimationFrame(function tick() {
      placeFramesRef.current += 1;
      rerender();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [placing]);
  // Content above the grid changes without re-rendering it (a results line, a
  // notice), so the margin is re-read once per scroll frame and on resize,
  // and the bands with it.
  useEffect(() => {
    const scroller = scrollRootRef.current.current;
    if (scroller === null) return;
    let frame = 0;
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const moved = readMargin();
        // Even on a frame whose margin moved: a resize before the next scroll
        // frame re-anchors from this top.
        recordTop();
        // A moved margin re-renders, and that render's effect syncs.
        if (moved) return;
        // Where TanStack's range and the rows meeting the viewport part —
        // the grid wholly outside it — no render of TanStack's would redraw
        // the marker.
        if (!sameRange(readRanges().visible, renderedVisibleRef.current)) {
          rerender();
          return;
        }
        sync();
      });
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [readMargin, readRanges, recordTop, sync]);

  /**
   * With nothing focused, an arrow lands on the first tile instead of doing
   * nothing (link-previews D11). A keydown with focus on `body` never reaches
   * the grid's own handler below, hence the document listener; focus anywhere
   * else — the path bar, the find input, a tile — is left to its own handler.
   */
  useEffect(() => {
    function onDocumentKeyDown(e: KeyboardEvent): void {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!ARROWS.has(e.key)) return;
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      // The lightbox steps models on the same keys from a window listener,
      // whatever holds focus while it is open. The entry menu needs no guard
      // only because it always holds focus itself (`EntryMenu` seeds it).
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      if (!focusEntry(0)) return;
      e.preventDefault();
    }
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [focusEntry]);

  /**
   * Arrow-key focus movement between tiles (grid-arrow-navigation), and Tab,
   * as steps over the shown entries rather than the tiles in the document
   * (D7), which skip every unmounted row. **Container scoping, not a guard, is
   * what isolates the find input and the path bar**: they render outside
   * `gridRef`, so their keydowns never reach here (D3). Alt/Ctrl/Meta keys are
   * left to the browser — Alt+Arrow is Back/Forward.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const { key } = e;
    const tab = key === "Tab";
    if (!tab && !ARROWS.has(key)) return;
    const active = document.activeElement;
    const idx =
      active instanceof HTMLElement && gridRef.current?.contains(active)
        ? indexOf.get(active.dataset.entryTile ?? "")
        : undefined;
    if (idx === undefined) return;
    const last = entries.length - 1;
    let target = idx;
    if (tab) {
      // At the listing's ends Tab leaves the grid, as it always has.
      const next = e.shiftKey ? idx - 1 : idx + 1;
      if (next >= 0 && next <= last) target = next;
    } else if (key === "ArrowRight") target = Math.min(idx + 1, last);
    else if (key === "ArrowLeft") target = Math.max(idx - 1, 0);
    else if (key === "ArrowDown") {
      const down = idx + cols;
      // A straight step, else the last tile when a partial row sits below,
      // else a no-op.
      if (down <= last) target = down;
      else if (Math.floor(idx / cols) < Math.floor(last / cols)) target = last;
    } else {
      // Never a clamp to 0, which slides focus sideways along the top row.
      const up = idx - cols;
      if (up >= 0) target = up;
    }
    // An inert edge arrow is left to the browser, so the page may scroll (D3).
    if (target === idx) return;
    e.preventDefault();
    focusEntry(target);
  };

  // Below the hooks: an early return above them makes the effects
  // conditional.
  if (entries.length === 0) {
    return (
      <div className="mt-20 flex flex-col items-center gap-2 text-center">
        <Icon name="folder" className="size-8 text-ink-3" strokeWidth={1.5} />
        <p className="text-sm text-ink-2">Nothing here.</p>
      </div>
    );
  }
  const renderTile = (entry: DirEntry) => {
    // The map's own array, so the memo sees an unchanged preview list as
    // unchanged. Folders only — a zip is never peeked.
    const preview = entry.kind === "dir" ? previews.get(entry.path) : undefined;
    return (
      <Tile
        key={entry.path}
        entry={entry}
        thumb={thumbs.get(entry.path)}
        preview={preview}
        // A fresh array every render, which is why `tilePropsEqual`
        // compares it elementwise.
        previewThumbs={preview?.map((e) => thumbs.get(e.path))}
        onEnter={onEnter}
        onModelPointerDown={onModelPointerDown}
        onModelOpen={onModelOpen}
        onModelHover={onModelHover}
        onEntryMenu={onEntryMenu}
        onImageError={onImageError}
        // A boolean per tile, not the path, so only the marked tile's props
        // change and the memo holds the rest.
        marked={entry.path === markedPath}
        anchor={entry.path === anchorPath}
        // Only the scale is tested here; the anchor rule and the missing
        // hit live inside `scoreFor`, which returns the landed map's own
        // object so the memo sees an unchanged answer as unchanged.
        score={scoreScale === null ? undefined : scoreFor(entry.path)}
        scale={scoreScale}
        showScores={showScores}
        modest={modestSet}
      />
    );
  };
  return (
    <div
      ref={gridRef}
      className="pt-1 pb-6"
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        const path = (e.target as HTMLElement).dataset.entryTile;
        if (path !== undefined && path !== lastFocused) setLastFocused(path);
      }}
    >
      {/* Never holds a tile: its computed columns are the column count. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className={ROW_CLASS[size]}
        style={{ height: 0, paddingBottom: 0, overflow: "hidden" }}
      />
      <div
        ref={bodyRef}
        data-grid-body
        style={{ position: "relative", height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            // Pauses the placeholder animations of rows not on screen
            // (index.css): overscan rows and kept rows (D5).
            data-offscreen={
              visibleRows !== null &&
              row.index >= visibleRows.first &&
              row.index <= visibleRows.last
                ? undefined
                : ""
            }
            className={ROW_CLASS[size]}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${row.start - scrollMargin}px)`,
            }}
          >
            {rows[row.index]?.map(renderTile)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(Grid);

/** How far a z-score stands out, as a share of the bar: z≈5 is about as far
 *  above the collection as any result gets, and a sliver always shows. */
function relevanceWidth(z: number): number {
  return Math.min(100, Math.max(6, (z / 5) * 100));
}

/**
 * Where a result lives, under its name. A deep search or a flat view carries
 * the path relative to where it ran; without this line two same-named files
 * from different kits look like duplicates.
 */
function ParentLine({ name }: { name: string }) {
  const slash = name.lastIndexOf("/");
  if (slash <= 0) return null;
  const inArchive = name.includes("!/");
  const raw = name.slice(0, slash).split("/");
  // Inside an archive the archive is what tells the copy apart from its
  // extracted twin, so its name is the part kept whole.
  const zipAt = raw.findIndex((p) => p.endsWith("!"));
  const keep = inArchive && zipAt >= 0 ? zipAt : raw.length - 1;
  const clean = raw.map((p) => p.replace(/!$/, ""));
  const last =
    keep === raw.length - 1
      ? clean[keep]!
      : `${clean[keep]} › ${clean[clean.length - 1]}`;
  const head = clean.slice(0, keep).join("/");
  // Otherwise the nearest folder is kept whole, and the rest gives way from
  // its end.
  return (
    <span
      data-tile-parent
      className="-mt-1.5 flex w-full min-w-0 items-center gap-1 px-2.5 pb-2 text-xs leading-tight text-ink-3"
    >
      {inArchive && <Icon name="archive" className="size-3 text-accent/70" />}
      <span className="flex min-w-0">
        {head !== "" && <span className="min-w-[2ch] truncate">{head}/</span>}
        <span className="max-w-[80%] shrink-0 truncate">{last}</span>
      </span>
    </span>
  );
}

/** A model's name with its extension quieted: the stem is what tells two
 *  models apart, the format is the same across a folder. */
function TileName({ name }: { name: string }) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || name.length - dot > 6) return <>{name}</>;
  return (
    <>
      {name.slice(0, dot)}
      <span className="text-ink-3">{name.slice(dot)}</span>
    </>
  );
}

/** Placeholder tiles shaped like the real ones, so the grid does not jump when
 *  the listing lands. */
export function SkeletonGrid({ size = "m" }: { size?: TileSize }) {
  return (
    <div aria-hidden="true" className={GRID_CLASS[size]}>
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="animate-pulse overflow-hidden rounded-xl border border-line bg-surface"
        >
          <div className="aspect-square w-full bg-sunken" />
          <div className="px-2.5 py-2.5">
            <div className="h-2.5 w-2/3 rounded-full bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Two card edges peeking above a folder: a collection, not an item. Drawn in
 *  the row gap, so it costs the grid nothing. */
const STACK_CLASS =
  " shadow-[0_-7px_0_-3px_rgb(255_255_255/0.09),0_-13px_0_-7px_rgb(255_255_255/0.045)]";

/**
 * A score badge. `pointer-events-none` so it is never the target of the press
 * that orbits the tile, and `z-tile-badge` so the opaque orbit overlay does not
 * cover it — no ancestor of a tile makes a stacking context, so the two resolve
 * against the same root. index.css orders the five z layers.
 */
const BADGE_CLASS =
  "pointer-events-none absolute bottom-2 z-tile-badge rounded-full bg-canvas/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none text-ink-2 ring-1 ring-line-strong backdrop-blur-sm";

/**
 * What one thumbnail looks like at any moment, for a model tile and a sheet
 * cell alike. The `url`-before-status order is load-bearing: a loading entry
 * that has a URL is the embedded-3MF placeholder, and must draw as the picture
 * it is rather than as a spinner.
 */
function ThumbView({
  thumb,
  path,
  onImageError,
  quiet = false,
}: {
  thumb: ThumbState | undefined;
  /** The cell's own path in a folder sheet, not the folder's, so a failed
   *  image is reported for the entry it belongs to (D3). */
  path: string;
  onImageError?: (path: string) => void;
  /** A sheet cell: four spinners to a folder is a wall of them, so a cell
   *  waits as a faint block and its picture fades in. */
  quiet?: boolean;
}) {
  // Only until the *first* picture: a later URL replaces it on arrival while
  // the browser keeps the old pixels up, so spinning over them would discard a
  // picture already on screen. A `blob:` URL draws at once.
  const [everLoaded, setEverLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // A tile remounted on scroll-back finds its picture already decoded, and
  // would otherwise spin over it until a `load` that may never come (D12).
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img !== null && img.complete && img.naturalWidth > 0)
      setEverLoaded(true);
  }, []);
  if (thumb?.status === "error") {
    return (
      <span
        className="flex flex-col items-center gap-1.5 text-ink-3"
        title="Failed to load model"
      >
        <Icon name="warning" className="size-5" strokeWidth={1.5} />
        <span className="text-xs">Couldn't render</span>
      </span>
    );
  }
  if (thumb?.url !== undefined) {
    const url = thumb.url;
    const pending = !url.startsWith("blob:") && !everLoaded;
    return (
      // The box is declared, not inferred, so `overlayRectFor` measures a real
      // rect before a lazy image has intrinsic size — renders are always square
      // (`THUMB_SIZE`). Both axes, or a cell taller than wide squashes it.
      //
      // Whole class literals: Tailwind's scanner reads source text, so a
      // utility glued to a `${` never reaches the stylesheet.
      <span className="relative flex aspect-square w-[min(100%,100cqh)] items-center justify-center">
        <img
          ref={imgRef}
          src={url}
          alt="" // decorative: the button's aria-label names the model
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setEverLoaded(true)}
          onError={() => onImageError?.(path)}
          className={
            pending
              ? "h-full w-full object-contain opacity-0"
              : "h-full w-full object-contain"
          }
        />
        {pending && !quiet ? (
          <span className="absolute size-5 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
        ) : null}
      </span>
    );
  }
  return quiet ? (
    <span className="size-3/5 animate-[pulse_2.4s_ease-in-out_infinite] rounded-md bg-white/[0.035]" />
  ) : (
    <span className="size-5 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
  );
}

/**
 * The folder tile's contact sheet, up to four previews (D4). The sheet never
 * shows an empty cell — hence the column count chosen per length, and the third
 * of three spanning the row. An empty or unanswered peek keeps the icon, so a
 * tile never blanks while its peek is in flight.
 */
function ContactSheet({
  preview,
  thumbs,
  onImageError,
}: {
  preview: DirEntry[];
  thumbs: (ThumbState | undefined)[] | undefined;
  onImageError: (path: string) => void;
}) {
  return (
    <div
      data-preview-sheet={preview.length}
      className={`grid h-full min-h-0 w-full gap-1 ${preview.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
    >
      {preview.map((entry, i) => (
        <div
          key={entry.path}
          data-preview-cell={entry.path}
          // A cell shows no other name, so this title is its label and takes
          // the stored one (`library-overrides` D7). The folder tile's own
          // title keeps the real name — two different title roles.
          title={entry.displayName ?? entry.name}
          // A size container, so the image can take the cell's smaller axis.
          className={
            // The odd one out of three, given the full width below the pair.
            preview.length === 3 && i === 2
              ? "flex min-h-0 items-center justify-center overflow-hidden rounded-md bg-stage [container-type:size] col-span-2"
              : "flex min-h-0 items-center justify-center overflow-hidden rounded-md bg-stage [container-type:size]"
          }
        >
          <ThumbView
            // Keyed on the cache key: a same-path new-mtime entry is a
            // different render, and `everLoaded` must start over.
            key={`${entry.path}:${entry.mtime}`}
            thumb={thumbs?.[i]}
            path={entry.path}
            onImageError={onImageError}
            quiet
          />
        </div>
      ))}
    </div>
  );
}

interface TileProps {
  entry: DirEntry;
  thumb: ThumbState | undefined;
  onEnter: (entry: DirEntry) => void;
  onModelPointerDown: (
    e: React.PointerEvent,
    entry: DirEntry,
    el: HTMLElement,
  ) => void;
  onModelOpen: (entry: DirEntry, el: HTMLElement) => void;
  onModelHover: (path: string | null, mtime?: number) => void;
  onEntryMenu: (
    entry: DirEntry,
    el: HTMLElement,
    at: { x: number; y: number },
  ) => void;
  onImageError: (path: string) => void;
  marked: boolean;
  anchor: boolean;
  score: IndexScore | undefined;
  scale: ScoreScale | null;
  showScores: boolean;
  modest: boolean;
  /** The map's own array (see `Grid`), so compared by identity. */
  preview: DirEntry[] | undefined;
  /** Rebuilt every render, so `tilePropsEqual` compares it elementwise. */
  previewThumbs: (ThumbState | undefined)[] | undefined;
}

/**
 * React's shallow compare with `previewThumbs` exempted: it is a fresh array
 * every render, so identity would undo the memo for exactly the tiles that need
 * it most, while its elements are the thumbs map's own stable objects.
 *
 * Over the keys, not a hand-listed check, which would silently stop comparing a
 * prop added above.
 */
function tilePropsEqual(prev: TileProps, next: TileProps): boolean {
  const keys = Object.keys(next) as (keyof TileProps)[];
  if (keys.length !== Object.keys(prev).length) return false;
  for (const key of keys) {
    if (key === "previewThumbs") continue;
    if (prev[key] !== next[key]) return false;
  }
  const a = prev.previewThumbs;
  const b = next.previewThumbs;
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every((state, i) => state === b[i]);
}

const Tile = memo(function Tile({
  entry,
  thumb,
  onEnter,
  onModelPointerDown,
  onModelOpen,
  onModelHover,
  onEntryMenu,
  onImageError,
  marked,
  anchor,
  score,
  scale,
  showScores,
  modest,
  preview,
  previewThumbs,
}: TileProps) {
  const ref = useRef<HTMLButtonElement>(null);
  /** A touch press that began outside the orbit zone: its click is a tap. */
  const edgeTapRef = useRef(false);
  const base =
    "group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left text-ink-2 transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  // A CSS animation (index.css), not a class swap, so the fade is the
  // browser's and App only drops the state that applied it.
  const markClass = marked ? " animate-reveal-mark" : "";
  // Deliberately a quiet ring: anything louder reads as "this one matched
  // hardest", the opposite of what the subject is.
  const anchorClass = anchor ? " border-accent/40 ring-1 ring-accent/40" : "";
  // Both or neither: the two scoring routes run on different distributions, so
  // an unlabelled cosine invites a comparison it cannot support (D2).
  const badges =
    score !== undefined && scale !== null ? { score, scale } : null;

  const onMenuKey = (e: React.KeyboardEvent<HTMLButtonElement>): boolean => {
    // For the platforms that do not send `contextmenu` for the menu key.
    if (e.key !== "ContextMenu" && !(e.key === "F10" && e.shiftKey))
      return false;
    e.preventDefault();
    onEntryMenu(
      entry,
      e.currentTarget,
      menuAt(e.currentTarget, { clientX: 0, clientY: 0 }),
    );
    return true;
  };

  // A sibling of the tile, never inside it: a button may not hold another,
  // and a press here must not start the tile's orbit. Out of the tab order —
  // the tile itself takes Shift+F10 and the Menu key — and drawn on hover,
  // focus, or always where there is no hover to reveal it.
  const actions = (
    <button
      type="button"
      tabIndex={-1}
      data-tile-actions
      aria-label={`Actions for ${entry.name}`}
      title="Actions"
      onClick={(e) => {
        const tile = ref.current;
        if (tile === null) return;
        const r = e.currentTarget.getBoundingClientRect();
        onEntryMenu(entry, tile, { x: r.left, y: r.bottom + 4 });
      }}
      className="absolute top-1.5 right-1.5 z-tile-badge flex size-8 items-center touch:size-10 justify-center rounded-md bg-black/45 text-ink-2 opacity-0 ring-1 ring-white/10 backdrop-blur-sm transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 hover:text-ink [@media(hover:none)]:opacity-100"
    >
      <Icon name="more" className="size-4" strokeWidth={2.5} />
    </button>
  );

  if (entry.kind !== "model") {
    return (
      <div className="group/tile relative h-full">
        <button
          ref={ref}
          type="button"
          data-entry-tile={entry.path}
          title={entry.name}
          // Set only where a stored name is drawn below, or the stored name would
          // *become* the accessible name — the real one has to stay there
          // (`library-overrides` D7). That puts label and name deliberately out of
          // step (WCAG 2.5.3) on exactly those tiles: a knowing trade, since the
          // real name is what a reader acts on outside this app. Kind-split
          // because a named zip must not announce "folder".
          aria-label={
            entry.displayName !== undefined
              ? entry.kind === "dir"
                ? `folder ${entry.name}`
                : entry.name
              : undefined
          }
          className={
            (entry.kind === "dir" ? base + STACK_CLASS : base) +
            markClass +
            anchorClass
          }
          onClick={() => onEnter(entry)}
          onContextMenu={(e) => {
            if (nativeMenuRequested(e)) return;
            e.preventDefault();
            onEntryMenu(entry, e.currentTarget, menuAt(e.currentTarget, e));
          }}
          onKeyDown={onMenuKey}
          // Folders only — a zip is not peeked, and an absent attribute cannot
          // be picked up by mistake.
          data-dir-tile={entry.kind === "dir" ? entry.path : undefined}
        >
          {/* The folder chrome — a tab and a framed body — IS the directory
              tile's icon, drawn whether or not anything previews: the resting
              look and the filled look are one shape, so a peek landing fills the
              folder rather than replacing an emoji with chrome — no pop-in, and
              an empty folder still reads as a folder.
              The sheet, when there is one, sits inside: the images are *inside*
              the folder, the way every desktop draws it, which is what keeps a
              one-preview sheet from reading as a model tile. Only zips keep the
              emoji — they are never previewed and are not folders. */}
          {entry.kind === "dir" ? (
            // The chrome carries the type signal a glyph would otherwise leak
            // into the content-derived accessible name. A named tile's
            // button-level label takes over whole.
            <div
              data-folder-chrome
              role="img"
              aria-label="folder"
              // A relayout boundary: a landing sheet otherwise relays out the
              // whole grid, re-resolving every cell's container units.
              className="relative aspect-square w-full bg-sunken p-1.5 [contain:size_layout]"
            >
              {preview !== undefined && preview.length > 0 ? (
                <ContactSheet
                  preview={preview}
                  thumbs={previewThumbs}
                  onImageError={onImageError}
                />
              ) : (
                <span className="flex h-full items-center justify-center text-ink-3/60">
                  <Icon name="folder" className="size-10" strokeWidth={1.25} />
                </span>
              )}
            </div>
          ) : (
            // A bare glyph leaks into the accessible name as whatever the
            // reader's symbol dictionary says.
            <span
              role="img"
              aria-label="zip archive"
              className="flex aspect-square w-full items-center justify-center bg-stage text-ink-3"
            >
              <Icon name="archive" className="size-10" strokeWidth={1.25} />
            </span>
          )}
          {/* The leaf, not the relative path a deep search carries — truncating
              that shows the head of the path rather than the folder searched for.
              A stored name displaces it, for display only: the title, the
              accessible name and every matcher still read `entry.name` (D7). */}
          <span
            data-tile-name
            className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-2 text-[13px] leading-tight"
          >
            <Icon
              name={entry.kind === "dir" ? "folder" : "archive"}
              className="size-3.5 text-accent/80"
            />
            <span className="min-w-0 truncate">
              {entry.displayName ?? baseName(entry.name)}
            </span>
          </span>
          <ParentLine name={entry.name} />
        </button>
        {actions}
      </div>
    );
  }

  return (
    <div className="group/tile relative h-full">
      <button
        ref={ref}
        type="button"
        data-model-tile={entry.path}
        data-entry-tile={entry.path}
        title={
          badges === null
            ? entry.name
            : `${entry.name}\n${strengthOf(badges.score.z, modest)} match`
        }
        // An accessible name *replaces* the contents rather than joining them, so
        // the full path, the anchor and the badge numbers are only announced if
        // they are stated here (D8). The scales are spelled out for reading aloud.
        aria-label={
          (thumb?.status === "error"
            ? `${entry.name} — failed to load`
            : entry.name) +
          (anchor ? " — the model these are compared against" : "") +
          (badges === null
            ? ""
            : showScores
              ? ` — ${SCALE_SPOKEN[badges.scale]} ${formatCosine(badges.score.score)}, ${Z_LABEL} ${formatZ(badges.score.z)}`
              : ` — ${strengthOf(badges.score.z, modest).toLowerCase()} match`)
        }
        className={`${base} cursor-grab touch-pan-y select-none active:cursor-grabbing ${markClass} ${anchorClass}`}
        onPointerDown={(e) => {
          // A finger turns the model only from the middle of its picture;
          // the band around it scrolls the grid, and a tap there opens it.
          const edge =
            e.pointerType === "touch" &&
            (e.target as Element).closest("[data-orbit-zone]") === null;
          edgeTapRef.current = edge;
          if (!edge) onModelPointerDown(e, entry, e.currentTarget);
        }}
        onClick={(e) => {
          if (!edgeTapRef.current) return;
          edgeTapRef.current = false;
          onModelOpen(entry, e.currentTarget);
        }}
        // A shifted secondary press is the one exception: not prevented, not
        // raised, so the browser's own menu appears.
        onContextMenu={(e) => {
          if (nativeMenuRequested(e)) return;
          e.preventDefault();
          onEntryMenu(entry, e.currentTarget, menuAt(e.currentTarget, e));
        }}
        onKeyDown={(e) => {
          if (onMenuKey(e)) return;
          // Keyboard activation fires click, not pointerdown.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onModelOpen(entry, e.currentTarget);
          }
        }}
        onPointerEnter={() => onModelHover(entry.path, entry.mtime)}
        onPointerLeave={() => onModelHover(null)}
      >
        <div
          data-tile-content
          // A size container for the same reason as a sheet cell (`ThumbView`).
          className="relative flex aspect-square w-full items-center justify-center bg-stage [container-type:size]"
        >
          <ThumbView
            key={`${entry.path}:${entry.mtime}`}
            thumb={thumb}
            path={entry.path}
            onImageError={onImageError}
          />
          {/* The touch orbit zone: the middle of the picture, over it so a finger
              lands here, where a drag is meant for the model; everything
              outside it pans the page. */}
          <span
            aria-hidden="true"
            data-orbit-zone
            className="absolute inset-[17.5%] touch-none"
          />
          {/* Never composited into the render: a painted badge would make the
              score part of the thumbnail's cache key, and every query change
              would re-render the grid (D5). `aria-hidden` because the button
              states these numbers in its own name. */}
          {badges !== null && (
            <>
              {/* The strength at a glance, the numbers on hover: a bar reads
                  without a legend, a raw cosine does not. */}
              <span
                aria-hidden
                data-relevance-bar
                className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-r-full bg-accent/70"
                style={{ width: `${relevanceWidth(badges.score.z)}%` }}
              />
              {showScores && (
                <>
                  <span aria-hidden className={`${BADGE_CLASS} left-1.5`}>
                    {SCALE_BADGE[badges.scale]}{" "}
                    {formatCosine(badges.score.score)}
                  </span>
                  <span aria-hidden className={`${BADGE_CLASS} right-1.5`}>
                    {Z_LABEL} {formatZ(badges.score.z)}
                  </span>
                </>
              )}
            </>
          )}
          {/* Over the picture's foot, above the name: the last line is what a
              label is read from. */}
          {anchor && (
            <span className="absolute inset-x-0 bottom-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-accent">
              Compared against
            </span>
          )}
        </div>
        {/* The file name; the flat-view path is in the title and aria-label. A
            stored name displaces it as on the container tile — and needs no
            aria-label help here, since this button already states the real
            name (D7). */}
        <span
          data-tile-name
          className="w-full truncate px-2.5 py-2 text-[13px] leading-tight"
        >
          <TileName name={entry.displayName ?? baseName(entry.name)} />
        </span>
        <ParentLine name={entry.name} />
      </button>
      {actions}
    </div>
  );
}, tilePropsEqual);
