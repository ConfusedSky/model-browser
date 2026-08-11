import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { DirEntry, LightingMode } from '../../shared/types'
import { HttpApiClient } from './api/client'
import ChatPanel from './components/ChatPanel'
import Grid from './components/Grid'
import PathBar from './components/PathBar'
import { SKELETON_DELAY_MS, useDelayedFlag } from './hooks/useDelayedFlag'
import { useThumbnails } from './hooks/useThumbnails'
import { GestureTracker } from './lib/gesture'
import { createHoverWarmer } from './lib/hover'
import { fitSquareBox, type Box } from './lib/layout'
import { getLastPath, pushRecent } from './lib/recents'
import { MeshLru } from './three/lru'
import { disposeModel, embedded3mfThumbnail, formatOf, geometryBytes, parseModel } from './three/models'
import { RenderQueue } from './three/queue'
import { RIG_VERSION } from './three/renderer'
import ViewerLayer, { type ViewerState } from './viewer/ViewerLayer'
import { getLightingMode, LIGHTING_MODES, setLightingMode } from './viewer/lighting'
import { rimShadowsEnabled, setRimShadowsEnabled } from './viewer/rimShadows'
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
  const [flat, setFlat] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [lighting, setLightingState] = useState<LightingMode>(getLightingMode)
  const [rimShadows, setRimShadowsState] = useState(rimShadowsEnabled)
  const trackerRef = useRef(new GestureTracker())

  const showSkeleton = useDelayedFlag(pending, SKELETON_DELAY_MS)
  const { thumbs, setThumb, setPlaceholder } = useThumbnails(listing, api, lru, queue)
  placeholderRef.current = setPlaceholder

  // A flat walk can take seconds while a nested listing returns immediately,
  // so responses can land out of order — only the newest request may write.
  const requestRef = useRef(0)

  const fetchListing = useCallback(
    (target: string, asFlat: boolean, onFail?: () => void) => {
      const req = ++requestRef.current
      setPending(true)
      void api
        .listDir(target, { flat: asFlat })
        .then((res) => {
          if (req !== requestRef.current) return
          setPending(false)
          setPath(target)
          setListing(res.entries)
          setTruncated(res.truncated === true)
          setError(null)
          pushRecent(target)
        })
        .catch((err: unknown) => {
          if (req !== requestRef.current) return
          setPending(false)
          setError(err instanceof Error ? err.message : String(err))
          onFail?.()
        })
    },
    [api],
  )

  const navigate = useCallback((target: string) => fetchListing(target, flat), [fetchListing, flat])

  function toggleFlat(): void {
    const next = !flat
    setFlat(next)
    // The button reflects the request immediately so a second click reads as
    // "turn it back off", but a failed request must not leave it lit over a
    // grid that never changed — nor make every later navigation go flat.
    if (path !== '') fetchListing(path, next, () => setFlat(!next))
  }

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

  /**
   * The overlay replaces the thumbnail image, not the whole tile: same pixels,
   * same square aspect as the PNG (seamless handoff), and the label row below
   * stays visible. Falls back to the centered square of the content area when
   * no <img> has rendered yet.
   */
  function overlayRectFor(el: HTMLElement): Box {
    const img = el.querySelector('img')
    if (img !== null) {
      const r = img.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    const content = el.querySelector('[data-tile-content]') ?? el
    return fitSquareBox(content.getBoundingClientRect())
  }

  function onModelPointerDown(e: React.PointerEvent, entry: DirEntry, el: HTMLElement): void {
    if (e.button !== 0) return
    trackerRef.current.start(e.clientX, e.clientY)
    setViewer({
      mode: 'orbit',
      entry,
      rect: overlayRectFor(el),
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
        // Capture before the await: a rapid axis change or lighting toggle
        // mid-snapshot must not pair this PNG with newer values in one PUT.
        const { state, axis } = session
        const lighting = getLightingMode()
        const png = await session.snapshot()
        const url = URL.createObjectURL(png)
        // Decode before applying, so when this promise resolves the tile's
        // <img> swap cannot paint a half-decoded frame — the orbit overlay
        // holds its dismissal on that guarantee.
        const decode = createImageBitmap(png).then(
          (bitmap) => bitmap.close(),
          () => {
            const img = new Image()
            img.src = url
            return img.decode().catch(() => {})
          },
        )
        await Promise.all([
          decode,
          api.putThumb({
            path: entry.path,
            mtime: entry.mtime,
            png,
            camera: state,
            axis,
            lighting,
            rig: RIG_VERSION,
          }),
        ])
        setThumb(entry.path, { status: 'ready', url, camera: state, axis })
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
        <button
          type="button"
          onClick={toggleFlat}
          aria-pressed={flat}
          title="Show every model under this folder in one grid"
          className={`rounded-lg border px-3 py-2 text-sm ${
            flat
              ? 'border-sky-500 text-sky-400 hover:border-sky-400'
              : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
          }`}
        >
          Flat
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto" aria-busy={showSkeleton || undefined}>
          {path === '' && !showSkeleton ? (
            <p className="mt-24 text-center text-sm text-zinc-500">
              Enter a directory path above to browse your models.
            </p>
          ) : showSkeleton ? (
            // The old tiles are stale navigation targets while a slower listing
            // is fetched — unmounting the grid is what makes them unclickable.
            <div
              aria-hidden="true"
              className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 p-4"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded-xl border border-zinc-800 bg-zinc-900"
                />
              ))}
            </div>
          ) : (
            <>
              {truncated && (
                <p className="px-4 pt-3 text-xs text-amber-400">
                  Showing {listing.filter((e) => e.kind === 'model').length} models; some were
                  omitted.
                </p>
              )}
              <Grid
                entries={listing}
                thumbs={thumbs}
                onEnter={enterEntry}
                onModelPointerDown={onModelPointerDown}
                onModelOpen={openLightbox}
                onModelHover={(p) => (p !== null ? hover.enter(p) : hover.leave())}
              />
            </>
          )}
        </main>
        <ChatPanel />
      </div>
      {/* EXPERIMENTAL lighting-mode picker — remove once a winner is chosen */}
      <div className="fixed bottom-3 left-3 z-50 flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/90 p-1 text-xs">
        <span className="px-2 text-zinc-500">light</span>
        {LIGHTING_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setLightingMode(m)
              setLightingState(m)
            }}
            className={`rounded-full px-2.5 py-1 ${
              m === lighting ? 'bg-sky-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {m}
          </button>
        ))}
        {/* SCAFFOLDING: rim shadow casting on/off, live view only — removed after the comparison */}
        <span className="h-4 w-px bg-zinc-700" />
        <button
          type="button"
          aria-pressed={rimShadows}
          title="Let the red/blue rim lights cast shadows too, in the live view"
          onClick={() => {
            setRimShadowsEnabled(!rimShadows)
            setRimShadowsState(!rimShadows)
          }}
          className={`rounded-full px-2.5 py-1 ${
            rimShadows ? 'bg-sky-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          rim shadows
        </button>
      </div>
      {viewer !== null && (
        <ViewerLayer
          viewer={viewer}
          camera={thumbs.get(viewer.entry.path)?.camera}
          axis={thumbs.get(viewer.entry.path)?.axis}
          lighting={lighting}
          rimShadows={rimShadows}
          api={api}
          lru={lru}
          tracker={trackerRef.current}
          onPromote={() => setViewer((v) => (v !== null ? { ...v, mode: 'lightbox' } : v))}
          onDismiss={closeViewer}
          onPersist={persist}
          onLoadError={() => setThumb(viewer.entry.path, { status: 'error' })}
        />
      )}
    </div>
  )
}
