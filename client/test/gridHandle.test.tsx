// @vitest-environment happy-dom
//
// Every place the app lands on or focuses a tile goes through the grid's
// handle, so none of them depends on the tile being in the document
// (grid-virtualization D6–D9). Each cell's listing is far longer than the
// seam's viewport, so the tile it lands on or focuses starts in an unmounted
// row. happy-dom has no sequential focus navigation and does not scroll on
// `focus()`, so Tab is asserted as the grid's own handling and a view
// following focus is left to the browser check. Import `./appHarness` before
// any `../src/...` module (the renderer-mock ordering rule).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry, DirListing } from "../../shared/types";
import {
  click,
  container,
  dir,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  pathInput,
  pressEnter,
  searchInput,
  settle,
  tiles,
  type,
  unmountApp,
  upButton,
  wait,
} from "./appHarness";
import { installGridGeometry } from "./gridGeometry";
import { resetLookupQueueForTests } from "../src/hooks/useThumbnails";
import { measureIn } from "../src/lib/placement";
import { TRAIL_KEY } from "../src/lib/trail";
import type { GridGeometry } from "../src/lib/gridGeometry";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

/** Two 200px rows of three in view, the scroller's top edge at 100 and each
 *  tile 20px shorter than its row. */
const SCROLLER_TOP = 100;
const TILE_GAP = 20;
const SHORT: GridGeometry = {
  viewport: 400,
  rowHeight: 200,
  cols: 3,
  gridTop: 0,
};
function install(g: GridGeometry = SHORT): void {
  installGridGeometry(g, { scrollerTop: SCROLLER_TOP, tileGap: TILE_GAP });
}

const MODELS = (n: number, under = ""): DirEntry[] =>
  Array.from({ length: n }, (_, i) => model(`${under}m${i}.stl`));
const LONG: DirListing = { path: "/models", entries: MODELS(600) };
/** Ten rows of folders, then ninety rows alternating three models and a
 *  folder with two models, three to a row. */
function interleaved(): DirEntry[] {
  const out: DirEntry[] = Array.from({ length: 30 }, (_, i) => dir(`k${i}`));
  let m = 0;
  for (let row = 10; row < 100; row++) {
    if (row % 2 === 1) out.push(dir(`mix${row}`));
    while (out.length < (row + 1) * 3) out.push(model(`m${m++}.stl`));
  }
  return out;
}

const main = (): HTMLElement => container.querySelector("main")!;
function tile(path: string): HTMLElement | undefined {
  return Array.from(
    main().querySelectorAll<HTMLElement>("[data-entry-tile]"),
  ).find((el) => el.dataset.entryTile === path);
}
const focusedPath = (): string | undefined =>
  (document.activeElement as HTMLElement | null)?.dataset?.entryTile;
function mountedRows(): number[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-grid-body] > [data-index]"),
  ).map((row) => Number(row.dataset.index));
}

/** Scroll like a user and let the settle timer file the place. */
async function scrollTo(top: number): Promise<void> {
  await act(async () => {
    main().scrollTop = top;
  });
  await wait(200);
  await settle();
}
const back = (): Promise<void> =>
  act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 50));
  });
async function key(
  target: EventTarget,
  k: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  const ev = new KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    target.dispatchEvent(ev);
  });
  return ev;
}

beforeEach(() => {
  sessionStorage.removeItem(TRAIL_KEY);
  resetLookupQueueForTests();
  install();
});
afterEach(async () => {
  await unmountApp();
});

