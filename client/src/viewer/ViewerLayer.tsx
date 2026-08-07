import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { CameraState, DirEntry, OrbitAxis } from '../../../shared/types'
import type { ApiClient } from '../api/client'
import { GestureTracker } from '../lib/gesture'
import type { MeshLru } from '../three/lru'
import { getRenderer } from '../three/renderer'
import { ViewerSession } from './session'

export interface ViewerState {
  mode: 'orbit' | 'lightbox'
  entry: DirEntry
  /** Tile rect at pointerdown — where the orbit overlay sits. */
  rect: { left: number; top: number; width: number; height: number }
  originEl: HTMLElement | null
}

interface Props {
  viewer: ViewerState
  camera: CameraState | undefined
  axis: OrbitAxis | undefined
  api: ApiClient
  lru: MeshLru<THREE.Object3D>
  tracker: GestureTracker
  onPromote: () => void
  onDismiss: () => void
  onPersist: (session: ViewerSession) => Promise<void>
}

const AXIS_LETTERS = ['x', 'y', 'z'] as const

/**
 * The single live-canvas layer: in 'orbit' mode it overlays the pressed tile;
 * in 'lightbox' mode it is a modal with full orbit/zoom, focus-trapped.
 */
export default function ViewerLayer({
  viewer,
  camera,
  axis,
  api,
  lru,
  tracker,
  onPromote,
  onDismiss,
  onPersist,
}: Props) {
  const [session, setSession] = useState<ViewerSession | null>(null)
  const [sessionAxis, setSessionAxis] = useState<OrbitAxis>('y')
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  // A pointer-opened viewer mounts mid-press (orbit); a keyboard-opened one
  // mounts directly in lightbox mode with no pointer down.
  const pointer = useRef({ down: viewer.mode === 'orbit', lastX: 0, lastY: 0 })
  const sessionRef = useRef<ViewerSession | null>(null)
  const modeRef = useRef(viewer.mode)
  modeRef.current = viewer.mode

  // Load the mesh (spinner until warm) and build the session. The saved
  // camera/axis may not be in the thumbs map yet (its queued GET may not have
  // run) — fetch them from the server so a fast open never clobbers a saved
  // orientation with the default view on persist. Camera and axis live in the
  // same cache entry, so a present camera means the axis prop is settled too.
  useEffect(() => {
    let alive = true
    const savedPromise: Promise<{ camera?: CameraState; axis: OrbitAxis }> =
      camera !== undefined
        ? Promise.resolve({ camera, axis: axis ?? 'y' })
        : api
            .getThumb(viewer.entry.path, viewer.entry.mtime)
            .then((r) => ({ camera: r.camera, axis: r.axis ?? ('y' as OrbitAxis) }))
            .catch(() => ({ axis: 'y' as OrbitAxis }))
    void Promise.all([lru.acquire(viewer.entry.path), savedPromise])
      .then(([object, saved]) => {
        if (!alive) return
        const s = new ViewerSession(object, saved.axis, saved.camera)
        sessionRef.current = s
        setSession(s)
        setSessionAxis(saved.axis)
      })
      .catch(() => {
        if (alive) onDismiss()
      })
    return () => {
      alive = false
      sessionRef.current?.close()
      sessionRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.entry.path, lru])

  // Attach the shared canvas and render whenever session/mode/size changes.
  useEffect(() => {
    if (session === null) return
    const host = canvasHostRef.current
    if (host === null) return
    const canvas = getRenderer().domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    host.appendChild(canvas)
    renderNow()
    return () => {
      if (canvas.parentElement === host) host.removeChild(canvas)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, viewer.mode])

  function renderNow(): void {
    const s = sessionRef.current
    const host = canvasHostRef.current
    if (s === null || host === null) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(host.clientWidth * dpr))
    const h = Math.max(1, Math.round(host.clientHeight * dpr))
    s.render(w, h)
  }

  // Global gesture handling: the press that opened the overlay is already in
  // progress, so listeners live on window — and must attach synchronously
  // (before paint), or a fast click's pointerup arrives before they exist.
  useLayoutEffect(() => {
    function onMove(e: PointerEvent): void {
      if (!pointer.current.down) return
      const wasDrag = tracker.isDrag
      const isDrag = tracker.move(e.clientX, e.clientY)
      if (isDrag && sessionRef.current !== null) {
        if (!wasDrag) {
          pointer.current.lastX = e.clientX
          pointer.current.lastY = e.clientY
        }
        sessionRef.current.orbit(
          e.clientX - pointer.current.lastX,
          e.clientY - pointer.current.lastY,
        )
        pointer.current.lastX = e.clientX
        pointer.current.lastY = e.clientY
        renderNow()
      }
    }
    function onUp(e: PointerEvent): void {
      if (!pointer.current.down) return
      pointer.current.down = false
      if (!tracker.isDrag) {
        if (modeRef.current === 'orbit') onPromote()
        return
      }
      const s = sessionRef.current
      // Level the horizon and rebase the rest state, then persist that view.
      if (s !== null) void s.settle(renderNow).then(() => onPersist(s))
      // A drag released outside the tile gets no later pointerleave — the
      // overlay would be stuck. Dismiss now if the release landed outside.
      if (modeRef.current === 'orbit') {
        const rect = containerRef.current?.getBoundingClientRect()
        const inside =
          rect !== undefined &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        if (!inside) onDismiss()
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracker])

  // Orbit mode: dismiss on scroll/resize rather than track the tile.
  useEffect(() => {
    if (viewer.mode !== 'orbit') return
    function dismiss(): void {
      onDismiss()
    }
    window.addEventListener('scroll', dismiss, { capture: true })
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true })
      window.removeEventListener('resize', dismiss)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.mode])

  // Lightbox: focus trap + Esc close; re-render on window resize.
  useEffect(() => {
    if (viewer.mode !== 'lightbox') return
    containerRef.current?.focus()
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') void closeLightbox()
      if (e.key === 'Tab') {
        // Real trap: cycle focus through the dialog and its controls.
        e.preventDefault()
        const dialog = containerRef.current
        if (dialog === null) return
        const focusables = [dialog, ...dialog.querySelectorAll<HTMLElement>('button')]
        const idx = focusables.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey
          ? (idx - 1 + focusables.length) % focusables.length
          : (idx + 1) % focusables.length
        focusables[next]?.focus()
      }
    }
    function onResize(): void {
      renderNow()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.mode, session])

  async function closeLightbox(): Promise<void> {
    const s = sessionRef.current
    if (s !== null) {
      await s.settle(renderNow) // no-op if already level (e.g. Esc mid-drag aside)
      await onPersist(s)
    }
    onDismiss()
  }

  function startGesture(e: React.PointerEvent): void {
    pointer.current = { down: true, lastX: e.clientX, lastY: e.clientY }
    tracker.start(e.clientX, e.clientY)
  }

  // Drives renders while an axis-change tween is in flight. The loop ends on
  // its own when the tween completes or a drag/zoom cancels it.
  const tweenLoopActive = useRef(false)
  function runTweenLoop(): void {
    if (tweenLoopActive.current) return
    tweenLoopActive.current = true
    const step = (): void => {
      renderNow()
      if (sessionRef.current?.animating === true) requestAnimationFrame(step)
      else tweenLoopActive.current = false
    }
    requestAnimationFrame(step)
  }

  // The rest state is already the new spindle's default view, so persistence
  // is immediate — only the visible camera takes the scenic route.
  function changeAxis(next: OrbitAxis): void {
    const s = sessionRef.current
    if (s === null || next === s.axis) return
    s.setAxis(next)
    setSessionAxis(next)
    runTweenLoop()
    void onPersist(s)
  }

  const spinner = (
    <span className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
  )

  if (viewer.mode === 'orbit') {
    const { rect } = viewer
    return (
      <div
        ref={containerRef}
        className="fixed z-30 cursor-grab touch-none rounded-lg bg-zinc-900 ring-1 ring-sky-700/50 active:cursor-grabbing"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        onPointerDown={startGesture}
        onPointerLeave={() => {
          if (!pointer.current.down) onDismiss()
        }}
      >
        <div ref={canvasHostRef} className="h-full w-full" />
        {session === null && spinner}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) void closeLightbox()
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={viewer.entry.name}
        tabIndex={-1}
        className="relative h-[min(80vh,80vw)] w-[min(80vh,80vw)] cursor-grab touch-none rounded-2xl border border-zinc-700 bg-zinc-900 outline-none active:cursor-grabbing"
        onPointerDown={startGesture}
        onWheel={(e) => {
          sessionRef.current?.zoom(e.deltaY > 0 ? 1.1 : 0.9)
          renderNow()
        }}
      >
        <div ref={canvasHostRef} className="h-full w-full" />
        {session === null && spinner}
        {session !== null && (
          <div
            className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-zinc-800/80 p-1 text-xs"
            aria-label="Orbit axis"
          >
            <span className="px-1.5 text-zinc-500">axis</span>
            {AXIS_LETTERS.map((letter) => {
              const flipped = sessionAxis.startsWith('-')
              const active = sessionAxis === letter || sessionAxis === `-${letter}`
              return (
                <button
                  key={letter}
                  type="button"
                  aria-pressed={active}
                  onClick={() => changeAxis(flipped ? (`-${letter}` as OrbitAxis) : letter)}
                  className={`rounded-full px-2.5 py-1 ${
                    active ? 'bg-sky-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {letter.toUpperCase()}
                </button>
              )
            })}
            <span className="h-4 w-px bg-zinc-700" />
            <button
              type="button"
              aria-pressed={sessionAxis.startsWith('-')}
              title="Negate the spindle axis (+axis ↔ −axis)"
              onClick={() =>
                changeAxis(
                  sessionAxis.startsWith('-')
                    ? (sessionAxis.slice(1) as OrbitAxis)
                    : (`-${sessionAxis}` as OrbitAxis),
                )
              }
              className={`rounded-full px-2.5 py-1 ${
                sessionAxis.startsWith('-')
                  ? 'bg-amber-700 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              flip
            </button>
          </div>
        )}
        <button
          type="button"
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700"
          onClick={() => void closeLightbox()}
        >
          ✕
        </button>
        <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-zinc-800/80 px-3 py-1 text-xs text-zinc-300">
          {viewer.entry.name}
        </p>
      </div>
    </div>
  )
}
