/**
 * Where the grid was left, and how to put it back (retrace-placement D1, D4, D5).
 *
 * A placement is an anchor tile and an offset, not a scroll offset: the first
 * tile whose box crosses the scrollport's top edge, and how far above that edge
 * its top sits. It reproduces the pixel position when nothing changed and
 * degrades to "the same tile in the same place" when a resize or a listing
 * change moved the rows.
 *
 * Three pure pieces and two DOM adapters. `measurePlacement` and
 * `resolvePlacement` know nothing about the DOM so the fallback chain can be
 * asserted cell by cell; `measureIn` and `applyIn` read and set the real
 * scroller and never throw — a placement is a convenience, and a failed one
 * must leave the app exactly where a fresh landing would (the top).
 */

/** The first tile crossing the scrollport's top edge and `tile.top − scrollport.top`
 *  (zero or negative while the tile is partly scrolled past; positive only when the
 *  listing is shorter than the scrollport and the first tile sits below a notice). */
export interface Placement {
  anchor: string
  offset: number
}

/** What a navigation asks the landing to do. Raised by whichever navigation ran,
 *  resolved once against the listing that actually landed (D5). */
export type PlacementRequest =
  | { kind: 'top' }
  /** Back / Forward / dismiss: the entry's own remembered placement. */
  | { kind: 'entry'; placement: Placement | null }
  /** ↑: the parent row's placement, and the folder the user came out of. */
  | { kind: 'up'; placement: Placement | null; child: string }
  /** The existing reveal: centre the located entry. */
  | { kind: 'reveal'; path: string }

/** The answer of the chain: which tile, where. */
export type Resolved =
  | { kind: 'anchor'; path: string; offset: number }
  | { kind: 'center'; path: string }
  | { kind: 'top' }

const TOP: Resolved = { kind: 'top' }

/**
 * D4's fallback chain. Presence in `entries` is the whole test — an anchor that
 * is a model survives a flat toggle, one that is a folder does not exist in flat
 * and falls through — so there is no flat comparison and no special case here.
 *
 *   up      anchor present → it at its offset; child present → child centred; else top
 *   entry   anchor present → it at its offset; else top
 *   reveal  path present → centred; else top
 *   top     top
 */
export function resolvePlacement(
  request: PlacementRequest,
  entries: ReadonlyArray<{ path: string }>,
): Resolved {
  const present = (path: string) => entries.some((e) => e.path === path)
  const anchored = (placement: Placement | null): Resolved | null =>
    placement && present(placement.anchor)
      ? { kind: 'anchor', path: placement.anchor, offset: placement.offset }
      : null
  switch (request.kind) {
    case 'top':
      return TOP
    case 'entry':
      return anchored(request.placement) ?? TOP
    case 'up':
      return (
        anchored(request.placement) ??
        (present(request.child) ? { kind: 'center', path: request.child } : TOP)
      )
    case 'reveal':
      return present(request.path) ? { kind: 'center', path: request.path } : TOP
  }
}

/**
 * The first tile in document order whose bottom lies below the scrollport's top
 * edge is the anchor; its offset is `top − scrollportTop`. No tiles, or every
 * tile scrolled fully past (a listing that shrank under the scroller), is null.
 *
 * `tiles` is read lazily — the walk stops at the first crossing — so an adapter
 * can hand in objects whose `top`/`bottom` measure on access and pay for one rect
 * per tile passed, not one per tile in the listing (D1's cost argument).
 */
export function measurePlacement(
  scrollportTop: number,
  tiles: ReadonlyArray<{ path: string; top: number; bottom: number }>,
): Placement | null {
  for (const tile of tiles) {
    if (tile.bottom > scrollportTop) return { anchor: tile.path, offset: tile.top - scrollportTop }
  }
  return null
}

const TILE_ATTR = 'data-entry-tile'

/**
 * Every tile the grid drew, in document order. Not a selector on the path:
 * library paths carry spaces, quotes and `!/`, and a quoted attribute value with
 * `CSS.escape`'s backslash escapes is refused by happy-dom's selector parser
 * (`is not a valid selector`, probed 2026-09-09), so the suite could not exercise
 * a selector-based lookup with a realistic path. Exact attribute equality is the
 * same test `resolvePlacement` makes on `entries`, and the walk is the one
 * `measureIn` already does.
 */
function tilesIn(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>(`[${TILE_ATTR}]`))
}

function findTile(scroller: HTMLElement, path: string): HTMLElement | null {
  return tilesIn(scroller).find((el) => el.getAttribute(TILE_ATTR) === path) ?? null
}

/** `measurePlacement` over the scroller's tiles, rects read as the walk reaches them. */
export function measureIn(scroller: HTMLElement): Placement | null {
  try {
    const scrollportTop = scroller.getBoundingClientRect().top
    const tiles = tilesIn(scroller).map((el) => {
      let rect: DOMRect | null = null
      const measure = () => (rect ??= el.getBoundingClientRect())
      return {
        path: el.getAttribute(TILE_ATTR) ?? '',
        get top() {
          return measure().top
        },
        get bottom() {
          return measure().bottom
        },
      }
    })
    return measurePlacement(scrollportTop, tiles)
  } catch {
    return null
  }
}

/**
 * Set the scroller so the resolved tile sits where it should: for `anchor`, its
 * top `offset` px from the scrollport's top edge; for `center`, in the middle of
 * the scrollport. Instant, never smooth — the listing has only just appeared,
 * and a glide over sixty rows is a distraction rather than an orientation (the
 * reveal's own reasoning). `top` is `scrollTop = 0`.
 *
 * True when it placed; false when the tile is not in the grid or nothing could
 * be measured, so the caller may treat the landing as fresh. Never throws.
 */
export function applyIn(scroller: HTMLElement, resolved: Resolved): boolean {
  try {
    if (resolved.kind === 'top') {
      scroller.scrollTop = 0
      return true
    }
    const tile = findTile(scroller, resolved.path)
    if (!tile) return false
    const scrollerRect = scroller.getBoundingClientRect()
    const tileRect = tile.getBoundingClientRect()
    if (!scrollerRect || !tileRect) return false
    const want =
      resolved.kind === 'anchor'
        ? resolved.offset
        : (scroller.clientHeight - tileRect.height) / 2
    scroller.scrollTop += tileRect.top - scrollerRect.top - want
    return true
  } catch {
    return false
  }
}
