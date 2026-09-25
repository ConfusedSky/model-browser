// @vitest-environment happy-dom
//
// The grid mounts only the rows near the view (grid-virtualization D1, D3, D10,
// D11). happy-dom lays nothing out, so every cell sets the grid's geometry
// through the seam (test/gridGeometry.ts) — a viewport a few rows tall over a
// listing hundreds of rows long — and scrolls it. A `Grid` rendered alone
// scrolls the document's body; the app's cells scroll its `<main>`. Import
// `./appHarness` before any `../src/...` module (the renderer-mock ordering
// rule).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry, DirListing } from "../../shared/types";
import {
  container,
  dir,
  model,
  mountApp,
  searchInput,
  tiles,
  unmountApp,
  wait,
} from "./appHarness";
import { installGridGeometry } from "./gridGeometry";
import Grid, { type GridHandle } from "../src/components/Grid";
import type { ThumbState } from "../src/hooks/useThumbnails";
import { resetLookupQueueForTests } from "../src/hooks/useThumbnails";
import type { GridGeometry } from "../src/lib/gridGeometry";
import type { Band } from "../src/three/queue";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

/** Two rows of three on screen: at scrollTop 20000 that is rows 100 and 101. */
const SHORT: GridGeometry = {
  viewport: 400,
  rowHeight: 200,
  cols: 3,
  gridTop: 0,
};
const MODELS = (n: number): DirEntry[] =>
  Array.from({ length: n }, (_, i) => model(`m${i}.stl`));
/** Ten rows of folders, then ninety rows alternating three models and a
 *  folder with two models, three to a row. */
function interleaved(): DirEntry[] {
  const out: DirEntry[] = Array.from({ length: 30 }, (_, i) => dir(`kit${i}`));
  let m = 0;
  for (let row = 10; row < 100; row++) {
    if (row % 2 === 1) out.push(dir(`mix${row}`));
    while (out.length < (row + 1) * 3) out.push(model(`m${m++}.stl`));
  }
  return out;
}
/** Rows `from..to`, inclusive. */
const span = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

let host: HTMLElement | null = null;
let root: Root | null = null;

async function renderGrid(
  entries: DirEntry[],
  report: {
    onBands?: (bands: ReadonlyMap<string, Band>) => void;
    onPeek?: (path: string) => void;
    handle?: { current: GridHandle | null };
    thumbs?: Map<string, ThumbState>;
  } = {},
): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Grid
        handle={report.handle}
        entries={entries}
        thumbs={report.thumbs ?? new Map()}
        onEnter={() => {}}
        onModelPointerDown={() => {}}
        onModelOpen={() => {}}
        onModelHover={() => {}}
        onEntryMenu={() => {}}
        onImageError={() => {}}
        markedPath={null}
        scoreFor={() => undefined}
        scoreScale={null}
        previews={new Map()}
        onPeek={report.onPeek ?? (() => {})}
        onBands={report.onBands ?? (() => {})}
        scrollRoot={{ current: document.body }}
      />,
    );
  });
}

/** The index of every row in the document, in document order. */
function mountedRows(): number[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-grid-body] > [data-index]"),
  ).map((row) => Number(row.dataset.index));
}
const bodyHeight = (): string =>
  document.querySelector<HTMLElement>("[data-grid-body]")!.style.height;

/** Scroll `scroller` as a user does, and let the frame callbacks run. */
async function scrollTo(scroller: HTMLElement, top: number): Promise<void> {
  await act(async () => {
    scroller.scrollTop = top;
  });
  await wait(50);
}

