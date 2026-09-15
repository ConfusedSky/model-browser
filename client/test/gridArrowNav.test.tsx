// @vitest-environment happy-dom
//
// Arrow-key focus movement across the grid (grid-arrow-navigation). The handler
// sits on the grid container; a keydown from a focused tile bubbles to it and
// moves focus between the tile buttons. happy-dom lays nothing out, so the
// column-stepping cells stub each tile's `getBoundingClientRect` to fake a
// three-column layout, and `columnCount` is unit-tested directly over stubbed
// rects. Import `./appHarness` before any `../src/...` module (the renderer-mock
// ordering rule).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirListing } from "../../shared/types";
import {
  findInput,
  model,
  mountApp,
  openFind,
  tiles,
  unmountApp,
} from "./appHarness";
import { columnCount } from "../src/components/Grid";
import { resetLookupQueueForTests } from "../src/hooks/useThumbnails";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

// Seven models: at three columns that is [0 1 2] [3 4 5] [6] — two full rows and
// a short final row of one, which is what the "down into a short row" cell needs.
const SEVEN: DirListing = {
  path: "/models",
  entries: Array.from({ length: 7 }, (_, i) => model(`m${i}.stl`)),
};

/** Fake a three-column, 160px-tile grid on the live tile buttons. */
function stub3col(): void {
  tiles().forEach((t, i) => {
    const top = Math.floor(i / 3) * 200;
    const left = (i % 3) * 180;
    t.getBoundingClientRect = () =>
      ({
        top,
        left,
        right: left + 160,
        bottom: top + 160,
        width: 160,
        height: 160,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  });
}

/** Dispatch a keydown on whatever holds focus; return the event for defaultPrevented. */
async function fireArrow(
  key: string,
  opts: { alt?: boolean } = {},
): Promise<KeyboardEvent> {
  const ev = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    altKey: opts.alt ?? false,
  });
  await act(async () => {
    document.activeElement?.dispatchEvent(ev);
  });
  return ev;
}

describe("grid arrow-key focus movement", () => {
  beforeEach(async () => {
    resetLookupQueueForTests();
    await mountApp("/models", SEVEN);
  });
  afterEach(async () => {
    await unmountApp();
  });

  it("ArrowRight then ArrowLeft moves focus one tile and back", async () => {
    tiles()[0]!.focus();
    await fireArrow("ArrowRight");
    expect(document.activeElement).toBe(tiles()[1]);
    await fireArrow("ArrowLeft");
    expect(document.activeElement).toBe(tiles()[0]);
  });

  it("clamps focus at the horizontal edges", async () => {
    tiles()[0]!.focus();
    await fireArrow("ArrowLeft");
    expect(document.activeElement).toBe(tiles()[0]);

    const t = tiles();
    t[t.length - 1]!.focus();
    await fireArrow("ArrowRight");
    expect(document.activeElement).toBe(t[t.length - 1]);
  });

  it("prevents default on a handled arrow but leaves a modified arrow alone", async () => {
    tiles()[0]!.focus();
    const handled = await fireArrow("ArrowRight");
    expect(handled.defaultPrevented).toBe(true);

    // Alt+ArrowRight is the browser's Back/Forward — not moved, not prevented.
    tiles()[0]!.focus();
    const modified = await fireArrow("ArrowRight", { alt: true });
    expect(document.activeElement).toBe(tiles()[0]);
    expect(modified.defaultPrevented).toBe(false);

    // An inert edge arrow (ArrowLeft at the first tile) moves nothing, so it is
    // left to the browser — not prevented, the page may scroll (D3).
    tiles()[0]!.focus();
    const edge = await fireArrow("ArrowLeft");
    expect(document.activeElement).toBe(tiles()[0]);
    expect(edge.defaultPrevented).toBe(false);
  });

  it("steps by the live column count for Down and Up", async () => {
    stub3col();
    tiles()[1]!.focus();
    await fireArrow("ArrowDown");
    expect(document.activeElement).toBe(tiles()[4]);
    await fireArrow("ArrowUp");
    expect(document.activeElement).toBe(tiles()[1]);
  });

  it("does not move sideways on ArrowUp from the top row", async () => {
    stub3col();
    tiles()[1]!.focus(); // top row, but not the first tile
    await fireArrow("ArrowUp");
    expect(document.activeElement).toBe(tiles()[1]);
  });

  it("lands on the last tile stepping down into a short final row", async () => {
    stub3col();
    // Tile 4 is in the last full row; a straight step (→7) falls past the end,
    // but a partial row sits below, so focus goes to the last tile.
    tiles()[4]!.focus();
    await fireArrow("ArrowDown");
    expect(document.activeElement).toBe(tiles()[6]);
  });

  it("columnCount counts the leading top-row tiles", () => {
    const rects = [0, 0, 0, 200, 200, 200, 400];
    const fake = rects.map(
      (top) =>
        ({ getBoundingClientRect: () => ({ top }) }) as unknown as HTMLElement,
    );
    expect(columnCount(fake)).toBe(3);
    expect(columnCount([])).toBe(1);
  });

  it("leaves arrows in the find input untouched", async () => {
    await openFind();
    const input = findInput();
    expect(input).not.toBeNull();
    input!.focus();
    expect(document.activeElement).toBe(input);

    await fireArrow("ArrowRight");

    // The find input is isolated by CONTAINER SCOPING (design D3): the listener
    // is on gridRef and the input renders in <main> OUTSIDE it, so its keydown
    // never reaches the handler. The idx === -1 check is a second defense for a
    // non-tile that does reach the handler (focus on the container itself).
    // Because both hold, neither single-line mutation falsifies THIS cell —
    // scoping stops the event, and the guard would reject the input anyway; only
    // the compound window-listener + no-guard mutation moves focus off the input.
    // So this cell is a behavioral regression assertion, not a single-mutant
    // falsification (the falsifiable mutants are preventDefault and the Up clamp).
    expect(document.activeElement).toBe(input);
    expect(tiles().some((t) => t === document.activeElement)).toBe(false);
  });
});
