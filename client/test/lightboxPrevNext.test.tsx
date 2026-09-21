// @vitest-environment happy-dom
// Lightbox prev/next stepping (lightbox-sibling-stepping). The lightbox steps to
// the previous/next MODEL of the shown listing, in grid order, on ArrowLeft/Right
// and two on-screen affordances — staying open, skipping interleaved dirs/zips,
// stopping (disabled) at the ends, persisting the leaving model exactly as a
// close does, and following the URL in place. Helper idioms are urlLightbox's.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry, DirListing, OverrideCredits } from "../../shared/types";
import {
  container,
  deferred,
  dir,
  fetchModel,
  listDir,
  model,
  mountApp,
  overrides,
  putThumb,
  settle,
  tinyStl,
  unmountApp,
  wait,
} from "./appHarness";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

function zipEntry(name: string): DirEntry {
  return { name, path: `/models/${name}`, kind: "zip", size: 0, mtime: 1 };
}

// Two models, then an interleaved dir and zip, then two more models. The
// siblings the lightbox steps among are m0..m3 in this order; the dir and zip
// sit between m0 and m1 so a forward step from m0 must skip both.
const M0 = "/models/m0.stl";
const M1 = "/models/m1.stl";
const M2 = "/models/m2.stl";
const M3 = "/models/m3.stl";
const LISTING: DirListing = {
  path: "/models",
  entries: [
    model("m0.stl"),
    dir("sub"),
    zipEntry("arc.zip"),
    model("m1.stl"),
    model("m2.stl"),
    model("m3.stl"),
  ],
};

const dialog = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[role="dialog"]');
/** Which model the dialog is showing — the dialog's accessible name is the entry name. */
const shownName = (): string | null =>
  dialog()?.getAttribute("aria-label") ?? null;
const search = (): string => window.location.search;
const pop = (): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
const prevButton = (): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Previous model"]',
  )!;
const nextButton = (): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Next model"]',
  )!;
const axisGroup = (): Element | null =>
  dialog()?.querySelector('[aria-label="Orbit axis"]') ?? null;
const spinner = (): Element | null =>
  dialog()?.querySelector(".animate-spin") ?? null;
const closeButton = (): HTMLButtonElement =>
  dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
const copyPathButton = (): HTMLButtonElement =>
  dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Copy path"]')!;
const creditLink = (field: string): HTMLAnchorElement =>
  dialog()!.querySelector<HTMLAnchorElement>(`[data-credit="${field}"] a`)!;

/** A kit credited in all three linked fields, so the panel draws three anchors. */
const CREDITS: OverrideCredits = {
  author: "Valandar",
  authorUrl: "https://www.thingiverse.com/Valandar",
  license: "Creative Commons - Attribution",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  sourceUrl: "https://www.thingiverse.com/thing:3750572",
};

/** The first `<button>` after the metadata list, read from the DOM rather than
 *  named: which group draws it depends on the feature report and on whether any
 *  app resolved, and the ring's shape is what these cells are about. */
function buttonAfterCredits(): HTMLButtonElement {
  const dl = dialog()!.querySelector("dl")!;
  return Array.from(dialog()!.querySelectorAll("button")).find(
    (b) => dl.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  )!;
}

const pressTab = (opts: KeyboardEventInit = {}): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ...opts }));
  });

/** The dialog's ring is finite, so a walk that cannot reach its target has to
 *  end in a failure rather than spin. */
const RING_CAP = 40;
async function tabTo(target: HTMLElement): Promise<void> {
  for (let i = 0; i < RING_CAP; i++) {
    await pressTab();
    if (document.activeElement === target) return;
  }
  throw new Error(
    `focus never reached ${target.getAttribute("aria-label") ?? target.tagName} in ${RING_CAP} presses`,
  );
}

/** The persist's own write for a path, told apart from the sweep's: a camera
 *  rides only on a persist, never on a background render. */
const cameraWrites = (path: string): unknown[] =>
  putThumb.mock.calls
    .map(([b]) => b as { path: string; camera?: unknown })
    .filter(
      (b) => b.path === path && b.camera !== undefined && b.camera !== null,
    );

function modelTile(path: string): HTMLElement {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-model-tile]"),
  ).find((t) => t.getAttribute("data-model-tile") === path)!;
}

/** Keyboard open: Enter on the tile promotes straight into lightbox mode. */
async function openModel(path: string): Promise<void> {
  await act(async () => {
    modelTile(path).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await wait(200);
  await settle();
  expect(dialog()).not.toBeNull();
}

async function pressArrow(
  key: "ArrowLeft" | "ArrowRight",
  opts: KeyboardEventInit = {},
): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...opts }));
  });
  await wait(200);
  await settle();
}

/** Drag on the open lightbox's canvas, then clear the release's own write: an
 *  untouched view writes nothing, so it is a write after this that proves a step
 *  persisted the leaving model. */
