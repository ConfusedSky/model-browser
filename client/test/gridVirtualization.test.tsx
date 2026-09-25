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
import Grid from "../src/components/Grid";
import { resetLookupQueueForTests } from "../src/hooks/useThumbnails";
import type { GridGeometry } from "../src/lib/gridGeometry";

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
/** Rows `from..to`, inclusive. */
const span = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

let host: HTMLElement | null = null;
let root: Root | null = null;

async function renderGrid(entries: DirEntry[]): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Grid
        entries={entries}
        thumbs={new Map()}
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
        onPeek={() => {}}
        onBands={() => {}}
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