describe("landing on a tile that is not drawn", () => {
  it("Back to a place far down a long listing lands its tile at the same offset", async () => {
    // Folder rows on top, and below them model rows alternating with mixed
    // ones, each kind its own height. Landing near the anchor draws the first
    // mixed row there, which re-estimates every mixed row above it: a write
    // toward the anchor's estimated row alone misses it by thousands of px.
    install({ ...SHORT, rowHeights: { dirs: 150, models: 250, mixed: 400 } });
    const PARENT: DirListing = { path: "/models", entries: interleaved() };
    await mountApp("/models", PARENT);
    listDir.mockImplementation((_target: string, opts?: { q?: string }) =>
      Promise.resolve(
        structuredClone(
          opts?.q !== undefined
            ? { path: "/models", entries: [model("found.stl")] }
            : PARENT,
        ),
      ),
    );
    // Row 80 lies at 10×150 + 35×250 + 35×400 = 24250.
    await scrollTo(24300);
    const left = measureIn(main())!;
    const leftAt = main().scrollTop;
    const row = Math.floor(
      PARENT.entries.findIndex((e) => e.path === left.anchor) / 3,
    );
    expect(row).toBeGreaterThan(70);

    await type(searchInput(), "found");
    await pressEnter(searchInput());
    await settle();
    expect(main().scrollTop).toBe(0);
    expect(tile(left.anchor)).toBeUndefined();

    await back();
    await settle();
    expect(main().scrollTop).toBe(leftAt);
    expect(tile(left.anchor)!.getBoundingClientRect().top).toBe(
      SCROLLER_TOP + left.offset,
    );
  });

  it("Back to a tile scrolled nearly out of view lands it to the pixel past the estimates", async () => {
    // Only a sliver of the anchor tile shows, so its offset is past the
    // height every undrawn row is estimated at until a model row is measured.
    // As a browser orders it: a write's scroll and the rows' measurements
    // each arrive a frame later.
    install({
      ...SHORT,
      rowHeight: 170,
      rowHeights: { models: 210 },
      scrollTiming: "production",
    });
    const PARENT: DirListing = {
      path: "/models",
      entries: [
        ...Array.from({ length: 30 }, (_, i) => dir(`k${i}`)),
        ...MODELS(570),
      ],
    };
    await mountApp("/models", PARENT);
    listDir.mockImplementation((_target: string, opts?: { q?: string }) =>
      Promise.resolve(
        structuredClone(
          opts?.q !== undefined
            ? { path: "/models", entries: [model("found.stl")] }
            : PARENT,
        ),
      ),
    );
    // Row 80 at 10×170 + 70×210 once measured; then its 190px tile shows 5px.
    await scrollTo(10 * 170 + 70 * 210);
    await wait(100);
    const drawnAt = tile("/models/m210.stl")!.getBoundingClientRect().top;
    await scrollTo(main().scrollTop + drawnAt - SCROLLER_TOP + 185);
    await wait(100);
    const left = measureIn(main())!;
    const leftAt = main().scrollTop;
    expect(left).toEqual({ anchor: "/models/m210.stl", offset: -185 });

    await type(searchInput(), "found");
    await pressEnter(searchInput());
    await wait(100);
    expect(tile(left.anchor)).toBeUndefined();

    await back();
    await wait(300);
    expect(main().scrollTop).toBe(leftAt);
    expect(tile(left.anchor)!.getBoundingClientRect().top).toBe(
      SCROLLER_TOP - 185,
    );
  });

  it("a reveal far down a folder centres and marks the model", async () => {
    const BIG: DirListing = {
      path: "/models/big",
      entries: MODELS(600, "big/"),
    };
    const FOUND: DirListing = {
      path: "/models",
      entries: [model("big/m250.stl")],
    };
    await mountApp("/models", FOUND);
    listDir.mockImplementation((target: string) =>
      Promise.resolve(structuredClone(target === "/models/big" ? BIG : FOUND)),
    );
    const found = tile("/models/big/m250.stl")!;
    await act(async () => {
      found.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 120,
          clientY: 140,
        }),
      );
    });
    await settle();
    await click(
      document.querySelector<HTMLButtonElement>(
        '[role="menu"] [data-command="reveal"]',
      )!,
    );
    await settle();

    // Row 83 at 16600, its 180px tile centred in the 400px scrollport.
    expect(tiles().length).toBeLessThan(60);
    expect(main().scrollTop).toBe(16600 - (400 - 180) / 2);
    const marked = container.querySelector(".animate-reveal-mark");
    expect(marked?.getAttribute("data-entry-tile")).toBe(
      "/models/big/m250.stl",
    );
  });

  it("going up focuses a folder far from the remembered place without moving the grid", async () => {
    const KITS: DirListing = {
      path: "/models",
      entries: Array.from({ length: 60 }, (_, i) =>
        dir(`k${String(i).padStart(2, "0")}`),
      ),
    };
    await mountApp("/models", KITS);
    listDir.mockImplementation((target: string) =>
      Promise.resolve(
        structuredClone(
          target === "/models"
            ? KITS
            : { path: target, entries: [model("inside.stl")] },
        ),
      ),
    );
    // k03's row at the top, 50px scrolled past; k57 is row 19.
    await scrollTo(250);
    await click(tile("/models/k03")!);
    await settle();
    await type(pathInput(), "/models/k57");
    await pressEnter(pathInput());
    await settle();
    (document.activeElement as HTMLElement | null)?.blur();

    await click(upButton());
    await settle();
    expect(main().scrollTop).toBe(250);
    expect(focusedPath()).toBe("/models/k57");
    expect(mountedRows()).toContain(19);
  });
});

