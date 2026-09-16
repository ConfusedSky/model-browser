import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { baseName } from "../../../shared/names";
import type { DirEntry, IndexScore } from "../../../shared/types";
import type { ThumbState } from "../hooks/useThumbnails";
import { formatCosine, formatZ } from "../lib/format";
import { nativeMenuRequested } from "../lib/gesture";
import { tilesIn } from "../lib/placement";
import {
  SCALE_BADGE,
  SCALE_SPOKEN,
  Z_LABEL,
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
  onModelHover: (path: string | null) => void;
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
   * Arrow-key focus movement between tiles (grid-arrow-navigation). **Container
   * scoping, not a guard, is what isolates the find input and the path bar**:
   * they render outside `gridRef`, so their keydowns never reach here (D3).
   * Alt/Ctrl/Meta arrows are left to the browser — Alt+Arrow is Back/Forward.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const { key } = e;
    if (
      key !== "ArrowRight" &&
      key !== "ArrowLeft" &&
      key !== "ArrowDown" &&
      key !== "ArrowUp"
    ) {
      return;
    }
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
      <p className="mt-16 text-center text-sm text-zinc-600">
        Nothing to show here.
      </p>
    );
  }
  return (
    <div
      ref={gridRef}
      className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 p-4"
      onKeyDown={onKeyDown}
    >
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
          />
        );
      })}
    </div>
  );
}

export default memo(Grid);

/**
 * A corner badge. `pointer-events-none` so it is never the target of the press
 * that orbits the tile, and `z-tile-badge` so the opaque orbit overlay does not
 * cover it — no ancestor of a tile makes a stacking context, so the two resolve
 * against the same root. index.css orders the five z layers.
 */
const BADGE_CLASS =
  "pointer-events-none absolute top-0 z-tile-badge rounded bg-zinc-950/80 px-1 py-px text-[0.625rem] font-medium tabular-nums leading-tight text-zinc-300 ring-1 ring-zinc-800/60";

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
}: {
  thumb: ThumbState | undefined;
  /** The cell's own path in a folder sheet, not the folder's, so a failed
   *  image is reported for the entry it belongs to (D3). */
  path: string;
  onImageError?: (path: string) => void;
}) {
  // Only until the *first* picture: a later URL replaces it on arrival while
  // the browser keeps the old pixels up, so spinning over them would discard a
  // picture already on screen. A `blob:` URL draws at once.
  const [everLoaded, setEverLoaded] = useState(false);
  if (thumb?.status === "error") {
    return (
      <span className="text-2xl" title="Failed to load model">
        ⚠️
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
        {pending ? (
          <span className="absolute size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        ) : null}
      </span>
    );
  }
  return (
    <span className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
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
      className={`grid min-h-0 w-full flex-1 gap-1 ${preview.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
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
              ? "flex min-h-0 items-center justify-center overflow-hidden rounded [container-type:size] col-span-2"
              : "flex min-h-0 items-center justify-center overflow-hidden rounded [container-type:size]"
          }
        >
          <ThumbView
            // Keyed on the cache key: a same-path new-mtime entry is a
            // different render, and `everLoaded` must start over.
            key={`${entry.path}:${entry.mtime}`}
            thumb={thumbs?.[i]}
            path={entry.path}
            onImageError={onImageError}
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
  onModelHover: (path: string | null) => void;
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
  preview,
  previewThumbs,
}: TileProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const base =
    "group flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 transition-colors hover:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500";
  // A CSS animation (index.css), not a class swap, so the fade is the
  // browser's and App only drops the state that applied it.
  const markClass = marked ? " animate-reveal-mark" : "";
  // Deliberately a quiet ring: anything louder reads as "this one matched
  // hardest", the opposite of what the subject is.
  const anchorClass = anchor ? " border-sky-800 ring-1 ring-sky-800" : "";
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

  if (entry.kind !== "model") {
    return (
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
        className={base + markClass + anchorClass}
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
            className="flex min-h-0 w-full flex-1 flex-col px-1 pt-1"
          >
            <div className="h-2.5 w-1/2 shrink-0 rounded-t-md bg-amber-400/40" />
            <div className="flex min-h-0 w-full flex-1 rounded-b-md rounded-tr-md bg-amber-400/40 p-1">
              {preview !== undefined && preview.length > 0 && (
                <ContactSheet
                  preview={preview}
                  thumbs={previewThumbs}
                  onImageError={onImageError}
                />
              )}
            </div>
          </div>
        ) : (
          // A bare emoji leaks into the accessible name as whatever the
          // reader's symbol dictionary says.
          <span role="img" aria-label="zip archive" className="text-4xl">
            🗜️
          </span>
        )}
        {/* The leaf, not the relative path a deep search carries — truncating
            that shows the head of the path rather than the folder searched for.
            A stored name displaces it, for display only: the title, the
            accessible name and every matcher still read `entry.name` (D7). */}
        <span className="w-full truncate text-center text-xs">
          {entry.displayName ?? baseName(entry.name)}
        </span>
      </button>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      data-model-tile={entry.path}
      data-entry-tile={entry.path}
      title={entry.name}
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
          : ` — ${SCALE_SPOKEN[badges.scale]} ${formatCosine(badges.score.score)}, ${Z_LABEL} ${formatZ(badges.score.z)}`)
      }
      className={`${base} touch-none select-none${markClass}${anchorClass}`}
      onPointerDown={(e) => onModelPointerDown(e, entry, e.currentTarget)}
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
      onPointerEnter={() => onModelHover(entry.path)}
      onPointerLeave={() => onModelHover(null)}
    >
      <div
        data-tile-content
        // A size container for the same reason as a sheet cell (`ThumbView`).
        className="relative flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]"
      >
        <ThumbView
          key={`${entry.path}:${entry.mtime}`}
          thumb={thumb}
          path={entry.path}
          onImageError={onImageError}
        />
        {/* Never composited into the render: a painted badge would make the
            score part of the thumbnail's cache key, and every query change
            would re-render the grid (D5). `aria-hidden` because the button
            states these numbers in its own name. */}
        {badges !== null && (
          <>
            <span aria-hidden className={`${BADGE_CLASS} left-0`}>
              {SCALE_BADGE[badges.scale]} {formatCosine(badges.score.score)}
            </span>
            <span aria-hidden className={`${BADGE_CLASS} right-0`}>
              {Z_LABEL} {formatZ(badges.score.z)}
            </span>
          </>
        )}
      </div>
      {/* Above the name: the last line is what a label is read from. */}
      {anchor && (
        <span className="w-full truncate text-center text-[0.625rem] uppercase tracking-wide text-sky-500">
          Compared against
        </span>
      )}
      {/* The file name; the flat-view path is in the title and aria-label. A
          stored name displaces it as on the container tile — and needs no
          aria-label help here, since this button already states the real
          name (D7). */}
      <span className="w-full truncate text-center text-xs">
        {entry.displayName ?? baseName(entry.name)}
      </span>
    </button>
  );
}, tilePropsEqual);
