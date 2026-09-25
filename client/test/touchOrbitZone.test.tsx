// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import Grid from "../src/components/Grid";
import { model } from "./appHarness";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

let host: HTMLElement;
let root: Root;
const ENTRY = model("one.stl");

async function renderGrid() {
  const onModelPointerDown = vi.fn();
  const onModelOpen = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <Grid
        entries={[ENTRY]}
        thumbs={new Map()}
        onEnter={() => {}}
        onModelPointerDown={onModelPointerDown}
        onModelOpen={onModelOpen}
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
  return { onModelPointerDown, onModelOpen };
}

const tile = (): HTMLElement => host.querySelector("[data-model-tile]")!;
const zone = (): HTMLElement => host.querySelector("[data-orbit-zone]")!;

async function press(el: HTMLElement, pointerType: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType }),
    );
  });
}
async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("a model tile under a finger", () => {
  it("lets the band around the picture scroll the page, and pans nothing inside it", async () => {
    await renderGrid();
    // The tile pans; its middle does not, so a drag there is the model's.
    expect(tile().className).toContain("touch-pan-y");
    expect(zone().className).toContain("touch-none");
    expect(tile().contains(zone())).toBe(true);
  });

  it("turns the model from the middle, and takes a tap on the band as opening it", async () => {
    const { onModelPointerDown, onModelOpen } = await renderGrid();

    await press(zone(), "touch");
    expect(onModelPointerDown).toHaveBeenCalledTimes(1);

    await press(tile(), "touch");
    expect(onModelPointerDown).toHaveBeenCalledTimes(1);
    await click(tile());
    expect(onModelOpen).toHaveBeenCalledTimes(1);
  });

  it("leaves the whole tile to a mouse, as before", async () => {
    const { onModelPointerDown, onModelOpen } = await renderGrid();
    await press(tile(), "mouse");
    expect(onModelPointerDown).toHaveBeenCalledTimes(1);
    // A mouse press's click is the overlay's to promote, never the tile's.
    await click(tile());
    expect(onModelOpen).not.toHaveBeenCalled();
  });
});
