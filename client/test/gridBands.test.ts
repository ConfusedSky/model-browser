// Bands from the grid's row layout (grid-virtualization D4): which rows meet
// the viewport and the near band, and the band each entry takes from them.
import { describe, expect, it } from "vitest";
import type { DirEntry } from "../../shared/types";
import {
  bandsForRows,
  layoutRanges,
  rowsMeeting,
  type RowExtent,
} from "../src/lib/gridBands";

const entry = (path: string, kind: DirEntry["kind"]): DirEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  kind,
  size: 1,
  mtime: 1,
});
const model = (name: string): DirEntry => entry(`/m/${name}`, "model");
const dir = (name: string): DirEntry => entry(`/m/${name}`, "dir");

/** `count` rows of `height`, the first starting at `margin` — TanStack's
 *  measurements, whose starts carry the scroll margin. */
function laidOut(count: number, height: number, margin = 0): RowExtent[] {
  return Array.from({ length: count }, (_, i) => ({
    start: margin + i * height,
    end: margin + (i + 1) * height,
  }));
}

describe("rowsMeeting", () => {
  const rows = laidOut(10, 100);

  it("takes the rows a window meets, edges half-open", () => {
    expect(rowsMeeting(rows, 0, 100)).toEqual({ first: 0, last: 0 });
    expect(rowsMeeting(rows, 50, 250)).toEqual({ first: 0, last: 2 });
    // A row ending at the window's top, or starting at its bottom, is out.
    expect(rowsMeeting(rows, 100, 300)).toEqual({ first: 1, last: 2 });
  });

  it("clips at the ends of the grid", () => {
    expect(rowsMeeting(rows, -500, 150)).toEqual({ first: 0, last: 1 });
    expect(rowsMeeting(rows, 850, 5000)).toEqual({ first: 8, last: 9 });
  });

  it("is null when the window misses every row, or there are none", () => {
    expect(rowsMeeting(rows, 1000, 1200)).toBeNull();
    expect(rowsMeeting(laidOut(3, 100, 500), 0, 500)).toBeNull();
    expect(rowsMeeting([], 0, 100)).toBeNull();
  });
});

describe("layoutRanges", () => {
  it("grows the near band two viewports each side of the one on screen", () => {
    // Rows of 100 below a 250px margin; the view is 200 tall at 850.
    const rows = laidOut(40, 100, 250);
    const { visible, near } = layoutRanges(rows, 850, 200);
    // On screen: 850–1050, rows starting at 850 (6) through 1050 exclusive (7).
    expect(visible).toEqual({ first: 6, last: 7 });
    // Near: 450–1450, rows 2 through 11.
    expect(near).toEqual({ first: 2, last: 11 });
  });

  it("reports nothing on screen for a grid wholly below the view", () => {
    const rows = laidOut(5, 100, 1000);
    expect(layoutRanges(rows, 0, 200)).toEqual({
      visible: null,
      near: null,
    });
    expect(layoutRanges(rows, 700, 200)).toEqual({
      visible: null,
      near: { first: 0, last: 2 },
    });
  });

  it("is null both ways for a viewport with no height", () => {
    expect(layoutRanges(laidOut(5, 100), 0, 0)).toEqual({
      visible: null,
      near: null,
    });
  });
});

describe("bandsForRows", () => {
  const NONE = new Map<string, DirEntry[]>();

  it("ranks a folder near when its row is within the band but not on screen", () => {
    // Row 2 is in the near range only — past the rows a grid would mount.
    const rows = [[model("a")], [model("b")], [dir("k")]];
    const bands = bandsForRows(
      rows,
      { first: 0, last: 0 },
      { first: 0, last: 2 },
      NONE,
    );
    expect(bands.get("/m/k")).toBe("near");
    expect(bands.get("/m/b")).toBe("near");
    expect(bands.get("/m/a")).toBe("visible");
  });

  it("ranks a model far down the listing far, never leaving it out", () => {
    const rows = Array.from({ length: 50 }, (_, i) => [model(`m${i}`)]);
    const bands = bandsForRows(
      rows,
      { first: 0, last: 1 },
      { first: 0, last: 5 },
      NONE,
    );
    expect(bands.get("/m/m49")).toBe("far");
    expect(bands.size).toBe(50);
  });

  it("gives every entry far when no range is known", () => {
    const bands = bandsForRows([[model("a"), dir("k")]], null, null, NONE);
    expect([...bands.values()]).toEqual(["far", "far"]);
  });

  it("ranks a folder's preview cells one step farther than the folder", () => {
    const previews = new Map([["/m/k", [model("k/p")]]]);
    const on = bandsForRows(
      [[dir("k")]],
      { first: 0, last: 0 },
      { first: 0, last: 0 },
      previews,
    );
    expect(on.get("/m/k/p")).toBe("near");
    const near = bandsForRows(
      [[dir("k")]],
      null,
      { first: 0, last: 0 },
      previews,
    );
    expect(near.get("/m/k/p")).toBe("far");
  });

  it("gives a model shown as a far tile and as a visible folder's cell the cell's band", () => {
    // The cell is nearer: `near` beats the tile's own `far`.
    const previews = new Map([["/m/k", [model("x")]]]);
    const rows = [[dir("k")], [model("y")], [model("x")]];
    const bands = bandsForRows(
      rows,
      { first: 0, last: 0 },
      { first: 0, last: 0 },
      previews,
    );
    expect(bands.get("/m/x")).toBe("near");
  });

  it("keeps a visible tile visible when it is also a far folder's cell", () => {
    // The tile is nearer. Cells are banded after every tile, so here the
    // folder's `far` is the later write: last-write-wins would demote x.
    // Both listing orders, folder before and after the tile.
    const previews = new Map([["/m/k", [model("x")]]]);
    for (const rows of [
      [[dir("k")], [model("pad")], [model("x")]],
      [[model("x")], [model("pad")], [dir("k")]],
    ]) {
      const xRow = rows.findIndex((r) => r[0]!.path === "/m/x");
      const bands = bandsForRows(
        rows,
        { first: xRow, last: xRow },
        { first: xRow, last: xRow },
        previews,
      );
      expect(bands.get("/m/k")).toBe("far");
      expect(bands.get("/m/x")).toBe("visible");
    }
  });
});
