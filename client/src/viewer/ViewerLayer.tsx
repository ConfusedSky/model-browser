import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type * as THREE from 'three'
import type {
  AppRef,
  CameraState,
  DirEntry,
  IndexPose,
  IndexScore,
  LightingMode,
  OrbitAxis,
} from '../../../shared/types'
import type { ApiClient } from '../api/client'
import { MENU_ITEM_CLASS } from '../components/EntryMenu'
import {
  AXIS_CAPTION_CLASS,
  AXIS_DIVIDER_CLASS,
  AXIS_GROUP_CLASS,
  AXIS_LETTERS,
  FLIP_TITLE,
  OPEN_IN_CAPTION,
  OPEN_IN_PANEL_CAPTION_CLASS,
  OPEN_IN_GROUP_CLASS,
  OPEN_IN_PILL_CLASS,
  axisLetter,
  axisPillClass,
  axisWithLetter,
  copyEntryPath,
  flipPillClass,
  isAxisNegated,
  negatedAxis,
  type CommandId,
  type EntryCommand,
  type LiveFramingView,
} from '../lib/entryActions'
import { formatBytes, formatCosine, formatDate, formatZ } from '../lib/format'
import { expandLibraryPath } from '../lib/libraryPath'
import { SCALE_BADGE, Z_LABEL, type ScoreScale } from '../lib/scoreScale'
import { GestureTracker } from '../lib/gesture'
import type { MeshLru } from '../three/lru'
import { DEFAULT_CAMERA } from '../three/camera'
import { cameraForPose } from '../three/pose'
import { getRenderer } from '../three/renderer'
import { liveRenderSize } from './renderSize'
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
  /** The index's orientation for this model, when it has one. Advisory (D5). */
  pose: IndexPose | undefined
  /** What the index scored this model at, when it was opened from a scored
   *  result. Absent for a model opened from any ordinary listing. */
  score: IndexScore | undefined
  /** Which scale `score` is on — the same derivation the tile reads, so the two
   *  surfaces cannot report the number under different names (D7). */
  scoreScale: ScoreScale | null
  /** Active lighting mode — a prop (not read from the store) so toggling repaints the live view. */
  lighting: LightingMode
  /** Ambient occlusion on/off — a prop for the same reason as `lighting`. */
  ao: boolean
  api: ApiClient
  lru: MeshLru<THREE.Object3D>
  tracker: GestureTracker
  onPromote: () => void
  /**
   * Lightbox close affordances (✕, Escape, backdrop) raise an intent instead
   * of closing: App owns the history question — back out of a pushed entry,
   * or drop a deep-linked param — and answers via `closeSignal`.
   */
  onCloseIntent: () => void
  /** Increments when App wants the persisting close to run (url-navigation D3). */
  closeSignal: number
  onDismiss: () => void
  onPersist: (
    session: ViewerSession,
    opts?: { camera?: boolean; posed?: boolean },
  ) => Promise<void>
  onLoadError: (message: string) => void
  /**
   * Raise the shared entry menu on this viewer's own entry, at the pointer.
   *
   * Both modes report it, because both swallow `contextmenu`: the orbit overlay
   * sits over the very tile whose handler would otherwise see the press — and
   * keeps sitting there, invisibly, through the persist hold after a release
   * (PERSIST_HOLD_MS) — so without this a secondary press on a model being
   * viewed reaches nothing at all. `el` is this viewer's own container, which
   * is where dismissal returns focus; in lightbox mode that is the dialog, so
   * the focus trap gets its focus back.
   */
  onEntryMenu: (entry: DirEntry, el: HTMLElement | null, at: { x: number; y: number }) => void
  /**
   * Whether that menu is currently raised, read live.
   *
   * A ref rather than a value: the outcome must not depend on which window
   * listener runs first, and a changing prop would re-run the focus-trap effect
   * below — which focuses the dialog on every run and would pull focus straight
   * out of the menu it just raised.
   */
  menuOpen: { readonly current: boolean }
  /**
   * The entry actions this panel offers, decided by `entryActions` for this
   * entry and this surface (`LIGHTBOX_PANEL_EXCLUDES`) and asked by App — never
   * re-decided here, exactly as the menu never re-decides its own items.
   */
  panelCommands: readonly EntryCommand[]
  /**
   * The library's top as a filesystem path, or null while the library is not
   * `ready` (library R4). App reads it once from `ApiClient.library()`; this
   * panel is handed the string.
   *
   * The two places a path leaves the app are the copy affordance and the `path`
   * line below, and both expand through it (library R2): a library path is this
   * app's private spelling, and the file details are read by someone about to
   * open the file somewhere else. Everything else here — the `modified (zip)`
   * test, the entry lookups, the thumb cache key — goes on reading
   * `viewer.entry.path`, which is and stays the library path.
   */
  libraryTop: string | null
  /**
   * The panel's open-in row (open-in-slicer L10, reversed 2026-08-25): the
   * applications the platform associates with this model's type, default
   * first, or `null` where the row is not offered — a type with no
   * applications, or a report that has not landed. App decides that with
   * `openInApps`, exactly as it decides `panelCommands`; this component only
   * draws it.
   *
   * `null` and not an empty array, the menu's own rule: a caption with no
   * pills under it is an affordance that does nothing, and what does not
   * apply is absent rather than present and inert.
   */
  openIn?: { apps: AppRef[]; onChoose: (appId: string) => void } | null
  /**
   * Run one of them. The bodies are the shared ones and App holds the host, so
   * this component carries no copy of any command — only the live view a reset
   * needs to re-frame, which is the one thing App cannot reach: the session is
   * private to this component.
   */
  onCommand: (id: CommandId, live: LiveFramingView | null) => void
  /**
   * A launch failure's sentence, rendered *here* rather than under the path
   * bar. The lightbox is `fixed inset-0 z-lightbox` over that bar behind a 70% scrim,
   * so a sentence sent there is dimmed, corner-parked and gone in 2.5s while
   * the user is looking at the panel on the right. Success is silent by design,
   * which makes this the only feedback a launch raised from the panel gives —
   * the same per-surface split `copyError` already makes, App holding the
   * sentence and the surface holding where it lands.
   */
  actionError?: string | null
}

