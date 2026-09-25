/**
 * The grid's geometry under test (grid-virtualization D13). happy-dom lays
 * nothing out, so a test hands `Grid` the numbers a browser would measure;
 * `client/test/gridGeometry.ts` installs these together with the DOM stubs
 * that report the same numbers. Null in production, where TanStack's own
 * observers and the computed column read are used.
 */
import type { Rect, Virtualizer } from "@tanstack/react-virtual";

/** A row's kinds: all folders (zips count as folders), all models, or both. */
export type RowComposition = "dirs" | "models" | "mixed";

export interface GridGeometry {
  /** The scroller's height. */
  viewport: number;
  /** Every row's measured height, unless `rowHeights` names its composition;
   *  also the estimate for a row before any has been measured. */
  rowHeight: number;
  cols: number;
  /** The grid body's offset from the scroller's content top. */
  gridTop: number;
  rowHeights?: Partial<Record<RowComposition, number>>;
  /** `"production"`: a scroll is heard as scrolling until TanStack's
   *  `isScrollingResetDelay` passes without one, and `test/gridGeometry.ts`
   *  fires the scroll event and then the rows' `ResizeObserver` entries a
   *  frame later, as a browser does — so a row mounted by a scroll is measured
   *  only after the commit that drew it. Unset,
   *  never scrolling, and rows are measured as they mount. Install it before
   *  the grid mounts: TanStack creates its observer once. */
  scrollTiming?: "production";
}

let current: GridGeometry | null = null;

export function setGridGeometryForTests(g: GridGeometry | null): void {
  current = g;
}

export function gridGeometryForTests(): GridGeometry | null {
  return current;
}

/** TanStack's `observeElementRect`, answering the viewport once: happy-dom
 *  never fires a `ResizeObserver`, so there is nothing to observe. */
export function observeSeamRect(
  g: GridGeometry,
): (
  instance: Virtualizer<HTMLElement, HTMLDivElement>,
  cb: (r: Rect) => void,
) => void {
  return (instance, cb) => {
    cb({ width: instance.scrollElement?.clientWidth ?? 0, height: g.viewport });
  };
}

/**
 * TanStack's `observeElementOffset`: `scrollTop` on each `scroll`, as its
 * default reads it. By default never "scrolling": TanStack skips measuring a
 * row while scrolling and leaves the catch-up to a `ResizeObserver` happy-dom
 * never fires, and its scroll-end debounce would fire outside `act`. Under
 * `scrollTiming: "production"` it is scrolling until TanStack's debounce
 * passes with no scroll, as its own observer does, and the test helper's
 * observer does the catching up.
 */
export function observeSeamOffset(
  g: GridGeometry,
): (
  instance: Virtualizer<HTMLElement, HTMLDivElement>,
  cb: (offset: number, isScrolling: boolean) => void,
) => () => void {
  return (instance, cb) => {
    const el = instance.scrollElement;
    if (el === null) return () => {};
    let end: ReturnType<typeof setTimeout> | null = null;
    const onScroll =
      g.scrollTiming === "production"
        ? (): void => {
            if (end !== null) clearTimeout(end);
            end = setTimeout(() => {
              end = null;
              cb(el.scrollTop, false);
            }, instance.options.isScrollingResetDelay);
            cb(el.scrollTop, true);
          }
        : (): void => cb(el.scrollTop, false);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (end !== null) clearTimeout(end);
    };
  };
}

export function seamRowHeight(
  g: GridGeometry,
  composition: RowComposition | undefined,
): number {
  return (
    (composition === undefined ? undefined : g.rowHeights?.[composition]) ??
    g.rowHeight
  );
}
