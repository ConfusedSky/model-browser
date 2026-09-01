import { memo, useEffect, useRef } from 'react'
import { baseName } from '../../../shared/names'
import type { DirEntry, IndexScore } from '../../../shared/types'
import type { ThumbState } from '../hooks/useThumbnails'
import { formatCosine, formatZ } from '../lib/format'
import { SCALE_BADGE, SCALE_SPOKEN, Z_LABEL, type ScoreScale } from '../lib/scoreScale'

interface Props {
  entries: DirEntry[]
  thumbs: Map<string, ThumbState>
  onEnter: (entry: DirEntry) => void
  onModelPointerDown: (e: React.PointerEvent, entry: DirEntry, el: HTMLElement) => void
  /** Keyboard activation (Enter/Space) — opens the lightbox directly. */
  onModelOpen: (entry: DirEntry, el: HTMLElement) => void
  onModelHover: (path: string | null) => void
  /** Raise the entry menu — a secondary press, or the platform's context-menu
   *  key on a focused tile. Held by identity in App like the others. */
  onEntryMenu: (entry: DirEntry, el: HTMLElement, at: { x: number; y: number }) => void
  /** The entry a reveal just located, marked until the highlight fades.
   *  Component-local in App, never a view field (D8). */
  markedPath: string | null
  /** A similarity view's subject — the model its neighbours were computed from.
   *  It is drawn first and marked as the reference; App prepends it, so this is
   *  only which of the rendered tiles is it. */
  anchorPath?: string
  /** The one way to obtain a tile's score. A guarded lookup rather than the raw
   *  map: the anchor rule lives inside it, so this component cannot draw a badge
   *  the rule forbids even by forgetting to check. Returns the map's own object,
   *  so the memo below still compares by identity. */
  scoreFor: (path: string) => IndexScore | undefined
  /** Which scale those numbers are on, or `null` where the view is not a scored
   *  one — in which case no tile draws a number at all (D3). */
  scoreScale: ScoreScale | null
  /**
   * What each folder tile previews, for the listing on screen: the models a
   * peek found inside it, in the order it found them
   * (folder-contact-sheets D1). App owns the map and clears it per listing; a
   * path absent from it has not been answered for, which is the same thing a
   * tile draws as an empty answer — its own icon.
   *
   * The arrays are the map's own, never rebuilt per render, so `Tile`'s memo
   * compares them by identity like `score`.
   */
  previews: ReadonlyMap<string, DirEntry[]>
  /** Ask for a folder's preview — raised once per tile, when it first comes on
   *  screen. App holds it by identity and drops a repeat (D1). */
  onPeek: (path: string) => void
}

/**
 * The context-menu gesture, as a tile sees it. `contextmenu` covers both ways
 * in — the secondary press and the platform's context-menu key, which browsers
 * dispatch as the same event on the focused element — and Shift+F10 is handled
 * beside it for the platforms that do not.
 */
function menuAt(el: HTMLElement, e: { clientX: number; clientY: number }): { x: number; y: number } {
  // A keyboard-raised menu reports (0, 0) — anchor it to the tile instead, so
  // it appears where the thing it acts on is.
  if (e.clientX !== 0 || e.clientY !== 0) return { x: e.clientX, y: e.clientY }
  const r = el.getBoundingClientRect()
  return { x: r.left + 8, y: r.bottom - 8 }
}

/**
 * Memoized, tiles included: typing in the search box re-renders the app on
 * every keystroke while nothing here has changed, and a grid is hundreds of
 * tiles. A tile compares on its entry, its own thumbnail, and the handlers —
 * which App holds by identity for exactly this reason.
 */
