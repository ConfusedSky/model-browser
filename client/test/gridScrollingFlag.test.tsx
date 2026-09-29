// @vitest-environment happy-dom
//
// The grid's scroller carries `data-scrolling` while it scrolls, and index.css
// turns the tiles' hover transitions off under it. happy-dom applies no
// Tailwind, so the cells pin the attribute and its lifetime, and one more reads
// index.css as text for the top-level rule that consumes it: a computed style is
// not observable here. Import `./appHarness` before any `../src/...` module
// (the renderer-mock ordering rule).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirListing } from "../../shared/types";
import { container, model, mountApp, tiles, unmountApp } from "./appHarness";
import Grid, { SCROLL_QUIET_MS } from "../src/components/Grid";
// The stylesheet as text; see the `?raw` note in test/CLAUDE.md.
import CSS from "../src/index.css?raw";
import { resetLookupQueueForTests } from "../src/hooks/useThumbnails";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

const FLAG = "data-scrolling";

describe("a Grid rendered alone", () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;
  const flagged = (): boolean => document.body.hasAttribute(FLAG);
  const scroll = (): Promise<void> =>
    act(async () => {
      document.body.dispatchEvent(new Event("scroll"));
    });
  const advance = (ms: number): Promise<void> =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });
  const unmount = async (): Promise<void> => {
    await act(async () => root?.unmount());
    root = null;
  };

  beforeEach(async () => {
    // Only the flag's timer: the frame loop and React's act stay real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Grid
          entries={[model("a.stl"), model("b.stl")]}
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
  });
  afterEach(async () => {
    await unmount();
    host?.remove();
    host = null;
    vi.useRealTimers();
  });

  it("is not flagged until the scroller scrolls", () => {
    expect(flagged()).toBe(false);
  });

  it("flags the scroller on a scroll event and clears the flag once it has been quiet", async () => {
    await scroll();
    expect(flagged()).toBe(true);

    await advance(SCROLL_QUIET_MS - 1);
    expect(flagged()).toBe(true);
    await advance(1);
    expect(flagged()).toBe(false);
  });

  it("holds the flag while events keep arriving inside the quiet period", async () => {
    await scroll();
    await advance(SCROLL_QUIET_MS - 50);
    await scroll();
    // Past the first event's deadline, inside the second's.
    await advance(SCROLL_QUIET_MS - 50);
    expect(flagged()).toBe(true);

    await advance(49);
    expect(flagged()).toBe(true);
    await advance(1);
    expect(flagged()).toBe(false);
  });

  it("flags again when a later burst begins", async () => {
    await scroll();
    await advance(SCROLL_QUIET_MS);
    expect(flagged()).toBe(false);

    await scroll();
    expect(flagged()).toBe(true);
  });

  it("writes the attribute once per burst, not once per event", async () => {
    const set = vi.spyOn(document.body, "setAttribute");
    try {
      await scroll();
      await scroll();
      await scroll();
      expect(set.mock.calls.filter(([name]) => name === FLAG)).toHaveLength(1);
    } finally {
      // Not `vi.restoreAllMocks()`: it would also clear the harness's own
      // `vi.fn` implementations for the app cell that follows.
      set.mockRestore();
    }
  });

  it("takes the flag off the scroller when the grid unmounts mid-burst", async () => {
    await scroll();
    expect(flagged()).toBe(true);

    await unmount();
    expect(flagged()).toBe(false);
  });

  it("leaves no quiet-period timer running after it unmounts", async () => {
    const before = vi.getTimerCount();
    await scroll();
    expect(vi.getTimerCount()).toBe(before + 1);

    await unmount();
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe("the app's grid", () => {
  const LISTING: DirListing = {
    path: "/models",
    entries: [model("a.stl"), model("b.stl")],
  };

  beforeEach(async () => {
    resetLookupQueueForTests();
    await mountApp("/models", LISTING);
  });
  afterEach(async () => {
    await unmountApp();
  });

  // index.css selects a tile and its `⋯` button as descendants of the flagged
  // element, so the flag has to land on an ancestor of both.
  it("flags the scroller that holds every tile and its actions button", async () => {
    const main = container.querySelector("main")!;
    await act(async () => {
      main.dispatchEvent(new Event("scroll"));
    });

    expect(main.hasAttribute(FLAG)).toBe(true);
    expect(tiles().length).toBeGreaterThan(0);
    for (const tile of tiles()) expect(tile.closest(`[${FLAG}]`)).toBe(main);
    const actions = container.querySelectorAll("[data-tile-actions]");
    expect(actions.length).toBeGreaterThan(0);
    for (const button of actions)
      expect(button.closest(`[${FLAG}]`)).toBe(main);
  });
});

describe("the stylesheet", () => {
  // Both selectors are built from `FLAG`, so the attribute Grid writes and the
  // one the rule reads share a literal here.
  const RULE = new RegExp(
    `\\[${FLAG}\\]\\s+\\[data-entry-tile\\]\\s*,\\s*` +
      `\\[${FLAG}\\]\\s+\\[data-tile-actions\\]\\s*\\{\\s*transition:\\s*none;?\\s*\\}`,
  );

  it("turns off the transitions of a tile and its actions button under the flag, outside every layer", () => {
    const found = RULE.exec(CSS);
    expect(found).not.toBeNull();
    // A rule inside `@layer utilities` loses to the `transition-*` utilities it
    // has to beat: only unlayered CSS wins whatever the specificity.
    const before = CSS.slice(0, found!.index);
    expect(before.split("{").length).toBe(before.split("}").length);
  });
});
