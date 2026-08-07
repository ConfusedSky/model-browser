import type { DirEntry } from '../../../shared/types'
import type { ThumbState } from '../hooks/useThumbnails'

interface Props {
  entries: DirEntry[]
  thumbs: Map<string, ThumbState>
  onEnter: (entry: DirEntry) => void
  onModelPointerDown: (e: React.PointerEvent, entry: DirEntry, el: HTMLElement) => void
  onModelHover: (path: string | null) => void
}

export default function Grid({ entries, thumbs, onEnter, onModelPointerDown, onModelHover }: Props) {
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
  onModelHover,
}: {
  entry: DirEntry
  thumb: ThumbState | undefined
  onEnter: (entry: DirEntry) => void
  onModelPointerDown: (e: React.PointerEvent, entry: DirEntry, el: HTMLElement) => void
  onModelHover: (path: string | null) => void
}) {
  const base =
    'group flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 transition-colors hover:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'

  if (entry.kind !== 'model') {
    return (
      <button type="button" className={base} onClick={() => onEnter(entry)}>
        <span className="text-4xl">{entry.kind === 'dir' ? '📁' : '🗜️'}</span>
        <span className="w-full truncate text-center text-xs">{entry.name}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-model-tile={entry.path}
      className={`${base} touch-none select-none`}
      onPointerDown={(e) => onModelPointerDown(e, entry, e.currentTarget)}
      onPointerEnter={() => onModelHover(entry.path)}
      onPointerLeave={() => onModelHover(null)}
    >
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        {thumb?.status === 'error' ? (
          <span className="text-2xl" title="Failed to load model">⚠️</span>
        ) : thumb?.url !== undefined ? (
          <img
            src={thumb.url}
            alt={entry.name}
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        )}
      </div>
      <span className="w-full truncate text-center text-xs">{entry.name}</span>
    </button>
  )
}