async function orbit(): Promise<void> {
  const canvas = dialog()!.querySelector<HTMLElement>(".cursor-grab")!;
  await act(async () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
  });
  await act(async () => {
    const move = (x: number, y: number): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: x,
          clientY: y,
        }),
      );
    };
    move(160, 100); // beyond the drag threshold
    move(200, 120);
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: 200,
        clientY: 120,
      }),
    );
  });
  await settle();
  putThumb.mockClear();
}

beforeEach(async () => {
  await mountApp("/models", LISTING);
});
afterEach(async () => {
  await unmountApp();
});

describe("lightbox sibling stepping", () => {
  it("arrow keys step to the neighbour and back, and the URL follows", async () => {
    await openModel(M1);
    expect(shownName()).toBe("m1.stl");

    await pressArrow("ArrowRight");
    expect(dialog()).not.toBeNull();
    expect(shownName()).toBe("m2.stl");
    expect(search()).toContain("model=%2Fmodels%2Fm2.stl");

    await pressArrow("ArrowLeft");
    expect(shownName()).toBe("m1.stl");
    expect(search()).toContain("model=%2Fmodels%2Fm1.stl");
  });

  it("a forward step skips an interleaved dir and zip (model-only)", async () => {
    await openModel(M0);
    await pressArrow("ArrowRight");
    expect(shownName()).toBe("m1.stl"); // the dir and zip between m0 and m1 were skipped
  });

  it("the first model has a disabled previous control and ArrowLeft is a no-op", async () => {
    await openModel(M0);
    expect(prevButton().disabled).toBe(true);
    await pressArrow("ArrowLeft");
    expect(dialog()).not.toBeNull();
    expect(shownName()).toBe("m0.stl");
  });

  it("the last model has a disabled next control and ArrowRight is a no-op", async () => {
    await openModel(M3);
    expect(nextButton().disabled).toBe(true);
    await pressArrow("ArrowRight");
    expect(dialog()).not.toBeNull();
    expect(shownName()).toBe("m3.stl");
  });

  it("Alt+ArrowRight is left to the browser and does not step", async () => {
    await openModel(M1);
    await pressArrow("ArrowRight", { altKey: true });
    expect(shownName()).toBe("m1.stl");
  });

  it("the on-screen arrows match the keys", async () => {
    await openModel(M1);
    await act(async () => nextButton().click());
    await wait(200);
    await settle();
    expect(shownName()).toBe("m2.stl");
    await act(async () => prevButton().click());
    await wait(200);
    await settle();
    expect(shownName()).toBe("m1.stl");
  });

  it("several steps never close the lightbox", async () => {
    await openModel(M0);
    await pressArrow("ArrowRight");
    await pressArrow("ArrowRight");
    await pressArrow("ArrowRight");
    expect(dialog()).not.toBeNull();
    expect(shownName()).toBe("m3.stl");
    expect(nextButton().disabled).toBe(true);
  });

  it("a step after an orbit persists the LEAVING model, not the neighbour", async () => {
    await openModel(M1);
    await orbit(); // clears the release's own write
    await pressArrow("ArrowRight");
    expect(cameraWrites(M1).length).toBeGreaterThan(0); // the leaving model was written
    expect(cameraWrites(M2)).toHaveLength(0); // the neighbour was not
  });

  it("a step without a manipulation writes nothing", async () => {
    await openModel(M1);
    putThumb.mockClear();
    await pressArrow("ArrowRight");
    expect(cameraWrites(M1)).toHaveLength(0);
  });

  it("a close landing inside a step persist does not re-open and leaves no model param", async () => {
    await openModel(M1);
    await orbit();
    // Hold the leaving model's persist so a close can race into its window.
    const held = deferred<Record<string, unknown>>();
    putThumb.mockReturnValueOnce(held.promise);

    await pressArrow("ArrowRight"); // goTo parks at onPersist(held)

    // The user closes: browser back drops the model param and fires popstate.
    window.history.replaceState(window.history.state, "", "/?path=%2Fmodels");
    await pop();
    await wait(50);

    // The persist now completes.
    await act(async () => {
      held.resolve({});
    });
    await wait(200);
    await settle();

    expect(dialog()).toBeNull(); // stayed closed — the pending step did not re-open it
    expect(search()).not.toContain("model="); // and left no neighbour parameter behind
  });

  it("a step to a cold neighbour shows the spinner, not the last frame", async () => {
    // M2 must be genuinely cold: the thumbnail sweep warms every model's mesh
    // through the LRU on mount, so the held loader has to be in place before the
    // mount, or the step finds M2 already cached. Remount with it set.
    await unmountApp();
    const held = deferred<ArrayBuffer>();
    fetchModel.mockImplementation((p: string) =>
      p === M2 ? held.promise : Promise.resolve(tinyStl()),
    );
    await mountApp("/models", LISTING);
    await openModel(M1);

    await pressArrow("ArrowRight");
    expect(shownName()).toBe("m2.stl");
    expect(spinner()).not.toBeNull(); // a loading indicator, not m1's frozen frame
    expect(axisGroup()).toBeNull(); // the axis group is gated on the session, which is not up

    await act(async () => {
      held.resolve(tinyStl());
    });
    await wait(200);
    await settle();
    expect(axisGroup()).not.toBeNull(); // orbitable once the mesh lands
    expect(spinner()).toBeNull();
  });

  it("a step adds no history entry, and a popstate still closes the lightbox", async () => {
    await openModel(M1);
    const len = window.history.length;
    await pressArrow("ArrowRight");
    expect(window.history.length).toBe(len); // replace, not push

    // Browser back: the URL rewinds and popstate fires — the lightbox closes.
    window.history.replaceState(null, "", "/?path=%2Fmodels");
    await pop();
    await wait(200);
    expect(dialog()).toBeNull();
  });

  it("a close after stepping returns focus to the shown model tile", async () => {
    await openModel(M0);
    await pressArrow("ArrowRight");
    expect(shownName()).toBe("m1.stl");

    const back = vi.spyOn(window.history, "back").mockImplementation(() => {
      window.history.replaceState(null, "", "/?path=%2Fmodels");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
        .click();
    });
    await wait(200);
    await settle();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(modelTile(M1)); // focus returned to the shown model
    back.mockRestore();
  });

  it("Tab is not dead-stopped by a disabled end control (first model)", async () => {
    // On the first model the Previous control is disabled and first in the dialog's
    // button ring. `focus()` on a disabled button is a no-op, so a trap that kept it
    // in the ring would loop back to the dialog forever. The trap must skip it.
    await openModel(M0);
    expect(prevButton().disabled).toBe(true);
    expect(document.activeElement).toBe(dialog()); // focus grabbed on open
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    // Focus advanced off the dialog to the first *enabled* control (Next), not stuck.
    expect(document.activeElement).not.toBe(dialog());
    expect(document.activeElement).toBe(nextButton());
  });

  it("the attribution links sit in the Tab ring where the panel draws them", async () => {
    // Reachability is the smaller half: a ring that appended the anchors after
    // every button would reach all three and put them nowhere near the text
    // they credit. So the run is asserted with its neighbours on both sides —
    // Copy path before, and whatever button the panel drew after the list.
    overrides.mockResolvedValue({ credits: CREDITS });
    await openModel(M1);

    await tabTo(copyPathButton());
    for (const link of [
      creditLink("author"),
      creditLink("license"),
      creditLink("source"),
    ]) {
      await pressTab();
      expect(document.activeElement).toBe(link);
    }
    await pressTab();
    expect(document.activeElement).toBe(buttonAfterCredits());
  });

  it("Shift+Tab walks back out of the attribution links to Copy path", async () => {
    overrides.mockResolvedValue({ credits: CREDITS });
    await openModel(M1);

    await tabTo(creditLink("source"));
    for (const target of [
      creditLink("license"),
      creditLink("author"),
      copyPathButton(),
    ]) {
      await pressTab({ shiftKey: true });
      expect(document.activeElement).toBe(target);
      expect(dialog()!.contains(document.activeElement)).toBe(true);
    }
  });

  it("an uncredited model's ring is buttons only, all the way round", async () => {
    // A guard, not coverage: it passes whatever the query selects today,
    // because the panel draws nothing anchor-shaped for a model no key covers.
    // It is here to catch a later change that starts drawing one.
    await openModel(M1);
    expect(dialog()!.querySelectorAll("[data-credit]")).toHaveLength(0);

    const seen: Element[] = [];
    for (let i = 0; i < RING_CAP; i++) {
      await pressTab();
      if (document.activeElement === dialog()) break;
      seen.push(document.activeElement!);
    }
    expect(document.activeElement).toBe(dialog()); // the walk closed the loop
    expect(seen.every((el) => el.tagName === "BUTTON")).toBe(true);
    expect(seen).toContain(nextButton());
    expect(seen).toContain(copyPathButton());
    expect(seen).toContain(closeButton());
  });

  it("a second arrow during a step persist is ignored — no double persist", async () => {
    await openModel(M0);
    await orbit(); // manipulated, so the step will persist; clears the release's write
    const held = deferred<Record<string, unknown>>();
    putThumb.mockReturnValueOnce(held.promise);

    await pressArrow("ArrowRight"); // goTo#1 parks at onPersist(held); a step is in flight
    await pressArrow("ArrowRight"); // goTo#2 sees the in-flight guard and returns at once

    await act(async () => {
      held.resolve({});
    });
    await wait(200);
    await settle();

    expect(cameraWrites(M0)).toHaveLength(1); // one persist of the leaving model, not two
    expect(shownName()).toBe("m1.stl"); // advanced exactly one step
  });
});
