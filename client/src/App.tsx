import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { DirEntry } from '../../shared/types'
import { HttpApiClient } from './api/client'
import ChatPanel from './components/ChatPanel'
import Grid from './components/Grid'
import PathBar from './components/PathBar'
import { useThumbnails } from './hooks/useThumbnails'
import { GestureTracker } from './lib/gesture'
import { createHoverWarmer } from './lib/hover'
import { getLastPath, pushRecent } from './lib/recents'
import { MeshLru } from './three/lru'
import { disposeModel, embedded3mfThumbnail, formatOf, geometryBytes, parseModel } from './three/models'
import { RenderQueue } from './three/queue'
import ViewerLayer, { type ViewerState } from './viewer/ViewerLayer'
import type { ViewerSession } from './viewer/session'

export default function App() {
  const api = useMemo(() => new HttpApiClient(), [])
  const queue = useMemo(() => new RenderQueue(2), [])
  const placeholderRef = useRef<(path: string, url: string) => void>(() => {})
  const lru = useMemo(
    () =>
      new MeshLru<THREE.Object3D>(async (path) => {
        const format = formatOf(path)
        if (format === null) throw new Error(`not a model: ${path}`)
        const bytes = await api.fetchModel(path)
        if (format === '3mf') {
          const preview = embedded3mfThumbnail(bytes)
          if (preview !== null) placeholderRef.current(path, preview)
        }
        const object = parseModel(bytes, format)
        return { object, bytes: geometryBytes(object) }
      }, disposeModel),
    [api],
  )

  const [path, setPath] = useState(getLastPath)
  const [listing, setListing] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const trackerRef = useRef(new GestureTracker())

  const { thumbs, setThumb, setPlaceholder } = useThumbnails(listing, api, lru, queue)
  placeholderRef.current = setPlaceholder

  const navigate = useCallback(
    (target: string) => {
      void api
        .listDir(target)
        .then((res) => {
          setPath(target)
          setListing(res.entries)
          setError(null)
          pushRecent(target)
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err))
        })
    },
    [api],
  )

  useEffect(() => {
    if (path !== '') navigate(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The shared renderer serves one purpose at a time: suspend the thumbnail
  // queue while an orbit overlay or lightbox is active.
  useEffect(() => {
    if (viewer !== null) queue.suspend()
    else queue.resume()
  }, [viewer, queue])

  const hover = useMemo(() => createHoverWarmer((p) => lru.warm(p)), [lru])

  function onModelPointerDown(e: React.PointerEvent, entry: DirEntry, el: HTMLElement): void {
    if (e.button !== 0) return
    trackerRef.current.start(e.clientX, e.clientY)
    const r = el.getBoundingClientRect()
    setViewer({
      mode: 'orbit',
      entry,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      originEl: el,
    })
  }

  function openLightbox(entry: DirEntry, el: HTMLElement): void {
    trackerRef.current.start(0, 0)
    const r = el.getBoundingClientRect()
    setViewer({
      mode: 'lightbox',
      entry,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      originEl: el,
    })
  }

  function enterEntry(entry: DirEntry): void {
    if (entry.kind === 'dir' || entry.kind === 'zip') navigate(entry.path)
  }

  function goUp(): void {
    const zipSep = path.lastIndexOf('!/')
    if (zipSep !== -1) {
      const entry = path.slice(zipSep + 2)
      const parent = entry.includes('/')
        ? path.slice(0, zipSep + 2) + entry.slice(0, entry.lastIndexOf('/'))
        : path.slice(0, zipSep)
      navigate(parent)
      return
    }
    const slash = path.lastIndexOf('/')
    if (slash > 0) navigate(path.slice(0, slash))
    else if (path !== '/') navigate('/')
  }

  const persist = useCallback(
    async (session: ViewerSession) => {
      const entry = viewer?.entry
      if (entry === undefined) return
      try {
        const png = await session.snapshot()
        await api.putThumb({ path: entry.path, mtime: entry.mtime, png, camera: session.state })
        setThumb(entry.path, {
          status: 'ready',
          url: URL.createObjectURL(png),
          camera: session.state,
        })
      } catch {
        // persistence is best-effort; the orbit itself already happened
      }
    },
    [api, setThumb, viewer],
  )

  function closeViewer(): void {
    const origin = viewer?.originEl
    setViewer(null)
    origin?.focus()
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-2 border-b border-zinc-800 p-3">
        <button
          type="button"
          onClick={goUp}
          disabled={path === '' || path === '/'}
          aria-label="Parent directory"
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          ↑
        </button>
        <PathBar path={path} error={error} api={api} onNavigate={navigate} />
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto">
          {path === '' ? (
            <p className="mt-24 text-center text-sm text-zinc-500">
              Enter a directory path above to browse your models.
            </p>
          ) : (
            <Grid
              entries={listing}
              thumbs={thumbs}
              onEnter={enterEntry}
              onModelPointerDown={onModelPointerDown}
              onModelOpen={openLightbox}
              onModelHover={(p) => (p !== null ? hover.enter(p) : hover.leave())}
            />
          )}
        </main>
        <ChatPanel />
      </div>
      {viewer !== null && (
        <ViewerLayer
          viewer={viewer}
          camera={thumbs.get(viewer.entry.path)?.camera}
          api={api}
          lru={lru}
          tracker={trackerRef.current}
          onPromote={() => setViewer((v) => (v !== null ? { ...v, mode: 'lightbox' } : v))}
          onDismiss={closeViewer}
          onPersist={persist}
        />
      )}
    </div>
  )
}
