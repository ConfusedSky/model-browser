// The grid's geometry for happy-dom, which lays nothing out (grid-virtualization
// D13). `installGridGeometry` hands `Grid` its numbers through the src seam and
// makes the DOM report the same ones: the scroller's rect and `clientHeight`,
// the grid body's rect, each row's and each tile's, and a `scroll` event on
// every `scrollTop` change, as a browser fires one. `test/setup.ts` installs a
// tall default before every happy-dom cell; a cell that needs a short viewport
// installs its own, before the mount or again after it. Under `scrollTiming:
// "production"` the scroll event comes a frame after the write and a
// `ResizeObserver` reports sizes a frame after they appear or change, so a
// cell sees a browser's order of events rather than a synchronous one.
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
  resizeObserver: typeof ResizeObserver | undefined;
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

/**
 * A `ResizeObserver` that reports, on the next animation frame, every observed
 * element whose height (as the rect stub answers it) is new or changed —
 * happy-dom's never reports. A row's height follows its tiles, so a change
 * among an observed element's descendants is what prompts a new look.
 */
class FrameResizeObserver {
  readonly #callback: ResizeObserverCallback;
  readonly #heights = new Map<Element, number | null>();
  readonly #mutations = new MutationObserver(() => this.#schedule());
  #frame: number | null = null;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    if (!this.#heights.has(target)) {
      this.#heights.set(target, null);
      this.#mutations.observe(target, { childList: true, subtree: true });
    }
    this.#schedule();
  }
  unobserve(target: Element): void {
    this.#heights.delete(target);
  }
  disconnect(): void {
    this.#heights.clear();
    this.#mutations.disconnect();
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }
  #schedule(): void {
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      const entries: ResizeObserverEntry[] = [];
      for (const [target, was] of this.#heights) {
        if (!target.isConnected) continue;
        const rect = target.getBoundingClientRect();
        if (rect.height === was) continue;
        this.#heights.set(target, rect.height);
        const size = [{ blockSize: rect.height, inlineSize: rect.width }];
        entries.push({
          target,
          contentRect: rect,
          borderBoxSize: size,
          contentBoxSize: size,
          devicePixelContentBoxSize: size,
        });
      }
      if (entries.length > 0)
        this.#callback(entries, this as unknown as ResizeObserver);
    });
  }
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
    resizeObserver: window.ResizeObserver,
  };
  const production = g.scrollTiming === "production";
  if (production)
    window.ResizeObserver =
      FrameResizeObserver as unknown as typeof ResizeObserver;
  /** Scrollers written this frame, each to hear one `scroll` next frame. */
  const written = new Set<HTMLElement>();
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
      if (scrollTop.get!.call(this) === before) return;
      if (!production) {
        this.dispatchEvent(new Event("scroll"));
        return;
      }
      if (written.size === 0)
        requestAnimationFrame(() => {
          const scrollers = [...written];
          written.clear();
          for (const el of scrollers) el.dispatchEvent(new Event("scroll"));
        });
      written.add(this);
    },
  });
}

export function resetGridGeometry(): void {
  setGridGeometryForTests(null);
  if (saved === null) return;
  window.ResizeObserver = saved.resizeObserver!;
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
