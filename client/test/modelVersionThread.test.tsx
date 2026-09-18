// @vitest-environment happy-dom
//
// The version end to end in the mounted app, on both routes that reach the
// mesh: the thumbnail sweep's render job, and a hover past the linger. A file
// of its own rather than cells in `thumbnailQueue.test.tsx` — that suite drives
// the hook against a `fakeLru` with no loader, so the real `MeshLru` and
// `meshLoader` these ride through are exactly what it lacks. The mtime is
// fractional because the server compares the value exactly (`byteTiers`), so a
// rounded version is one no source ever had and nothing would be pinned (D5).
import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DirListing } from "../../shared/types";
import {
  fetchModelGlb,
  getThumb,
  model,
  mountApp,
  settle,
  tiles,
  unmountApp,
  wait,
} from "./appHarness";
// Imported after `./appHarness` on purpose (client/test/CLAUDE.md): with a
// `../src/...` module first, its mock factory is what loads the harness and the
// app's own importers get the real renderer.
import { resetLookupQueueForTests } from "../src/hooks/useThumbnails";
import { HOVER_LINGER_MS } from "../src/lib/hover";
import { RIG_VERSION, THUMB_LIGHTING } from "../src/three/renderer";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

/** What a listing really reports: a millisecond time with a fractional part. */
const MTIME = 1789446597239.1736;
const HERO = { ...model("hero.stl"), mtime: MTIME };
const LISTING: DirListing = { path: "/models", entries: [HERO] };

/** A complete hit under the recipe in force: the sweep draws nothing for it, so
 *  a mesh fetch in that cell can only be the hover's. */
const HIT = {
  status: "hit",
  pngUrl: "blob:hero",
  lighting: THUMB_LIGHTING,
  rig: RIG_VERSION,
};

beforeEach(() => {
  // The queue is module-level and ranked, and the render queue's far gate reads
  // it — a lookup left pending by an earlier file would close the gate here and
  // no render job would ever reach the LRU (client/test/CLAUDE.md).
  resetLookupQueueForTests();
});
afterEach(async () => {
  await unmountApp();
  // Shared across this file's cells and not restored by `unmountApp`.
  getThumb.mockResolvedValue({ status: "miss" });
});

describe("the version the listing reported reaches the request", () => {
  it("fetches a tile’s mesh under that entry’s mtime, fraction and all", async () => {
    // The harness's `getThumb` misses by default, which is what pushes the
    // render job the version rides through.
    await mountApp("/models", LISTING);
    await settle();

    expect(fetchModelGlb).toHaveBeenCalledTimes(1);
    // The whole argument list, so a hop that dropped the version fails here
    // rather than passing on the path alone.
    expect(fetchModelGlb.mock.calls[0]).toEqual([HERO.path, MTIME]);
  });

  it("warms a hovered tile’s mesh under that entry’s mtime, fraction and all", async () => {
    getThumb.mockResolvedValue(HIT);
    await mountApp("/models", LISTING);
    await settle();
    // Nothing else may reach the fetcher, or the assertion below would pass on
    // the sweep's call whatever the tile handed the warmer.
    expect(fetchModelGlb).not.toHaveBeenCalled();

    // React synthesizes `onPointerEnter` from `pointerover`, so that is the
    // event a hover is — a dispatched `pointerenter` reaches no handler.
    await act(async () => {
      tiles()[0]!.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true }),
      );
    });
    await wait(HOVER_LINGER_MS + 40);

    expect(fetchModelGlb).toHaveBeenCalledTimes(1);
    expect(fetchModelGlb.mock.calls[0]).toEqual([HERO.path, MTIME]);
  });
});
