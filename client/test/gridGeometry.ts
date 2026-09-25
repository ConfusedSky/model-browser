// The grid's geometry for happy-dom, which lays nothing out (grid-virtualization
// D13). `installGridGeometry` hands `Grid` its numbers through the src seam and
// makes the DOM report the same ones: the scroller's rect and `clientHeight`,
// the grid body's rect, each row's and each tile's, and a `scroll` event on
// every `scrollTop` change, as a browser fires one. `test/setup.ts` installs a
// tall default before every happy-dom cell; a cell that needs a short viewport
// installs its own, before the mount or again after it.
import {
  seamRowHeight,
  setGridGeometryForTests,
  type GridGeometry,
  type RowComposition,
} from "../src/lib/gridGeometry";

export interface StubOptions {
  /** The scroller's own top in the page. */
  scrollerTop?: number;
  /** How much shorter a tile is than its row: the row gap below it. */
  tileGap?: number;
}

export const DEFAULT_GRID_GEOMETRY: GridGeometry = {
  viewport: 20000,
  rowHeight: 200,
  cols: 4,
  gridTop: 0,
};

interface Saved {
  rect: PropertyDescriptor | undefined;
  clientHeight: PropertyDescriptor | undefined;
  scrollTop: PropertyDescriptor | undefined;
}
let saved: Saved | null = null;

function box(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Where `Grid` drew a row inside its body: its `translateY`. */
function drawnAt(row: HTMLElement): number {
  const m = /translateY\((-?[\d.]+)px\)/.exec(row.style.transform);
  return m === null ? 0 : Number(m[1]);
}

/** A row's kinds, from the tiles it holds (zips count as folders). */
function compositionOf(row: HTMLElement): RowComposition {
  const tiles = row.querySelectorAll("[data-entry-tile]").length;
  const models = row.querySelectorAll("[data-model-tile]").length;
  return models === 0 ? "dirs" : models === tiles ? "models" : "mixed";
}

/** The grid's body and its scroller: the app's `<main>`, or the document's
 *  body for a `Grid` rendered alone. */
function scrollerAndBody(): {
  scroller: HTMLElement;
  body: HTMLElement;
} | null {
  const body = document.querySelector<HTMLElement>("[data-grid-body]");
  if (body === null) return null;
  return { scroller: body.closest("main") ?? document.body, body };
}

export function installGridGeometry(
  g: GridGeometry,
  options: StubOptions = {},
): void {
  resetGridGeometry();
  setGridGeometryForTests(g);
  const scrollerTop = options.scrollerTop ?? 0;
  const tileGap = options.tileGap ?? 0;
  const proto = HTMLElement.prototype;
  saved = {
    rect: Object.getOwnPropertyDescriptor(proto, "getBoundingClientRect"),
    clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
    scrollTop: Object.getOwnPropertyDescriptor(proto, "scrollTop"),
  };
  const originalRect = Element.prototype.getBoundingClientRect;
  const clientHeight = Object.getOwnPropertyDescriptor(proto, "clientHeight")!;
  const scrollTop = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollTop",
  )!;

  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: function (this: HTMLElement): DOMRect {
      const found = scrollerAndBody();
      if (found === null) return originalRect.call(this);
      const { scroller, body } = found;
      if (this === scroller) return box(scrollerTop, g.viewport);
      const bodyTop = scrollerTop + g.gridTop - scroller.scrollTop;
      if (this === body)
        return box(bodyTop, Number.parseFloat(body.style.height) || 0);
      // A row lies where the grid drew it and is as tall as its kind
      // measures, as a browser would lay it out; a tile shares its row's top.
      // Never by a tile's place among the tiles in the document, which skip
      // every unmounted row. With no `rowHeights`, every row is `rowHeight`
      // and drawn at its index times that.
      const rowBox = (row: HTMLElement, shorter: number): DOMRect =>
        box(
          bodyTop + drawnAt(row),
          seamRowHeight(g, compositionOf(row)) - shorter,
        );
      if (this.parentElement === body && this.dataset.index !== undefined)
        return rowBox(this, 0);
      if (this.dataset.entryTile !== undefined) {
        const row = this.parentElement?.parentElement;
        if (
          row != null &&
          row.parentElement === body &&
          row.dataset.index !== undefined
        )
          return rowBox(row, tileGap);
      }
      return originalRect.call(this);
    },
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      return scrollerAndBody()?.scroller === this
        ? g.viewport
        : (clientHeight.get!.call(this) as number);
    },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement): number {
      return scrollTop.get!.call(this) as number;
    },
    set(this: HTMLElement, value: number) {
      const before = scrollTop.get!.call(this);
      scrollTop.set!.call(this, value);
      if (scrollTop.get!.call(this) !== before)
        this.dispatchEvent(new Event("scroll"));
    },
  });
}

export function resetGridGeometry(): void {
  setGridGeometryForTests(null);
  if (saved === null) return;
  const proto = HTMLElement.prototype;
  for (const key of [
    "getBoundingClientRect",
    "clientHeight",
    "scrollTop",
  ] as const) {
    const was = saved[key === "getBoundingClientRect" ? "rect" : key];
    if (was === undefined)
      delete (proto as unknown as Record<string, unknown>)[key];
    else Object.defineProperty(proto, key, was);
  }
  saved = null;
}
