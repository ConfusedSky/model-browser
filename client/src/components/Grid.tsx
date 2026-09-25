import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { baseName } from "../../../shared/names";
import Icon from "./Icon";
import type { DirEntry, IndexScore } from "../../../shared/types";
import type { ThumbState } from "../hooks/useThumbnails";
import { formatCosine, formatZ } from "../lib/format";
import { nativeMenuRequested } from "../lib/gesture";
import { tilesIn } from "../lib/placement";
import {
  SCALE_BADGE,
  SCALE_SPOKEN,
  Z_LABEL,
  strengthOf,
  type ScoreScale,
} from "../lib/scoreScale";
import type { Band } from "../three/queue";

/** How far past the scrollport a tile may sit before its render ranks `far`.
 *  Wide enough that ordinary scrolling oscillation cannot flip a tile's rank
 *  back and forth, and a screen or two of travel lands on rendered tiles. */
export const FAR_ROOT_MARGIN = "200% 0px 200% 0px";

/** How near a band sorts — the per-path max ("nearest wins") compares on this. */
const NEARNESS: Record<Band, number> = { visible: 0, near: 1, far: 2 };
/** One worse than the folder's own: a sheet is decoration, and at equal bands
 *  an off-screen folder's cells beat near model tiles on listing order (D2). */
const CELL_BAND: Record<Band, Band> = {
  visible: "near",
  near: "far",
  far: "far",
};

export type TileSize = "s" | "m" | "l";
/** Whole literals, one per size, so each reaches the stylesheet. */
const GRID_CLASS: Record<TileSize, string> = {
  s: "grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 px-3 pt-1 pb-6 sm:px-4",
  m: "grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 px-3 pt-1 pb-6 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:px-4",
  l: "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 px-3 pt-1 pb-6 sm:px-4",
};

const ARROWS = new Set(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]);

/** The grid is `auto-fill`, so its columns are whatever the width yields (D2):
 *  the leading run of tiles sharing the first one's `top` is the top row. Pure
 *  over the rects, since happy-dom lays nothing out. Empty grid returns 1. */
export function columnCount(tiles: HTMLElement[]): number {
  const first = tiles[0];
  if (first === undefined) return 1;
  const top = first.getBoundingClientRect().top;
  let n = 0;
  for (const tile of tiles) {
    if (tile.getBoundingClientRect().top !== top) break;
    n++;
  }
  return n;
}

interface Props {
  entries: DirEntry[];
  thumbs: Map<string, ThumbState>;
  onEnter: (entry: DirEntry) => void;
  onModelPointerDown: (
    e: React.PointerEvent,
    entry: DirEntry,
    el: HTMLElement,
  ) => void;
  /** Keyboard activation (Enter/Space) — opens the lightbox directly. */
  onModelOpen: (entry: DirEntry, el: HTMLElement) => void;
  onModelHover: (path: string | null, mtime?: number) => void;
  /** A secondary press, or the platform's context-menu key. */
  onEntryMenu: (
    entry: DirEntry,
    el: HTMLElement,
    at: { x: number; y: number },
  ) => void;
  onImageError: (path: string) => void;
  /** Marked until the highlight fades. Never a view field (D8). */
  markedPath: string | null;
  /** Which rendered tile is the similarity subject; App prepends it. */
  anchorPath?: string;
  /** A guarded lookup rather than the raw map, so this component cannot draw a
   *  badge the anchor rule forbids. Returns the map's own object, which the
   *  memo compares by identity. */
  scoreFor: (path: string) => IndexScore | undefined;
  /** `null` where the view is not a scored one, and no tile draws a number (D3). */
  scoreScale: ScoreScale | null;
  /** What each folder tile previews (folder-contact-sheets D1). An absent path
   *  draws as an empty answer does — the folder's own icon. The arrays are the
   *  map's own, so `Tile`'s memo compares them by identity. */
  previews: ReadonlyMap<string, DirEntry[]>;
  /** Raised whenever a tile crosses the park boundary — the band observer
   *  keeps watching, so App's guard is the only thing dropping repeats (D1). */
  onPeek: (path: string) => void;
  /** Every observed tile's band, wholesale, after each observer batch (D2). */
  onBands: (bands: ReadonlyMap<string, Band>) => void;
  /** **Must be the scroller**: the intersection algorithm clips against every
   *  clipping ancestor before the root's margin applies, so a `rootMargin`
   *  against the default viewport root is inert (D2). A `RefObject` so it is
   *  stable in deps and populated during commit. */
  scrollRoot: RefObject<HTMLElement | null>;
  size?: TileSize;
  /** The raw score pair on each result, rather than the strength alone. */
  showScores?: boolean;
  /** The set's best is middling; strength words stop at "Fair". */
  modestSet?: boolean;
}