function Grid({
  entries,
  thumbs,
  onEnter,
  onModelPointerDown,
  onModelOpen,
  onModelHover,
  onEntryMenu,
  markedPath,
  anchorPath,
  scoreFor,
  scoreScale,
  previews,
  onPeek,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  /**
   * One observer for the grid, watching folder tiles only (D1): a preview costs
   * a request, so it is paid for folders the user actually scrolls to rather
   * than for every folder in the listing. Zip tiles are never previewed and are
   * never observed — `data-dir-tile` is written by the `dir` branch alone.
   *
   * Built and populated in **one** effect so there is no window in which an
   * observer exists but nothing is observed, and no second effect to keep in
   * step with this one's deps. It is rebuilt when the listing changes, which is
   * also when App clears the map the peeks fill — the two stay in step by
   * keying on the same array.
   *
   * `onPeek` is App's `useCallback`, stable across renders; if it ever stops
   * being, this tears down and rebuilds the observer on every render.
   */
  useEffect(() => {
    const root = gridRef.current
    if (root === null) return
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue
        // Unobserved on the way past: one peek per tile per listing is what the
        // requirement asks for, and App's own guard is the backstop for the
        // tile that is re-observed after a re-render.
        observer.unobserve(record.target)
        const path = (record.target as HTMLElement).dataset.dirTile
        if (path !== undefined) onPeek(path)
      }
    })
    for (const el of root.querySelectorAll<HTMLElement>('[data-dir-tile]')) observer.observe(el)
    return () => observer.disconnect()
  }, [entries, onPeek])

  // Below the hooks, not above them: the observer effect must run on every
  // render of this component, and an early return before it would make it
  // conditional.
  if (entries.length === 0) {
    return <p className="mt-16 text-center text-sm text-zinc-600">Nothing to show here.</p>
  }
  return (
    <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 p-4">
      {entries.map((entry) => {
        // Resolved here rather than in the tile, for the reason `score` is: the
        // map's own array is reference-stable across renders, so the memo sees
        // an unchanged preview list as unchanged. Only folders have one — a zip
        // is never peeked (Non-Goals), and a model is not a container.
        const preview = entry.kind === 'dir' ? previews.get(entry.path) : undefined
        return (
          <Tile
            key={entry.path}
            entry={entry}
            thumb={thumbs.get(entry.path)}
            preview={preview}
            // A fresh array every render, unavoidably — which is why `Tile`'s
            // comparator compares it elementwise instead of by identity. The
            // states inside are the thumbs map's own objects and are stable
            // unless the cell's own thumbnail changed.
            previewThumbs={preview?.map((e) => thumbs.get(e.path))}
            onEnter={onEnter}
            onModelPointerDown={onModelPointerDown}
            onModelOpen={onModelOpen}
            onModelHover={onModelHover}
            onEntryMenu={onEntryMenu}
            // A boolean per tile, not the path: only the marked tile's props
            // change, so the memo keeps the other 499 from re-rendering.
            marked={entry.path === markedPath}
            // Per-tile boolean for the same reason `marked` is one: the memo
            // keeps every other tile out of the re-render.
            anchor={entry.path === anchorPath}
            // Resolved here rather than in the tile, so a tile that draws no
            // badge is passed nothing and the memo sees `undefined` unchanged
            // across renders — `scoreFor` returns the landed map's own object, so
            // an unchanged answer passes the same reference every time.
            //
            // Only the scale is tested here. The other two ways to have no number
            // are inside the lookup: this tile is the anchor (the index excludes
            // the query model from its own ranking rather than scoring it), or the
            // hit that would have carried one did not resolve. `anchorPath` is
            // still a prop because the ring and the caption below need it — the
            // anchor *fact* has two readers, but the anchor *guard* now has one.
            score={scoreScale === null ? undefined : scoreFor(entry.path)}
            scale={scoreScale}
          />
        )
      })}
    </div>
  )
}

export default memo(Grid)