describe("a Grid rendered alone", () => {
  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;
    document.body.scrollTop = 0;
  });

  it("mounts only the rows near the view and the first row, and spans the listing", async () => {
    installGridGeometry(SHORT);
    await renderGrid(MODELS(600));
    // The two rows on screen and three either side, clipped at the top.
    expect(mountedRows()).toEqual(span(0, 4));
    expect(bodyHeight()).toBe(`${200 * 200}px`);

    await scrollTo(document.body, 20000);
    expect(mountedRows()).toEqual([0, ...span(97, 104)]);
    expect(document.querySelectorAll("[data-entry-tile]").length).toBe(9 * 3);
    expect(bodyHeight()).toBe(`${200 * 200}px`);
  });

  it("keeps a scrolled scroller where it was when the grid mounts", async () => {
    installGridGeometry(SHORT);
    document.body.scrollTop = 5000;
    await renderGrid(MODELS(600));
    expect(document.body.scrollTop).toBe(5000);
    expect(mountedRows()).toEqual([0, ...span(22, 29)]);
  });

  it("estimates the rows not yet drawn at their composition's measured height", async () => {
    // Ten rows of folders, then a hundred of models, each kind its own height.
    installGridGeometry({ ...SHORT, rowHeights: { dirs: 150, models: 250 } });
    await renderGrid([
      ...Array.from({ length: 30 }, (_, i) => dir(`kit${i}`)),
      ...MODELS(300),
    ]);
    // Only folder rows are drawn: every row stands at the one height measured.
    expect(Math.max(...mountedRows())).toBeLessThan(10);
    expect(bodyHeight()).toBe(`${110 * 150}px`);

    // Straight to row 50 as estimated: the first model rows drawn re-estimate
    // every model row not yet drawn, the ones above them included. TanStack
    // alone re-estimates only the rows after a measured one.
    await scrollTo(document.body, 50 * 150);
    expect(mountedRows().some((row) => row >= 10)).toBe(true);
    expect(bodyHeight()).toBe(`${10 * 150 + 100 * 250}px`);
  });

  it("re-reads where the grid sits in the scroller on the next scroll frame", async () => {
    installGridGeometry(SHORT);
    await renderGrid(MODELS(600));
    await scrollTo(document.body, 20000);
    expect(mountedRows()).toEqual([0, ...span(97, 104)]);

    // Content above the grid grew by a row's height, with no render of Grid.
    installGridGeometry({ ...SHORT, gridTop: 200 });
    await act(async () => {
      document.body.dispatchEvent(new Event("scroll"));
    });
    await wait(50);
    expect(mountedRows()).toEqual([0, ...span(96, 103)]);
  });
});

describe("bands and peeks from the layout", () => {
  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;
    document.body.scrollTop = 0;
  });

  it("ranks and peeks a folder below the mounted rows, and ranks the far end far", async () => {
    // Two rows on screen, three of overscan: rows 0–4 mounted. The near band
    // reaches two viewports (four rows) below the view, so row 5 is near.
    installGridGeometry(SHORT);
    const entries = MODELS(600);
    entries[15] = dir("k"); // row 5
    const onBands = vi.fn();
    const onPeek = vi.fn();
    await renderGrid(entries, { onBands, onPeek });

    expect(mountedRows()).toEqual(span(0, 4));
    expect(document.querySelector('[data-dir-tile="/models/k"]')).toBeNull();
    expect(onPeek.mock.calls).toEqual([["/models/k"]]);
    const bands = onBands.mock.calls.at(-1)![0] as ReadonlyMap<string, Band>;
    expect(bands.get("/models/k")).toBe("near");
    expect(bands.get("/models/m0.stl")).toBe("visible");
    expect(bands.get("/models/m150.stl")).toBe("far"); // row 50
    expect(bands.size).toBe(600);
  });

  it("publishes nothing for a scroll that stays within the same rows", async () => {
    installGridGeometry(SHORT);
    const onBands = vi.fn();
    await renderGrid(MODELS(600), { onBands });
    // Off the rows' edges, so the next scroll crosses none: on screen rows
    // 0–2, near rows 0–6, both before and after.
    await scrollTo(document.body, 50);
    const published = onBands.mock.calls.length;

    await scrollTo(document.body, 150);
    expect(onBands).toHaveBeenCalledTimes(published);

    // The control: a row's height further, and the rows on screen change.
    await scrollTo(document.body, 250);
    expect(onBands).toHaveBeenCalledTimes(published + 1);
  });
});

describe("the tile that last held focus", () => {
  const LONG: DirListing = { path: "/models", entries: MODELS(600) };
  const main = (): HTMLElement => container.querySelector("main")!;

  beforeEach(async () => {
    resetLookupQueueForTests();
    installGridGeometry(SHORT);
    await mountApp("/models", LONG);
  });
  afterEach(async () => {
    await unmountApp();
  });

  it("stays in the document, focused, while the grid scrolls far from it", async () => {
    // Row 3: drawn at the top, and neither the first row nor near row 100.
    const tile = tiles()[9]!;
    await act(async () => tile.focus());
    expect(document.activeElement).toBe(tile);

    await scrollTo(main(), 20000);
    expect(tile.isConnected).toBe(true);
    expect(document.activeElement).toBe(tile);
    expect(mountedRows()).toEqual([0, 3, ...span(97, 104)]);
  });

  it("stays in the document after focus moves out of the grid", async () => {
    const tile = tiles()[9]!;
    await act(async () => tile.focus());
    await act(async () => searchInput().focus());
    expect(document.activeElement).toBe(searchInput());

    await scrollTo(main(), 20000);
    expect(tile.isConnected).toBe(true);
    expect(mountedRows()).toContain(3);
  });
});

