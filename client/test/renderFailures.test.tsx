// @vitest-environment happy-dom
// What the grid says when drawing fails: one model's thumbnail that could not
// be rendered, and the GPU taking the whole page's drawing context away.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirListing } from "../../shared/types";
import {
  container,
  dir,
  model,
  mountApp,
  renderThumbnail,
  settle,
  tiles,
  unmountApp,
} from "./appHarness";

/** The listener App hands `onContextLost`, so a cell can play the GPU. */
const gpu = vi.hoisted(() => ({
  notify: null as ((lost: boolean) => void) | null,
}));

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) => ({
  ...(await (await import("./appHarness")).rendererModule(importOriginal)),
  onContextLost: (listener: (lost: boolean) => void) => {
    gpu.notify = listener;
    return () => {
      gpu.notify = null;
    };
  },
}));

const NESTED: DirListing = {
  path: "/models",
  entries: [dir("Alpha"), model("widget.stl")],
};

afterEach(() => unmountApp());

describe("drawing that fails", () => {
  it("says a model's thumbnail could not be rendered, in words under the icon", async () => {
    renderThumbnail.mockRejectedValue(new Error("no geometry"));
    await mountApp("/models", NESTED);
    await settle();

    const tile = tiles().find((t) => t.dataset.modelTile !== undefined)!;
    expect(tile.textContent).toContain("Couldn't render");
    // A screen reader hears it from the accessible name, which replaces the
    // button's contents rather than joining them.
    expect(tile.getAttribute("aria-label")).toBe("widget.stl — failed to load");
  });

  it("raises an alert with a way to reload when the GPU drops the page's context", async () => {
    await mountApp("/models", NESTED);
    await settle();
    const alert = (): HTMLElement | null =>
      container.querySelector<HTMLElement>('[role="alert"]');
    expect(alert()).toBeNull();

    await act(async () => gpu.notify!(true));
    expect(alert()).not.toBeNull();
    expect(
      Array.from(alert()!.querySelectorAll("button")).map((b) => b.textContent),
    ).toEqual(["Reload"]);

    // And it goes when the context comes back.
    await act(async () => gpu.notify!(false));
    expect(alert()).toBeNull();
  });
});