/**
 * A corner badge. Small, corner-anchored, and backed opaquely enough to read
 * over a pale model and darkly enough to read over a bright one;
 * `tabular-nums` keeps a column of them from jittering as digits change.
 * `pointer-events-none` so a badge is never the target of the press that
 * orbits or opens the tile.
 *
 * `z-tile-badge` is what keeps the numbers on screen while the model is turned.
 * The orbit overlay is a `z-orbit-overlay` layer drawn over this tile with an
 * opaque background, so at the default z it simply covered the badges — they
 * vanished for exactly as long as the user was looking at the model they
 * describe. No ancestor of a tile creates a stacking context (checked: every
 * one is `position: static`, `z-index: auto`, no
 * transform/filter/opacity/isolation), so this z and the overlay's resolve
 * against the same root context and the badge wins. It sits deliberately below
 * `z-chrome`, `z-lightbox` and `z-menu`, all of which SHOULD cover a tile.
 * index.css orders the five and says why.
 *
 * The alternative was drawing a second pair on the overlay itself. That is
 * worse twice over: two copies of the markup to drift, and the overlay is a
 * centred *square* (the `<img>`'s box, which `overlayRectFor` measures) inside
 * a content box ten pixels wider, so its corners are not this tile's corners
 * and the badges visibly jumped inward on every press.
 */
const BADGE_CLASS =
  'pointer-events-none absolute top-0 z-tile-badge rounded bg-zinc-950/80 px-1 py-px text-[0.625rem] font-medium tabular-nums leading-tight text-zinc-300 ring-1 ring-zinc-800/60'

/**
 * What one thumbnail looks like at any moment: failed, drawn, or on its way.
 *
 * One component and not two copies, because a model tile and a folder tile's
 * sheet cell show the *same* thing — a preview is an ordinary thumbnail from
 * the same pipeline and the same cache, so a cell that rendered its own idea of
 * "loading" would be a second answer to a question already answered here. The
 * `url`-before-status order matters and is why this is worth naming: a loading
 * entry that has acquired a URL is the embedded-3MF placeholder
 * (`setPlaceholder` writes a url onto a loading state), and it must draw as the
 * picture it is rather than as a spinner.
 */
function ThumbView({ thumb }: { thumb: ThumbState | undefined }) {
  if (thumb?.status === 'error') {
    return (
      <span className="text-2xl" title="Failed to load model">
        ⚠️
      </span>
    )
  }
  if (thumb?.url !== undefined) {
    return (
      <img
        src={thumb.url}
        alt="" // decorative: the button's aria-label names the model
        draggable={false}
        className="max-h-full max-w-full object-contain"
      />
    )
  }
  return (
    <span className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
  )
}

/**
 * The folder tile's contact sheet: up to four previews filling the image area
 * where the icon would be (D4).
 *
 * Cells are filled in peek order and the sheet never shows an empty one — one
 * preview is a single full-size image rather than a quadrant and three blanks,
 * two sit side by side, three are two above one, four are the 2×2. That is why
 * the column count is chosen here rather than fixed at two, and why the third
 * of three spans the row.
 *
 * Rendered only for a non-empty preview: an empty answer, an unanswered one and
 * a zip all keep the icon, which is what stops a tile blanking while its peek
 * is in flight.
 */