function menuAt(
  el: HTMLElement,
  e: { clientX: number; clientY: number },
): { x: number; y: number } {
  // A keyboard-raised menu reports (0, 0) — anchor it to the tile instead, so
  // it appears where the thing it acts on is.
  if (e.clientX !== 0 || e.clientY !== 0) return { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  return { x: r.left + 8, y: r.bottom - 8 };
}

/** Memoized, tiles included: a keystroke in the search box re-renders the app
 *  while nothing here changed, and a grid is hundreds of tiles. App holds the
 *  handlers by identity for exactly that. */
function Grid({
  entries,
  thumbs,
  onEnter,
  onModelPointerDown,
  onModelOpen,
  onModelHover,
  onEntryMenu,
  onImageError,
  markedPath,
  anchorPath,
  scoreFor,
  scoreScale,
  previews,
  onPeek,
  onBands,
  scrollRoot,
  size = "m",
  showScores = false,
  modestSet = false,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  /** Each observed tile's last record from each observer. A tile heard by one
   *  observer stays unreported rather than taking a band from a defaulted
   *  half. */
  const bandStateRef = useRef<
    Map<string, { inPark?: boolean; inView?: boolean }>
  >(new Map());
  /** Read inside the observer callbacks, so it cannot be an effect dep: every
   *  landed peek mints a new map and would rebuild both observers. */
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  /** Returns early while nothing is tracked: an empty report would read as
   *  "every path is unreported" over work the last one had ranked. */
  const publish = useCallback(() => {
    const state = bandStateRef.current;
    if (state.size === 0) return;
    const bands = new Map<string, Band>();
    // A path shown in two places — its own tile and a folder's preview — takes
    // the nearest band (D2).
    const put = (path: string, band: Band): void => {
      const cur = bands.get(path);
      if (cur === undefined || NEARNESS[band] < NEARNESS[cur])
        bands.set(path, band);
    };
    const shown = previewsRef.current;
    for (const [path, s] of state) {
      if (s.inPark === undefined || s.inView === undefined) continue;
      const band: Band = s.inView ? "visible" : s.inPark ? "near" : "far";
      put(path, band);
      // Preview models have no tile of their own; unregistered they would rank
      // behind every visible tile while their folder is on screen.
      const cells = shown.get(path);
      if (cells !== undefined)
        for (const cell of cells) put(cell.path, CELL_BAND[band]);
    }
    // Nothing heard by both observers yet is not a report either — the first
    // batch after a rebuild fills one half for every path.
    if (bands.size === 0) return;
    onBands(bands);
  }, [onBands]);
  /**
   * Two observers, rooted at the scroller (D2). Three bands need both: one
   * `rootMargin` yields two states, and `intersectionRatio` is measured against
   * the *expanded* root, so visible and near read alike to a single observer.
   * `onPeek` rides the margined one, firing screens before a tile is seen.
   *
   * Built and populated in one effect, so no window has an observer with
   * nothing observed. Every dep is identity-stable by design — an unstable one
   * pays an observer rebuild per render.
   */
  useEffect(() => {
    // Before the guard below: an empty listing renders no grid, and the old
    // paths must not survive for the previews effect to publish.
    const state = bandStateRef.current;
    state.clear();
    const root = gridRef.current;
    const scroller = scrollRoot.current;
    if (root === null || scroller === null) return;
    const stateOf = (path: string): { inPark?: boolean; inView?: boolean } => {
      let s = state.get(path);
      if (s === undefined) {
        s = {};
        state.set(path, s);
      }
      return s;
    };
    const apply = (
      records: IntersectionObserverEntry[],
      half: "inPark" | "inView",
      peeks: boolean,
    ): void => {
      for (const record of records) {
        const el = record.target as HTMLElement;
        const path = el.dataset.dirTile ?? el.dataset.modelTile;
        if (path === undefined) continue;
        stateOf(path)[half] = record.isIntersecting;
        if (peeks && record.isIntersecting && el.dataset.dirTile !== undefined)
          onPeek(path);
      }
      publish();
    };
    const bandObserver = new IntersectionObserver(
      (records) => apply(records, "inPark", true),
      {
        root: scroller,
        rootMargin: FAR_ROOT_MARGIN,
      },
    );
    const viewObserver = new IntersectionObserver(
      (records) => apply(records, "inView", false),
      {
        root: scroller,
      },
    );
    for (const el of root.querySelectorAll<HTMLElement>(
      "[data-dir-tile], [data-model-tile]",
    )) {
      bandObserver.observe(el);
      viewObserver.observe(el);
    }
    return () => {
      bandObserver.disconnect();
      viewObserver.disconnect();
    };
  }, [entries, onPeek, publish, scrollRoot]);

  /** A landed peek's models join their folder's band with no observer churn. */
  useEffect(() => {
    publish();
  }, [previews, publish]);

  /**
   * With nothing focused, an arrow lands on the first tile instead of doing
   * nothing (link-previews D11). A keydown with focus on `body` never reaches
   * the grid's own handler below, hence the document listener; focus anywhere
   * else — the path bar, the find input, a tile — is left to its own handler.
   */
  useEffect(() => {
    function onDocumentKeyDown(e: KeyboardEvent): void {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!ARROWS.has(e.key)) return;
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      // The lightbox steps models on the same keys from a window listener,
      // whatever holds focus while it is open. The entry menu needs no guard
      // only because it always holds focus itself (`EntryMenu` seeds it).
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      const first = gridRef.current ? tilesIn(gridRef.current)[0] : undefined;
      if (first === undefined) return;
      e.preventDefault();
      first.focus();
    }
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, []);

  /**
   * Arrow-key focus movement between tiles (grid-arrow-navigation). **Container
   * scoping, not a guard, is what isolates the find input and the path bar**:
   * they render outside `gridRef`, so their keydowns never reach here (D3).
   * Alt/Ctrl/Meta arrows are left to the browser — Alt+Arrow is Back/Forward.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const { key } = e;
    if (!ARROWS.has(key)) return;
    const tiles = gridRef.current ? tilesIn(gridRef.current) : [];
    const idx = tiles.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    const last = tiles.length - 1;
    const cols = columnCount(tiles);
    let target = idx;
    if (key === "ArrowRight") target = Math.min(idx + 1, last);
    else if (key === "ArrowLeft") target = Math.max(idx - 1, 0);
    else if (key === "ArrowDown") {
      const down = idx + cols;
      // A straight step, else the last tile when a partial row sits below,
      // else a no-op.
      if (down <= last) target = down;
      else if (Math.floor(idx / cols) < Math.floor(last / cols)) target = last;
    } else {
      // Never a clamp to 0, which slides focus sideways along the top row.
      const up = idx - cols;
      if (up >= 0) target = up;
    }
    // An inert edge arrow is left to the browser, so the page may scroll (D3).
    if (target === idx) return;
    e.preventDefault();
    tiles[target]?.focus();
  };

  // Below the hooks: an early return above them makes the observer effect
  // conditional.
  if (entries.length === 0) {
    return (
      <div className="mt-20 flex flex-col items-center gap-2 text-center">
        <Icon name="folder" className="size-8 text-ink-3" strokeWidth={1.5} />
        <p className="text-sm text-ink-2">Nothing here.</p>
      </div>
    );
  }
  return (
    <div ref={gridRef} className={GRID_CLASS[size]} onKeyDown={onKeyDown}>
      {entries.map((entry) => {
        // The map's own array, so the memo sees an unchanged preview list as
        // unchanged. Folders only — a zip is never peeked.
        const preview =
          entry.kind === "dir" ? previews.get(entry.path) : undefined;
        return (
          <Tile
            key={entry.path}
            entry={entry}
            thumb={thumbs.get(entry.path)}
            preview={preview}
            // A fresh array every render, which is why `tilePropsEqual`
            // compares it elementwise.
            previewThumbs={preview?.map((e) => thumbs.get(e.path))}
            onEnter={onEnter}
            onModelPointerDown={onModelPointerDown}
            onModelOpen={onModelOpen}
            onModelHover={onModelHover}
            onEntryMenu={onEntryMenu}
            onImageError={onImageError}
            // A boolean per tile, not the path, so only the marked tile's props
            // change and the memo holds the rest.
            marked={entry.path === markedPath}
            anchor={entry.path === anchorPath}
            // Only the scale is tested here; the anchor rule and the missing
            // hit live inside `scoreFor`, which returns the landed map's own
            // object so the memo sees an unchanged answer as unchanged.
            score={scoreScale === null ? undefined : scoreFor(entry.path)}
            scale={scoreScale}
            showScores={showScores}
            modest={modestSet}
          />
        );
      })}
    </div>
  );
}

export default memo(Grid);

/** How far a z-score stands out, as a share of the bar: z≈5 is about as far
 *  above the collection as any result gets, and a sliver always shows. */
function relevanceWidth(z: number): number {
  return Math.min(100, Math.max(6, (z / 5) * 100));
}

/**
 * Where a result lives, under its name. A deep search or a flat view carries
 * the path relative to where it ran; without this line two same-named files
 * from different kits look like duplicates.
 */
function ParentLine({ name }: { name: string }) {
  const slash = name.lastIndexOf("/");
  if (slash <= 0) return null;
  const inArchive = name.includes("!/");
  const raw = name.slice(0, slash).split("/");
  // Inside an archive the archive is what tells the copy apart from its
  // extracted twin, so its name is the part kept whole.
  const zipAt = raw.findIndex((p) => p.endsWith("!"));
  const keep = inArchive && zipAt >= 0 ? zipAt : raw.length - 1;
  const clean = raw.map((p) => p.replace(/!$/, ""));
  const last =
    keep === raw.length - 1
      ? clean[keep]!
      : `${clean[keep]} › ${clean[clean.length - 1]}`;
  const head = clean.slice(0, keep).join("/");
  // Otherwise the nearest folder is kept whole, and the rest gives way from
  // its end.
  return (
    <span
      data-tile-parent
      className="-mt-1.5 flex w-full min-w-0 items-center gap-1 px-2.5 pb-2 text-xs leading-tight text-ink-3"
    >
      {inArchive && <Icon name="archive" className="size-3 text-accent/70" />}
      <span className="flex min-w-0">
        {head !== "" && <span className="min-w-[2ch] truncate">{head}/</span>}
        <span className="max-w-[80%] shrink-0 truncate">{last}</span>
      </span>
    </span>
  );
}

/** A model's name with its extension quieted: the stem is what tells two
 *  models apart, the format is the same across a folder. */
function TileName({ name }: { name: string }) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || name.length - dot > 6) return <>{name}</>;
  return (
    <>
      {name.slice(0, dot)}
      <span className="text-ink-3">{name.slice(dot)}</span>
    </>
  );
}

/** Placeholder tiles shaped like the real ones, so the grid does not jump when
 *  the listing lands. */
export function SkeletonGrid({ size = "m" }: { size?: TileSize }) {
  return (
    <div aria-hidden="true" className={GRID_CLASS[size]}>
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="animate-pulse overflow-hidden rounded-xl border border-line bg-surface"
        >
          <div className="aspect-square w-full bg-sunken" />
          <div className="px-2.5 py-2.5">
            <div className="h-2.5 w-2/3 rounded-full bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Two card edges peeking above a folder: a collection, not an item. Drawn in
 *  the row gap, so it costs the grid nothing. */
const STACK_CLASS =
  " shadow-[0_-7px_0_-3px_rgb(255_255_255/0.09),0_-13px_0_-7px_rgb(255_255_255/0.045)]";

/**
 * A score badge. `pointer-events-none` so it is never the target of the press
 * that orbits the tile, and `z-tile-badge` so the opaque orbit overlay does not
 * cover it — no ancestor of a tile makes a stacking context, so the two resolve
 * against the same root. index.css orders the five z layers.
 */
const BADGE_CLASS =
  "pointer-events-none absolute bottom-2 z-tile-badge rounded-full bg-canvas/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none text-ink-2 ring-1 ring-line-strong backdrop-blur-sm";

/**
 * What one thumbnail looks like at any moment, for a model tile and a sheet
 * cell alike. The `url`-before-status order is load-bearing: a loading entry
 * that has a URL is the embedded-3MF placeholder, and must draw as the picture
 * it is rather than as a spinner.
 */
function ThumbView({
  thumb,
  path,
  onImageError,
  quiet = false,
}: {
  thumb: ThumbState | undefined;
  /** The cell's own path in a folder sheet, not the folder's, so a failed
   *  image is reported for the entry it belongs to (D3). */
  path: string;
  onImageError?: (path: string) => void;
  /** A sheet cell: four spinners to a folder is a wall of them, so a cell
   *  waits as a faint block and its picture fades in. */
  quiet?: boolean;
}) {
  // Only until the *first* picture: a later URL replaces it on arrival while
  // the browser keeps the old pixels up, so spinning over them would discard a
  // picture already on screen. A `blob:` URL draws at once.
  const [everLoaded, setEverLoaded] = useState(false);
  if (thumb?.status === "error") {
    return (
      <span
        className="flex flex-col items-center gap-1.5 text-ink-3"
        title="Failed to load model"
      >
        <Icon name="warning" className="size-5" strokeWidth={1.5} />
        <span className="text-xs">Couldn't render</span>
      </span>
    );
  }
  if (thumb?.url !== undefined) {
    const url = thumb.url;
    const pending = !url.startsWith("blob:") && !everLoaded;
    return (
      // The box is declared, not inferred, so `overlayRectFor` measures a real
      // rect before a lazy image has intrinsic size — renders are always square
      // (`THUMB_SIZE`). Both axes, or a cell taller than wide squashes it.
      //
      // Whole class literals: Tailwind's scanner reads source text, so a
      // utility glued to a `${` never reaches the stylesheet.
      <span className="relative flex aspect-square w-[min(100%,100cqh)] items-center justify-center">
        <img
          src={url}
          alt="" // decorative: the button's aria-label names the model
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setEverLoaded(true)}
          onError={() => onImageError?.(path)}
          className={
            pending
              ? "h-full w-full object-contain opacity-0"
              : "h-full w-full object-contain"
          }
        />
        {pending && !quiet ? (
          <span className="absolute size-5 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
        ) : null}
      </span>
    );
  }
  return quiet ? (
    <span className="size-3/5 animate-[pulse_2.4s_ease-in-out_infinite] rounded-md bg-white/[0.035]" />
  ) : (
    <span className="size-5 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
  );
}

/**
 * The folder tile's contact sheet, up to four previews (D4). The sheet never
 * shows an empty cell — hence the column count chosen per length, and the third
 * of three spanning the row. An empty or unanswered peek keeps the icon, so a
 * tile never blanks while its peek is in flight.
 */
function ContactSheet({
  preview,
  thumbs,
  onImageError,
}: {
  preview: DirEntry[];
  thumbs: (ThumbState | undefined)[] | undefined;
  onImageError: (path: string) => void;
}) {
  return (
    <div
      data-preview-sheet={preview.length}
      className={`grid h-full min-h-0 w-full gap-1 ${preview.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
    >
      {preview.map((entry, i) => (
        <div
          key={entry.path}
          data-preview-cell={entry.path}
          // A cell shows no other name, so this title is its label and takes
          // the stored one (`library-overrides` D7). The folder tile's own
          // title keeps the real name — two different title roles.
          title={entry.displayName ?? entry.name}
          // A size container, so the image can take the cell's smaller axis.
          className={
            // The odd one out of three, given the full width below the pair.
            preview.length === 3 && i === 2
              ? "flex min-h-0 items-center justify-center overflow-hidden rounded-md bg-stage [container-type:size] col-span-2"
              : "flex min-h-0 items-center justify-center overflow-hidden rounded-md bg-stage [container-type:size]"
          }
        >
          <ThumbView
            // Keyed on the cache key: a same-path new-mtime entry is a
            // different render, and `everLoaded` must start over.
            key={`${entry.path}:${entry.mtime}`}
            thumb={thumbs?.[i]}
            path={entry.path}
            onImageError={onImageError}
            quiet
          />
        </div>
      ))}
    </div>
  );
}

interface TileProps {
  entry: DirEntry;
  thumb: ThumbState | undefined;
  onEnter: (entry: DirEntry) => void;
  onModelPointerDown: (
    e: React.PointerEvent,
    entry: DirEntry,
    el: HTMLElement,
  ) => void;
  onModelOpen: (entry: DirEntry, el: HTMLElement) => void;
  onModelHover: (path: string | null, mtime?: number) => void;
  onEntryMenu: (
    entry: DirEntry,
    el: HTMLElement,
    at: { x: number; y: number },
  ) => void;
  onImageError: (path: string) => void;
  marked: boolean;
  anchor: boolean;
  score: IndexScore | undefined;
  scale: ScoreScale | null;
  showScores: boolean;
  modest: boolean;
  /** The map's own array (see `Grid`), so compared by identity. */
  preview: DirEntry[] | undefined;
  /** Rebuilt every render, so `tilePropsEqual` compares it elementwise. */
  previewThumbs: (ThumbState | undefined)[] | undefined;
}

/**
 * React's shallow compare with `previewThumbs` exempted: it is a fresh array
 * every render, so identity would undo the memo for exactly the tiles that need
 * it most, while its elements are the thumbs map's own stable objects.
 *
 * Over the keys, not a hand-listed check, which would silently stop comparing a
 * prop added above.
 */
function tilePropsEqual(prev: TileProps, next: TileProps): boolean {
  const keys = Object.keys(next) as (keyof TileProps)[];
  if (keys.length !== Object.keys(prev).length) return false;
  for (const key of keys) {
    if (key === "previewThumbs") continue;
    if (prev[key] !== next[key]) return false;
  }
  const a = prev.previewThumbs;
  const b = next.previewThumbs;
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every((state, i) => state === b[i]);
}

const Tile = memo(function Tile({
  entry,
  thumb,
  onEnter,
  onModelPointerDown,
  onModelOpen,
  onModelHover,
  onEntryMenu,
  onImageError,
  marked,
  anchor,
  score,
  scale,
  showScores,
  modest,
  preview,
  previewThumbs,
}: TileProps) {
  const ref = useRef<HTMLButtonElement>(null);
  /** A touch press that began outside the orbit zone: its click is a tap. */
  const edgeTapRef = useRef(false);
  const base =
    "group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left text-ink-2 transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  // A CSS animation (index.css), not a class swap, so the fade is the
  // browser's and App only drops the state that applied it.
  const markClass = marked ? " animate-reveal-mark" : "";
  // Deliberately a quiet ring: anything louder reads as "this one matched
  // hardest", the opposite of what the subject is.
  const anchorClass = anchor ? " border-accent/40 ring-1 ring-accent/40" : "";
  // Both or neither: the two scoring routes run on different distributions, so
  // an unlabelled cosine invites a comparison it cannot support (D2).
  const badges =
    score !== undefined && scale !== null ? { score, scale } : null;

  const onMenuKey = (e: React.KeyboardEvent<HTMLButtonElement>): boolean => {
    // For the platforms that do not send `contextmenu` for the menu key.
    if (e.key !== "ContextMenu" && !(e.key === "F10" && e.shiftKey))
      return false;
    e.preventDefault();
    onEntryMenu(
      entry,
      e.currentTarget,
      menuAt(e.currentTarget, { clientX: 0, clientY: 0 }),
    );
    return true;
  };

  // A sibling of the tile, never inside it: a button may not hold another,
  // and a press here must not start the tile's orbit. Out of the tab order —
  // the tile itself takes Shift+F10 and the Menu key — and drawn on hover,
  // focus, or always where there is no hover to reveal it.
  const actions = (
    <button
      type="button"
      tabIndex={-1}
      data-tile-actions
      aria-label={`Actions for ${entry.name}`}
      title="Actions"
      onClick={(e) => {
        const tile = ref.current;
        if (tile === null) return;
        const r = e.currentTarget.getBoundingClientRect();
        onEntryMenu(entry, tile, { x: r.left, y: r.bottom + 4 });
      }}
      className="absolute top-1.5 right-1.5 z-tile-badge flex size-8 items-center touch:size-10 justify-center rounded-md bg-black/45 text-ink-2 opacity-0 ring-1 ring-white/10 backdrop-blur-sm transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 hover:text-ink [@media(hover:none)]:opacity-100"
    >
      <Icon name="more" className="size-4" strokeWidth={2.5} />
    </button>
  );

  if (entry.kind !== "model") {
    return (
      <div className="group/tile relative h-full">
        <button
          ref={ref}
          type="button"
          data-entry-tile={entry.path}
          title={entry.name}
          // Set only where a stored name is drawn below, or the stored name would
          // *become* the accessible name — the real one has to stay there
          // (`library-overrides` D7). That puts label and name deliberately out of
          // step (WCAG 2.5.3) on exactly those tiles: a knowing trade, since the
          // real name is what a reader acts on outside this app. Kind-split
          // because a named zip must not announce "folder".
          aria-label={
            entry.displayName !== undefined
              ? entry.kind === "dir"
                ? `folder ${entry.name}`
                : entry.name
              : undefined
          }
          className={
            (entry.kind === "dir" ? base + STACK_CLASS : base) +
            markClass +
            anchorClass
          }
          onClick={() => onEnter(entry)}
          onContextMenu={(e) => {
            if (nativeMenuRequested(e)) return;
            e.preventDefault();
            onEntryMenu(entry, e.currentTarget, menuAt(e.currentTarget, e));
          }}
          onKeyDown={onMenuKey}
          // What the observer watches. Folders only — a zip is not peeked, and an
          // absent attribute cannot be picked up by mistake.
          data-dir-tile={entry.kind === "dir" ? entry.path : undefined}
        >
          {/* The folder chrome — a tab and a framed body — IS the directory
              tile's icon, drawn whether or not anything previews: the resting
              look and the filled look are one shape, so a peek landing fills the
              folder rather than replacing an emoji with chrome — no pop-in, and
              an empty folder still reads as a folder.
              The sheet, when there is one, sits inside: the images are *inside*
              the folder, the way every desktop draws it, which is what keeps a
              one-preview sheet from reading as a model tile. Only zips keep the
              emoji — they are never previewed and are not folders. */}
          {entry.kind === "dir" ? (
            // The chrome carries the type signal a glyph would otherwise leak
            // into the content-derived accessible name. A named tile's
            // button-level label takes over whole.
            <div
              data-folder-chrome
              role="img"
              aria-label="folder"
              className="relative aspect-square w-full bg-sunken p-1.5"
            >
              {preview !== undefined && preview.length > 0 ? (
                <ContactSheet
                  preview={preview}
                  thumbs={previewThumbs}
                  onImageError={onImageError}
                />
              ) : (
                <span className="flex h-full items-center justify-center text-ink-3/60">
                  <Icon name="folder" className="size-10" strokeWidth={1.25} />
                </span>
              )}
            </div>
          ) : (
            // A bare glyph leaks into the accessible name as whatever the
            // reader's symbol dictionary says.
            <span
              role="img"
              aria-label="zip archive"
              className="flex aspect-square w-full items-center justify-center bg-stage text-ink-3"
            >
              <Icon name="archive" className="size-10" strokeWidth={1.25} />
            </span>
          )}
          {/* The leaf, not the relative path a deep search carries — truncating
              that shows the head of the path rather than the folder searched for.
              A stored name displaces it, for display only: the title, the
              accessible name and every matcher still read `entry.name` (D7). */}
          <span
            data-tile-name
            className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-2 text-[13px] leading-tight"
          >
            <Icon
              name={entry.kind === "dir" ? "folder" : "archive"}
              className="size-3.5 text-accent/80"
            />
            <span className="min-w-0 truncate">
              {entry.displayName ?? baseName(entry.name)}
            </span>
          </span>
          <ParentLine name={entry.name} />
        </button>
        {actions}
      </div>
    );
  }

  return (
    <div className="group/tile relative h-full">
      <button
        ref={ref}
        type="button"
        data-model-tile={entry.path}
        data-entry-tile={entry.path}
        title={
          badges === null
            ? entry.name
            : `${entry.name}\n${strengthOf(badges.score.z, modest)} match`
        }
        // An accessible name *replaces* the contents rather than joining them, so
        // the full path, the anchor and the badge numbers are only announced if
        // they are stated here (D8). The scales are spelled out for reading aloud.
        aria-label={
          (thumb?.status === "error"
            ? `${entry.name} — failed to load`
            : entry.name) +
          (anchor ? " — the model these are compared against" : "") +
          (badges === null
            ? ""
            : showScores
              ? ` — ${SCALE_SPOKEN[badges.scale]} ${formatCosine(badges.score.score)}, ${Z_LABEL} ${formatZ(badges.score.z)}`
              : ` — ${strengthOf(badges.score.z, modest).toLowerCase()} match`)
        }
        className={`${base} cursor-grab touch-pan-y select-none active:cursor-grabbing ${markClass} ${anchorClass}`}
        onPointerDown={(e) => {
          // A finger turns the model only from the middle of its picture;
          // the band around it scrolls the grid, and a tap there opens it.
          const edge =
            e.pointerType === "touch" &&
            (e.target as Element).closest("[data-orbit-zone]") === null;
          edgeTapRef.current = edge;
          if (!edge) onModelPointerDown(e, entry, e.currentTarget);
        }}
        onClick={(e) => {
          if (!edgeTapRef.current) return;
          edgeTapRef.current = false;
          onModelOpen(entry, e.currentTarget);
        }}
        // A shifted secondary press is the one exception: not prevented, not
        // raised, so the browser's own menu appears.
        onContextMenu={(e) => {
          if (nativeMenuRequested(e)) return;
          e.preventDefault();
          onEntryMenu(entry, e.currentTarget, menuAt(e.currentTarget, e));
        }}
        onKeyDown={(e) => {
          if (onMenuKey(e)) return;
          // Keyboard activation fires click, not pointerdown.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onModelOpen(entry, e.currentTarget);
          }
        }}
        onPointerEnter={() => onModelHover(entry.path, entry.mtime)}
        onPointerLeave={() => onModelHover(null)}
      >
        <div
          data-tile-content
          // A size container for the same reason as a sheet cell (`ThumbView`).
          className="relative flex aspect-square w-full items-center justify-center bg-stage [container-type:size]"
        >
          <ThumbView
            key={`${entry.path}:${entry.mtime}`}
            thumb={thumb}
            path={entry.path}
            onImageError={onImageError}
          />
          {/* The touch orbit zone: the middle of the picture, over it so a finger
              lands here, where a drag is meant for the model; everything
              outside it pans the page. */}
          <span
            aria-hidden="true"
            data-orbit-zone
            className="absolute inset-[17.5%] touch-none"
          />
          {/* Never composited into the render: a painted badge would make the
              score part of the thumbnail's cache key, and every query change
              would re-render the grid (D5). `aria-hidden` because the button
              states these numbers in its own name. */}
          {badges !== null && (
            <>
              {/* The strength at a glance, the numbers on hover: a bar reads
                  without a legend, a raw cosine does not. */}
              <span
                aria-hidden
                data-relevance-bar
                className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-r-full bg-accent/70"
                style={{ width: `${relevanceWidth(badges.score.z)}%` }}
              />
              {showScores && (
                <>
                  <span aria-hidden className={`${BADGE_CLASS} left-1.5`}>
                    {SCALE_BADGE[badges.scale]}{" "}
                    {formatCosine(badges.score.score)}
                  </span>
                  <span aria-hidden className={`${BADGE_CLASS} right-1.5`}>
                    {Z_LABEL} {formatZ(badges.score.z)}
                  </span>
                </>
              )}
            </>
          )}
          {/* Over the picture's foot, above the name: the last line is what a
              label is read from. */}
          {anchor && (
            <span className="absolute inset-x-0 bottom-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-accent">
              Compared against
            </span>
          )}
        </div>
        {/* The file name; the flat-view path is in the title and aria-label. A
            stored name displaces it as on the container tile — and needs no
            aria-label help here, since this button already states the real
            name (D7). */}
        <span
          data-tile-name
          className="w-full truncate px-2.5 py-2 text-[13px] leading-tight"
        >
          <TileName name={entry.displayName ?? baseName(entry.name)} />
        </span>
        <ParentLine name={entry.name} />
      </button>
      {actions}
    </div>
  );
}, tilePropsEqual);
