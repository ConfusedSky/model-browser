import { memo, useEffect, useRef } from 'react'
import { baseName } from '../../../shared/names'
import type { DirEntry } from '../../../shared/types'
import type { ThumbState } from '../hooks/useThumbnails'

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
}: Props) {
  if (entries.length === 0) {
    return <p className="mt-16 text-center text-sm text-zinc-600">Nothing to show here.</p>
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 p-4">
      {entries.map((entry) => (
        <Tile
          key={entry.path}
          entry={entry}
          thumb={thumbs.get(entry.path)}
          onEnter={onEnter}
          onModelPointerDown={onModelPointerDown}
          onModelOpen={onModelOpen}
          onModelHover={onModelHover}
          onEntryMenu={onEntryMenu}
          // A boolean per tile, not the path: only the marked tile's props
          // change, so the memo keeps the other 499 from re-rendering.
          marked={entry.path === markedPath}
        />
      ))}
    </div>
  )
}

export default memo(Grid)

const Tile = memo(function Tile({
  entry,
  thumb,
  onEnter,
  onModelPointerDown,
  onModelOpen,
  onModelHover,
  onEntryMenu,
  marked,
}: {
  entry: DirEntry
  thumb: ThumbState | undefined
  onEnter: (entry: DirEntry) => void
  onModelPointerDown: (e: React.PointerEvent, entry: DirEntry, el: HTMLElement) => void
  onModelOpen: (entry: DirEntry, el: HTMLElement) => void
  onModelHover: (path: string | null) => void
  onEntryMenu: (entry: DirEntry, el: HTMLElement, at: { x: number; y: number }) => void
  marked: boolean
}) {
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
        className={base + markClass}
        onClick={() => onEnter(entry)}
        onContextMenu={(e) => {
          e.preventDefault()
          onEntryMenu(entry, e.currentTarget, menuAt(e.currentTarget, e))
        }}
        onKeyDown={onMenuKey}
      >
        <span className="text-4xl">{entry.kind === 'dir' ? '📁' : '🗜️'}</span>
        {/* Labeled by its own name like a model tile is: a deep-search container
            carries a relative path, and truncating that to fit shows the head of
            the path rather than the folder the user searched for. Path in title. */}
        <span className="w-full truncate text-center text-xs">{baseName(entry.name)}</span>
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
      aria-label={thumb?.status === 'error' ? `${entry.name} — failed to load` : entry.name}
      className={`${base} touch-none select-none${markClass}`}
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
        {thumb?.status === 'error' ? (
          <span className="text-2xl" title="Failed to load model">⚠️</span>
        ) : thumb?.url !== undefined ? (
          <img
            src={thumb.url}
            alt="" // decorative: the button's aria-label names the model
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        )}
      </div>
      {/* Flat-view names carry the relative path (`dir/foo.stl`, `a.zip!/b.stl`) — the
          tile shows just the file name; the path is in the title and aria-label. */}
      <span className="w-full truncate text-center text-xs">{baseName(entry.name)}</span>
    </button>
  )
})