function ContactSheet({
  preview,
  thumbs,
}: {
  preview: DirEntry[]
  thumbs: (ThumbState | undefined)[] | undefined
}) {
  return (
    <div
      data-preview-sheet={preview.length}
      className={`grid min-h-0 w-full flex-1 gap-1 ${preview.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
    >
      {preview.map((entry, i) => (
        <div
          key={entry.path}
          data-preview-cell={entry.path}
          // A cell has no visible label — this title is the only name it shows,
          // so it is the cell's label and takes the stored one where the store
          // holds it (`library-overrides` D7). The folder tile's own title, up
          // on the button, keeps the real name; these are two different title
          // roles. The fallback is `entry.name` and not `baseName(entry.name)`:
          // an entry the store does not name must be titled exactly as it was
          // before this capability existed.
          title={entry.displayName ?? entry.name}
          className={`flex min-h-0 items-center justify-center overflow-hidden rounded${
            // The odd one out of three, given the full width below the pair.
            preview.length === 3 && i === 2 ? ' col-span-2' : ''
          }`}
        >
          <ThumbView thumb={thumbs?.[i]} />
        </div>
      ))}
    </div>
  )
}

interface TileProps {
  entry: DirEntry
  thumb: ThumbState | undefined
  onEnter: (entry: DirEntry) => void
  onModelPointerDown: (e: React.PointerEvent, entry: DirEntry, el: HTMLElement) => void
  onModelOpen: (entry: DirEntry, el: HTMLElement) => void
  onModelHover: (path: string | null) => void
  onEntryMenu: (entry: DirEntry, el: HTMLElement, at: { x: number; y: number }) => void
  marked: boolean
  anchor: boolean
  /** What the index scored this tile at; absent when nothing did (see `Grid`). */
  score: IndexScore | undefined
  /** Which scale `score` is on. Never read when `score` is absent. */
  scale: ScoreScale | null
  /** The models this folder previews, or absent for anything that previews
   *  none — a zip, a model, a folder whose peek has not answered or found
   *  nothing. The map's own array (see `Grid`), so compared by identity. */
  preview: DirEntry[] | undefined
  /** Those models' thumbnails, positionally. Rebuilt every render, so
   *  `tilePropsEqual` is the one place that knows to compare it elementwise. */
  previewThumbs: (ThumbState | undefined)[] | undefined
}

/**
 * React's own shallow compare, with exactly one prop exempted.
 *
 * `previewThumbs` is a fresh array on every render — `Grid` has to build it by
 * looking each preview path up in the thumbs map — so identity would report
 * every sheet as changed on every render and undo the memo for precisely the
 * tiles it is most needed on. Its *elements* are stable, though: `setThumb`
 * copies the map but reuses the per-path state objects it did not touch, so an
 * elementwise identity compare answers the real question — did anything this
 * sheet draws change? A keystroke in the search box changes nothing here, and
 * an unrelated tile's thumbnail landing changes nothing here either.
 *
 * Written over the keys rather than as a hand-listed prop check: a list would
 * go on passing silently when a prop is added above and quietly stop comparing
 * it.
 */
function tilePropsEqual(prev: TileProps, next: TileProps): boolean {
  const keys = Object.keys(next) as (keyof TileProps)[]
  if (keys.length !== Object.keys(prev).length) return false
  for (const key of keys) {
    if (key === 'previewThumbs') continue
    if (prev[key] !== next[key]) return false
  }
  const a = prev.previewThumbs
  const b = next.previewThumbs
  if (a === b) return true
  if (a === undefined || b === undefined || a.length !== b.length) return false
  return a.every((state, i) => state === b[i])
}

const Tile = memo(function Tile({
  entry,
  thumb,
  onEnter,
  onModelPointerDown,
  onModelOpen,
  onModelHover,
  onEntryMenu,
  marked,
  anchor,
  score,
  scale,
  preview,
  previewThumbs,
}: TileProps) {
  const ref = useRef<HTMLButtonElement>(null)
  // Locating is the point of reveal (D3): a grid of identical squares ten
  // screens tall is not answered by scrolling alone. `center` rather than
  // `nearest` so the tile never lands flush against the top of the scroller,
  // where the notice row sits and where a sticky header would sit if one is
  // ever added; `nearest` inline because the grid never scrolls sideways.
  // Instant, not smooth: the listing has only just appeared, and a half-second
  // glide over sixty rows is a distraction rather than an orientation.
  useEffect(() => {
    if (marked) ref.current?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  }, [marked])

  const base =
    'group flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 transition-colors hover:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'
  // The mark rides a CSS animation (index.css) rather than a class swap, so the
  // fade is the browser's business and App only has to drop the state that
  // applied it.
  const markClass = marked ? ' animate-reveal-mark' : ''
  // The subject of a similarity view: the model the others were compared
  // against, drawn as the reference rather than as the best result. A ring the
  // neighbours do not have, and deliberately a quiet one — anything louder
  // reads as "this one matched hardest", which is the opposite of what it is.
  const anchorClass = anchor ? ' border-sky-800 ring-1 ring-sky-800' : ''
  // The two numbers, resolved together: either both are drawn or neither is.
  // `scale` is what makes the cosine readable at all — the two scoring routes
  // run on measurably different distributions, so an unlabelled cosine invites
  // a comparison it cannot support (D2).
  const badges = score !== undefined && scale !== null ? { score, scale } : null

  const onMenuKey = (e: React.KeyboardEvent<HTMLButtonElement>): boolean => {
    // Shift+F10 for the platforms that do not send `contextmenu` for the
    // context-menu key itself.
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return false
    e.preventDefault()
    onEntryMenu(entry, e.currentTarget, menuAt(e.currentTarget, { clientX: 0, clientY: 0 }))
    return true
  }

  if (entry.kind !== 'model') {
    return (
      <button
        ref={ref}
        type="button"
        data-entry-tile={entry.path}
        title={entry.name}
        // Named explicitly only where a stored name is drawn below, and absent
        // otherwise. This button has no aria-label of its own, so its accessible
        // name is computed from its contents — which means a stored name would
        // silently *become* the accessible name, and the requirement is that the
        // real name stays there (`library-overrides` D7: the file name is what
        // tells two same-named parts apart and what the user greps their disk
        // for). Set unconditionally it would also change what a deep-search
        // folder tile announces today, from `Beta` to `Alpha/Beta`, so absence
        // is what keeps a library with no store byte-identical.
        //
        // This does put the visible label and the accessible name deliberately
        // out of step (WCAG 2.5.3 "Label in Name") on exactly the tiles a store
        // names. That is the spec's own trade, made knowingly: the real name is
        // the one a reader can act on outside this app. The "folder " prefix
        // keeps the type signal a button-level label would otherwise drop —
        // without it, exactly the tiles a store names (every kit in the demo)
        // would lose what the chrome's own img label gives the unnamed ones
        // (review round four).
        // Kind-split because this branch serves zips too, and the server
        // attaches displayName to any keyed entry without a kind filter: a
        // hand-written store naming a zip must not make it announce "folder"
        // (review round five). A named zip states the real name alone.
        aria-label={
          entry.displayName !== undefined
            ? entry.kind === 'dir'
              ? `folder ${entry.name}`
              : entry.name
            : undefined
        }
        className={base + markClass + anchorClass}
        onClick={() => onEnter(entry)}
        onContextMenu={(e) => {
          e.preventDefault()
          onEntryMenu(entry, e.currentTarget, menuAt(e.currentTarget, e))
        }}
        onKeyDown={onMenuKey}
        // What the grid's observer watches. Folders only: a zip is not peeked
        // (a central-directory read per archive is `listing-tree-cache`'s job),
        // and an attribute it does not carry is one the observer cannot pick up
        // by mistake.
        data-dir-tile={entry.kind === 'dir' ? entry.path : undefined}
      >
        {/* The folder chrome — a tab and a framed body — IS the directory
            tile's icon, drawn whether or not anything previews (Masa,
            2026-08-31): the resting look and the filled look are one shape, so
            a peek landing fills the folder rather than replacing an emoji with
            chrome — no pop-in, and an empty folder still reads as a folder.
            The sheet, when there is one, sits inside: the images are *inside*
            the folder, the way every desktop draws it, which is what keeps a
            one-preview sheet from reading as a model tile. Only zips keep the
            emoji — they are never previewed and are not folders. */}
        {entry.kind === 'dir' ? (
          // role="img" with a "folder" label: the emoji used to leak '📁' into
          // this button's content-derived accessible name, and dropping it took
          // the only type signal a screen reader had for directories while zips
          // kept theirs (review's catch). The chrome now states the type
          // deliberately — a store-less dir tile announces "folder <name>". A
          // named tile's button-level aria-label (the real name, below) takes
          // over whole, so the type signal yields to the real-name rule there —
          // the WCAG 2.5.3 trade already recorded on that attribute.
          <div
            data-folder-chrome
            role="img"
            aria-label="folder"
            className="flex min-h-0 w-full flex-1 flex-col px-1 pt-1"
          >
            <div className="h-2.5 w-1/2 shrink-0 rounded-t-md bg-amber-400/40" />
            <div className="flex min-h-0 w-full flex-1 rounded-b-md rounded-tr-md bg-amber-400/40 p-1">
              {preview !== undefined && preview.length > 0 && (
                <ContactSheet preview={preview} thumbs={previewThumbs} />
              )}
            </div>
          </div>
        ) : (
          <span className="text-4xl">🗜️</span>
        )}
        {/* Labeled by its own name like a model tile is: a deep-search container
            carries a relative path, and truncating that to fit shows the head of
            the path rather than the folder the user searched for. Path in title.

            The store's name displaces that label where it holds one — this is
            the tile the demo's kit names land on. Display only: the title above,
            the accessible name above, and every matcher go on reading
            `entry.name` (D7). */}
        <span className="w-full truncate text-center text-xs">
          {entry.displayName ?? baseName(entry.name)}
        </span>
      </button>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      data-model-tile={entry.path}
      data-entry-tile={entry.path}
      title={entry.name}
      // The label is shortened to the file name, so the accessible name carries
      // the full one — in flat view that path is the only thing telling two
      // same-named parts apart.
      // The badges reach the label explicitly, the way `anchor` does. An
      // accessible name *replaces* the element's contents rather than joining
      // them — the `<img>` below says as much — so a number drawn inside this
      // button is announced to nobody unless it is stated here (D8). The scales
      // are spelled out: the corner is terse because room there is the
      // constraint, and read aloud `k` is a letter this app already spends on
      // the neighbour count.
      aria-label={
        (thumb?.status === 'error' ? `${entry.name} — failed to load` : entry.name) +
        (anchor ? ' — the model these are compared against' : '') +
        (badges === null
          ? ''
          : ` — ${SCALE_SPOKEN[badges.scale]} ${formatCosine(badges.score.score)}, ${Z_LABEL} ${formatZ(badges.score.z)}`)
      }
      className={`${base} touch-none select-none${markClass}${anchorClass}`}
      onPointerDown={(e) => onModelPointerDown(e, entry, e.currentTarget)}
      // The press that raises a menu never orbits: App's `onModelPointerDown`
      // returns on `e.button !== 0` before any overlay is set.
      onContextMenu={(e) => {
        e.preventDefault()
        onEntryMenu(entry, e.currentTarget, menuAt(e.currentTarget, e))
      }}
      onKeyDown={(e) => {
        if (onMenuKey(e)) return
        // Keyboard activation fires click, not pointerdown — handle it here.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onModelOpen(entry, e.currentTarget)
        }
      }}
      onPointerEnter={() => onModelHover(entry.path)}
      onPointerLeave={() => onModelHover(null)}
    >
      <div data-tile-content className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        <ThumbView thumb={thumb} />
        {/* Over the image, never composited into it: a badge painted into the
            render would make the score part of the thumbnail's cache key, and
            every query change would re-render the grid (D5). `aria-hidden`
            because the button states these numbers in its own name above —
            drawn here, read there, one source. */}
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
      {/* Above the name rather than below it: it captions the tile, and it must
          not become the tile's last line, which is what a label is read from. */}
      {anchor && (
        <span className="w-full truncate text-center text-[0.625rem] uppercase tracking-wide text-sky-500">
          Compared against
        </span>
      )}
      {/* Flat-view names carry the relative path (`dir/foo.stl`, `a.zip!/b.stl`) — the
          tile shows just the file name; the path is in the title and aria-label.

          A stored name displaces it where one is carried, exactly as on the
          container tile above. Nothing else moves: this button already states
          the real name in `aria-label`, so the accessible name needs no help
          here the way the container's does (D7). */}
      <span className="w-full truncate text-center text-xs">
        {entry.displayName ?? baseName(entry.name)}
      </span>
    </button>
  )
}, tilePropsEqual)
