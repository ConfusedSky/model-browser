/**
 * Where each entry of a virtualized grid lies, as a band (grid-virtualization
 * D4): arithmetic over the row layout, so an entry whose row is not mounted is
 * ranked as surely as one that is.
 */
import type { DirEntry } from "../../../shared/types";
import type { Band } from "../three/queue";

/** How far past the scrollport, in viewport heights either side, a row may lie
 *  before its render ranks `far`. Wide enough that ordinary scrolling
 *  oscillation cannot flip a tile's rank back and forth, and a screen or two of
 *  travel lands on rendered tiles. */
export const NEAR_SCREENS = 2;

/** How near a band sorts — the per-path max ("nearest wins") compares on this. */
export const NEARNESS: Record<Band, number> = { visible: 0, near: 1, far: 2 };
/** One worse than the folder's own: a sheet is decoration, and at equal bands
 *  an off-screen folder's cells beat near model tiles on listing order (D2). */
export const CELL_BAND: Record<Band, Band> = {
  visible: "near",
  near: "far",
  far: "far",
};

/** Row indexes, both ends included. */
export interface RowRange {
  first: number;
  last: number;
}

export function sameRange(a: RowRange | null, b: RowRange | null): boolean {
  return a === b || (a?.first === b?.first && a?.last === b?.last);
}

/** A row's extent in the scroller's content, `start` inclusive and `end`
 *  exclusive — TanStack's measurements, whose starts carry the scroll margin. */
export interface RowExtent {
  start: number;
  end: number;
}

/**
 * The rows meeting `[top, bottom)`, found by binary search over rows laid end
 * to end in index order. Null when none does.
 */
export function rowsMeeting(
  rows: ArrayLike<RowExtent>,
  top: number,
  bottom: number,
): RowRange | null {
  if (rows.length === 0 || bottom <= top) return null;
  // The first row ending below `top`.
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.end > top) hi = mid;
    else lo = mid + 1;
  }
  const first = lo;
  // The last row starting above `bottom`.
  lo = 0;
  hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.start < bottom) lo = mid + 1;
    else hi = mid;
  }
  const last = lo - 1;
  return first <= last ? { first, last } : null;
}

/** The rows on screen, and the rows within `NEAR_SCREENS` viewports of it. */
export function layoutRanges(
  rows: ArrayLike<RowExtent>,
  offset: number,
  viewport: number,
  nearScreens: number = NEAR_SCREENS,
): { visible: RowRange | null; near: RowRange | null } {
  if (viewport <= 0) return { visible: null, near: null };
  const grow = nearScreens * viewport;
  return {
    visible: rowsMeeting(rows, offset, offset + viewport),
    near: rowsMeeting(rows, offset - grow, offset + viewport + grow),
  };
}

const within = (range: RowRange | null, row: number): boolean =>
  range !== null && row >= range.first && row <= range.last;

/**
 * A band for every entry: its row's, and one step farther (`CELL_BAND`) for
 * each model a folder previews. A path shown in two places takes the nearest
 * band (`NEARNESS`) — which is why the cells are a second pass: written after
 * every tile, a last-write-wins slip would demote a visible tile that is also a
 * far folder's cell.
 */
export function bandsForRows(
  rows: readonly (readonly DirEntry[])[],
  visible: RowRange | null,
  near: RowRange | null,
  previews: ReadonlyMap<string, readonly DirEntry[]>,
): Map<string, Band> {
  const bands = new Map<string, Band>();
  const put = (path: string, band: Band): void => {
    const cur = bands.get(path);
    if (cur === undefined || NEARNESS[band] < NEARNESS[cur])
      bands.set(path, band);
  };
  rows.forEach((row, i) => {
    const band: Band = within(visible, i)
      ? "visible"
      : within(near, i)
        ? "near"
        : "far";
    for (const entry of row) put(entry.path, band);
  });
  // Preview models have no tile of their own; unregistered they would rank
  // behind every visible tile while their folder is on screen.
  for (const row of rows)
    for (const entry of row) {
      const cells = previews.get(entry.path);
      if (cells === undefined) continue;
      const band = CELL_BAND[bands.get(entry.path)!];
      for (const cell of cells) put(cell.path, band);
    }
  return bands;
}
