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
}

export default function Grid({ entries, thumbs, onEnter, onModelPointerDown, onModelOpen, onModelHover }: Props) {
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
        />
      ))}
    </div>
  )
}

function Tile({
  entry,
  thumb,
  onEnter,
  onModelPointerDown,
  onModelOpen,
  onModelHover,
}: {
  entry: DirEntry
  thumb: ThumbState | undefined
  onEnter: (entry: DirEntry) => void
  onModelPointerDown: (e: React.PointerEvent, entry: DirEntry, el: HTMLElement) => void
  onModelOpen: (entry: DirEntry, el: HTMLElement) => void
  onModelHover: (path: string | null) => void
}) {
  const base =
    'group flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 transition-colors hover:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'

  if (entry.kind !== 'model') {
    return (
      <button type="button" title={entry.name} className={base} onClick={() => onEnter(entry)}>
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
      type="button"
      data-model-tile={entry.path}
      title={entry.name}
      // The label is shortened to the file name, so the accessible name carries
      // the full one — in flat view that path is the only thing telling two
      // same-named parts apart.
      aria-label={thumb?.status === 'error' ? `${entry.name} — failed to load` : entry.name}
      className={`${base} touch-none select-none`}
      onPointerDown={(e) => onModelPointerDown(e, entry, e.currentTarget)}
      onKeyDown={(e) => {
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
}
