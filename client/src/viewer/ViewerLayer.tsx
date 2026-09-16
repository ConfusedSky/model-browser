import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import { MENU_ITEM_CLASS } from "../components/EntryMenu";
import { CREDIT_LINK_CLASS, hostLabel } from "../lib/credits";
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
} from "../lib/entryActions";
import { formatBytes, formatCosine, formatDate, formatZ } from "../lib/format";
import { expandLibraryPath } from "../lib/libraryPath";
import { SCALE_BADGE, Z_LABEL, type ScoreScale } from "../lib/scoreScale";
import { GestureTracker, nativeMenuRequested } from "../lib/gesture";
import type { MeshLru } from "../three/lru";
import { DEFAULT_CAMERA, defaultAxisFor } from "../three/camera";
import { formatOfEntry } from "../three/models";
import { cameraForPose } from "../three/pose";
import { getRenderer } from "../three/renderer";
import { liveRenderSize } from "./renderSize";
import { ViewerSession } from "./session";

export interface ViewerState {
  mode: "orbit" | "lightbox";
  entry: DirEntry;
  /** Tile rect at pointerdown — where the orbit overlay sits. */
  rect: { left: number; top: number; width: number; height: number };
  originEl: HTMLElement | null;
}

interface Props {
  viewer: ViewerState;
  camera: CameraState | undefined;
  axis: OrbitAxis | undefined;
  /** The index's orientation for this model, when it has one. Advisory (D5). */
  pose: IndexPose | null | undefined;
  /** What the index scored this model at, when it was opened from a scored
   *  result. Absent for a model opened from any ordinary listing. */
  score: IndexScore | undefined;
  /** Which scale `score` is on — the same derivation the tile reads, so the two
   *  surfaces cannot report the number under different names (D7). */
  scoreScale: ScoreScale | null;
  /** Ambient occlusion on/off — a prop (not read from the store) so toggling
   *  repaints the live view. */
  ao: boolean;
  api: ApiClient;
  lru: MeshLru<THREE.Object3D>;
  tracker: GestureTracker;
  onPromote: () => void;
  /**
   * Lightbox close affordances (✕, Escape, backdrop) raise an intent instead
   * of closing: App owns the history question — back out of a pushed entry,
   * or drop a deep-linked param — and answers via `closeSignal`.
   */
  onCloseIntent: () => void;
  /** Increments when App wants the persisting close to run (url-navigation D3). */
  closeSignal: number;
  onDismiss: () => void;
  /** Write the view — camera, axis and pixels — after a manipulation: an
   *  orbit release, an axis change, or the close that follows one. */
  onPersist: (session: ViewerSession) => Promise<void>;
  onLoadError: (message: string) => void;
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
  onEntryMenu: (
    entry: DirEntry,
    el: HTMLElement | null,
    at: { x: number; y: number },
    /** The live view a framing reset needs, read at press time — the session
     *  is private to this component, so the menu's surface hands it over the
     *  way the panel's presses do. */
    live?: () => LiveFramingView | null,
  ) => void;
  /**
   * Whether that menu is currently raised, read live.
   *
   * A ref rather than a value: the outcome must not depend on which window
   * listener runs first, and a changing prop would re-run the focus-trap effect
   * below — which focuses the dialog on every run and would pull focus straight
   * out of the menu it just raised.
   */
  menuOpen: { readonly current: boolean };
  /**
   * The entry actions this panel offers, decided by `entryActions` for this
   * entry and this surface (`LIGHTBOX_PANEL_EXCLUDES`) and asked by App — never
   * re-decided here, exactly as the menu never re-decides its own items.
   */
  panelCommands: readonly EntryCommand[];
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
  libraryTop: string | null;
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
  openIn?: { apps: AppRef[]; onChoose: (appId: string) => void } | null;
  /**
   * Run one of them. The bodies are the shared ones and App holds the host, so
   * this component carries no copy of any command — only the live view a reset
   * needs to re-frame, which is the one thing App cannot reach: the session is
   * private to this component.
   */
  onCommand: (id: CommandId, live: LiveFramingView | null) => void;
  /**
   * A shared command's brief sentence, rendered *here* rather than under the
   * path bar. The lightbox is `fixed inset-0 z-lightbox` over that bar behind a
   * 70% scrim, so a sentence sent there is dimmed, corner-parked and gone in
   * 2.5s while the user is looking at the panel on the right — the same
   * per-surface split `copyError` already makes, App holding the sentence and
   * the surface holding where it lands.
   *
   * Toned, because both kinds arrive here: a launch failure (a launch that
   * *works* is silent by design, so the sentence is its only feedback) and a
   * copy's confirmation, which entry-actions requires and which the menu raised
   * on this surface could not previously show at all.
   */
  actionNote?: { text: string; tone: "ok" | "error" } | null;
  /**
   * Step the lightbox to a sibling model (lightbox-sibling-stepping). App swaps
   * `viewer.entry` and the URL together; `goTo` here reproduces the persisting
   * close's branch first (D3). Reached through a ref from the key handler so it
   * never closes over a leaving render's `onPersist` (the `endGestureRef` bug).
   */
  onNavigate: (entry: DirEntry) => void;
  /** The previous / next model in shown order, or `null` at the ends (D1/D2) —
   *  the arrow controls disable and the arrow keys no-op where `null`. */
  prevEntry: DirEntry | null;
  nextEntry: DirEntry | null;
}

