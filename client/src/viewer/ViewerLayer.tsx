import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as THREE from "three";
import type {
  AppRef,
  CameraState,
  DirEntry,
  IndexPose,
  IndexScore,
  OrbitAxis,
  OverrideCredits,
} from "../../../shared/types";
import { renderableCredits } from "../../../shared/credits";
import type { ApiClient } from "../api/client";
import { COMMAND_ICON, MENU_ITEM_CLASS } from "../components/EntryMenu";
import { CREDIT_LINK_CLASS, hostLabel } from "../lib/credits";
import {
  AXIS_CAPTION_CLASS,
  AXIS_DIVIDER_CLASS,
  AXIS_GROUP_CLASS,
  AXIS_LETTERS,
  FLIP_TITLE,
  MAINTENANCE_COMMANDS,
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
} from "../lib/entryActions";
import { formatBytes, formatCosine, formatDate, formatZ } from "../lib/format";
import { expandLibraryPath } from "../lib/libraryPath";
import {
  SCALE_BADGE,
  Z_LABEL,
  strengthOf,
  type ScoreScale,
} from "../lib/scoreScale";
import { GestureTracker, nativeMenuRequested } from "../lib/gesture";
import type { MeshLru } from "../three/lru";
import { DEFAULT_CAMERA, defaultAxisFor } from "../three/camera";
import { formatOfEntry } from "../three/models";
import { cameraForPose } from "../three/pose";
import { getRenderer, onContextLost } from "../three/renderer";
import { liveRenderSize } from "./renderSize";
import { ViewerSession } from "./session";
import Icon from "../components/Icon";
import { baseName } from "../../../shared/names";

/** What a press on the stage belongs to rather than the model. */
const STAGE_CONTROLS = "button, [data-stage-control]";

/** Read once: a device does not change what its pointer is mid-session. */
const COARSE_POINTER =
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches === true;

/** The panel's launch buttons: the default application is the one filled
 *  button in the panel, so what "open" means is never a question. */
const OPEN_IN_PRIMARY_CLASS =
  "flex h-9 min-w-0 flex-1 basis-full items-center justify-center gap-2 truncate rounded-lg bg-accent px-3 text-[13px] font-semibold text-accent-ink hover:bg-accent-hover";
const OPEN_IN_SECONDARY_CLASS =
  "flex h-8 min-w-0 flex-1 items-center justify-center truncate rounded-lg px-3 text-xs text-ink-2 ring-1 ring-line-strong hover:bg-white/5 hover:text-ink";

export interface ViewerState {
  mode: "orbit" | "lightbox";
  entry: DirEntry;
  /** Tile rect at pointerdown — where the orbit overlay sits. */
  rect: { left: number; top: number; width: number; height: number };
  /** Opened from a tile, or stepped onto a shown entry: the close focuses
   *  that entry's tile (grid-virtualization D8). */
  returnsFocus: boolean;
}

interface Props {
  viewer: ViewerState;
  camera: CameraState | undefined;
  axis: OrbitAxis | undefined;
  /** Advisory only (D5). */
  pose: IndexPose | null | undefined;
  score: IndexScore | undefined;
  /** The same derivation the tile reads, so the two surfaces cannot report one
   *  number under different names (D7). */
  scoreScale: ScoreScale | null;
  /** The raw pair beside the strength word. */
  showScores?: boolean;
  /** The set's best is middling; the strength word stops at "Fair". */
  modestSet?: boolean;
  /** A prop, not a store read, so toggling repaints the live view. */
  ao: boolean;
  api: ApiClient;
  lru: MeshLru<THREE.Object3D>;
  tracker: GestureTracker;
  onPromote: () => void;
  /** Close affordances raise an intent rather than closing: App owns the
   *  history question and answers through `closeSignal`. */
  onCloseIntent: () => void;
  closeSignal: number;
  onDismiss: () => void;
  onPersist: (session: ViewerSession) => Promise<void>;
  onLoadError: (message: string) => void;
  /** The orbit overlay reports it, because it swallows `contextmenu` for the
   *  very tile whose handler would otherwise see the press, and keeps sitting
   *  there through the persist hold. The lightbox raises no menu: its panel
   *  carries every command. */
  onEntryMenu: (
    entry: DirEntry,
    el: HTMLElement | null,
    at: { x: number; y: number },
  ) => void;
  /** A ref, not a value: a changing prop would re-run the focus-trap effect
   *  below and pull focus out of the menu it just raised. */
  menuOpen: { readonly current: boolean };
  /** Decided by `entryActions` (`LIGHTBOX_PANEL_EXCLUDES`), never here. */
  panelCommands: readonly EntryCommand[];
  /** The library's top as a filesystem path, `null` until ready (library R4).
   *  Only the two places a path *leaves* the app expand through it — the copy
   *  affordance and the `path` line (R2); everything else reads the library
   *  path. */
  libraryTop: string | null;
  /**
   * The panel's open-in row (open-in-slicer L10), or `null` where it is not
   * offered — App decides with `openInApps`. `null` and not `[]`, the menu's
   * rule: what does not apply is absent rather than present and inert.
   */
  openIn?: { apps: AppRef[]; onChoose: (appId: string) => void } | null;
  /** App holds the bodies; this component contributes only the live view, which
   *  is the one thing App cannot reach. */
  onCommand: (id: CommandId, live: LiveFramingView | null) => void;
  /** Rendered here rather than under the path bar, which the lightbox covers
   *  behind a scrim. Toned, because a launch failure and a copy's confirmation
   *  both land here. */
  actionNote?: { text: string; tone: "ok" | "error" } | null;
  /** App swaps `viewer.entry` and the URL together (lightbox-sibling-stepping
   *  D3). */
  onNavigate: (entry: DirEntry) => void;
  /** `null` at the ends: the controls disable and the arrow keys no-op (D1/D2). */
  prevEntry: DirEntry | null;
  nextEntry: DirEntry | null;
}

