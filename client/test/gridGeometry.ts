// The grid's geometry for happy-dom, which lays nothing out (grid-virtualization
// D13). `installGridGeometry` hands `Grid` its numbers through the src seam and
// makes the DOM report the same ones: the scroller's rect, `clientHeight` and
// `scrollHeight`, the grid body's rect, each row's rect and `offsetHeight` (so
// `Grid` measures rows as it does in a browser), each tile's rect, and a
// `scroll` event on every `scrollTop` change, as a browser fires one.
// `test/setup.ts` installs a tall default before every happy-dom cell; a cell
// that needs a short viewport installs its own, before the mount or again
// after it. Under `scrollTiming: "production"` the scroll event comes a frame
// after the write, a write is clamped to the content drawn, and a
// `ResizeObserver` reports sizes a frame after they appear or change, after
// that frame's scroll events, so a cell sees a browser's order of events
// rather than a synchronous one.
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
  scrollHeight: PropertyDescriptor | undefined;
  offsetHeight: PropertyDescriptor | undefined;
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

/** Work for the next frame, run in a browser's order: every `scroll` event,
 *  then every resize observation, so the commit a scroll causes runs before
 *  the rows it drew are measured. */
const frameWork: Record<"scroll" | "resize", (() => void)[]> = {
  scroll: [],
  resize: [],
};
let frameQueued = false;
function nextFrame(phase: "scroll" | "resize", work: () => void): void {
  frameWork[phase].push(work);
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    for (const run of frameWork.scroll.splice(0)) run();
    for (const run of frameWork.resize.splice(0)) run();
  });
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
  #queued = false;
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
    this.#queued = false;
  }
  #schedule(): void {
    if (this.#queued) return;
    this.#queued = true;
    nextFrame("resize", () => {
      if (!this.#queued) return;
      this.#queued = false;
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
    scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
    offsetHeight: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
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
  const scrollHeight = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollHeight",
  )!;
  /** The scroller's content: what lies above the grid, then its body. By
   *  default unbounded, as its writes are never clamped; under production
   *  timing clamped as a browser clamps them. */
  const extentOf = (el: HTMLElement): number | null => {
    const found = scrollerAndBody();
    if (found === null || found.scroller !== el) return null;
    if (!production) return Number.MAX_SAFE_INTEGER;
    const body = Number.parseFloat(found.body.style.height) || 0;
    return Math.max(g.viewport, g.gridTop + body);
  };
  const offsetHeight = Object.getOwnPropertyDescriptor(proto, "offsetHeight")!;
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
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      const body = scrollerAndBody()?.body;
      return body !== undefined &&
        this.parentElement === body &&
        this.dataset.index !== undefined
        ? seamRowHeight(g, compositionOf(this))
        : (offsetHeight.get!.call(this) as number);
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
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      return extentOf(this) ?? (scrollHeight.get!.call(this) as number);
    },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement): number {
      return scrollTop.get!.call(this) as number;
    },
    set(this: HTMLElement, value: number) {
      const before = scrollTop.get!.call(this);
      const extent = extentOf(this);
      scrollTop.set!.call(
        this,
        extent === null
          ? value
          : Math.max(0, Math.min(value, extent - g.viewport)),
      );
      if (scrollTop.get!.call(this) === before) return;
      if (!production) {
        this.dispatchEvent(new Event("scroll"));
        return;
      }
      if (written.size === 0)
        nextFrame("scroll", () => {
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
    "scrollHeight",
    "offsetHeight",
    "scrollTop",
  ] as const) {
    const was = saved[key === "getBoundingClientRect" ? "rect" : key];
    if (was === undefined)
      delete (proto as unknown as Record<string, unknown>)[key];
    else Object.defineProperty(proto, key, was);
  }
  saved = null;
}