/** Longest the orbit overlay holds its dismissal waiting for the refreshed thumbnail. */
export const PERSIST_HOLD_MS = 1500

/**
 * The single live-canvas layer: in 'orbit' mode it overlays the pressed tile;
 * in 'lightbox' mode it is a modal with full orbit/zoom, focus-trapped.
 */
export default function ViewerLayer({
  viewer,
  camera,
  axis,
  pose,
  score,
  scoreScale,
  lighting,
  ao,
  api,
  lru,
  tracker,
  onPromote,
  onCloseIntent,
  closeSignal,
  onDismiss,
  onPersist,
  onLoadError,
  onEntryMenu,
  menuOpen,
  panelCommands,
  libraryTop,
  openIn = null,
  onCommand,
  actionError = null,
}: Props) {
  const [session, setSession] = useState<ViewerSession | null>(null)
  const [sessionAxis, setSessionAxis] = useState<OrbitAxis>('y')
  /** Mesh-load failure message — the viewer shows it instead of dismissing. */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /** The panel's brief failure report — the surface half of the shared copy
   *  command's failure path (task 1.2/1.3). */
  const [copyError, setCopyError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  /**
   * Whether the orientation on screen is the index's rather than the user's —
   * set when the session opens at a pose, and re-decided by a framing reset,
   * which installs exactly such an orientation (or the default). Read on close
   * to decide what may be written and how the pixels are labelled.
   */
  const openedFromPoseRef = useRef(false)
  /**
   * Whether a *reset framing* in this session discarded the model's stored
   * orientation. Separate from the ref above because the two disagree in the
   * case that matters: a reset with no usable pose leaves the view at the
   * default, which came from no index and must still never be written back —
   * writing it would store an orientation the user did not choose, and D7's
   * whole point is that a stored default is worse than nothing (it disqualifies
   * the model from ever being posed).
   */
  const framingDiscardedRef = useRef(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // A pointer-opened viewer mounts mid-press (orbit); a keyboard-opened one
  // mounts directly in lightbox mode with no pointer down.
  const pointer = useRef({ down: viewer.mode === 'orbit', lastX: 0, lastY: 0 })
  // A held dismissal can keep this component mounted while a new press
  // replaces the viewer prop — re-arm the gesture state exactly as a fresh
  // mount would, or the new tile's drag/promote would be dead (D4).
  const prevViewerRef = useRef(viewer)
  if (prevViewerRef.current !== viewer) {
    prevViewerRef.current = viewer
    pointer.current = { down: viewer.mode === 'orbit', lastX: 0, lastY: 0 }
  }
  const sessionRef = useRef<ViewerSession | null>(null)
  const modeRef = useRef(viewer.mode)
  modeRef.current = viewer.mode
  const viewerRef = useRef(viewer)
  viewerRef.current = viewer
  /** In-flight settle→persist chain from the last drag release (D1). */
  const pendingPersistRef = useRef<Promise<void> | null>(null)

  /**
   * Post-drag dismissal: hold the overlay until the refreshed thumbnail is
   * applied and paintable (or a short timeout), so it unmounts onto matching
   * pixels. Dismisses synchronously when nothing is pending. A held dismissal
   * yields to any newer interaction (D4).
   */
  async function dismissAfterPersist(): Promise<void> {
    const pending = pendingPersistRef.current
    if (pending === null) {
      onDismiss()
      return
    }
    const scheduledViewer = viewerRef.current
    await Promise.race([pending, new Promise((r) => setTimeout(r, PERSIST_HOLD_MS))])
    // Two rAFs: let React commit the new <img> src and the browser paint it
    // beneath the still-mounted overlay before unmounting.
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    if (pointer.current.down) return // a new gesture owns dismissal now
    if (viewerRef.current !== scheduledViewer) return // a newer viewer replaced this one
    onDismiss()
  }

  // Load the mesh (spinner until warm) and build the session. The saved
  // camera/axis may not be in the thumbs map yet (its queued GET may not have
  // run) — fetch them from the server so a fast open never clobbers a saved
  // orientation with the default view on persist. Camera and axis live in the
  // same cache entry, so a present camera means the axis prop is settled too.
  useEffect(() => {
    let alive = true
    // An index orientation is the *default* only: a stored axis or camera is
    // the user's own and wins, and applying a pose persists nothing — the
    // sidecar is written by orbiting, not by opening (semantic-search D5).
    const fromPose = cameraForPose(pose, DEFAULT_CAMERA)
    // Whether this session opened at an orientation the index suggested rather
    // than one the user stored — read on close, to decide what may be written.
    openedFromPoseRef.current = false
    // A new session has discarded nothing yet — a held dismissal can keep this
    // component mounted across entries.
    framingDiscardedRef.current = false
    const savedPromise: Promise<{ camera?: CameraState; axis: OrbitAxis }> =
      camera !== undefined
        ? Promise.resolve({ camera, axis: axis ?? 'y' })
        : api
            .getThumb(viewer.entry.path, viewer.entry.mtime)
            .then((r) => {
              const posed = r.camera === undefined && r.axis === undefined && fromPose !== null
              openedFromPoseRef.current = posed
              return {
                camera: posed ? fromPose.camera : r.camera,
                axis: r.axis ?? (posed ? fromPose.axis : ('y' as OrbitAxis)),
              }
            })
            .catch(() => {
              openedFromPoseRef.current = fromPose !== null
              return { camera: fromPose?.camera, axis: fromPose?.axis ?? ('y' as OrbitAxis) }
            })
    void Promise.all([lru.acquire(viewer.entry.path), savedPromise])
      .then(([object, saved]) => {
        if (!alive) return
        const s = new ViewerSession(object, saved.axis, saved.camera)
        sessionRef.current = s
        setSession(s)
        setSessionAxis(saved.axis)
      })
      .catch((err: unknown) => {
        // Missing file / gone zip entry / parse failure: show it, don't
        // silently dismiss — and flip the tile so the stale thumbnail stops
        // advertising a healthy model.
        if (!alive) return
        const message = err instanceof Error ? err.message : String(err)
        setLoadError(message)
        onLoadError(message)
      })
    return () => {
      alive = false
      sessionRef.current?.close()
      sessionRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.entry.path, lru])

  // Attach the shared canvas and render whenever session/mode/size changes —
  // and on a lighting-mode or AO toggle, so the switch is visible without a drag.
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
  }, [session, viewer.mode, lighting, ao])

  function renderNow(): void {
    const s = sessionRef.current
    const host = canvasHostRef.current
    if (s === null || host === null) return
    // Above device resolution, so the browser downsamples: a thumbnail is a
    // 512² render shown in a ~176 px tile, and matching that sample density is
    // what keeps the live view from reading as the aliased one at handoff.
    const { width, height } = liveRenderSize(
      host.clientWidth,
      host.clientHeight,
      window.devicePixelRatio || 1,
    )
    s.render(width, height)
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
      // The chain is kept so post-drag dismissals can await it (D1).
      if (s !== null) {
        const p = s
          .settle(renderNow)
          .then(() => onPersist(s, { camera: true }))
          .finally(() => {
            if (pendingPersistRef.current === p) pendingPersistRef.current = null
          })
        pendingPersistRef.current = p
      }
      // A drag released outside the tile gets no later pointerleave — the
      // overlay would be stuck. Dismiss (persistence-aware) if the release
      // landed outside.
      if (modeRef.current === 'orbit') {
        const rect = containerRef.current?.getBoundingClientRect()
        const inside =
          rect !== undefined &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        if (!inside) void dismissAfterPersist()
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
      // The entry menu can now be raised over this view, and while it is up it
      // is the thing on top: its own window listener closes it and this one
      // stands down, so one press dismisses one thing. The next press finds the
      // ref false and closes the lightbox as before. Same idiom, same reason as
      // App's find control standing down for a menu.
      if (e.key === 'Escape') {
        if (menuOpen.current) return
        onCloseIntent()
      }
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
      // Always persists — `model-viewer` requires a close to save camera and
      // thumbnail like an orbit release does. What it may not save is an
      // orientation the *index* suggested and the user never touched: that
      // would become their stored camera after one open, and "a stored axis
      // wins" would then keep it forever, outliving the re-classification that
      // would have corrected it (semantic-search D5). So the pixels go either
      // way; the camera goes only when it records a decision.
      //
      // A framing reset is the second view that records none, and the strictest
      // one: the user pressed a button to give the stored orientation up, so a
      // close that wrote *any* camera back — the discarded one, or the default
      // it resolved to — would undo the press. Orbiting after the reset is a
      // new decision and does get written, which is why `everManipulated` still
      // leads (`reframe` cleared it, so only a later drag can set it again).
      const unowned = openedFromPoseRef.current || framingDiscardedRef.current
      const decided = s.everManipulated || !unowned
      // The pose label describes the pixels, so it follows what is on screen
      // and not what may be written: a reset that found no usable pose leaves
      // the view at the default, and labelling those pixels posed would tell
      // the grid a pose it has never applied is already in force.
      await onPersist(s, { camera: decided, posed: openedFromPoseRef.current && !s.everManipulated })
    }
    onDismiss()
  }

  // App's answer to a close intent (and the browser-back path): run the SAME
  // async teardown as every in-app affordance — settle, persist, dismiss. The
  // session is private to this component, so no one else can run it.
  const handledCloseRef = useRef(closeSignal)
  useEffect(() => {
    if (closeSignal === handledCloseRef.current) return
    handledCloseRef.current = closeSignal
    if (viewer.mode === 'lightbox') void closeLightbox()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal])

  function startGesture(e: React.PointerEvent): void {
    // Primary button only, exactly as the tile's own handler decides
    // (App.onModelPointerDown): orbit is a left-drag, and a secondary press is
    // the menu's. Without this the release after a right-click would find a
    // gesture in progress and promote the overlay to the lightbox behind the
    // menu it just raised.
    if (e.button !== 0) return
    pointer.current = { down: true, lastX: e.clientX, lastY: e.clientY }
    tracker.start(e.clientX, e.clientY)
  }

  /**
   * The secondary press on either viewer surface: the app's own entry menu,
   * never the browser's. Nothing collides — there is no right-button gesture
   * here to preserve.
   */
  function raiseEntryMenu(e: React.MouseEvent): void {
    e.preventDefault()
    onEntryMenu(viewer.entry, containerRef.current, { x: e.clientX, y: e.clientY })
  }

  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  /**
   * The copy affordance, through the shared command (entry-actions R1) — the
   * same body the context menu invokes, so the same text lands on the clipboard
   * and the same sentence reports a write that did not.
   *
   * What stays here is presentation: the button that says "copied", and where
   * the failure sentence is rendered. The panel's old fallback — selecting the
   * path text for a manual copy — is gone with the move; see `copyEntryPath`.
   */
  function copyPath(): void {
    copyEntryPath(viewer.entry, {
      libraryTop,
      confirm: () => {
        setCopyError(null)
        setCopied(true)
        clearTimeout(copyTimerRef.current)
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
      },
      report: (message) => {
        // An earlier copy's confirmation must not outlive this failure.
        clearTimeout(copyTimerRef.current)
        setCopied(false)
        setCopyError(message)
        copyTimerRef.current = setTimeout(() => setCopyError(null), 2500)
      },
    })
  }

  /**
   * A panel affordance pressed: the shared command, through App's host.
   *
   * What travels with it is the live view — this component's session, which is
   * private to it and is the thing a framing reset has to move. Handed over for
   * every command, not just that one: the surface reports what it has, and
   * which commands care is `entryActions`' business.
   */
  function runPanelCommand(id: CommandId): void {
    const s = sessionRef.current
    const live: LiveFramingView | null =
      s === null
        ? null
        : {
            axis: s.axis,
            reframe: (nextCamera, nextAxis, posed) => {
              s.reframe(nextCamera, nextAxis)
              setSessionAxis(nextAxis)
              runTweenLoop()
              // The view on screen is now the index's orientation or the
              // default — either way not the user's, and the close must not
              // write it back over the discard just made.
              openedFromPoseRef.current = posed
              framingDiscardedRef.current = true
            },
          }
    onCommand(id, live)
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
        className="fixed z-orbit-overlay cursor-grab touch-none rounded-lg bg-zinc-900 active:cursor-grabbing"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        onPointerDown={startGesture}
        onContextMenu={raiseEntryMenu}
        onPointerLeave={() => {
          if (!pointer.current.down) void dismissAfterPersist()
        }}
      >
        <div ref={canvasHostRef} className="h-full w-full" />
        {session === null &&
          (loadError !== null ? (
            <span
              role="alert"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-zinc-800/90 px-2.5 py-1 text-xs text-red-400"
            >
              ⚠ failed to load
            </span>
          ) : (
            spinner
          ))}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-lightbox flex items-center justify-center bg-black/70"
      onContextMenu={raiseEntryMenu}
      onPointerDown={(e) => {
        // Primary button only, for the same reason `startGesture` checks it: a
        // secondary press on the backdrop raises the menu, and closing the view
        // out from under the menu it just raised is not what was asked.
        if (e.button === 0 && e.target === e.currentTarget) onCloseIntent()
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={viewer.entry.name}
        tabIndex={-1}
        // The dialog's two width facts, declared once here because it is the
        // element that owns both: everything inside sizes itself from them.
        // The square below is `--lb-width` minus `--lb-panel`, which is only
        // true while those are *the* max-width and *the* panel width — so they
        // are read, not restated. Three sites used to spell `95vw`, `18rem` and
        // `w-72` independently, and a panel widened in one place would have
        // silently overlapped the model rather than visibly breaking.
        style={{ '--lb-width': '95vw', '--lb-panel': '18rem' } as CSSProperties}
        className="relative flex max-w-[var(--lb-width)] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 outline-none"
      >
        {/* The square is load-bearing: snapshot() captures at aspect = 1, so a
            squeezed live view would disagree with its thumbnail (D1) — which is
            why this shrinks as a square rather than being allowed to flatten.

            Sized against the space left *after* the panel, not against the
            viewport alone. It used to be `min(80vh,80vw)`, which took its share
            first and left the panel whatever remained: measured 2026-08-26, a
            760px window gave the model 594px and crushed the panel to 126px, a
            640px window to 94px, a 520px window to 76px — narrow enough that
            the panel's own path text overflowed and it grew a horizontal
            scrollbar. `--lb-width` minus `--lb-panel` (both declared on the
            dialog) is the room left over, which is what the model now takes.
            The `16rem` floor is the other direction's honesty:
            below roughly 570px there is not enough room for both, and a 130px
            model view is useless where a 256px one beside a narrower panel is
            still usable. Below that the panel narrows again — genuinely
            stacking it under the model would contradict "an info panel beside
            the viewer" in `model-viewer`, so it belongs to a change that owns
            that requirement. */}
        <div className="relative h-[min(80vh,max(16rem,calc(var(--lb-width)_-_var(--lb-panel))))] w-[min(80vh,max(16rem,calc(var(--lb-width)_-_var(--lb-panel))))] shrink-0">
          <div
            ref={canvasHostRef}
            className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
            onPointerDown={startGesture}
            onWheel={(e) => {
              sessionRef.current?.zoom(e.deltaY > 0 ? 1.1 : 0.9)
              renderNow()
            }}
          />
          {session === null &&
            (loadError !== null ? (
              <div
                role="alert"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center"
              >
                <span className="text-2xl" aria-hidden="true">
                  ⚠
                </span>
                <p className="text-sm font-medium text-zinc-200">{viewer.entry.name}</p>
                <p className="text-xs text-red-400">{loadError}</p>
              </div>
            ) : (
              spinner
            ))}
          {session !== null && (
            // This row is the axis control's source of truth; the tile menu's
            // group draws the same four buttons from the same strings and
            // rules, which live in `entryActions` so neither copy can drift
            // (second look at 6.8).
            <div className={`absolute left-3 top-3 ${AXIS_GROUP_CLASS}`} aria-label="Orbit axis">
              <span className={AXIS_CAPTION_CLASS}>axis</span>
              {AXIS_LETTERS.map((letter) => {
                const active = axisLetter(sessionAxis) === letter
                return (
                  <button
                    key={letter}
                    type="button"
                    aria-pressed={active}
                    onClick={() => changeAxis(axisWithLetter(sessionAxis, letter))}
                    className={axisPillClass(active)}
                  >
                    {letter.toUpperCase()}
                  </button>
                )
              })}
              <span className={AXIS_DIVIDER_CLASS} />
              <button
                type="button"
                aria-pressed={isAxisNegated(sessionAxis)}
                title={FLIP_TITLE}
                onClick={() => changeAxis(negatedAxis(sessionAxis))}
                className={flipPillClass(isAxisNegated(sessionAxis))}
              >
                flip
              </button>
            </div>
          )}
        </div>
        <div className="flex w-[var(--lb-panel)] min-w-0 flex-col gap-4 overflow-y-auto p-4">
          {/* pr-9 keeps the name clear of the dialog-anchored close button */}
          <p className="break-all pr-9 text-sm font-medium text-zinc-200">{viewer.entry.name}</p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">path</span>
              <button
                type="button"
                aria-label="Copy path"
                onClick={copyPath}
                className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
            {/* The filesystem path, not the library path (library R2): this
                line is read to be typed or pasted somewhere else, and it has to
                agree with what the copy button beside it puts on the clipboard
                — one expansion, `expandLibraryPath`, called from both. */}
            <p className="select-text break-all text-xs text-zinc-300">
              {expandLibraryPath(libraryTop, viewer.entry.path)}
            </p>
            {copyError !== null && (
              <p role="status" className="text-xs text-red-400">
                {copyError}
              </p>
            )}
          </div>
          <dl className="flex flex-col gap-2 text-xs">
            {viewer.entry.format !== undefined && (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">format</dt>
                <dd className="uppercase text-zinc-300">{viewer.entry.format}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">size</dt>
              <dd className="text-zinc-300">{formatBytes(viewer.entry.size)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">
                {viewer.entry.path.includes('!/') ? 'modified (zip)' : 'modified'}
              </dt>
              <dd className="text-right text-zinc-300">{formatDate(viewer.entry.mtime)}</dd>
            </div>
            {/* Among the metadata and before the action strip: the panel
                describes the model first and offers what can be done to it
                second, which is a requirement of the lightbox and easy to break
                by appending. Same labels as the tile's corners, from the same
                derivation, so the two surfaces cannot report one number under
                two names (D7). Unlike the tile, nothing here needs restating for
                a reader — a `<dl>` is read as written. */}
            {score !== undefined && scoreScale !== null && (
              <>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">{SCALE_BADGE[scoreScale]}</dt>
                  <dd className="tabular-nums text-zinc-300">{formatCosine(score.score)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">{Z_LABEL}</dt>
                  <dd className="tabular-nums text-zinc-300">{formatZ(score.z)}</dd>
                </div>
              </>
            )}
          </dl>
          {/* The entry actions as affordances rather than only behind a
              secondary press (6.6) — the same commands the menu raises, beside
              the copy affordance that was already one of them. Named for the
              model, not "Entry actions": the menu can be raised over this very
              panel, and two things sharing an accessible name are one thing to
              anything reading names.

              **Last in the panel, and drawn as menu items** *(user feedback
              2026-08-22, 6.8)*: what the panel is is a description of the model,
              so the facts about it come first and the things one can do to it
              come after — and these are the same commands the menu offers, so
              they are the menu's rows rather than a second look for one thing.
              `MENU_ITEM_CLASS` is imported from `EntryMenu`, which owns that
              look. The copy affordance stays a pill up beside the path it
              copies: it is part of that line, not one of these. */}
          {openIn !== null && (
            // The launch actions beside the model (L10, the 2026-08-25
            // reversal): the pill row the menu draws, from the same exported
            // strings, so the two surfaces cannot drift — above the action
            // strip it extends, since *Open with…* arrives there as a strip
            // row. Not a menu, so the pills are plain buttons in a labelled
            // group, named the way the strip beside them is; they carry
            // `data-app-id` and no `data-command`, exactly as the menu's do.
            <div role="group" aria-label="Open in" className={OPEN_IN_GROUP_CLASS}>
              <span className={OPEN_IN_PANEL_CAPTION_CLASS}>{OPEN_IN_CAPTION}</span>
              {openIn.apps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  data-app-id={app.id}
                  title={app.name}
                  onClick={() => openIn.onChoose(app.id)}
                  className={OPEN_IN_PILL_CLASS}
                >
                  {app.name}
                </button>
              ))}
            </div>
          )}
          {panelCommands.length > 0 && (
            <div
              className="-mx-1 flex flex-col overflow-hidden rounded-lg border border-zinc-700 text-sm text-zinc-200"
              aria-label="Model actions"
              role="group"
            >
              {panelCommands.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-command={c.id}
                  onClick={() => runPanelCommand(c.id)}
                  className={MENU_ITEM_CLASS}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {actionError !== null && (
            <p role="status" className="text-xs text-red-400">
              {actionError}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-700"
          onClick={() => onCloseIntent()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
