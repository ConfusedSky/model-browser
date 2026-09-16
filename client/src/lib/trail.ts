/**
 * A session mirror of the history stack (`retrace-placement` D2), because the
 * browser hands a page only the **current** entry's state and ↑ must read the
 * visit that led here. `commitUrl` stamps an index into every entry; this keeps
 * one row per index.
 *
 * A push at *i* drops every row at or above it, as the browser does to Forward,
 * which is what keeps the walk off a branch the user left. `sessionStorage`,
 * because it has history state's lifetime.
 *
 * Nothing here may throw (`stored.ts`'s posture): anything unreadable reads as
 * an empty trail, and an unknown index answers `null`, which lands as the top.
 */
import { serializeView } from "./urlState";
import { toUrlView, type View } from "../state/view";
import type { Placement } from "./placement";

export interface TrailRow {
  idx: number;
  listing: string;
  placement: Placement | null;
}

/** Just what is used, so a test can pass a plain object. */
export type TrailStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const TRAIL_KEY = "mb:trail";
export const TRAIL_CAP = 300;

/** The view minus its model, as `sameListing` compares it. */
export function listingKey(view: View): string {
  return serializeView(toUrlView({ ...view, model: null }));
}

function browserStorage(): TrailStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Accessing the property itself throws where site data is blocked.
    return null;
  }
}

function isPlacement(value: unknown): value is Placement {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.anchor === "string" && typeof p.offset === "number";
}

function isRow(value: unknown): value is TrailRow {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.idx === "number" &&
    typeof r.listing === "string" &&
    (r.placement === null || isPlacement(r.placement))
  );
}

/** The rows, ascending by index; anything unreadable or malformed is empty. */
function readRows(storage: TrailStorage | null): TrailRow[] {
  if (storage === null) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TRAIL_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRow).sort((a, b) => a.idx - b.idx);
  } catch {
    return [];
  }
}

function writeRows(storage: TrailStorage | null, rows: TrailRow[]): void {
  if (storage === null) return;
  try {
    storage.setItem(TRAIL_KEY, JSON.stringify(rows.slice(-TRAIL_CAP)));
  } catch {
    // Storage refused the write — the trail is simply not kept.
  }
}

/** Prunes every row at or above `idx` before appending. */
export function trailPush(
  idx: number,
  listing: string,
  storage = browserStorage(),
): void {
  const rows = readRows(storage).filter((r) => r.idx < idx);
  rows.push({ idx, listing, placement: null });
  writeRows(storage, rows);
}

/** The placement survives only while the listing is unchanged. */
export function trailReplace(
  idx: number,
  listing: string,
  storage = browserStorage(),
): void {
  const rows = readRows(storage);
  const row = rows.find((r) => r.idx === idx);
  if (row === undefined) rows.push({ idx, listing, placement: null });
  else if (row.listing === listing) return;
  else Object.assign(row, { listing, placement: null });
  writeRows(
    storage,
    rows.sort((a, b) => a.idx - b.idx),
  );
}

/** An index the trail does not know is ignored, never invented. */
export function trailRecord(
  idx: number,
  placement: Placement | null,
  storage = browserStorage(),
): void {
  const rows = readRows(storage);
  const row = rows.find((r) => r.idx === idx);
  if (row === undefined) return;
  row.placement = placement;
  writeRows(storage, rows);
}

/** `null` where the row is unknown or names another listing: a state-less entry
 *  reads as index 0, which is some other row. */
export function trailPlacement(
  idx: number,
  listing: string,
  storage = browserStorage(),
): Placement | null {
  const row = readRows(storage).find((r) => r.idx === idx);
  return row !== undefined && row.listing === listing ? row.placement : null;
}

/** The visit that led here (D3). */
export function trailWalkBack(
  fromIdx: number,
  listing: string,
  storage = browserStorage(),
): TrailRow | null {
  const rows = readRows(storage);
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row !== undefined && row.idx < fromIdx && row.listing === listing)
      return row;
  }
  return null;
}