describe("the keyboard over rows that are not drawn", () => {
  it("Tab then Shift+Tab after scrolling far away step from the focused tile", async () => {
    await mountApp("/models", LONG);
    // m11 ends row 3; m12 begins row 4, which scrolling away unmounts.
    await act(async () => tile("/models/m11.stl")!.focus());
    await scrollTo(20000);
    expect(tile("/models/m12.stl")).toBeUndefined();

    const tab = await key(document.activeElement!, "Tab");
    expect(tab.defaultPrevented).toBe(true);
    expect(focusedPath()).toBe("/models/m12.stl");

    // m12's row is the one kept now, so m11's has gone.
    expect(tile("/models/m11.stl")).toBeUndefined();
    await key(document.activeElement!, "Tab", { shiftKey: true });
    expect(focusedPath()).toBe("/models/m11.stl");
  });

  it("leaves Tab to the browser at the listing's ends", async () => {
    await mountApp("/models", { path: "/models", entries: MODELS(4) });
    await act(async () => tiles()[3]!.focus());
    const out = await key(document.activeElement!, "Tab");
    expect(out.defaultPrevented).toBe(false);
    await act(async () => tiles()[0]!.focus());
    const back = await key(document.activeElement!, "Tab", { shiftKey: true });
    expect(back.defaultPrevented).toBe(false);
  });

  it("ArrowDown from the first row visits every row in turn", async () => {
    await mountApp("/models", { path: "/models", entries: MODELS(60) });
    await act(async () => tiles()[0]!.focus());
    for (let row = 1; row < 20; row++) {
      await key(document.activeElement!, "ArrowDown");
      expect(focusedPath()).toBe(`/models/m${row * 3}.stl`);
    }
  });
});

