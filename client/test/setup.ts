// Every happy-dom cell starts with a grid geometry tall enough to mount every
// row of its listing, so a cell that mounts `Grid` without asking never meets a
// 0×0 scroller (grid-virtualization D13). Node-environment files have no DOM
// to stub.
import { afterEach, beforeEach } from "vitest";
import {
  DEFAULT_GRID_GEOMETRY,
  installGridGeometry,
  resetGridGeometry,
} from "./gridGeometry";

if (typeof HTMLElement !== "undefined") {
  beforeEach(() => installGridGeometry(DEFAULT_GRID_GEOMETRY));
  afterEach(() => resetGridGeometry());
}
