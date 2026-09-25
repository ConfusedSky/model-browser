// @vitest-environment happy-dom
//
// Arrow-key focus movement across the grid (grid-arrow-navigation). The handler
// sits on the grid container; a keydown from a focused tile bubbles to it and
// moves focus between the tile buttons. A second, document-level listener
// (link-previews D11) catches the arrow nobody is focused for and lands it on
// the first tile. happy-dom lays nothing out, so the
// grid's geometry seam gives it three columns, and `trackCount` (the column
// read from a real grid's computed tracks) is unit-tested directly. Import `./appHarness` before any `../src/...` module (the renderer-mock
// ordering rule).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirListing } from "../../shared/types";
import {
  findInput,
  model,
  mountApp,
  openFind,
  settle,
  tiles,
  unmountApp,
  wait,
} from "./appHarness";
import { DEFAULT_GRID_GEOMETRY, installGridGeometry } from "./gridGeometry";
import { trackCount } from "../src/components/Grid";
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
    installGridGeometry({ ...DEFAULT_GRID_GEOMETRY, cols: 3 });
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
    tiles()[1]!.focus();
    await fireArrow("ArrowDown");
    expect(document.activeElement).toBe(tiles()[4]);
    await fireArrow("ArrowUp");
    expect(document.activeElement).toBe(tiles()[1]);
  });

  it("does not move sideways on ArrowUp from the top row", async () => {
    tiles()[1]!.focus(); // top row, but not the first tile
    await fireArrow("ArrowUp");
    expect(document.activeElement).toBe(tiles()[1]);
  });

  it("lands on the last tile stepping down into a short final row", async () => {
    // Tile 4 is in the last full row; a straight step (→7) falls past the end,
    // but a partial row sits below, so focus goes to the last tile.
    tiles()[4]!.focus();
    await fireArrow("ArrowDown");
    expect(document.activeElement).toBe(tiles()[6]);
  });

  it("trackCount counts the computed column tracks", () => {
    expect(trackCount("181.333px 181.333px 181.333px")).toBe(3);
    expect(trackCount("[a] 160px [b c] 160px [d]")).toBe(2);
    // No layout (happy-dom) and a non-grid both read as one column.
    expect(trackCount("")).toBe(1);
    expect(trackCount("none")).toBe(1);
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

  /** Drop focus to `body`, the state a fresh visitor or a click on empty space leaves. */
  function blurAll(): void {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
  }

  it("lands on the first tile when nothing has focus", async () => {
    blurAll();
    const right = await fireArrow("ArrowRight");
    expect(document.activeElement).toBe(tiles()[0]);
    expect(right.defaultPrevented).toBe(true);

    // Every arrow, not only the forward ones: there is no tile to step from.
    blurAll();
    await fireArrow("ArrowLeft");
    expect(document.activeElement).toBe(tiles()[0]);
    blurAll();
    await fireArrow("ArrowUp");
    expect(document.activeElement).toBe(tiles()[0]);

    // A modified arrow is the browser's whatever holds focus.
    blurAll();
    const modified = await fireArrow("ArrowRight", { alt: true });
    expect(document.activeElement).toBe(document.body);
    expect(modified.defaultPrevented).toBe(false);
  });

  it("leaves an unfocused arrow alone while the lightbox is open", async () => {
    tiles()[0]!.focus();
    await act(async () => {
      tiles()[0]!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await wait(200);
    await settle();
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();

    // The lightbox pulls focus back on every step, so `activeElement` cannot
    // tell whether the grid grabbed it first; the tile's own `focus` can.
    const grab = vi.spyOn(tiles()[0]!, "focus");
    blurAll();
    await fireArrow("ArrowRight");
    await wait(200);
    await settle();
    expect(grab).not.toHaveBeenCalled();
    expect(tiles().some((t) => t === document.activeElement)).toBe(false);
    // The body-targeted arrow still reached the lightbox's window listener.
    expect(
      document.querySelector('[aria-modal="true"]')?.getAttribute("aria-label"),
    ).toBe("m1.stl");
  });
});