describe("the lightbox hands focus back by entry", () => {
  const dialog = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[role="dialog"]');

  it("a close after stepping past the drawn rows focuses the stepped-to tile", async () => {
    await mountApp("/models", LONG);
    await key(tile("/models/m0.stl")!, "Enter");
    await wait(200);
    await settle();
    expect(dialog()).not.toBeNull();
    // Rows 0–4 drawn: m16 is row 5.
    for (let i = 0; i < 16; i++) {
      await key(window, "ArrowRight");
      await wait(20);
    }
    await settle();
    expect(dialog()?.getAttribute("aria-label")).toBe("m16.stl");
    expect(tile("/models/m16.stl")).toBeUndefined();

    const historyBack = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => {
        window.history.replaceState(null, "", "/?path=%2Fmodels");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    await key(window, "Escape");
    await wait(200);
    await settle();
    expect(dialog()).toBeNull();
    expect(focusedPath()).toBe("/models/m16.stl");
    historyBack.mockRestore();
  });

  it("a deep-linked lightbox closed without stepping moves no focus", async () => {
    await mountAppAtCurrentUrl(
      "/?path=%2Fmodels&model=%2Fmodels%2Fm30.stl",
      LONG,
    );
    await wait(200);
    await settle();
    expect(dialog()).not.toBeNull();

    await key(window, "Escape");
    await wait(200);
    await settle();
    expect(dialog()).toBeNull();
    expect(focusedPath()).toBeUndefined();
    expect(tile("/models/m30.stl")).toBeUndefined();
  });

  it("a deep-linked lightbox stepped onto a shown model hands focus to its tile", async () => {
    await mountAppAtCurrentUrl(
      "/?path=%2Fmodels&model=%2Fmodels%2Fm30.stl",
      LONG,
    );
    await wait(200);
    await settle();
    await key(window, "ArrowRight");
    await wait(200);
    await settle();
    expect(dialog()?.getAttribute("aria-label")).toBe("m31.stl");

    await key(window, "Escape");
    await wait(200);
    await settle();
    expect(dialog()).toBeNull();
    expect(focusedPath()).toBe("/models/m31.stl");
  });
});

describe("a column change keeps the top entry", () => {
  it("m → s keeps the entry at the top of the view at the same offset", async () => {
    await mountApp("/models", LONG);
    // Row 100 at the top, 50px scrolled past: m300 leads it.
    await scrollTo(20050);
    expect(tile("/models/m300.stl")!.getBoundingClientRect().top).toBe(
      SCROLLER_TOP - 50,
    );

    install({ ...SHORT, cols: 5 });
    await click(
      container.querySelector<HTMLButtonElement>('[data-tile-size="s"]')!,
    );
    await settle();

    // m300 now leads row 60.
    expect(main().scrollTop).toBe(60 * 200 + 50);
    const top = tile("/models/m300.stl")!;
    expect(top.getBoundingClientRect().top).toBe(SCROLLER_TOP - 50);
    expect(
      top.closest("[data-index]")!.querySelector("[data-entry-tile]"),
    ).toBe(top);
  });

  it("keeps the same entry on top through successive column changes", async () => {
    await mountApp("/models", LONG);
    // Row 101 at the top, 50px scrolled past: m303 leads it.
    await scrollTo(101 * 200 + 50);

    install({ ...SHORT, cols: 5 });
    await click(
      container.querySelector<HTMLButtonElement>('[data-tile-size="s"]')!,
    );
    await settle();
    // Fourth in row 60, which m300 leads.
    expect(tile("/models/m303.stl")!.getBoundingClientRect().top).toBe(
      SCROLLER_TOP - 50,
    );

    install({ ...SHORT, cols: 2 });
    await click(
      container.querySelector<HTMLButtonElement>('[data-tile-size="l"]')!,
    );
    await settle();
    // Leading row 151 again, not m300 leading row 150.
    expect(main().scrollTop).toBe(151 * 200 + 50);
    expect(tile("/models/m303.stl")!.getBoundingClientRect().top).toBe(
      SCROLLER_TOP - 50,
    );
  });

  it("keeps a thin top row's entry on top through changes to shorter rows", async () => {
    await mountApp("/models", LONG);
    // Row 101 on top with 110 of its 200px showing: m303 leads it, 45% of
    // the row scrolled past.
    await scrollTo(101 * 200 + 90);

    install({ ...SHORT, cols: 5, rowHeight: 120 });
    await click(
      container.querySelector<HTMLButtonElement>('[data-tile-size="s"]')!,
    );
    await settle();
    // Fourth in row 60, 45% of its 120px scrolled past.
    expect(main().scrollTop).toBe(60 * 120 + 54);

    // 90px, the offset in pixels, would lie wholly above an 80px row.
    install({ ...SHORT, cols: 6, rowHeight: 80 });
    await click(
      container.querySelector<HTMLButtonElement>('[data-tile-size="m"]')!,
    );
    await settle();
    // Fourth in row 50.
    expect(main().scrollTop).toBe(50 * 80 + 36);
    expect(tile("/models/m303.stl")!.getBoundingClientRect().top).toBe(
      SCROLLER_TOP - 36,
    );
    expect(measureIn(main())!.anchor).toBe("/models/m300.stl");
  });

  it("takes the top entry from the next row when less than half of the top row shows", async () => {
    await mountApp("/models", LONG);
    // Row 100 shows 30px; row 101, led by m303, is what the user reads.
    await scrollTo(100 * 200 + 170);

    install({ ...SHORT, cols: 5 });
    await click(
      container.querySelector<HTMLButtonElement>('[data-tile-size="s"]')!,
    );
    await settle();
    // m303 is fourth in row 60, which lands flush with the top.
    expect(main().scrollTop).toBe(60 * 200);
    expect(tile("/models/m303.stl")!.getBoundingClientRect().top).toBe(
      SCROLLER_TOP,
    );
  });

  it("keeps the top entry when the columns change right after content above the grid moved", async () => {
    await mountApp("/models", LONG);
    await scrollTo(20050);
    // In one frame the view scrolls on and the content above the grid grows
    // by a row, so the grid now starts 200px down: row 149 is on top, 50px
    // scrolled past, and m447 leads it.
    install({ ...SHORT, gridTop: 200 });
    await act(async () => {
      main().scrollTop = 30050;
    });
    await wait(50);

    install({ ...SHORT, cols: 5, gridTop: 200 });
    await click(
      container.querySelector<HTMLButtonElement>('[data-tile-size="s"]')!,
    );
    await settle();
    // m447 is third in row 89.
    expect(main().scrollTop).toBe(200 + 89 * 200 + 50);
    expect(tile("/models/m447.stl")!.getBoundingClientRect().top).toBe(
      SCROLLER_TOP - 50,
    );
  });
});

describe("with no grid mounted", () => {
  it("every call site falls through: the top still lands, the keyboard stays put", async () => {
    await mountApp("/models", LONG);
    listDir.mockImplementation((_target: string, opts?: { q?: string }) =>
      Promise.resolve(
        structuredClone(
          opts?.q !== undefined ? { path: "/models", entries: [] } : LONG,
        ),
      ),
    );
    await scrollTo(450);

    await type(searchInput(), "nothing");
    await pressEnter(searchInput());
    await settle();
    expect(container.querySelector("[data-grid-body]")).toBeNull();
    expect(main().scrollTop).toBe(0);

    searchInput().focus();
    await key(searchInput(), "ArrowDown");
    expect(document.activeElement).toBe(searchInput());
  });
});

describe("a grid with nothing to show", () => {
  it("an empty folder lands at the top through the grid's own empty state", async () => {
    await mountApp("/models", LONG);
    listDir.mockImplementation((target: string) =>
      Promise.resolve(
        structuredClone(
          target === "/models/empty"
            ? { path: "/models/empty", entries: [] }
            : LONG,
        ),
      ),
    );
    await scrollTo(450);

    await type(pathInput(), "/models/empty");
    await pressEnter(pathInput());
    await settle();
    expect(main().textContent).toContain("Nothing here.");
    expect(main().scrollTop).toBe(0);
  });
});
