// @vitest-environment happy-dom
// directory-browsing: *A location that cannot be opened says so in the grid's
// place* — only where no listing landed, never over an empty folder that did.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirListing } from "../../shared/types";
import {
  container,
  listDir,
  mountApp,
  mountAppAtCurrentUrl,
  pathInput,
  pressEnter,
  settle,
  type,
  unmountApp,
} from "./appHarness";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

const EMPTY: DirListing = { path: "/models", entries: [] };

afterEach(() => unmountApp());

describe("a location that cannot be opened", () => {
  it("says so, with a way to the library, when a link names one that is gone", async () => {
    const mounted = mountAppAtCurrentUrl("/?path=%2Fnope", EMPTY);
    // Set after the mount's own default and before its first request.
    listDir.mockRejectedValue(new Error("no such path: /nope"));
    await mounted;
    await settle();

    expect(container.textContent).toContain("Couldn't open “nope”.");
    expect(container.textContent).toContain("Go to the library");
  });

  it("leaves an empty folder that did land as it is when a typed path fails", async () => {
    await mountApp("/models", EMPTY);
    await settle();
    listDir.mockRejectedValueOnce(new Error("no such path: /models/nope"));
    await type(pathInput(), "/models/nope");
    await pressEnter(pathInput());
    await settle();

    expect(container.textContent).toContain("no such path: /models/nope");
    expect(container.textContent).not.toContain("Couldn't open");
    expect(container.textContent).toContain("Nothing here.");
  });
});
