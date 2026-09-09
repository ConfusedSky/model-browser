/**
 * The trail: a session mirror of the history stack (`retrace-placement` D2).
 *
 * The browser hands a page the `state` of the **current** entry and nothing
 * else, and ↑ needs to read entries behind it — the visit that led here, which
 * D3 finds by walking back to the nearest entry whose listing is the parent. So
 * `commitUrl` stamps an index into every entry's state and this module keeps
 * one row per index: `{ idx, listing, placement }`, where `listing` is the view
 * minus its model serialized as `sameListing` compares (`listingKey`).
 *
 * A push at index *i* drops every row at or above *i* before appending, because
 * that is what the browser does to Forward on a push — the pruning is what
 * guarantees the walk never sees a branch the user left. A replace keeps the
 * row's placement only while its listing is unchanged: a `replaceState` that
 * re-names the entry is a different listing, and the old anchor would be wrong.
 *
 * `sessionStorage`, because it has history state's lifetime: a tab is a
 * session, state survives a reload and so does the mirror, a new tab starts
 * clean. One JSON array under `TRAIL_KEY`, capped by dropping the lowest indices.
 *
 * Nothing here may throw (`stored.ts`'s posture). Storage can be absent or
 * refused, and so can the property access itself; a read that cannot happen
 * reads as an empty trail, a write that cannot happen is dropped, and a
 * malformed value reads as empty. An index the trail does not know answers
 * `null`, which the caller lands as the top — fresh, never wrong.
 */
import { serializeView } from './urlState'
import { toUrlView, type View } from '../state/view'

/** An anchor tile and its offset from the scrollport's top edge (D1). Structurally
 *  the record `placement.ts` measures; declared here so this module stands alone. */
export interface Placement {
  anchor: string
  offset: number
}

export interface TrailRow {
  idx: number
  listing: string
  placement: Placement | null
}

/** Just the three calls used here, so a test can pass a plain object. */
export type TrailStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const TRAIL_KEY = 'mb:trail'
export const TRAIL_CAP = 300

/** The entry's listing as `sameListing` compares it: the view minus its model. */
export function listingKey(view: View): string {
  return serializeView(toUrlView({ ...view, model: null }))
}

function browserStorage(): TrailStorage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    // Accessing the property itself throws where site data is blocked.
    return null
  }
}

function isPlacement(value: unknown): value is Placement {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return typeof p.anchor === 'string' && typeof p.offset === 'number'
}

function isRow(value: unknown): value is TrailRow {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.idx === 'number' &&
    typeof r.listing === 'string' &&
    (r.placement === null || isPlacement(r.placement))
  )
}

/** The rows, ascending by index; anything unreadable or malformed is empty. */
function readRows(storage: TrailStorage | null): TrailRow[] {
  if (storage === null) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TRAIL_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRow).sort((a, b) => a.idx - b.idx)
  } catch {
    return []
  }
}

function writeRows(storage: TrailStorage | null, rows: TrailRow[]): void {
  if (storage === null) return
  try {
    storage.setItem(TRAIL_KEY, JSON.stringify(rows.slice(-TRAIL_CAP)))
  } catch {
    // Storage refused the write — the trail is simply not kept.
  }
}

/** A new entry at `idx`: prune every row at or above it, append it with no placement. */
export function trailPush(idx: number, listing: string, storage = browserStorage()): void {
  const rows = readRows(storage).filter((r) => r.idx < idx)
  rows.push({ idx, listing, placement: null })
  writeRows(storage, rows)
}

/** The entry at `idx` now names `listing` (a boot seed, a `replaceState`). Its
 *  placement survives only if the listing is unchanged. */
export function trailReplace(idx: number, listing: string, storage = browserStorage()): void {
  const rows = readRows(storage)
  const row = rows.find((r) => r.idx === idx)
  if (row === undefined) rows.push({ idx, listing, placement: null })
  else if (row.listing === listing) return
  else Object.assign(row, { listing, placement: null })
  writeRows(storage, rows.sort((a, b) => a.idx - b.idx))
}

/** File the entry's placement. An index the trail does not know is ignored, never invented. */
export function trailRecord(idx: number, placement: Placement | null, storage = browserStorage()): void {
  const rows = readRows(storage)
  const row = rows.find((r) => r.idx === idx)
  if (row === undefined) return
  row.placement = placement
  writeRows(storage, rows)
}

/** The entry's placement, `null` when unknown. */
export function trailPlacement(idx: number, storage = browserStorage()): Placement | null {
  return readRows(storage).find((r) => r.idx === idx)?.placement ?? null
}

/** The nearest row below `fromIdx` whose listing is `listing` — the visit that led here (D3). */
export function trailWalkBack(fromIdx: number, listing: string, storage = browserStorage()): TrailRow | null {
  const rows = readRows(storage)
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row !== undefined && row.idx < fromIdx && row.listing === listing) return row
  }
  return null
}
