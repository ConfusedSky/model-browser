// @vitest-environment happy-dom
//
// Alt+ArrowUp ascends one level, the same as the header's ↑ button (issue #29).
// The binding rides App's window keydown effect and stands down under the same
// three conditions Escape does: while the user is typing (path bar, search,
// find), while a viewer owns the keyboard, and while an entry menu is raised —
// plus the button's own no-op at the library top, which `goUp` guards.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirListing } from "../../shared/types";
import {
  click,
  container,
  dir,
  findInput,
  listDir,
  model,
  mountApp,
  openFind,
  pathInput,
  searchInput,
  settle,
  tiles,
  unmountApp,
} from "./appHarness";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

const PARENT: DirListing = {
  path: "/models",
  entries: [dir("k00"), dir("k01"), model("widget.stl")],
};
const CHILD: DirListing = {
  path: "/models/k00",
  entries: [model("k00/a.stl"), model("k00/b.stl")],
};
// The library's top, addressed as "/" — where ↑ has nowhere to go.
const TOP: DirListing = { path: "/", entries: [dir("k00")] };
// A folder inside an archive and the archive's own listing above it.
const ARCHIVE: DirListing = {
  path: "/models/kit.zip",
  entries: [dir("kit.zip!/sub"), model("kit.zip!/a.stl")],
};
const ARCHIVE_INNER: DirListing = {
  path: "/models/kit.zip!/sub",
  entries: [model("kit.zip!/sub/x.stl")],
};

function routes(): void {
  listDir.mockImplementation((target: string) => {
    if (target === "/models") return Promise.resolve(PARENT);
    if (target === "/models/k00") return Promise.resolve(CHILD);
    if (target === "/models/kit.zip") return Promise.resolve(ARCHIVE);
    if (target === "/models/kit.zip!/sub")
      return Promise.resolve(ARCHIVE_INNER);
    return Promise.resolve(TOP);
  });
}

/** Alt+ArrowUp, dispatched on `on` and bubbling to App's window listener. */
const altUp = (on: EventTarget = window): Promise<void> =>
  act(async () => {
    on.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
      }),
    );
  });

const askedFor = (path: string): number =>
  listDir.mock.calls.filter((c) => c[0] === path).length;

afterEach(async () => {
  await unmountApp();
});

describe("Alt+ArrowUp ascends one level", () => {
  it("goes up from a folder, like the ↑ button", async () => {
    await mountApp("/models", PARENT);
    routes(); // after mountApp — mount() resets listDir to answer the boot only
    await click(
      container.querySelector<HTMLElement>('[data-entry-tile="/models/k00"]')!,
    );
    await settle();
    expect(tiles().length).toBe(CHILD.entries.length);

    await altUp();
    await settle();
    expect(tiles().length).toBe(PARENT.entries.length);
  });

  it("goes up from inside an archive", async () => {
    await mountApp("/models/kit.zip!/sub", ARCHIVE_INNER);
    routes();
    expect(askedFor("/models/kit.zip")).toBe(0);

    await altUp();
    await settle();
    expect(askedFor("/models/kit.zip")).toBe(1);
    expect(tiles().length).toBe(ARCHIVE.entries.length);
  });

  it("does nothing at the library top", async () => {
    await mountApp("/", TOP);
    const before = listDir.mock.calls.length;

    await altUp();
    await settle();
    expect(listDir.mock.calls.length).toBe(before);
    expect(tiles().length).toBe(TOP.entries.length);
  });
});

describe("Alt+ArrowUp stands down", () => {
  beforeEach(async () => {
    await mountApp("/models/k00", CHILD);
    routes();
  });

  it("while the path bar, the search box or the find control has focus", async () => {
    for (const input of [pathInput(), searchInput()]) {
      await act(async () => input.focus());
      await altUp(input);
      await settle();
      expect(askedFor("/models")).toBe(0);
      await act(async () => input.blur());
    }
    // The find control is summoned, not always present — and opened with
    // nothing else focused, since Ctrl+F stands down while a box has focus too.
    await openFind();
    const find = findInput()!;
    await act(async () => find.focus());
    await altUp(find);
    await settle();
    expect(askedFor("/models")).toBe(0);
  });

  it("while a viewer owns the keyboard", async () => {
    const tile = container.querySelector<HTMLElement>(
      "button[data-model-tile]",
    )!;
    await act(async () => {
      tile.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 50,
          clientY: 50,
          button: 0,
        }),
      );
    });
    await settle();
    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 50,
          clientY: 50,
        }),
      );
    });
    await settle();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await altUp();
    await settle();
    expect(askedFor("/models")).toBe(0);
  });

  it("while an entry menu is raised", async () => {
    const tile = container.querySelector<HTMLElement>(
      "button[data-model-tile]",
    )!;
    await act(async () => {
      tile.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 2,
          buttons: 2,
          clientX: 120,
          clientY: 140,
        }),
      );
      tile.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 120,
          clientY: 140,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 2 }),
      );
    });
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    await altUp();
    await settle();
    expect(askedFor("/models")).toBe(0);
  });
});