/** Longest the orbit overlay holds its dismissal waiting for the refreshed thumbnail. */
export const PERSIST_HOLD_MS = 1500;

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
  /**
   * The spindle this model turns about when nothing names one: its format's
   * up axis, from the one definition (file-frame-spindle D2). Read at the
   * state seed, at every branch of the saved-framing read, and by the live
   * view a reset moves, so the picker, the session and the reset agree.
   */
  const fallbackAxis = defaultAxisFor(formatOfEntry(viewer.entry));
  // The seed is overwritten by the open's answer before the picker (gated on
  // `session`) draws; it is the entry's default so no letter is fixed here.
  const [sessionAxis, setSessionAxis] = useState<OrbitAxis>(fallbackAxis);
  /** Mesh-load failure message — the viewer shows it instead of dismissing. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** The panel's brief failure report — the surface half of the shared copy
   *  command's failure path (task 1.2/1.3). */
  const [copyError, setCopyError] = useState<string | null>(null);
  /**
   * What the library's override store credits this entry to, or `null` for
   * every way of having nothing to show — no store, no covering key, a read
   * that failed, or a `credits` holding no field worth a row. One state for all
   * of them, because the panel draws them identically by requirement: absent
   * and failed are the same picture, and no placeholder stands in for either
   * (`library-overrides` D4).
   */
  const [credits, setCredits] = useState<OverrideCredits | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the orientation on screen is the index's rather than the user's —
   * A framing reset that landed **before this session existed** — the panel and
   * the menu are both up while the mesh loads, so the press can arrive over the
   * spinner, when `liveFramingView` has no session to re-frame.
   *
   * Without this the discard would reach only the store: the effect below
   * captured the `camera` prop (or the `getThumb` answer) *before* the press and
   * does not re-run when the discard clears it, so the session would open at the
   * orientation just given up — and an orbit from there would have the close
   * write a camera built on it.
   *
   * Consumed in the effect's landing handler, where the session is built from
   * it, and nowhere else.
   *
   * The framing itself is not recomputed here: it is the one `resetFramingLive`
   * already resolved through `framingAfterDiscard`, handed over by `reframe`, so
   * this component learns no second copy of the rule.
   */
  const pendingReframeRef = useRef<{
    camera: CameraState;
    axis: OrbitAxis;
  } | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // A pointer-opened viewer mounts mid-press (orbit); a keyboard-opened one
  // mounts directly in lightbox mode with no pointer down.
  const pointer = useRef({ down: viewer.mode === "orbit", lastX: 0, lastY: 0 });
  // A held dismissal can keep this component mounted while a new press
  // replaces the viewer prop — re-arm the gesture state exactly as a fresh
  // mount would, or the new tile's drag/promote would be dead (D4).
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
  // A close in progress (lightbox-sibling-stepping D3) and a step in progress.
  // `goTo` awaits a persist before it navigates; a close landing in that window
  // must abort the pending step (`closingRef`, set at the top of `closeLightbox`)
  // so it does not flash the neighbour on its way out, and a second step in the
  // window is ignored (`steppingRef`) so a rapid double-press neither double-
  // persists nor lands on the wrong model. Never reset: a close unmounts.
  const closingRef = useRef(false);
  const steppingRef = useRef(false);
  /** In-flight settle→persist chain from the last drag release (D1). */
  const pendingPersistRef = useRef<Promise<void> | null>(null);

  /**
   * Post-drag dismissal: hold the overlay until the refreshed thumbnail is
   * applied and paintable (or a short timeout), so it unmounts onto matching
   * pixels. Dismisses synchronously when nothing is pending. A held dismissal
   * yields to any newer interaction (D4).
   */
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
    // Two rAFs: let React commit the new <img> src and the browser paint it
    // beneath the still-mounted overlay before unmounting.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    if (pointer.current.down) return; // a new gesture owns dismissal now
    if (viewerRef.current !== scheduledViewer) return; // a newer viewer replaced this one
    onDismiss();
  }

  // Load the mesh (spinner until warm) and build the session. The saved
  // camera/axis may not be in the thumbs map yet (its queued GET may not have
  // run) — fetch them from the server so a fast open never clobbers a saved
  // orientation with the default view on persist. Camera and axis live in the
  // same cache entry, so a present camera means the axis prop is settled too.
  useEffect(() => {
    let alive = true;
    // A step swaps `viewer.entry` under a live lightbox (lightbox-sibling-stepping
    // D5): clear this component's own session and error state up front so the
    // neighbour draws the spinner (and no stale ⚠) rather than the leaving
    // model's frozen last frame while its mesh loads. The cleanup nulls
    // `sessionRef` but leaves the `session` *state* — which the spinner, the axis
    // group and the error block all gate on — so without this reset a cold step
    // shows the previous frame beside the new name. A no-op on the first open,
    // where both are already null/absent.
    setSession(null);
    setLoadError(null);
    // An index orientation is the *default* only: a stored axis or camera is
    // the user's own and wins, and applying a pose persists nothing — the
    // sidecar is written by orbiting, not by opening (semantic-search D5).
    const fromPose = cameraForPose(pose, DEFAULT_CAMERA);
    // A new session has discarded nothing yet — a held dismissal can keep this
    // component mounted across entries, and a reframe recorded for the open
    // that was in flight must not be adopted by the one replacing it. The next
    // open re-reads a cache the store half has already updated anyway.
    pendingReframeRef.current = null;
    const savedPromise: Promise<{ camera?: CameraState; axis: OrbitAxis }> =
      camera !== undefined
        ? Promise.resolve({ camera, axis: axis ?? fallbackAxis })
        : api
            // The orientation only: this open wants the saved camera and axis,
            // and the pixels it would otherwise be handed are bytes nothing
            // here reads (and an object URL nothing here revoked).
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
    void Promise.all([lru.acquire(viewer.entry.path), savedPromise])
      .then(([object, saved]) => {
        if (!alive) return;
        // A framing reset pressed while this open was in flight wins over the
        // orientation the open resolved: `saved` is the very thing the press
        // gave up.
        const discarded = pendingReframeRef.current;
        if (discarded !== null) pendingReframeRef.current = null;
        // A discard resolves the axis with the camera — the pose's, or the
        // file's own default (`pose-rerender` D7) — so a pending one names it.
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
        // Missing file / gone zip entry / parse failure: show it, don't
        // silently dismiss — and flip the tile so the stale thumbnail stops
        // advertising a healthy model.
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

  // The credits, followed to the viewer's subject on the ignore-on-stale idiom
  // of the read above — an `alive` flag, never an AbortController (D4): the
  // answer is a memory lookup server-side, so there is nothing running worth
  // stopping, and what matters is only that a departed subject's answer is not
  // drawn for the one that replaced it.
  //
  // Cleared on the way in, before anything is asked: the component survives a
  // subject change (a held dismissal keeps it mounted), so without this the
  // previous model's attribution would sit under the new model's name for as
  // long as the new read takes — and would stay there forever if the new entry
  // resolves nothing at all, which is the common case.
  //
  // Asked only in lightbox mode, which is the only mode with a panel to draw it
  // in: an orbit press-drag-release then costs no request at all, and a lightbox
  // open costs exactly one. Failure is caught into the same `null` as absence —
  // no error state, by requirement.
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

  // Attach the shared canvas and render whenever session/mode/size changes —
  // and on an AO toggle, so the switch is visible without a drag.
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
    // Above device resolution, so the browser downsamples: a thumbnail is a
    // 512² render shown in a ~176 px tile, and matching that sample density is
    // what keeps the live view from reading as the aliased one at handoff.
    const { width, height } = liveRenderSize(
      host.clientWidth,
      host.clientHeight,
      window.devicePixelRatio || 1,
    );
    s.render(width, height);
  }

  /**
   * The end of the primary gesture, at the point given: a press without drag
   * promotes (when asked to), a drag settles and persists. Two callers — the
   * primary's own release, and `raiseEntryMenu` declining a shifted secondary
   * press mid-gesture, which ends the orbit here because the browser's menu
   * takes the primary's release and `onUp` would never run.
   *
   * Reached through `endGestureRef`, never directly: the window listeners are
   * installed once (the effect below runs on `tracker`, which App holds for
   * the app's lifetime) and would otherwise keep the mount render's copy —
   * whose `onPersist` closes over the mount render's `viewer`. A viewer swapped
   * in during a held dismissal then persisted the new tile's pixels under the
   * old tile's path (found in review, pre-existing; the bypass path, which is
   * re-created per render, was the first caller to see the props in force).
   */
  function endGesture(
    at: { clientX: number; clientY: number },
    { promote }: { promote: boolean },
  ): void {
    if (!pointer.current.down) return;
    pointer.current.down = false;
    if (!tracker.isDrag) {
      if (promote && modeRef.current === "orbit") onPromote();
      return;
    }
    const s = sessionRef.current;
    // Level the horizon and rebase the rest state, then persist that view.
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
    // A drag released outside the tile gets no later pointerleave — the
    // overlay would be stuck. Dismiss (persistence-aware) if the release
    // landed outside.
    if (modeRef.current === "orbit") {
      const rect = containerRef.current?.getBoundingClientRect();
      const inside =
        rect !== undefined &&
        at.clientX >= rect.left &&
        at.clientX <= rect.right &&
        at.clientY >= rect.top &&
        at.clientY <= rect.bottom;
      if (!inside) void dismissAfterPersist();
    }
  }
  const endGestureRef = useRef(endGesture);
  endGestureRef.current = endGesture;

  // Global gesture handling: the press that opened the overlay is already in
  // progress, so listeners live on window — and must attach synchronously
  // (before paint), or a fast click's pointerup arrives before they exist.
  useLayoutEffect(() => {
    function onMove(e: PointerEvent): void {
      if (!pointer.current.down) return;
      const wasDrag = tracker.isDrag;
      const isDrag = tracker.move(e.clientX, e.clientY);
      if (isDrag && sessionRef.current !== null) {
        if (!wasDrag) {
          pointer.current.lastX = e.clientX;
          pointer.current.lastY = e.clientY;
        }
        sessionRef.current.orbit(
          e.clientX - pointer.current.lastX,
          e.clientY - pointer.current.lastY,
        );
        pointer.current.lastX = e.clientX;
        pointer.current.lastY = e.clientY;
        renderNow();
      }
    }
    function onUp(e: PointerEvent): void {
      // The primary's release only. The gesture is the primary button's
      // (startGesture), and the overlay mounts with it already down — so
      // without this the *secondary* button's release mid-hold ended the
      // gesture as if the primary had let go, and a right-click without a
      // drag opened the lightbox under the menu it had just raised.
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

  // Orbit mode: dismiss on scroll/resize rather than track the tile.
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

  /**
   * Step to a sibling model (lightbox-sibling-stepping D3). Persist the leaving
   * model exactly as `closeLightbox` does — its camera, axis and pixels, under
   * its own path, and only if it was manipulated — *before* asking App to swap
   * the entry, because App's `persist` captures `viewer.entry` before its awaits
   * and that is still the leaving model until the swap lands.
   *
   * The snapshot-and-bail is `dismissAfterPersist`'s idiom: `onPersist`'s
   * `putThumb` is a tens-to-hundreds-of-ms window in which a close (Escape / ✕ /
   * backdrop) can run the full teardown, so after the awaits we bail if the
   * viewer we started on is gone or the mode is no longer `lightbox`. App's
   * `navigateSibling` owns the matching guard, so a step that lost the race
   * writes no `modelOpen` and cannot re-open the lightbox over the listing the
   * user backed onto. An untouched view has no await to race.
   */
  // `goTo` and the step props reach the key handler through refs, not the effect
  // deps (D6): the key effect re-runs on every step (its `session` dep changes),
  // and closing `onKey` over a leaving render's `onPersist` is the `endGestureRef`
  // bug — the new tile's pixels under the old tile's path. Updated on render so
  // both the key handler and the on-screen buttons see the current values.
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const prevEntryRef = useRef(prevEntry);
  prevEntryRef.current = prevEntry;
  const nextEntryRef = useRef(nextEntry);
  nextEntryRef.current = nextEntry;
  async function goTo(entry: DirEntry): Promise<void> {
    // Already closing, or a step's persist is still in flight — do nothing (D3):
    // the first covers a close that raced the press, the second a rapid double
    // press while the leaving model is being written.
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
    // Bail if a close landed in the persist window, or the viewer was replaced or
    // left the lightbox: App's `navigateSibling` also mode-guards the commit, so
    // a lost race writes no `modelOpen` and cannot re-open over the backed-to list.
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

  // Lightbox: focus trap + Esc close; re-render on window resize.
  useEffect(() => {
    if (viewer.mode !== "lightbox") return;
    // Conditional, not unconditional (D6): grab focus when the lightbox opens
    // (focus is outside the dialog then), but do NOT yank it back on every step
    // (the effect re-runs as `session` changes), or a keyboard user could
    // activate the on-screen Next control only once before focus jumped away.
    if (
      containerRef.current !== null &&
      !containerRef.current.contains(document.activeElement)
    ) {
      containerRef.current.focus();
    }
    function onKey(e: KeyboardEvent): void {
      // The entry menu can now be raised over this view, and while it is up it
      // is the thing on top: its own window listener closes it and this one
      // stands down, so one press dismisses one thing. The next press finds the
      // ref false and closes the lightbox as before. Same idiom, same reason as
      // App's find control standing down for a menu.
      if (e.key === "Escape") {
        if (menuOpen.current) return;
        onCloseIntent();
      }
      if (e.key === "Tab") {
        // Real trap: cycle focus through the dialog and its controls.
        e.preventDefault();
        const dialog = containerRef.current;
        if (dialog === null) return;
        // `:not([disabled])` — a disabled button (a prev/next control at an end,
        // D2) cannot take focus, so `focus()` on it is a no-op and the trap would
        // dead-stop there. On the first model the disabled Previous control is the
        // first button in the ring, so without this Tab is inert in the lightbox.
        const focusables = [
          dialog,
          ...dialog.querySelectorAll<HTMLElement>("button:not([disabled])"),
        ];
        const idx = focusables.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? (idx - 1 + focusables.length) % focusables.length
          : (idx + 1) % focusables.length;
        focusables[next]?.focus();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Leave Alt+Arrow to the browser (it is Back/Forward — Alt+Left is the
        // very gesture that closes the lightbox), and Ctrl/Meta+Arrow to the OS
        // (D6). Stand down for the entry menu as Escape does.
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
    // Mark the close first (lightbox-sibling-stepping D3): a step whose persist is
    // still awaiting must see this and abort rather than navigate on its way out.
    closingRef.current = true;
    const s = sessionRef.current;
    // A close persists — camera, axis and pixels, like an orbit release — only
    // after the user manipulated the view (`pose-rerender` D4): an orbit, a
    // zoom or an axis change. Untouched, it writes nothing at all. What an
    // untouched lightbox shows records no decision of the user's — their
    // stored camera, the index's orientation, or the default — and a camera
    // stored by such a close would outlive every orientation the source later
    // holds for the model ("a stored camera wins"), which with the index down
    // stored the default and withheld the pose forever. No pixels either: the
    // tile already shows the same framing, or the grid's own sweep follows
    // the pose state (D5). A framing reset clears the claim
    // (`ViewerSession.reframe`) and redraws the tile itself, so a close after
    // one writes nothing unless the user orbited again — which is what "not
    // written back by the close that follows" always meant.
    if (s !== null && s.everManipulated) {
      await s.settle(renderNow); // no-op if already level (e.g. Esc mid-drag aside)
      await onPersist(s);
    }
    onDismiss();
  }

  // App's answer to a close intent (and the browser-back path): run the SAME
  // async teardown as every in-app affordance — settle, persist, dismiss. The
  // session is private to this component, so no one else can run it.
  const handledCloseRef = useRef(closeSignal);
  useEffect(() => {
    if (closeSignal === handledCloseRef.current) return;
    handledCloseRef.current = closeSignal;
    if (viewer.mode === "lightbox") void closeLightbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal]);

  function startGesture(e: React.PointerEvent): void {
    // Primary button only, exactly as the tile's own handler decides
    // (App.onModelPointerDown): orbit is a left-drag, and a secondary press is
    // the menu's. Without this the release after a right-click would find a
    // gesture in progress and promote the overlay to the lightbox behind the
    // menu it just raised.
    if (e.button !== 0) return;
    pointer.current = { down: true, lastX: e.clientX, lastY: e.clientY };
    tracker.start(e.clientX, e.clientY);
  }

  /**
   * The secondary press on either viewer surface: the app's own entry menu,
   * never the browser's — except the shifted press, which is the browser's by
   * the requirement's one exception (entry-actions). Nothing else collides:
   * there is no right-button gesture here to preserve.
   *
   * Declining mid-orbit ends the orbit first, as a release at this point
   * would, but never promotes: the browser's menu is about to take the pointer,
   * so the primary's release will not reach `onUp`, and an orbit left running
   * would follow the mouse with no button held and refuse every dismissal.
   */
  function raiseEntryMenu(e: React.MouseEvent): void {
    if (nativeMenuRequested(e)) {
      endGestureRef.current(e, { promote: false });
      return;
    }
    e.preventDefault();
    onEntryMenu(
      viewer.entry,
      containerRef.current,
      { x: e.clientX, y: e.clientY },
      liveFramingView,
    );
  }

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

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
        setCopyError(null);
        setCopied(true);
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      },
      report: (message) => {
        // An earlier copy's confirmation must not outlive this failure.
        clearTimeout(copyTimerRef.current);
        setCopied(false);
        setCopyError(message);
        copyTimerRef.current = setTimeout(() => setCopyError(null), 2500);
      },
    });
  }

  /**
   * A panel affordance pressed: the shared command, through App's host.
   *
   * What travels with it is the live view — this component's session, which is
   * private to it and is the thing a framing reset has to move. Handed over for
   * every command, not just that one: the surface reports what it has, and
   * which commands care is `entryActions`' business.
   */
  /**
   * The live view a framing reset moves, built fresh at each read — one
   * construction for the panel's presses and the menu's, so the two surfaces
   * cannot drift in what "live" means.
   *
   * Offered even while the mesh is still loading, when there is no session to
   * move. That is not a pretence that one is open: the discard is a fact about
   * the model that this component alone can carry across the pending open, and
   * `reframe` records it for the landing handler instead of animating nothing.
   * Returning `null` there is what let the close resurrect a discarded camera —
   * `pendingReframeRef` says why.
   */
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
        // The view on screen is now the index's orientation or the default —
        // either way not the user's. `s.reframe` gave up the session's claim,
        // so the close that follows writes nothing unless the user orbits
        // again; the pixels are the reset's own render, queued behind this
        // view's suspension (`resetFramingLive`).
      },
    };
  }

  function runPanelCommand(id: CommandId): void {
    onCommand(id, liveFramingView());
  }

  // Drives renders while an axis-change tween is in flight. The loop ends on
  // its own when the tween completes or a drag/zoom cancels it.
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

  // The rest state is already the new spindle's default view, so persistence
  // is immediate — only the visible camera takes the scenic route.
  function changeAxis(next: OrbitAxis): void {
    const s = sessionRef.current;
    if (s === null || next === s.axis) return;
    s.setAxis(next);
    setSessionAxis(next);
    runTweenLoop();
    void onPersist(s);
  }

  const spinner = (
    <span className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
  );

  if (viewer.mode === "orbit") {
    const { rect } = viewer;
    return (
      <div
        ref={containerRef}
        className="fixed z-orbit-overlay cursor-grab touch-none rounded-lg bg-zinc-900 active:cursor-grabbing"
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
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-zinc-800/90 px-2.5 py-1 text-xs text-red-400"
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
      className="fixed inset-0 z-lightbox flex items-center justify-center bg-black/70"
      onContextMenu={raiseEntryMenu}
      onPointerDown={(e) => {
        // Primary button only, for the same reason `startGesture` checks it: a
        // secondary press on the backdrop raises the menu, and closing the view
        // out from under the menu it just raised is not what was asked.
        if (e.button === 0 && e.target === e.currentTarget) onCloseIntent();
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
        style={{ "--lb-width": "95vw", "--lb-panel": "18rem" } as CSSProperties}
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
              sessionRef.current?.zoom(e.deltaY > 0 ? 1.1 : 0.9);
              renderNow();
            }}
          />
          {/* Prev/next affordances (lightbox-sibling-stepping D2). Siblings of
              the canvas host, not children — the host owns the orbit/zoom
              handlers and this container owns none, so a press or wheel on a
              button never orbits or zooms. Present but `disabled` at the end
              each cannot serve (no wrap), so focus stays put and the ends are
              visible. `z-10` keeps them above the canvas. */}
          <button
            type="button"
            aria-label="Previous model"
            disabled={prevEntry === null}
            onClick={() => {
              if (prevEntry !== null) void goTo(prevEntry);
            }}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-zinc-800/80 p-2 text-zinc-200 hover:bg-zinc-700 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-zinc-800/80"
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
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-zinc-800/80 p-2 text-zinc-200 hover:bg-zinc-700 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-zinc-800/80"
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
          {session === null &&
            (loadError !== null ? (
              <div
                role="alert"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center"
              >
                <span className="text-2xl" aria-hidden="true">
                  ⚠
                </span>
                <p className="text-sm font-medium text-zinc-200">
                  {viewer.entry.name}
                </p>
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
            <div
              className={`absolute left-3 top-3 ${AXIS_GROUP_CLASS}`}
              aria-label="Orbit axis"
            >
              <span className={AXIS_CAPTION_CLASS}>axis</span>
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
        <div className="flex w-[var(--lb-panel)] min-w-0 flex-col gap-4 overflow-y-auto p-4">
          {/* pr-9 keeps the name clear of the dialog-anchored close button */}
          <p className="break-all pr-9 text-sm font-medium text-zinc-200">
            {viewer.entry.name}
          </p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">path</span>
              <button
                type="button"
                aria-label="Copy path"
                onClick={copyPath}
                className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                {copied ? "copied" : "copy"}
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
                <dd className="uppercase text-zinc-300">
                  {viewer.entry.format}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">size</dt>
              <dd className="text-zinc-300">
                {formatBytes(viewer.entry.size)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">
                {viewer.entry.path.includes("!/")
                  ? "modified (zip)"
                  : "modified"}
              </dt>
              <dd className="text-right text-zinc-300">
                {formatDate(viewer.entry.mtime)}
              </dd>
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
                  <dd className="tabular-nums text-zinc-300">
                    {formatCosine(score.score)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">{Z_LABEL}</dt>
                  <dd className="tabular-nums text-zinc-300">
                    {formatZ(score.z)}
                  </dd>
                </div>
              </>
            )}
            {/* Attribution, among the metadata and before the action strip for
                the same "describes before it offers" reason the score rows are
                here — and as rows of this same `<dl>`, which is what "among the
                metadata" means when the metadata is a description list. Drawn
                only where the store credits something: nothing announces that a
                model has no author, because most libraries have no store at all
                and a panel that said so would say it forever
                (`library-overrides` D4).

                A row per field the store actually holds, so a partial credit
                draws as the part it is rather than as a blank next to a label —
                the corpus metadata does not always carry all six. The order is
                author, license, source, modified (`credits-completion` D4): the
                first three say whose work this is and where it came from, the
                last what was done to this copy, a footnote to them. */}
            {credits !== null && (
              <>
                {credits.author !== undefined && (
                  <div
                    data-credit="author"
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-zinc-500">author</dt>
                    <dd className="min-w-0 text-right text-zinc-300">
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
                    <dt className="text-zinc-500">license</dt>
                    <dd className="min-w-0 break-words text-right text-zinc-300">
                      {/* The label stays the corpus's string and links to the
                          stored deed URL — the URL is what carries the version,
                          and the app derives nothing from the label (D3). */}
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
                    <dt className="text-zinc-500">source</dt>
                    <dd className="min-w-0 text-right text-zinc-300">
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
                {/* The modification notice: the corpus's phrase, verbatim, and
                    only where the store holds one — absent means served
                    unchanged, and an unchanged copy is not labelled (D2).
                    Addressed as `modified`, labelled "this copy": the list
                    above already labels the file's date `modified`, and the
                    phrase is about the copy, not the date (D4). */}
                {credits.modified !== undefined && (
                  <div
                    data-credit="modified"
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-zinc-500">this copy</dt>
                    <dd className="min-w-0 break-words text-right text-zinc-300">
                      {credits.modified}
                    </dd>
                  </div>
                )}
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
            <div
              role="group"
              aria-label="Open in"
              className={OPEN_IN_GROUP_CLASS}
            >
              <span className={OPEN_IN_PANEL_CAPTION_CLASS}>
                {OPEN_IN_CAPTION}
              </span>
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
          {actionNote !== null && (
            // The header's own two tones, so one transient line reads the same
            // wherever it lands (App's `headerMessage`).
            <p
              role="status"
              className={`text-xs ${
                actionNote.tone === "error" ? "text-red-400" : "text-zinc-400"
              }`}
            >
              {actionNote.text}
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
  );
}