/** Longest the orbit overlay holds its dismissal waiting for the refreshed thumbnail. */
export const PERSIST_HOLD_MS = 1500;

/** The single live-canvas layer: over the pressed tile in 'orbit' mode, a
 *  focus-trapped modal with orbit and zoom in 'lightbox'. */
export default function ViewerLayer({
  viewer,
  camera,
  axis,
  pose,
  score,
  scoreScale,
  showScores = false,
  modestSet = false,
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
  actionNote = null,
  onNavigate,
  prevEntry,
  nextEntry,
}: Props) {
  const [session, setSession] = useState<ViewerSession | null>(null);
  /** The spindle when nothing names one — the format's up axis, from the one
   *  definition (file-frame-spindle D2), so the picker, the session and a
   *  reset agree. */
  const fallbackAxis = defaultAxisFor(formatOfEntry(viewer.entry));
  const [sessionAxis, setSessionAxis] = useState<OrbitAxis>(fallbackAxis);
  /** Shown instead of dismissing. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHint, setShowHint] = useState(true);
  // Nothing turns on a lost context, so the hint would be promising a drag
  // that does nothing.
  useEffect(() => onContextLost((lost) => lost && setShowHint(false)), []);
  const [copyError, setCopyError] = useState<string | null>(null);
  /** `null` for every way of having nothing to show — no store, no key, a
   *  failed read — because the panel draws them identically (D4). */
  const [credits, setCredits] = useState<OverrideCredits | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  /** A framing reset pressed over the spinner, before a session exists to
   *  move. Without it the open — whose orientation was resolved before the
   *  press — reopens at the very framing that was given up. */
  const pendingReframeRef = useRef<{
    camera: CameraState;
    axis: OrbitAxis;
  } | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // A pointer-opened viewer mounts mid-press; a keyboard-opened one has no
  // pointer down.
  const pointer = useRef({ down: viewer.mode === "orbit", lastX: 0, lastY: 0 });
  // A held dismissal keeps this mounted while a new press replaces `viewer`:
  // re-arm as a fresh mount would, or the new tile's gesture is dead (D4).
  const prevViewerRef = useRef(viewer);
  if (prevViewerRef.current !== viewer) {
    prevViewerRef.current = viewer;
    pointer.current = { down: viewer.mode === "orbit", lastX: 0, lastY: 0 };
  }
  const sessionRef = useRef<ViewerSession | null>(null);
  const modeRef = useRef(viewer.mode);
  modeRef.current = viewer.mode;
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  // `goTo` awaits a persist before it navigates. A close landing in that window
  // must abort the step, and a second step in it is ignored (D3). Never reset:
  // a close unmounts.
  const closingRef = useRef(false);
  const steppingRef = useRef(false);
  const pendingPersistRef = useRef<Promise<void> | null>(null);

  /** Hold the overlay until the refreshed thumbnail is paintable, so it
   *  unmounts onto matching pixels. Yields to any newer interaction (D4). */
  async function dismissAfterPersist(): Promise<void> {
    const pending = pendingPersistRef.current;
    if (pending === null) {
      onDismiss();
      return;
    }
    const scheduledViewer = viewerRef.current;
    await Promise.race([
      pending,
      new Promise((r) => setTimeout(r, PERSIST_HOLD_MS)),
    ]);
    // Two rAFs: React commits the new src, then the browser paints it beneath
    // the still-mounted overlay.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    if (pointer.current.down) return; // a new gesture owns dismissal now
    if (viewerRef.current !== scheduledViewer) return; // a newer viewer replaced this one
    onDismiss();
  }

  // Load the mesh and build the session. The saved camera/axis may not be in
  // the thumbs map yet, so a fast open fetches them rather than persisting the
  // default over a stored orientation.
  useEffect(() => {
    let alive = true;
    // A step swaps `viewer.entry` under a live lightbox (D5): the cleanup nulls
    // `sessionRef` but leaves the `session` *state* everything here gates on, so
    // without this reset a cold step shows the leaving model's last frame.
    setSession(null);
    setLoadError(null);
    // A pose is the *default* only, and applying one persists nothing — the
    // sidecar is written by orbiting, not by opening (semantic-search D5).
    const fromPose = cameraForPose(pose, DEFAULT_CAMERA);
    // A reframe recorded for the open in flight must not be adopted by the one
    // replacing it across a held dismissal.
    pendingReframeRef.current = null;
    const savedPromise: Promise<{ camera?: CameraState; axis: OrbitAxis }> =
      camera !== undefined
        ? Promise.resolve({ camera, axis: axis ?? fallbackAxis })
        : api
            // Orientation only: the pixels would be an object URL nothing here
            // revokes.
            .getThumb(
              viewer.entry.path,
              viewer.entry.mtime,
              true,
              undefined,
              false,
            )
            .then((r) => {
              const posed =
                r.camera === undefined &&
                r.axis === undefined &&
                fromPose !== null;
              return {
                camera: posed ? fromPose.camera : r.camera,
                axis: r.axis ?? (posed ? fromPose.axis : fallbackAxis),
              };
            })
            .catch(() => ({
              camera: fromPose?.camera,
              axis: fromPose?.axis ?? fallbackAxis,
            }));
    void Promise.all([
      lru.acquire(viewer.entry.path, viewer.entry.mtime),
      savedPromise,
    ])
      .then(([object, saved]) => {
        if (!alive) return;
        // A reset pressed while this was in flight wins: `saved` is the very
        // thing the press gave up.
        const discarded = pendingReframeRef.current;
        if (discarded !== null) pendingReframeRef.current = null;
        // A discard resolves the axis with the camera (`pose-rerender` D7).
        const axisAt = discarded !== null ? discarded.axis : saved.axis;
        const s = new ViewerSession(
          object,
          axisAt,
          discarded?.camera ?? saved.camera,
        );
        sessionRef.current = s;
        setSession(s);
        setSessionAxis(axisAt);
      })
      .catch((err: unknown) => {
        // Show it rather than dismissing, and flip the tile so a stale
        // thumbnail stops advertising a healthy model.
        if (!alive) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoadError(message);
        onLoadError(message);
      });
    return () => {
      alive = false;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.entry.path, lru]);

  // Ignore-on-stale, never an AbortController (D4). Cleared on the way in:
  // this component survives a subject change, so otherwise the previous model's
  // attribution sits under the new name — forever, where the new entry resolves
  // nothing, which is the common case.
  useEffect(() => {
    let alive = true;
    const forget = (): void => {
      alive = false;
    };
    setCredits(null);
    if (viewer.mode !== "lightbox") return forget;
    api
      .overrides(viewer.entry.path)
      .then((resolved) => {
        if (alive) setCredits(renderableCredits(resolved.credits));
      })
      .catch(() => {
        if (alive) setCredits(null);
      });
    return forget;
  }, [viewer.entry.path, viewer.mode, api]);

  // Also on an AO toggle, so the switch is visible without a drag.
  useEffect(() => {
    if (session === null) return;
    const host = canvasHostRef.current;
    if (host === null) return;
    const canvas = getRenderer().domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);
    renderNow();
    return () => {
      if (canvas.parentElement === host) host.removeChild(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, viewer.mode, ao]);

  function renderNow(): void {
    const s = sessionRef.current;
    const host = canvasHostRef.current;
    if (s === null || host === null) return;
    // Above device resolution, so the browser downsamples — see
    // `liveRenderSize` for why shading aliasing needs the extra samples.
    const { width, height } = liveRenderSize(
      host.clientWidth,
      host.clientHeight,
      window.devicePixelRatio || 1,
    );
    s.render(width, height);
  }

  /**
   * The end of the primary gesture: a press without drag promotes, a drag settles
   * and persists. `raiseEntryMenu` also ends it when declining a shifted press,
   * since the browser's menu takes the release `onUp` would have seen.
   *
   * **Always through `endGestureRef`**: the window listeners are installed once,
   * so a direct reference pins the mount render's `onPersist` — and a viewer
   * swapped in during a held dismissal then writes the new tile's pixels under
   * the old tile's path.
   */
  function endGesture(
    at: { clientX: number; clientY: number; pointerType?: string },
    { promote }: { promote: boolean },
  ): void {
    if (!pointer.current.down) return;
    pointer.current.down = false;
    if (!tracker.isDrag) {
      if (promote && modeRef.current === "orbit") onPromote();
      return;
    }
    const s = sessionRef.current;
    // The chain is kept so post-drag dismissals can await it (D1).
    if (s !== null) {
      const p = s
        .settle(renderNow)
        .then(() => onPersist(s))
        .finally(() => {
          if (pendingPersistRef.current === p) pendingPersistRef.current = null;
        });
      pendingPersistRef.current = p;
    }
    // A drag released outside the tile gets no later pointerleave, so the
    // overlay would be stuck. Nor does a finger: a touch stays captured by
    // the tile it pressed and has no hover to leave, so its release is the
    // end of the overlay.
    if (modeRef.current === "orbit") {
      const rect = containerRef.current?.getBoundingClientRect();
      const inside =
        rect !== undefined &&
        at.clientX >= rect.left &&
        at.clientX <= rect.right &&
        at.clientY >= rect.top &&
        at.clientY <= rect.bottom;
      if (!inside || at.pointerType === "touch") void dismissAfterPersist();
    }
  }
  const endGestureRef = useRef(endGesture);
  endGestureRef.current = endGesture;

  // The press that opened the overlay is already in progress, so these live on
  // window and must attach **before paint**, or a fast click's pointerup
  // arrives before they exist.
  useLayoutEffect(() => {
    function onMove(e: PointerEvent): void {
      if (!pointer.current.down) return;
      const wasDrag = tracker.isDrag;
      const isDrag = tracker.move(e.clientX, e.clientY);
      const dx = e.clientX - pointer.current.lastX;
      const dy = e.clientY - pointer.current.lastY;
      // The baseline follows the pointer whether or not a session exists yet:
      // a drag begun over the spinner must not land the whole pre-load travel
      // on the model in one frame.
      pointer.current.lastX = e.clientX;
      pointer.current.lastY = e.clientY;
      if (isDrag && sessionRef.current !== null) {
        // The move that crosses the threshold marks the session manipulated
        // and cancels an axis tween, but turns nothing.
        sessionRef.current.orbit(wasDrag ? dx : 0, wasDrag ? dy : 0);
        renderNow();
      }
    }
    function onUp(e: PointerEvent): void {
      // The primary's release only, or a secondary release mid-hold ends the
      // gesture and opens the lightbox under the menu it just raised.
      if (e.button !== 0) return;
      endGestureRef.current(e, { promote: true });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracker]);

  // Dismiss on scroll/resize rather than track the tile.
  useEffect(() => {
    if (viewer.mode !== "orbit") return;
    function dismiss(): void {
      onDismiss();
    }
    window.addEventListener("scroll", dismiss, { capture: true });
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, { capture: true });
      window.removeEventListener("resize", dismiss);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.mode]);

  // Refs, not effect deps (D6): closing `onKey` over a leaving render's
  // `onPersist` is the mistake `endGestureRef` guards against.
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const prevEntryRef = useRef(prevEntry);
  prevEntryRef.current = prevEntry;
  const nextEntryRef = useRef(nextEntry);
  nextEntryRef.current = nextEntry;
  /**
   * Persist the leaving model as `closeLightbox` would, **before** App swaps
   * the entry — App's own `persist` captures `viewer.entry` before its awaits,
   * and that is still the leaving model until the swap lands (D3).
   */
  async function goTo(entry: DirEntry): Promise<void> {
    // A close that raced the press, or a rapid double press.
    if (closingRef.current || steppingRef.current) return;
    const started = viewerRef.current;
    const s = sessionRef.current;
    if (s !== null && s.everManipulated) {
      steppingRef.current = true;
      try {
        await s.settle(renderNow);
        await onPersist(s);
      } finally {
        steppingRef.current = false;
      }
    }
    // The persist window is tens to hundreds of ms, in which a close can run the
    // whole teardown. App's `navigateSibling` mode-guards the commit too, so a
    // lost race cannot re-open the lightbox over the listing backed onto.
    if (
      closingRef.current ||
      viewerRef.current !== started ||
      modeRef.current !== "lightbox"
    ) {
      return;
    }
    onNavigateRef.current(entry);
  }
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // Focus trap + Esc close; re-render on resize.
  useEffect(() => {
    if (viewer.mode !== "lightbox") return;
    // Conditional (D6): this effect re-runs on every step, and yanking focus
    // back each time lets a keyboard user press Next exactly once.
    if (
      containerRef.current !== null &&
      !containerRef.current.contains(document.activeElement)
    ) {
      containerRef.current.focus();
    }
    function onKey(e: KeyboardEvent): void {
      // The menu is on top and closes itself, so one press dismisses one thing.
      if (e.key === "Escape") {
        if (menuOpen.current) return;
        onCloseIntent();
      }
      if (e.key === "Tab") {
        // Real trap: cycle focus through the dialog and its controls.
        e.preventDefault();
        const dialog = containerRef.current;
        if (dialog === null) return;
        // `:not([disabled])` — a disabled end control cannot take focus, and it
        // is first in the ring on the first model, so the trap dead-stops
        // there (D2). `[disabled]` is not a thing an anchor has, so the one
        // selector governs the buttons and still admits the credit links, in
        // the document order the panel reads them in.
        const focusables = [
          dialog,
          ...dialog.querySelectorAll<HTMLElement>(
            "button:not([disabled]), a[href]",
          ),
        ];
        const idx = focusables.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? (idx - 1 + focusables.length) % focusables.length
          : (idx + 1) % focusables.length;
        focusables[next]?.focus();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Alt+Arrow is Back/Forward — the very gesture that closes this — and
        // Ctrl/Meta+Arrow is the OS's (D6).
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (menuOpen.current) return;
        const target =
          e.key === "ArrowLeft" ? prevEntryRef.current : nextEntryRef.current;
        if (target === null) return; // no wrap; the end control is disabled (D2)
        e.preventDefault();
        void goToRef.current(target);
      }
    }
    function onResize(): void {
      renderNow();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.mode, session]);

  async function closeLightbox(): Promise<void> {
    // First (D3): a step still awaiting its persist must see this and abort.
    closingRef.current = true;
    const s = sessionRef.current;
    // Only after a manipulation (`pose-rerender` D4). An untouched view showed
    // the stored camera, a pose or the default — none of them a decision — and
    // a camera stored here would outrank every orientation the source later
    // holds. A framing reset clears the claim too (`ViewerSession.reframe`).
    if (s !== null && s.everManipulated) {
      await s.settle(renderNow); // no-op if already level (e.g. Esc mid-drag aside)
      await onPersist(s);
    }
    onDismiss();
  }

  // App's answer to a close intent, and the browser-back path: the same
  // teardown every in-app affordance runs, which only this component can.
  const handledCloseRef = useRef(closeSignal);
  useEffect(() => {
    if (closeSignal === handledCloseRef.current) return;
    handledCloseRef.current = closeSignal;
    if (viewer.mode === "lightbox") void closeLightbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal]);

  function startGesture(e: React.PointerEvent): void {
    // Primary only, as the tile's own handler decides: orbit is a left-drag and
    // a secondary press is the menu's.
    if (e.button !== 0) return;
    pointer.current = { down: true, lastX: e.clientX, lastY: e.clientY };
    tracker.start(e.clientX, e.clientY);
  }

  /**
   * The app's own entry menu, except on a shifted press — the requirement's one
   * exception (entry-actions). Declining ends the orbit but never promotes: the
   * browser's menu takes the pointer, so `onUp` never runs, and an orbit left
   * going would follow the mouse with no button held.
   */
  function raiseEntryMenu(e: React.MouseEvent): void {
    if (nativeMenuRequested(e)) {
      endGestureRef.current(e, { promote: false });
      return;
    }
    e.preventDefault();
    onEntryMenu(viewer.entry, containerRef.current, {
      x: e.clientX,
      y: e.clientY,
    });
  }

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  /** The shared command (entry-actions R1); only the presentation is local. */
  function copyPath(): void {
    copyEntryPath(viewer.entry, {
      libraryTop,
      confirm: () => {
        setCopyError(null);
        setCopied(true);
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      },
      report: (message) => {
        // An earlier confirmation must not outlive this failure.
        clearTimeout(copyTimerRef.current);
        setCopied(false);
        setCopyError(message);
        copyTimerRef.current = setTimeout(() => setCopyError(null), 2500);
      },
    });
  }

  /** One construction for the panel's presses and the menu's. Offered while
   *  the mesh is still loading too: `reframe` records the discard for the
   *  landing handler rather than answering `null`, which would let the close
   *  resurrect the camera just given up. */
  function liveFramingView(): LiveFramingView {
    const s = sessionRef.current;
    return {
      reframe: (nextCamera, nextAxis) => {
        if (s !== null) {
          s.reframe(nextCamera, nextAxis);
          runTweenLoop();
        } else {
          // Nothing on screen to move yet; the open in flight adopts this
          // instead of the orientation it resolved before the press.
          pendingReframeRef.current = { camera: nextCamera, axis: nextAxis };
        }
        setSessionAxis(nextAxis);
      },
    };
  }

  /** The live view travels with every command; which ones care is
   *  `entryActions`' business. */
  function runPanelCommand(id: CommandId): void {
    onCommand(id, liveFramingView());
  }

  // Ends on its own when the tween completes or a drag cancels it.
  const tweenLoopActive = useRef(false);
  function runTweenLoop(): void {
    if (tweenLoopActive.current) return;
    tweenLoopActive.current = true;
    const step = (): void => {
      renderNow();
      if (sessionRef.current?.animating === true) requestAnimationFrame(step);
      else tweenLoopActive.current = false;
    };
    requestAnimationFrame(step);
  }

  // The rest state is already the new spindle's default, so the persist need
  // not wait for the tween.
  function changeAxis(next: OrbitAxis): void {
    const s = sessionRef.current;
    if (s === null || next === s.axis) return;
    s.setAxis(next);
    setSessionAxis(next);
    runTweenLoop();
    void onPersist(s);
  }

  /** Everyday commands first, maintenance after the divider. */
  const orderedPanel = [
    ...panelCommands.filter((c) => !MAINTENANCE_COMMANDS.has(c.id)),
    ...panelCommands.filter((c) => MAINTENANCE_COMMANDS.has(c.id)),
  ];

  const spinner = (
    <span className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
  );

  if (viewer.mode === "orbit") {
    const { rect } = viewer;
    return (
      <div
        ref={containerRef}
        className="fixed z-orbit-overlay cursor-grab touch-none rounded-t-xl bg-stage active:cursor-grabbing"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }}
        onPointerDown={startGesture}
        onContextMenu={raiseEntryMenu}
        onPointerLeave={() => {
          if (!pointer.current.down) void dismissAfterPersist();
        }}
      >
        <div ref={canvasHostRef} className="h-full w-full" />
        {session === null &&
          (loadError !== null ? (
            <span
              role="alert"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-raised/90 px-2.5 py-1 text-xs text-danger"
            >
              ⚠ failed to load
            </span>
          ) : (
            spinner
          ))}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-lightbox flex items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      onPointerDown={(e) => {
        // Primary only: the panel beside the model already carries every
        // command, so the lightbox raises no menu of its own, and a secondary
        // press must not close the view either.
        if (e.button === 0 && e.target === e.currentTarget) onCloseIntent();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={viewer.entry.name}
        tabIndex={-1}
        className="relative flex h-full w-full flex-col overflow-hidden bg-canvas outline-none sm:flex-row sm:rounded-2xl sm:border sm:border-line-strong sm:shadow-2xl sm:shadow-black/60"
      >
        {/* The stage takes whatever the panel leaves, and the canvas is the
            largest square inside it. The square is load-bearing: `snapshot()`
            captures at aspect 1, so a squeezed live view disagrees with its
            thumbnail (D1). The stage is a size container so the square can
            take its smaller axis.

            The whole stage turns and zooms the model, not only the square: the
            gutters beside it are drawn as the same surface, and a press there
            that did nothing would read as a broken drag. Presses on the
            stage's own controls are theirs. */}
        <div
          data-lightbox-stage
          className="relative flex min-h-0 min-w-0 flex-1 cursor-grab touch-none items-center justify-center bg-stage [container-type:size] active:cursor-grabbing"
          onPointerDown={(e) => {
            if ((e.target as Element).closest(STAGE_CONTROLS) !== null) return;
            setShowHint(false);
            startGesture(e);
          }}
          onWheel={(e) => {
            if ((e.target as Element).closest(STAGE_CONTROLS) !== null) return;
            sessionRef.current?.zoom(e.deltaY > 0 ? 1.1 : 0.9);
            renderNow();
          }}
        >
          <div className="relative size-[min(100cqw,100cqh)]">
            <div ref={canvasHostRef} className="h-full w-full" />
            {session === null &&
              (loadError !== null ? (
                <div
                  role="alert"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center"
                >
                  <Icon name="warning" className="size-7 text-danger/80" />
                  <p className="text-sm font-medium text-ink">
                    {viewer.entry.name}
                  </p>
                  <p className="text-xs text-danger">{loadError}</p>
                </div>
              ) : (
                spinner
              ))}
          </div>
          {/* Disabled rather than absent at the ends (D2). */}
          <button
            type="button"
            aria-label="Previous model"
            disabled={prevEntry === null}
            onClick={() => {
              if (prevEntry !== null) void goTo(prevEntry);
            }}
            title="Previous model (←)"
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-raised/80 p-2.5 text-ink ring-1 ring-line-strong backdrop-blur cursor-pointer hover:bg-raised disabled:pointer-events-none disabled:opacity-0"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next model"
            disabled={nextEntry === null}
            onClick={() => {
              if (nextEntry !== null) void goTo(nextEntry);
            }}
            title="Next model (→)"
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-raised/80 p-2.5 text-ink ring-1 ring-line-strong backdrop-blur cursor-pointer hover:bg-raised disabled:pointer-events-none disabled:opacity-0"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          {/* On a pill, so the model cannot draw over it, and at the foot of
              the stage, where no control lives; gone once the model has been
              turned, since by then it has done its job. Its length follows the
              stage's own width (the stage is a size container), so it never
              runs into the axis bar or past the edge. */}
          {session !== null && showHint && (
            <p
              aria-hidden="true"
              className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-canvas/75 px-3 py-1 text-xs whitespace-nowrap text-ink-2 ring-1 ring-line backdrop-blur-sm"
            >
              {COARSE_POINTER ? (
                "Drag to turn the model"
              ) : (
                <>
                  <span className="@lg:hidden">
                    Drag to turn · scroll to zoom
                  </span>
                  <span className="hidden @lg:inline">
                    Drag to turn · scroll to zoom · ← → for the next model
                  </span>
                </>
              )}
            </p>
          )}
          {session !== null && (
            // The tile menu draws the same four buttons from the same strings
            // in `entryActions`, so neither copy can drift.
            <div
              data-stage-control
              className={`absolute left-3 top-3 cursor-default ${AXIS_GROUP_CLASS}`}
              aria-label="Orbit axis"
            >
              <span className={AXIS_CAPTION_CLASS}>up axis</span>
              {AXIS_LETTERS.map((letter) => {
                const active = axisLetter(sessionAxis) === letter;
                return (
                  <button
                    key={letter}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      changeAxis(axisWithLetter(sessionAxis, letter))
                    }
                    className={axisPillClass(active)}
                  >
                    {letter.toUpperCase()}
                  </button>
                );
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
        <div className="flex max-h-[42dvh] w-full min-w-0 shrink-0 flex-col gap-5 overflow-y-auto border-t border-line p-5 sm:max-h-none sm:w-80 sm:border-t-0 sm:border-l">
          {/* pr-9 clears the dialog-anchored close button */}
          {/* The file's own name; a result carries its path relative to the
              search, whose folders go on the line under it. */}
          <div className="pr-9">
            <p className="text-base leading-snug font-semibold [overflow-wrap:anywhere] text-ink">
              {baseName(viewer.entry.name)}
            </p>
            {viewer.entry.name.includes("/") && (
              // The nearest two folders, which name the kit; the whole path
              // is in the PATH row below.
              <p className="mt-0.5 truncate text-xs text-ink-3">
                in {nearestFolders(viewer.entry.name)}
              </p>
            )}
          </div>
          {openIn !== null && openIn.apps.length > 0 && (
            // The panel's primary action: the default application leads as the
            // one filled button, the rest follow as plain ones (L10). Plain
            // buttons carrying `data-app-id` and no `data-command`, exactly as
            // the menu's do.
            <div
              role="group"
              aria-label="Open in"
              className="flex flex-wrap gap-1.5"
            >
              {openIn.apps.map((app, i) => (
                <button
                  key={app.id}
                  type="button"
                  data-app-id={app.id}
                  title={`Open in ${app.name}`}
                  onClick={() => openIn.onChoose(app.id)}
                  className={
                    i === 0 ? OPEN_IN_PRIMARY_CLASS : OPEN_IN_SECONDARY_CLASS
                  }
                >
                  {i === 0 && <Icon name="externalLink" className="size-3.5" />}
                  {i === 0 ? `Open in ${app.name}` : app.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tracking-wider text-ink-3 uppercase">
                path
              </span>
              <span role="status" className="sr-only">
                {copied ? "Path copied." : ""}
              </span>
              <button
                type="button"
                aria-label="Copy path"
                onClick={copyPath}
                className={
                  copied
                    ? "h-7 rounded-md bg-accent-soft px-2.5 text-xs text-accent touch:h-11"
                    : "h-7 rounded-md px-2.5 text-xs text-ink-2 ring-1 ring-line-strong hover:bg-white/5 hover:text-ink touch:h-11"
                }
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>
            {/* The filesystem path (library R2), through the one expansion the
                copy button beside it also uses. */}
            <p className="font-mono text-xs leading-relaxed break-all text-ink-2 select-text">
              {expandLibraryPath(libraryTop, viewer.entry.path)}
            </p>
            {copyError !== null && (
              <p role="status" className="text-xs text-danger">
                {copyError}
              </p>
            )}
          </div>
          <dl className="flex flex-col gap-2 border-t border-line pt-4 text-xs">
            {viewer.entry.format !== undefined && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">format</dt>
                <dd className="uppercase text-ink-2">{viewer.entry.format}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">size</dt>
              <dd className="text-ink-2">{formatBytes(viewer.entry.size)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">
                {viewer.entry.path.includes("!/")
                  ? "modified (zip)"
                  : "modified"}
              </dt>
              <dd className="text-right text-ink-2">
                {formatDate(viewer.entry.mtime)}
              </dd>
            </div>
            {/* Among the metadata, before the action strip: the panel
                describes before it offers, which appending quietly breaks. Same
                labels as the tile's corners, from one derivation (D7). */}
            {score !== undefined && scoreScale !== null && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">match</dt>
                <dd className="text-ink-2">{strengthOf(score.z, modestSet)}</dd>
              </div>
            )}
            {score !== undefined && scoreScale !== null && showScores && (
              <>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-3">{SCALE_BADGE[scoreScale]}</dt>
                  <dd className="tabular-nums text-ink-2">
                    {formatCosine(score.score)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-3">{Z_LABEL}</dt>
                  <dd className="tabular-nums text-ink-2">
                    {formatZ(score.z)}
                  </dd>
                </div>
              </>
            )}
            {/* Drawn only where the store credits something: most libraries
                have no store, and a panel that announced "no author" would say
                it forever (`library-overrides` D4). A row per field held, so a
                partial credit draws as the part it is (`credits-completion`
                D4). */}
            {credits !== null && (
              <>
                {credits.author !== undefined && (
                  <div
                    data-credit="author"
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-ink-3">author</dt>
                    <dd className="min-w-0 text-right text-ink-2">
                      {credits.authorUrl !== undefined ? (
                        <a
                          href={credits.authorUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={credits.authorUrl}
                          className={CREDIT_LINK_CLASS}
                        >
                          {credits.author}
                        </a>
                      ) : (
                        <span className="break-all">{credits.author}</span>
                      )}
                    </dd>
                  </div>
                )}
                {credits.license !== undefined && (
                  <div
                    data-credit="license"
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-ink-3">license</dt>
                    <dd className="min-w-0 break-words text-right text-ink-2">
                      {/* The corpus's string, linked to the stored deed URL:
                          the URL carries the version (D3). */}
                      {credits.licenseUrl !== undefined ? (
                        <a
                          href={credits.licenseUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={credits.licenseUrl}
                          className={CREDIT_LINK_CLASS}
                        >
                          {credits.license}
                        </a>
                      ) : (
                        credits.license
                      )}
                    </dd>
                  </div>
                )}
                {credits.sourceUrl !== undefined && (
                  <div
                    data-credit="source"
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-ink-3">source</dt>
                    <dd className="min-w-0 text-right text-ink-2">
                      <a
                        href={credits.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={credits.sourceUrl}
                        className={CREDIT_LINK_CLASS}
                      >
                        {hostLabel(credits.sourceUrl)}
                      </a>
                    </dd>
                  </div>
                )}
                {/* The corpus's phrase verbatim; absent means served unchanged,
                    and an unchanged copy is not labelled (D2). Labelled "this
                    copy" because the list above already spends `modified` on
                    the file's date (D4). */}
                {credits.modified !== undefined && (
                  <div
                    data-credit="modified"
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-ink-3">this copy</dt>
                    <dd className="min-w-0 break-words text-right text-ink-2">
                      {credits.modified}
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>
          {/* Named for the model, not "Entry actions": the menu can be raised
              over this very panel, and two things sharing an accessible name
              are one thing to anything reading names. They wear the menu's own
              look (`MENU_ITEM_CLASS`, owned by `EntryMenu`). */}
          {panelCommands.length > 0 && (
            <div
              className="-mx-1 flex flex-col gap-px rounded-lg border border-line bg-surface p-1 text-[13px] text-ink"
              aria-label="Model actions"
              role="group"
            >
              {orderedPanel.map((c, i) => (
                <Fragment key={c.id}>
                  {i > 0 &&
                    MAINTENANCE_COMMANDS.has(c.id) &&
                    !MAINTENANCE_COMMANDS.has(orderedPanel[i - 1]!.id) && (
                      <div
                        role="separator"
                        className="mx-1 my-0.5 h-px bg-line"
                      />
                    )}
                  <button
                    type="button"
                    data-command={c.id}
                    onClick={() => runPanelCommand(c.id)}
                    className={MENU_ITEM_CLASS}
                  >
                    <Icon
                      name={COMMAND_ICON[c.id]}
                      className="size-3.5 text-ink-3"
                    />
                    {c.label}
                  </button>
                </Fragment>
              ))}
            </div>
          )}
          {actionNote !== null && (
            // The header's own two tones, so a transient line reads the same
            // wherever it lands.
            <p
              role="status"
              className={`text-xs ${
                actionNote.tone === "error" ? "text-danger" : "text-ink-2"
              }`}
            >
              {actionNote.text}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          title="Close (Esc)"
          className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-white/5 hover:text-ink touch:size-11"
          onClick={() => onCloseIntent()}
        >
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}

/** "in Kit › Folder": the last two folders of a result's relative path that
 *  say something — kits nest their files under the same few generic names —
 *  with an archive named without its `!`. */
function nearestFolders(name: string): string {
  const parts = name
    .slice(0, name.lastIndexOf("/"))
    .split("/")
    .map((p) => p.replace(/!$/, ""));
  const telling = parts.filter((p) => !GENERIC_FOLDER.test(p));
  return (telling.length > 0 ? telling : parts).slice(-2).join(" › ");
}

/** Folder names that recur inside every kit and tell one from another not at
 *  all: sizes, support states, file formats, parts. */
const GENERIC_FOLDER =
  /^(\d+\s?mm|(un|pre|non)?[\s_-]?supported|no[\s_-]?supports?|supports?|stls?|obj|3mf|files?|parts?|one[\s_-]?piece|split|models?|print[\s_-]?files?)$/i;
