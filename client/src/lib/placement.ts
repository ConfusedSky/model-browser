/**
 * Where the grid was left, and how to put it back (retrace-placement D1/D4/D5).
 * An anchor tile and an offset rather than a scroll offset, so it degrades to
 * "the same tile in the same place" when a resize moved the rows.
 *
 * The DOM adapters never throw: a placement is a convenience, and a failed one
 * must leave the app where a fresh landing would.
 */

/** The first tile crossing the scrollport's top edge, and `tile.top` relative to
 *  that edge — negative while the tile is partly scrolled past. */
export interface Placement {
  anchor: string;
  offset: number;
}

/** Raised by whichever navigation ran, resolved once against the listing that
 *  actually landed (D5). */
export type PlacementRequest =
  | { kind: "top" }
  /** Back / Forward / dismiss: the entry's own remembered placement. */
  | { kind: "entry"; placement: Placement | null }
  /** ↑: the parent row's placement, and the folder the user came out of. */
  | { kind: "up"; placement: Placement | null; child: string }
  /** The existing reveal: centre the located entry. */
  | { kind: "reveal"; path: string };

/** The answer of the chain: which tile, where. */
export type Resolved =
  | { kind: "anchor"; path: string; offset: number }
  | { kind: "center"; path: string }
  | { kind: "top" };

const TOP: Resolved = { kind: "top" };

/**
 * D4's fallback chain. Presence in `entries` is the whole test, so a flat toggle
 * needs no special case: a folder anchor simply is not there and falls through.
 */
export function resolvePlacement(
  request: PlacementRequest,
  entries: ReadonlyArray<{ path: string }>,
): Resolved {
  const present = (path: string) => entries.some((e) => e.path === path);
  const anchored = (placement: Placement | null): Resolved | null =>
    placement && present(placement.anchor)
      ? { kind: "anchor", path: placement.anchor, offset: placement.offset }
      : null;
  switch (request.kind) {
    case "top":
      return TOP;
    case "entry":
      return anchored(request.placement) ?? TOP;
    case "up":
      return (
        anchored(request.placement) ??
        (present(request.child) ? { kind: "center", path: request.child } : TOP)
      );
    case "reveal":
      return present(request.path)
        ? { kind: "center", path: request.path }
        : TOP;
  }
}

/**
 * `tiles` is read lazily and the walk stops at the first crossing, so an adapter
 * can hand in objects that measure on access and pay one rect per tile *passed*
 * rather than one per tile in the listing (D1).
 */
export function measurePlacement(
  scrollportTop: number,
  tiles: ReadonlyArray<{ path: string; top: number; bottom: number }>,
): Placement | null {
  for (const tile of tiles) {
    if (tile.bottom > scrollportTop)
      return { anchor: tile.path, offset: tile.top - scrollportTop };
  }
  return null;
}

const TILE_ATTR = "data-entry-tile";

/** Not a selector on the path: happy-dom's selector parser refuses the escapes
 *  a realistic library path needs, so the suite could not exercise one. */
export function tilesIn(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>(`[${TILE_ATTR}]`));
}

export function findTile(
  scroller: HTMLElement,
  path: string,
): HTMLElement | null {
  return (
    tilesIn(scroller).find((el) => el.getAttribute(TILE_ATTR) === path) ?? null
  );
}

/** Rects are read as the walk reaches them. */
export function measureIn(scroller: HTMLElement): Placement | null {
  try {
    const scrollportTop = scroller.getBoundingClientRect().top;
    const tiles = tilesIn(scroller).map((el) => {
      let rect: DOMRect | null = null;
      const measure = () => (rect ??= el.getBoundingClientRect());
      return {
        path: el.getAttribute(TILE_ATTR) ?? "",
        get top() {
          return measure().top;
        },
        get bottom() {
          return measure().bottom;
        },
      };
    });
    return measurePlacement(scrollportTop, tiles);
  } catch {
    return null;
  }
}

/**
 * Instant, never smooth: the listing has only just appeared, and a glide over
 * it is a distraction rather than an orientation. False where the tile is not in
 * the grid or nothing could be measured, so the caller treats the landing as
 * fresh; never throws.
 */
export function applyIn(scroller: HTMLElement, resolved: Resolved): boolean {
  try {
    if (resolved.kind === "top") {
      scroller.scrollTop = 0;
      return true;
    }
    const tile = findTile(scroller, resolved.path);
    if (!tile) return false;
    const scrollerRect = scroller.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    if (!scrollerRect || !tileRect) return false;
    const want =
      resolved.kind === "anchor"
        ? resolved.offset
        : (scroller.clientHeight - tileRect.height) / 2;
    scroller.scrollTop += tileRect.top - scrollerRect.top - want;
    return true;
  } catch {
    return false;
  }
}