describe("the handle", () => {
  const handle: { current: GridHandle | null } = { current: null };
  const tileOf = (path: string): HTMLElement | undefined =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-entry-tile]"),
    ).find((el) => el.dataset.entryTile === path);
  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;
    document.body.scrollTop = 0;
  });

  it("lands an anchor whose row is not drawn at its offset, past the estimates", async () => {
    // Folder rows on screen, and far below them model rows alternating with
    // mixed ones, as a search interleaves them. Drawing the rows around a
    // write toward row 80 measures the first mixed row, which re-estimates
    // every mixed row above it, and row 80 moves by thousands of px.
    installGridGeometry({
      ...SHORT,
      rowHeights: { dirs: 150, models: 250, mixed: 400 },
    });
    const entries = interleaved();
    await renderGrid(entries, { handle });
    const target = entries[80 * 3]!.path;
    expect(tileOf(target)).toBeUndefined();

    await act(async () =>
      handle.current!.place({ kind: "anchor", path: target, offset: -50 }),
    );
    // 10 folder rows, then 35 model and 35 mixed rows above row 80.
    expect(document.body.scrollTop).toBe(10 * 150 + 35 * 250 + 35 * 400 + 50);
    expect(tileOf(target)!.getBoundingClientRect().top).toBe(-50);
  });

  it("centres a tile whose row is not drawn", async () => {
    installGridGeometry(SHORT, { tileGap: 20 });
    await renderGrid(MODELS(600), { handle });
    await act(async () =>
      handle.current!.place({ kind: "center", path: "/models/m250.stl" }),
    );
    // Row 83 at 16600; its 180px tile in the middle of 400px.
    expect(document.body.scrollTop).toBe(16600 - 110);
    expect(tileOf("/models/m250.stl")!.getBoundingClientRect().top).toBe(110);
  });

  it("focuses a tile whose row is not drawn, and refuses an entry not shown", async () => {
    installGridGeometry(SHORT);
    await renderGrid(MODELS(600), { handle });
    expect(tileOf("/models/m250.stl")).toBeUndefined();

    let answer = false;
    await act(async () => {
      answer = handle.current!.focusEntry("/models/m250.stl", {
        preventScroll: true,
      });
    });
    expect(answer).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.entryTile).toBe(
      "/models/m250.stl",
    );
    expect(document.body.scrollTop).toBe(0);

    expect(handle.current!.focusEntry("/models/absent.stl")).toBe(false);
    expect(handle.current!.focusEntry(600)).toBe(false);
  });

  it("lands within a few frames when the scroll event it waits for never comes", async () => {
    installGridGeometry(SHORT, { tileGap: 20 });
    await renderGrid(MODELS(600), { handle });
    // The first write reaches the scroller but not TanStack.
    const raw = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    )!;
    Object.defineProperty(document.body, "scrollTop", {
      configurable: true,
      get(this: HTMLElement) {
        return raw.get!.call(this) as number;
      },
      set(this: HTMLElement, value: number) {
        delete (this as unknown as Record<string, unknown>).scrollTop;
        raw.set!.call(this, value);
      },
    });

    await act(async () => {
      handle.current!.place({ kind: "center", path: "/models/m250.stl" });
      await wait(500);
    });
    expect(document.body.scrollTop).toBe(16600 - 110);
    expect(tileOf("/models/m250.stl")!.getBoundingClientRect().top).toBe(110);

    // Unpinned: scrolled away from, its row goes.
    await scrollTo(document.body, 0);
    expect(mountedRows()).not.toContain(83);
  });
});

describe("a thumbnail drawn again", () => {
  const URL_OF = "/api/thumb?path=%2Fmodels%2Fm0.stl";
  const spinnerIn = (): Element | null =>
    document.querySelector('[data-model-tile="/models/m0.stl"] .animate-spin');
  let restore: (() => void) | null = null;
  function imagesReport(complete: boolean): void {
    const proto = HTMLImageElement.prototype;
    const was = {
      complete: Object.getOwnPropertyDescriptor(proto, "complete")!,
      naturalWidth: Object.getOwnPropertyDescriptor(proto, "naturalWidth")!,
    };
    Object.defineProperty(proto, "complete", {
      configurable: true,
      get: () => complete,
    });
    Object.defineProperty(proto, "naturalWidth", {
      configurable: true,
      get: () => (complete ? 256 : 0),
    });
    restore = () => {
      Object.defineProperty(proto, "complete", was.complete);
      Object.defineProperty(proto, "naturalWidth", was.naturalWidth);
    };
  }
  afterEach(async () => {
    restore?.();
    restore = null;
    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });
  const thumbs = (): Map<string, ThumbState> =>
    new Map([["/models/m0.stl", { status: "ready", url: URL_OF }]]);

  it("shows no spinner over an image already complete when it mounts", async () => {
    imagesReport(true);
    await renderGrid(MODELS(3), { thumbs: thumbs() });
    expect(spinnerIn()).toBeNull();
  });

  it("spins over an image still loading when it mounts", async () => {
    imagesReport(false);
    await renderGrid(MODELS(3), { thumbs: thumbs() });
    expect(spinnerIn()).not.toBeNull();
  });
});
