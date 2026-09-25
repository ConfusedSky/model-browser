import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type * as THREE from "three";
import type {
  AppsReport,
  DirEntry,
  FeatureReport,
  IndexPose,
  IndexScore,
  LibraryState,
  OrbitAxis,
} from "../../shared/types";
import { EXAMPLE_QUERIES } from "../../shared/exampleQueries";
import { HttpApiClient, HttpError, type ApiClient } from "./api/client";
import { withLocalFramings } from "./api/localFramings";
import EntryMenu from "./components/EntryMenu";
import FindBar from "./components/FindBar";
import Grid, { SkeletonGrid, type TileSize } from "./components/Grid";
import Icon, { type IconName } from "./components/Icon";
import IntroBanner from "./components/IntroBanner";
import JobChip from "./components/JobChip";
import SidePanel, { collapseStore } from "./components/SidePanel";
import PathBar from "./components/PathBar";
import { useCyclingPlaceholder } from "./hooks/useCyclingPlaceholder";
import { SKELETON_DELAY_MS, useDelayedFlag } from "./hooks/useDelayedFlag";
import { useThumbnails, type ThumbState } from "./hooks/useThumbnails";
import { BulkJobs, useBulkJobState, type JobOperation } from "./jobs/bulkJobs";
import {
  commandsFor,
  containingFolder,
  JOB_BUSY,
  resettable,
  type FramingWrite,
  type StoredFraming,
  LIGHTBOX_PANEL_EXCLUDES,
  openEntryIn,
  openInApps,
  orbitAxisApplies,
  resetFramingLive,
  runCommand,
  setOrbitAxis,
  type ActionHost,
  type CommandId,
  type EntryCommand,
  type LiveFramingView,
} from "./lib/entryActions";
import { GestureTracker } from "./lib/gesture";
import { createHoverWarmer } from "./lib/hover";
import { ABOUT_URL, introDismissedStore, pickExample } from "./lib/intro";
import { fitSquareBox, type Box } from "./lib/layout";
import {
  applyIn,
  findTile,
  measureIn,
  tilesIn,
  resolvePlacement,
  type PlacementRequest,
} from "./lib/placement";
import { pushRecent } from "./lib/recents";
import { stored } from "./lib/stored";
import { scaleOf, showScoresStore } from "./lib/scoreScale";
import {
  applySessionSearchMode,
  folderMatchingEnabled,
  hasStoredSearchMode,
  searchKinds,
  searchMode,
  searchTuning,
  setFolderMatchingEnabled,
  setSearchKinds,
  setSearchMode,
  setSearchTuning,
  resolveTuning,
  optionsOffDefault,
  looksLikeDescription,
  looksLikeFileName,
  type SearchKinds,
  type SearchMode,
  type Tuning,
} from "./lib/searchOptions";
import {
  listingKey,
  trailPlacement,
  trailPush,
  trailRecord,
  trailReplace,
  trailWalkBack,
} from "./lib/trail";
import {
  commitUrl,
  historyIndex,
  isLightboxEntry,
  isSimilarEntry,
  LIGHTBOX_ENTRY,
  parseUrl,
  serializeView,
  SIMILAR_ENTRY,
  similarDepth,
  type UrlView,
} from "./lib/urlState";
import {
  initialState,
  reducer,
  type Action,
  type Landed,
  type Result,
} from "./state/reducer";
import {
  busy,
  byKind,
  controls,
  dest,
  labelInputs,
  landedListing,
  liveView,
  meaningRunnableAt,
  noticeKinds,
  pendingRequest,
} from "./state/selectors";
import {
  sameListing,
  SIMILAR_K,
  toUrlView,
  type Prefs,
  type Subject,
  type View,
} from "./state/view";
import { MeshLru } from "./three/lru";
import { meshLoader } from "./three/meshLoader";
import { defaultAxisFor } from "./three/camera";
import {
  disposeModel,
  embedded3mfThumbnail,
  formatOf,
  formatOfEntry,
  geometryBytes,
  parseModel,
} from "./three/models";
import { POSE_VERSION } from "./three/pose";
import { RenderQueue, type Band } from "./three/queue";
import { RIG_VERSION, THUMB_LIGHTING, onContextLost } from "./three/renderer";
import ViewerLayer, { type ViewerState } from "./viewer/ViewerLayer";
import { aoEnabled, setAoEnabled } from "./viewer/aoToggle";
import type { ViewerSession } from "./viewer/session";

/** Long enough that a number typed digit by digit is one search, not four. */
const TUNING_DEBOUNCE_MS = 300;

/** Must match the `reveal-mark` animation in `index.css`, which fades it. */
const MARK_MS = 1800;

/** A fling emits an event per frame, and the trail wants where they stopped. */
const RECORD_SETTLE_MS = 150;

/** `raisedWith` is the answer on screen at raise time: a restore asking the
 *  same question patches — new object, same `id` — so an unchanged id once
 *  things settle means nothing landed and nothing may be applied (D5). */
interface PendingPlacement {
  request: PlacementRequest;
  raisedWith: Result | null;
}

const TOP_REQUEST: PlacementRequest = { kind: "top" };

const ACTION_TEXT_MS = 2500;

/** The sweep and the wave re-run on these identities, so a fresh literal per
 *  render would walk the grid on every keystroke. */
const NO_ENTRIES: DirEntry[] = [];
const NO_PATHS: string[] = [];
const NO_POSES: Record<string, IndexPose | null> = {};
const NO_SCORES: Record<string, IndexScore> = {};
/** Shared, so **never written to**: every landing builds a new Map. */
const NO_PREVIEWS: ReadonlyMap<string, DirEntry[]> = new Map();
const NO_PREVIEW: DirEntry[] = [];

/** Below this top z a meaning search reads as a guess. Measured against both
 *  indexes: nonsense phrases top out at 1.7–2.4 where real ones start near
 *  2.4 — so this catches most nonsense and a few vague phrases, never a
 *  strong one. */
const WEAK_TOP_Z = 2.5;
/** Below this top z no result in the set is called better than "Fair". */
const STRONG_TOP_Z = 3.6;
/** How many guesses a weak set shows before "Show all". */
const WEAK_SHOWN = 12;
const RENDERING_DELAY_MS = 300;
/** What the name search answers at most, so a probe count there is a floor. */
const NAME_COUNT_CAP = 500;
const NOTE_ACTION_CLASS =
  "font-medium text-accent underline-offset-2 hover:underline touch:py-2";

const TILE_SIZES = ["s", "m", "l"] as const;
const TILE_SIZE_NAME: Record<TileSize, string> = {
  s: "Small",
  m: "Medium",
  l: "Large",
};
const tileSizeStore = stored<TileSize>(
  "model-browser:tile-size",
  (raw) => (raw === "s" || raw === "l" ? raw : "m"),
  (v) => v,
);

/** Keyed on the listing's identity, so it is scanned once per landing. */
const carriedPreviews = new WeakMap<DirEntry[], Map<string, DirEntry[]>>();
function carriedPreviewsFor(entries: DirEntry[]): Map<string, DirEntry[]> {
  let map = carriedPreviews.get(entries);
  if (map === undefined) {
    map = new Map();
    for (const e of entries)
      if (e.preview !== undefined) map.set(e.path, e.preview);
    carriedPreviews.set(entries, map);
  }
  return map;
}
const NO_SUBJECT: Subject = { kind: "none" };

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Two sentences because only one failure is fixable (D4/4.5): an archive
 *  resident is never a key on either side, so it must not borrow the other's
 *  promise that indexing again would help. */
const NOT_EMBEDDED =
  "This model has not been indexed yet, so the index knows no neighbours for it — run the classifier over it and try again.";
/** The same fact for a viewer who cannot run the classifier
 *  (`public-deployment` D11). Not a truncation: "yet" and "try again" promise a
 *  repair nobody on this side can keep. */
const NOT_EMBEDDED_VISITOR =
  "This model is not in the index, so it has no neighbours yet.";
/** Only a **known** report takes the visitor form (feature-report). */
function notEmbeddedMessage(features: FeatureReport | null): string {
  return features?.hostDetails === false ? NOT_EMBEDDED_VISITOR : NOT_EMBEDDED;
}
const OUTSIDE_CORPUS =
  "Models inside an archive are outside what the index covers, so it can find nothing similar to this one.";

/** Under a committed search an absent option means the **default**, never this
 *  profile's preference (D4), or one link hands two people different results.
 *  With nothing committed there is no view to reproduce. */
function optionsOf(view: UrlView): Prefs {
  if (view.q === undefined || view.q === "") return ownPrefs();
  return {
    folderMatching: view.folderMatching ?? true,
    kinds: view.kinds ?? "both",
    mode: view.mode ?? "name",
    // Not a spread: the bounds are read by presence, and a spread re-adds the
    // field the link deliberately left out (D4).
    tuning: resolveTuning(view.tuning),
  };
}

/** Carried on the action, never read inside the reducer, which must stay pure
 *  under StrictMode (design R2). */
function ownPrefs(): Prefs {
  return {
    folderMatching: folderMatchingEnabled(),
    kinds: searchKinds(),
    mode: searchMode(),
    tuning: searchTuning(),
  };
}

function resolveView(url: UrlView): View {
  return {
    path: url.path,
    flat: url.flat,
    // `similar` is the more specific parameter, so a link carrying both is the
    // similarity view (D4).
    subject:
      url.similar !== undefined
        ? {
            kind: "similar",
            model: url.similar,
            k: url.k ?? SIMILAR_K,
            pool: url.pool,
          }
        : url.q !== undefined
          ? { kind: "query", text: url.q }
          : { kind: "none" },
    model: url.model ?? null,
    ...optionsOf(url),
  };
}

/** States, not failures (library R4): one line in the header's slot, no error
 *  surface of their own. A deployment may withhold the locations each names as
 *  the remedy (`hostDetails`, D11), and that `undefined` is the server's
 *  omission, not a failed read. */
const LIBRARY_UNCONFIGURED =
  "No library configured — set MODEL_BROWSER_ROOT or root in config.json";
const LIBRARY_UNCONFIGURED_VISITOR = "No library is configured.";
const libraryUnconfiguredText = (features: FeatureReport | null): string =>
  features?.hostDetails === false
    ? LIBRARY_UNCONFIGURED_VISITOR
    : LIBRARY_UNCONFIGURED;
const libraryMissingText = (root: string | undefined): string =>
  root === undefined
    ? "The library is not present"
    : `The library at ${root} is not present`;
const libraryNestedText = (library: string | undefined): string =>
  library === undefined
    ? "The root contains another library."
    : `This root contains a library at ${library}. Point the root at it, or at a folder inside it.`;

/** Exhaustive over `LibraryState` by construction, so a new variant is a type
 *  error until someone picks a side — and needed at all because
 *  `HttpError.state` carries *any* failure body's state, the index's 503
 *  included. */
const LIBRARY_STATES: ReadonlySet<string> = new Set(
  Object.entries({
    ready: false,
    unconfigured: true,
    missing: true,
    nested: true,
  } satisfies Record<LibraryState["state"], boolean>)
    .filter(([, isFault]) => isFault)
    .map(([state]) => state),
);

export default function App() {
  /** A stable getter for the two consumers that must read the report without
   *  depending on it (D6): the client identity has to survive it resolving,
   *  and the sweep's dependency array must not churn. */
  const featuresRef = useRef<FeatureReport | null>(null);
  const readFeatures = useCallback(() => featuresRef.current, []);
  /** It keys the local-framing store, without which one installation repointed
   *  between two libraries sharing relative paths would read one's framings
   *  onto the other's models. */
  const libraryIdRef = useRef<string | null>(null);
  const readLibraryId = useCallback(() => libraryIdRef.current, []);
  /** Where thumbnail writes are off, the decorator keeps a framing in this
   *  browser and overlays it on a lookup's answer (D6) — one seam rather than
   *  that rule at every `putThumb` call site. */
  const api = useMemo(
    () =>
      withLocalFramings(
        new HttpApiClient(),
        readFeatures,
        undefined,
        readLibraryId,
      ),
    [readFeatures, readLibraryId],
  );
  const queue = useMemo(() => new RenderQueue(2), []);
  const placeholderRef = useRef<(path: string, url: string) => void>(() => {});
  const lru = useMemo(
    () =>
      new MeshLru<THREE.Object3D>(
        meshLoader(api, placeholderRef),
        disposeModel,
      ),
    [api],
  );

  // The search/view state, whole (design R1). The URL alone names the boot
  // view; the last session's path is recents only, never a boot source.
  const [state, rawDispatch] = useReducer(reducer, undefined, () =>
    initialState(resolveView(parseUrl())),
  );
  const dispatch = useCallback((action: Action): void => {
    if (import.meta.env.DEV && import.meta.env.MODE !== "test") {
      // eslint-disable-next-line no-console
      console.debug("[view]", action.type, action);
    }
    rawDispatch(action);
  }, []);

  /** Set only by dispatches that own the URL (design R3) — never by model-close
   *  or model-drop, whose window overlaps an async teardown (bridge 4), nor by
   *  an unrun tuning record, which would mint an entry per keystroke. */
  const urlIntent = useRef<{ replace?: boolean; state?: unknown } | null>(null);
  /** The URL can run ahead of the view — the browser rewinds it on Back while
   *  the restoration is still in flight — so "did this dispatch advance the
   *  view" is asked of the view, never of the address bar. */
  const projectedRef = useRef<string | null>(null);

  /** A `RefObject`, never its `.current`: the identity has to be stable in the
   *  observer effect's deps, and population happens during commit (D2). */
  const mainRef = useRef<HTMLElement>(null);
  /** Focus has to land somewhere when the banner's ✕ unmounts the focused
   *  element, or the browser drops it to `<body>` (`landing-page` D3). */
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Set during render, because the record has to see what the last commit
   *  painted. */
  const busyRef = useRef(false);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /** The scroll timer's record, taken as the user acts instead — while the grid
   *  is still on screen and `historyIndex()` still its entry's (D2). Skipped
   *  while busy: another entry's grid is not this one's place. */
  const recordNow = useCallback((): void => {
    clearTimeout(recordTimerRef.current);
    recordTimerRef.current = undefined;
    const main = mainRef.current;
    if (main === null || busyRef.current) return;
    trailRecord(historyIndex(), measureIn(main));
  }, []);
  useEffect(() => {
    const main = mainRef.current;
    if (main === null) return;
    const onScroll = (): void => {
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = setTimeout(recordNow, RECORD_SETTLE_MS);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", onScroll);
      clearTimeout(recordTimerRef.current);
    };
  }, [recordNow]);

  const commit = useCallback(
    (
      action: Action,
      opts: { replace?: boolean; state?: unknown } = {},
    ): void => {
      // Filed before the view moves on (D2's flush); whether this supersedes a
      // pending placement is the placement effect's call.
      recordNow();
      urlIntent.current = opts;
      dispatch(action);
    },
    [dispatch, recordNow],
  );
  /** For callbacks whose identity must not follow the state: `onPop`,
   *  `leaveSubject` and the action host are memoised once and still raise
   *  placements against the answer on screen now. */
  const stateRef = useRef(state);
  stateRef.current = state;

  // The draft lives in the reducer because submit reads it; this filter does
  // not (design R8), and starts empty even on a restore, because nothing in a
  // URL describes one.
  const [findText, setFindText] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  // The window-level listeners below subscribe once, so everything they read
  // reaches them through a ref rather than a closure.
  const viewerRef = useRef<ViewerState | null>(null);
  const findOpenRef = useRef(false);
  findOpenRef.current = findOpen;

  /** **Not a viewer**: it never sets `viewer`, which the render-queue
   *  suspension keys off (2.4). Raised from a tile or from the orbit overlay
   *  over one, which is the tile it covers; the lightbox raises none — its
   *  panel carries every command. */
  const [menu, setMenu] = useState<{
    entry: DirEntry;
    el: HTMLElement | null;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<typeof menu>(null);
  menuRef.current = menu;
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menu !== null;

  const goUpRef = useRef<() => void>(() => {});

  /** A fact about the *server*, never a `View` field (library R4), so it
   *  reaches neither the URL, the history, nor the reducer. `null` is "not
   *  asked yet" and must not read as blocked: the boot listing is already
   *  out. */
  const [libraryState, setLibraryState] = useState<LibraryState | null>(null);
  /** A rejection is swallowed: `/api/library` answers in every state, so this
   *  is the outage the provoking request already reports. */
  const probeLibrary = useCallback((): void => {
    void api.library().then(setLibraryState, () => {});
  }, [api]);
  useEffect(() => probeLibrary(), [probeLibrary]);
  /** Read by the re-probe conditions without rebuilding the action host. */
  const libraryRef = useRef<LibraryState | null>(null);
  libraryRef.current = libraryState;
  const libraryId = libraryState?.state === "ready" ? libraryState.id : null;
  libraryIdRef.current = libraryId;

  /**
   * `null` is **not known** — in flight or a failed read, deliberately not
   * distinguished — and D3's split is what any new consumer must follow: an
   * **offer** is withheld unless a known report declares its capability on, a
   * **behavior** keeps its default until one declares it off, so a transient
   * failure can never relocate a user's data.
   */
  const [features, setFeatures] = useState<FeatureReport | null>(null);
  /** Component state rather than a module closure, so a test's
   *  `localStorage.clear()` resets it. A failed write still leaves this
   *  `true` — gone for this page, back on the next load, never an error. */
  const [introDismissed, setIntroDismissed] = useState(() =>
    introDismissedStore.read(),
  );
  const introModeApplied = useRef(false);
  /** How many models the user's hand made or unmade resettable since the tab
   *  last derived (D5). An adjustment, because a re-derivation costs a library
   *  walk per orbit; the full one still runs where it did, so drift heals. */
  const [handDelta, setHandDelta] = useState(0);
  /** The re-derivation trigger, for drift a ±1 cannot carry. Off `settled` and
   *  `wrote`, never a phase: a launch passes through `deriving` before it
   *  writes, and Cancel fires while the in-flight entry may still land. */
  const [jobsEnded, setJobsEnded] = useState(0);
  const thumbsRef = useRef<Map<string, ThumbState>>(new Map());
  const noteFramingChanged = useCallback(
    (path: string, write: FramingWrite, known?: StoredFraming) => {
      // The site's own lookup, else the tile's *ready* state, else a
      // re-derivation: a loading tile carries no framing, and reading that as
      // "unframed" miscounts. Never the listing's annotation, which can name a
      // camera the server no longer holds.
      const recount = (): void => setJobsEnded((n) => n + 1);
      const shown = thumbsRef.current.get(path);
      const before: StoredFraming | undefined =
        known ??
        (shown?.status === "ready"
          ? { camera: shown.camera, axis: shown.axis }
          : undefined);
      if (before === undefined) return recount();
      const after: StoredFraming = {
        camera:
          write.camera === null ? undefined : (write.camera ?? before.camera),
        axis: write.axis === null ? undefined : (write.axis ?? before.axis),
      };
      const delta =
        (resettable(after.camera, after.axis) ? 1 : 0) -
        (resettable(before.camera, before.axis) ? 1 : 0);
      if (delta !== 0) setHandDelta((d) => d + delta);
    },
    [],
  );

  /** One reading per session (L5), so the menu's open-in group is decided from
   *  state and never from a probe fired when a menu opens (2.5). A failed read
   *  is `null`: the actions are absent rather than present and inert. */
  const [apps, setApps] = useState<AppsReport | null>(null);
  /** Not a reducer failure kind: `state.failure` belongs to a *question* and is
   *  cleared by the next answer, and a clipboard refusal belongs to none. */
  const [actionText, setActionText] = useState<{
    text: string;
    tone: "ok" | "error";
  } | null>(null);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(actionTimerRef.current), []);
  const say = useCallback((text: string, tone: "ok" | "error"): void => {
    clearTimeout(actionTimerRef.current);
    setActionText({ text, tone });
    actionTimerRef.current = setTimeout(
      () => setActionText(null),
      ACTION_TEXT_MS,
    );
  }, []);
  /** The same sentence, sent to the lightbox instead of the path bar it covers.
   *  Toned, because *Copy path* must confirm briefly (entry-actions R1) and a
   *  confirmation in the failure colour is the other half of that bug. */
  const [viewerNote, setViewerNote] = useState<{
    text: string;
    tone: "ok" | "error";
  } | null>(null);
  const viewerNoteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(viewerNoteTimerRef.current), []);
  const sayInViewer = useCallback(
    (text: string, tone: "ok" | "error"): void => {
      clearTimeout(viewerNoteTimerRef.current);
      setViewerNote({ text, tone });
      viewerNoteTimerRef.current = setTimeout(
        () => setViewerNote(null),
        ACTION_TEXT_MS,
      );
    },
    [],
  );
  /** Off `viewerRef`, not the state, or the memoized action host rebuilds on
   *  every viewer open. Only the lightbox reroutes: an orbit overlay covers one
   *  tile, not the bar. */
  const sayWhereLooking = useCallback(
    (text: string, tone: "ok" | "error"): void => {
      if (viewerRef.current?.mode === "lightbox") sayInViewer(text, tone);
      else say(text, tone);
    },
    [say, sayInViewer],
  );

  /** Component-local like `findText`, so neither a scroll position nor a
   *  highlight reaches the URL or a reload. One pending thing, not two: a
   *  reveal is a case of the request, so it and a Back cannot both wait. */
  const [pendingPlacement, setPendingPlacement] =
    useState<PendingPlacement | null>(null);
  const pendingQuestionRef = useRef<number | null>(null);
  const [marked, setMarked] = useState<string | null>(null);
  const raisePlacement = useCallback((request: PlacementRequest): void => {
    pendingQuestionRef.current = null;
    setPendingPlacement({
      request,
      raisedWith: stateRef.current.result,
    });
  }, []);
  const markTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(markTimerRef.current), []);

  const tuningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /** The view a debounced re-run belongs to; the effect below drops the timer
   *  the moment that stops being the question on screen. */
  const tuningForRef = useRef<View | null>(null);
  useEffect(() => () => clearTimeout(tuningTimerRef.current), []);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  useEffect(() => {
    clearTimeout(viewerNoteTimerRef.current);
    setViewerNote(null);
  }, [viewer?.entry.path]);
  const [ao, setAoState] = useState(aoEnabled);
  const [panelOpen, setPanelOpen] = useState(() => !collapseStore.read());
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const [showScores, setShowScores] = useState(() => showScoresStore.read());
  /** The GPU context is gone: nothing more will draw until it comes back. */
  const [glLost, setGlLost] = useState(false);
  useEffect(() => onContextLost(setGlLost), []);
  /** The query last sent to the other corpus because its words belonged
   *  there: a file name to the names, a description to meaning. */
  const [autoMode, setAutoMode] = useState<{
    text: string;
    mode: SearchMode;
  } | null>(null);
  const [tileSize, setTileSize] = useState<TileSize>(() =>
    tileSizeStore.read(),
  );
  const trackerRef = useRef(new GestureTracker());

  // `history.state` cannot live in a reducer, so whether a model open writes a
  // new entry or the browser's own travels here (R7 bridge 1). Without it a
  // restored lightbox mints an entry nobody asked for.
  const suppressViewerPushRef = useRef(false);
  const [closeSignal, setCloseSignal] = useState(0);
  // Bridge 3: the overlay leads `view.model` by one transition, so "the model
  // left the view" is only meaningful after it arrived.
  const namedModelRef = useRef<string | null>(null);

  const target = dest(state);
  const live = controls(state);
  const label = labelInputs(state);
  const liveQuery = live.subject.kind === "query" ? live.subject.text : null;
  // Off the LIVE subject, or a spinner snaps back between press and answer.
  const liveSimilar = live.subject.kind === "similar" ? live.subject : null;
  const labelQuery = label.subject.kind === "query" ? label.subject.text : null;
  const labelModel =
    label.subject.kind === "similar" ? label.subject.model : null;
  const scope = state.result?.scope ?? null;
  const truncated = state.result?.truncated === true;
  // Off the ANSWER, not what is in flight: the line belongs to the listing on
  // screen (listing-tree-cache §5.1).
  const refreshing = state.result?.stale === true;
  const entries = state.result?.entries ?? NO_ENTRIES;
  /** A stored reference in every branch, because the sweep re-runs on this
   *  identity. Preview models are the set it misses — they never land, so no
   *  wave asks about them — and `poses` below folds their own in. */
  const listingPoses = state.result?.poses ?? state.listingPoses ?? NO_POSES;
  // The scale is the answer's own question, so a tile can only be labelled as
  // the thing that asked for it (D3).
  const scores = state.result?.scores ?? NO_SCORES;
  const scoreScale = scaleOf(label.subject, label.meaning);
  const anchor = state.result?.anchor;
  /** The only way to obtain a score, so the anchor guard cannot be forgotten.
   *  **Returns the map's own object, never a constructed one**: `Tile`'s memo
   *  compares `score` by identity, and `{score, z}` per call undoes it (D6). */
  const scoreFor = useCallback(
    (path: string): IndexScore | undefined =>
      path === anchor?.path ? undefined : scores[path],
    [scores, anchor?.path],
  );
  /** A path is in the map once its peek has answered, **nothing and failures
   *  included** — both store the empty list, so the tile draws its icon and
   *  nothing is retried within this listing (folder-contact-sheets D1). */
  const [previews, setPreviews] =
    useState<ReadonlyMap<string, DirEntry[]>>(NO_PREVIEWS);
  /** A ref, not state: a tile in flight already draws its icon, so nothing
   *  renders this. */
  const inFlightPeeks = useRef<Set<string>>(new Set());
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const listingRef = useRef(entries);
  listingRef.current = entries;
  /** Reset **during the render that first sees the new listing**, not in an
   *  effect: an observer report can reach `requestPeek` between an effect's
   *  `setPreviews` and the re-render that refreshes `previewsRef`, and where
   *  the listings share folders every report then reads as already answered. */
  const previewsListingRef = useRef(entries);
  if (previewsListingRef.current !== entries) {
    previewsListingRef.current = entries;
    inFlightPeeks.current.clear();
    previewsRef.current = NO_PREVIEWS;
    setPreviews(NO_PREVIEWS);
  }
  /** At most once per listing. No abort and no retry: the request is bounded
   *  server-side, and a failure is filed as "nothing to preview". */
  const requestPeek = useCallback(
    (path: string) => {
      if (previewsRef.current.has(path) || inFlightPeeks.current.has(path))
        return;
      inFlightPeeks.current.add(path);
      // Captured before the await: a peek outlives the tile that asked for it,
      // and an answer about a folder the user has left must not enter the new
      // listing's map.
      const asked = listingRef.current;
      const land = (found: DirEntry[]): void => {
        // Generation first, delete second: the marker is keyed by path alone,
        // so a superseded answer deleting it would strip the successor's
        // once-per-listing guard while that one is still in flight.
        if (listingRef.current !== asked) return;
        inFlightPeeks.current.delete(path);
        setPreviews((prev) => {
          const next = new Map(prev);
          next.set(path, found);
          return next;
        });
      };
      // The listing may already carry this folder's choice, inline from the
      // server's preview layer (listing-tree-cache 6.3/6.8).
      const carried = carriedPreviewsFor(asked).get(path);
      if (carried !== undefined) {
        // Not through `land`, whose marker delete would open a re-entry window:
        // `previewsRef` lags a render behind this set, so a second observer
        // report in the same batch would pass both guards and land again.
        setPreviews((prev) => {
          const next = new Map(prev);
          next.set(path, carried);
          return next;
        });
        return;
      }
      void api.peek(path).then(land, () => land(NO_PREVIEW));
    },
    [api],
  );
  /** Keyed on `entries` and **not** on `state.result`, which `patch` respreads
   *  on every fetchless view change: keying on the result would re-issue every
   *  peek each time a model was opened (D1). */
  useEffect(() => {
    askedPreviewPoses.current.clear();
    // Pruned, not reset: a pose going P → undefined → P retires and restarts
    // that model's pipeline — an unposed render and a visible angle flip on
    // exactly the tiles the wave exists to fix.
    setPreviewPoses((prev) => {
      if (prev === NO_POSES) return prev;
      const kept: Record<string, IndexPose | null> = {};
      let count = 0;
      for (const e of entries) {
        const pose = prev[e.path];
        if (pose !== undefined) {
          kept[e.path] = pose;
          count++;
        }
      }
      return count === 0
        ? NO_POSES
        : count === Object.keys(prev).length
          ? prev
          : kept;
    });
  }, [entries]);
  /** Their own wave, because the listing wave asks about what LANDED and
   *  preview models never land: without it a sheet cell keeps a stale angle
   *  until the user walks into the folder. Failure is silence. */
  const [previewPoses, setPreviewPoses] =
    useState<Record<string, IndexPose | null>>(NO_POSES);
  const askedPreviewPoses = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (libraryState?.state !== "ready" || previews.size === 0) return;
    const want: string[] = [];
    for (const found of previews.values()) {
      for (const e of found) {
        // An entry that arrived with its orientation is never a question
        // (listing-tree-cache §6.4). `!== undefined` covers the explicit `null`
        // deliberately: that is the index settled as holding none.
        if (
          e.kind !== "model" ||
          e.pose !== undefined ||
          askedPreviewPoses.current.has(e.path)
        ) {
          continue;
        }
        askedPreviewPoses.current.add(e.path);
        want.push(e.path);
      }
    }
    if (want.length === 0) return;
    const asked = listingRef.current;
    void api.semanticPosesFor(want).then(
      (res) => {
        if (listingRef.current !== asked) return;
        // Empty means *unsettled* — a warming index — so it merges nothing
        // rather than churn `poses` identity. An answer carrying `null`s is not
        // empty: those are settled absences and redraw a posed cell.
        if (Object.keys(res.poses).length === 0) return;
        setPreviewPoses((prev) => ({ ...prev, ...res.poses }));
      },
      () => {},
    );
  }, [previews, libraryState?.state, api]);
  // Sheet cells share the tiles' pipeline (folder-contact-sheets D3) and are
  // deduplicated by path, since a previewed model is often a tile as well.
  const thumbEntries = useMemo(() => {
    const base = anchor === undefined ? entries : [anchor, ...entries];
    if (previews.size === 0) return base;
    const seen = new Set(base.map((e) => e.path));
    const extra: DirEntry[] = [];
    for (const found of previews.values()) {
      for (const entry of found) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        extra.push(entry);
      }
    }
    return extra.length === 0 ? base : [...base, ...extra];
  }, [entries, anchor, previews]);
  /** The orientations the listing carried inline (§6.3), so neither wave asks.
   *  Off `thumbEntries` rather than `entries`, because that is the set the
   *  sweep draws — anchor and sheet cells included. */
  const carriedPoses = useMemo(() => {
    let found: Record<string, IndexPose | null> | null = null;
    for (const e of thumbEntries) {
      // Both settled states are filed, `null` included: only absence is left
      // for the wave below.
      if (e.pose === undefined) continue;
      found ??= {};
      found[e.path] = e.pose;
    }
    return found ?? NO_POSES;
  }, [thumbEntries]);
  /** Carried, previewed, then asked, an asked answer winning a shared path.
   *  With nothing carried and no preview poses this IS `listingPoses`, which is
   *  the identity the sweep re-runs on. */
  const poses = useMemo(
    () =>
      carriedPoses === NO_POSES && previewPoses === NO_POSES
        ? listingPoses
        : { ...carriedPoses, ...previewPoses, ...listingPoses },
    [listingPoses, previewPoses, carriedPoses],
  );
  // Off `view`, not the answer: with a stand-in listing on screen the answer is
  // about the folder, and this explains the question it is not about.
  const deferredSubject =
    state.phase !== "idle" ? state.view.subject : NO_SUBJECT;
  // Of the question the app stands behind, not the one it answered, so ONE
  // control serves a landed result and a deferral alike (D9).
  const dismissable = live.subject.kind !== "none";
  const error = state.failure?.message ?? null;
  /** `expandLibraryPath`'s first argument wherever a path leaves the app. Null
   *  also where the deployment withholds it (`hostDetails`, D11), which that
   *  function answers by handing the library path over unexpanded. */
  const libraryTop =
    libraryState?.state === "ready" ? (libraryState.top ?? null) : null;
  /** Non-null is also what "there is nothing to browse" means below: grid,
   *  skeleton and landing line are withheld and this stands alone (library R4).
   *  Not-asked-yet reads as unblocked, or every healthy start flashes empty. */
  const libraryMessage: string | null =
    libraryState === null || libraryState.state === "ready"
      ? null
      : libraryState.state === "unconfigured"
        ? // The state cell, not `readFeatures()`: a value read through the
          // getter would not re-render the header when the report resolves.
          libraryUnconfiguredText(features)
        : libraryState.state === "nested"
          ? libraryNestedText(libraryState.library)
          : libraryMissingText(libraryState.root);

  const showSkeleton = useDelayedFlag(busy(state), SKELETON_DELAY_MS);
  /** What the wait is for, said where the count will land: a user's request
   *  in flight, never a background revalidation. */
  const asked =
    state.inflight !== null && state.inflight.followUp !== true
      ? state.inflight.view
      : null;
  const waitLabel =
    asked === null
      ? ""
      : asked.subject.kind === "query"
        ? `Searching for “${asked.subject.text}”…`
        : asked.subject.kind === "similar"
          ? "Finding similar models…"
          : `Opening ${asked.path === "/" ? "the library" : baseName(asked.path)}…`;
  // `busy`, not `inflight !== null`: a follow-up keeps the answered grid up,
  // and the user's place in it is real.
  busyRef.current = busy(state) || showSkeleton;
  const {
    thumbs,
    setThumb,
    refetch,
    setPlaceholder,
    discardThumbFraming,
    applyLocalFramings,
    setBands,
    reportImageError,
  } = useThumbnails(
    thumbEntries,
    api,
    lru,
    queue,
    // The pill's state, not `aoToggle`'s store: this is what re-runs the sweep
    // over the grid on screen.
    ao,
    poses,
    // Not `thumbEntries`: a landed peek is not a new listing.
    entries,
    // The client's own getters, so local framing is one rule (D6).
    readFeatures,
    readLibraryId,
  );
  placeholderRef.current = setPlaceholder;

  /** The moment the sweep cannot cover: a report — or the library id — landing
   *  *after* a listing drew its tiles, which leaves a returning visitor's kept
   *  framings off the first grid. Not a re-run of the sweep: the pixels are the
   *  server's and nothing has questioned them. */
  useEffect(() => {
    if (features?.thumbWrites === false && libraryId !== null)
      applyLocalFramings();
  }, [features, libraryId, applyLocalFramings]);

  // After commit, not during render: a discarded render must not leave
  // `noteFramingChanged` reading state that never landed.
  useEffect(() => {
    thumbsRef.current = thumbs;
  }, [thumbs]);
  /** Built once, because this instance *is* the "one job at a time" rule (D2) —
   *  hence stable dependencies, and `ao` from the module rather than the state
   *  cell, which would rebuild the runner on every press of the pill. */
  const jobs = useMemo(
    () => new BulkJobs({ api, lru, queue, setThumb, refetch, ao: aoEnabled }),
    [api, lru, queue, setThumb, refetch],
  );
  const job = useBulkJobState(jobs);

  /**
   * The one URL writer (design R3), behind two conditions that are the fence.
   * An intent, because a wholesale write would `replaceState` over an entry the
   * user already Backed off — lightbox teardown is asynchronous, and the view
   * disagrees with what is mounted throughout (R7). And an advance, because
   * pushing an unadvanced view after a Back puts back the view they just left.
   * Only a `replace` is exempt from the second: the boot seed asserts nothing
   * and still has to land.
   */
  useEffect(() => {
    const intent = urlIntent.current;
    urlIntent.current = null;
    const url = serializeView(toUrlView(state.view));
    const advanced = url !== projectedRef.current;
    if (intent === null) {
      // An intentless pass may only *absorb* a view the address bar already
      // agrees with. Absorbing a `run: false` tuning record would make its real
      // commit read as unadvanced, and the typed bound never reach the URL.
      if (url === window.location.search) projectedRef.current = url;
      return;
    }
    projectedRef.current = url;
    if (!advanced && intent.replace !== true) return;
    // A declined write on a replace pass is the boot seed, where
    // `history.state` stays null and `historyIndex()` answers 0.
    // `trailReplace` keeps the row's placement when the listing is unchanged,
    // which a Back onto an already-rewound URL relies on.
    const key = listingKey(state.view);
    const { idx, wrote } = commitUrl(toUrlView(state.view), intent);
    if (wrote === "push") trailPush(idx, key);
    else if (wrote === "replace" || intent.replace === true)
      trailReplace(idx, key);
  }, [state]);

  /** Every response is tagged with the asking event, and the reducer decides
   *  whether it still belongs (R2). Listings are aborted too, not only meaning
   *  queries: a flat walk nobody waits for otherwise runs to completion on the
   *  server, and the abort is what silences a late answer. */
  const request = pendingRequest(state);
  const requestId = request?.id ?? null;
  const requestSource = state.inflight?.source ?? "user";
  useEffect(() => {
    if (request === null) return;
    const controller = new AbortController();
    const { id, forView } = request;
    const land = (landed: Landed): void => {
      if (controller.signal.aborted) return;
      pushRecent(request.path);
      // A restoration replaces, because back must not mint forward-erasing
      // entries (D1/D2). An in-app similarity landing marks the entry it pushes
      // (D9), so dismissing returns to the view it was raised from; the depth
      // is read here because here that entry is still current.
      urlIntent.current = {
        replace: requestSource === "restore",
        ...(request.kind === "similar" && requestSource === "user"
          ? { state: SIMILAR_ENTRY(similarDepth() + 1) }
          : {}),
      };
      dispatch({ type: "landing", id, forView, landed });
    };
    const fail = (err: unknown): void => {
      if (controller.signal.aborted) return;
      // A 503 naming a *library* state says the library is why this failed,
      // not the path (R4) — and `missing` can then name the root `HttpError`
      // drops. Matched against the set, because an index 503 uses that field.
      if (
        err instanceof HttpError &&
        err.state !== undefined &&
        LIBRARY_STATES.has(err.state)
      ) {
        probeLibrary();
      }
      dispatch({
        type: "failure",
        id,
        forView,
        message: err instanceof Error ? err.message : String(err),
      });
    };
    if (request.kind === "similar") {
      if (request.model.includes("!/")) {
        dispatch({ type: "failure", id, forView, message: OUTSIDE_CORPUS });
        return () => controller.abort();
      }
      // `undefined` is dropped from the body, so the index's default applies.
      void api
        .similar(request.model, request.k, request.pool, controller.signal)
        .then(
          // No scope, `weak` or `capped`: the index publishes none for
          // neighbours, and inventing them gives the label meaning-query
          // residue (4.7). The anchor rides beside the entries, never among.
          (res) =>
            land({
              entries: res.entries,
              poses: res.poses,
              scores: res.scores,
              anchor: res.anchor,
            }),
          (err: unknown) => {
            const notEmbedded = err instanceof HttpError && err.status === 404;
            // A 404 means the index *answered*, about this model rather than
            // itself: re-probing would flash "index is not there" across a
            // healthy one.
            if (!controller.signal.aborted && !notEmbedded) {
              void api.indexAvailability({ fresh: true }).then(
                (availability) => dispatch({ type: "index", availability }),
                () => {},
              );
            }
            // The status is the contract (`ApiClient.similar`), so the sentence
            // comes from it rather than from the index's own words, which name
            // a cache the user has never heard of.
            if (notEmbedded) {
              if (!controller.signal.aborted) {
                // Through the getter: these deps are `[requestId]` alone, and
                // a report landing must not re-ask the index.
                dispatch({
                  type: "failure",
                  id,
                  forView,
                  message: notEmbeddedMessage(readFeatures()),
                });
              }
              return;
            }
            fail(err);
          },
        );
      return () => controller.abort();
    }
    if (request.kind === "meaning") {
      void api
        .semanticSearch(
          request.text,
          request.path,
          request.tuning,
          controller.signal,
        )
        .then(
          (res) =>
            // Relevance order is the server's; the client sorts nothing (3.4).
            land({
              entries: res.entries,
              scope: res.scope,
              weak: res.weak,
              capped: res.capped,
              matched: res.matched,
              poses: res.poses,
              scores: res.scores,
            }),
          (err: unknown) => {
            if (!controller.signal.aborted) {
              void api.indexAvailability({ fresh: true }).then(
                (availability) => dispatch({ type: "index", availability }),
                () => {},
              );
            }
            fail(err);
          },
        );
    } else {
      void api
        // Sent only when off: absence is the default at every layer.
        .listDir(
          request.path,
          {
            flat: request.flat,
            q: request.q ?? undefined,
            folderMatching: request.folderMatching ? undefined : false,
          },
          controller.signal,
        )
        .then(
          // `stale` rides the landing, keying the affordance and the follow-up
          // to a listing rather than a moment.
          (res) =>
            land({
              entries: res.entries,
              truncated: res.truncated,
              stale: res.stale,
            }),
          fail,
        );
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  /**
   * The second wave (pose-for-every-model D3), its own request so the listing
   * stays index-independent. It asks about the models **on screen**, not a
   * directory's children, and off `result.entries` rather than `byKind`, which
   * the kinds filter moves with no landing behind it. Failure is silence, and
   * no abort: the reducer drops an answer the listing outran.
   */
  const wave = landedListing(state);
  const waveId = wave?.id ?? null;
  const waveEntries = wave?.entries ?? null;
  const wavePaths = useMemo(
    () =>
      waveEntries === null
        ? NO_PATHS
        : waveEntries
            // Only what the listing did not carry (§6.4). `=== undefined` and
            // not a truth test: `pose: null` is settled, and dropping it here
            // keeps a never-embedded folder from costing a wave per landing.
            .filter((e) => e.kind === "model" && e.pose === undefined)
            .map((e) => e.path),
    [waveEntries],
  );
  const libraryReady = libraryState?.state === "ready";
  useEffect(() => {
    if (waveId === null || wavePaths.length === 0 || !libraryReady) return;
    void api.semanticPosesFor(wavePaths).then(
      (res) => {
        // Filed whole, `null`s included (`pose-rerender` D5): a settled absence
        // is what makes a posed render stale, so an answer of only those is
        // still an answer.
        dispatch({ type: "listingPoses", id: waveId, poses: res.poses });
      },
      () => {},
    );
  }, [waveId, wavePaths, libraryReady, api, dispatch]);

  /** Exactly once per stale answer, keyed on the answering event's id, or a
   *  server that goes on answering marked is asked in a loop (§5.2). A failure
   *  raises no header error either: background housekeeping must not paint a
   *  banner over a good grid. */
  const staleId =
    state.result !== null &&
    state.result.stale &&
    state.result.followUp !== true
      ? state.result.id
      : null;
  useEffect(() => {
    if (staleId === null) return;
    dispatch({ type: "revalidate", id: staleId });
  }, [staleId, dispatch]);

  const navigate = useCallback(
    (path: string) => {
      // The filter and the mark are the caller's to clear, because the reducer
      // never reads either (D2/D3). A pending placement is not: reveal and ↑
      // raise theirs *after* this, for the arrival rather than the departure.
      setFindText("");
      setFindOpen(false);
      setMarked(null);
      arrivalFocusRef.current = {};
      // So a volume mounted later needs a navigation, not a reload (R4).
      const lib = libraryRef.current;
      if (lib !== null && lib.state !== "ready") probeLibrary();
      commit({ type: "navigate", path, prefs: ownPrefs() });
    },
    [commit, probeLibrary],
  );

  function toggleFlat(): void {
    // An ordinary request, so it supersedes a committed search. Targeted at
    // `dest`, so untoggling mid-navigation follows the user rather than
    // snapping back.
    commit({ type: "toggleFlat", prefs: ownPrefs() });
  }

  /**
   * **The** dismissal, whichever affordance asked for it (D9). The branch is
   * provenance: an in-app similarity view sits on an entry we marked, so back
   * restores the view it came from, while a cold link has nothing behind it and
   * clears to the listing. By the marker's depth, since every re-tune pushes
   * another marked entry.
   */
  const leaveSubject = useCallback(
    (otherwise: Action): void => {
      if (isSimilarEntry()) {
        // Filed while the index is still this entry's: `go` moves it
        // asynchronously, and `onPop` reads the entry it lands on.
        recordNow();
        window.history.go(-similarDepth());
        return;
      }
      // A query's dismissal is a push, not a pop, so it cannot read the entry it
      // lands on and retraces the way ↑ does (retrace-placement D3). `entry`,
      // not `up`: no folder was left, so there is no child to centre.
      const base = liveView(stateRef.current);
      // The view it lands on, options restored and all, is the one the trail
      // filed when the listing was left.
      const prefs =
        otherwise.type === "clearSubject" || otherwise.type === "queryText"
          ? otherwise.prefs
          : undefined;
      const key = listingKey({
        ...base,
        ...prefs,
        subject: { kind: "none" },
        model: null,
      });
      commit(otherwise);
      raisePlacement({
        kind: "entry",
        placement: trailWalkBack(historyIndex(), key)?.placement ?? null,
      });
    },
    [commit, recordNow, raisePlacement],
  );

  function handleQueryTextChange(value: string): void {
    // Emptying the input while a subject is committed is how it is left (D9),
    // and it goes through the one dismissal so erasing stale text under an
    // in-app similarity view returns where the ✕ returns. Ordinary typing
    // asserts nothing and owns no URL.
    if (value.trim() === "" && live.subject.kind !== "none") {
      leaveSubject({ type: "queryText", text: value, prefs: ownPrefs() });
      return;
    }
    dispatch({ type: "queryText", text: value });
  }

  /** Substituting the corpus is only honest when it was asked for. */
  function runDeferredByName(): void {
    if (state.phase === "idle") return;
    commit({ type: "deferredToName" });
  }

  /**
   * Where focus goes when a navigation lands, if the keyboard has lost it: the
   * pressed tile unmounts with its listing, which drops focus to `<body>` and
   * leaves the next Tab starting from the top of the page. Coming up, the
   * folder just left; otherwise the first tile.
   */
  const arrivalFocusRef = useRef<{ child?: string } | null>(null);
  useEffect(() => {
    const want = arrivalFocusRef.current;
    if (want === null || state.inflight !== null || state.result === null)
      return;
    arrivalFocusRef.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const main = mainRef.current;
    if (main === null) return;
    const el =
      (want.child !== undefined ? findTile(main, want.child) : null) ??
      tilesIn(main)[0];
    el?.focus({ preventScroll: true });
  }, [state.result, state.inflight]);

  function focusFirstTile(): void {
    const main = mainRef.current;
    if (main !== null) tilesIn(main)[0]?.focus();
  }

  /** The tile the keyboard was on when Narrow opened, to come back to. */
  const findFromRef = useRef<string | null>(null);
  function openFind(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.dataset.entryTile !== undefined)
      findFromRef.current = active.dataset.entryTile;
    setFindOpen(true);
    setFindFocus((n) => n + 1);
  }

  /** A closed control must never leave the grid silently narrowed. */
  function closeFind(): void {
    const fromBar = document.activeElement?.closest("[data-find-bar]") != null;
    const back = findFromRef.current;
    findFromRef.current = null;
    setFindOpen(false);
    setFindText("");
    // The bar's input is about to unmount under the keyboard: back to the
    // tile it was raised from, if it is still there.
    if (fromBar)
      requestAnimationFrame(() => {
        const main = mainRef.current;
        const tile =
          main !== null && back !== null ? findTile(main, back) : null;
        if (tile !== null) tile.focus();
        else focusFirstTile();
      });
  }

  /** Decides what the *server* returns, so a committed query is re-issued (D3).
   *  Operating a control is also the only thing that writes to storage — a
   *  restore or a link never does (D2). */
  function setFolderMatching(on: boolean): void {
    setFolderMatchingEnabled(on);
    commit({ type: "setFolderMatching", on });
  }

  /** Re-runs a committed query against the other corpus (D2), through the
   *  decision submit shares (R6), so the flip defers where a submit would. */
  function setMode(next: SearchMode): void {
    setSearchMode(next);
    commit({ type: "setMode", mode: next });
  }

  /** The results line's "the other corpus" links: this search, asked of the
   *  other corpus, and the profile's own choice left as it was — leaving the
   *  results puts it back (`clearSubject`'s `prefs`). */
  function switchModeOnce(next: SearchMode): void {
    commit({ type: "setMode", mode: next });
  }

  /** `setSearchMode` and not `applySessionSearchMode`, because clicking a chip
   *  *is* the visitor choosing meaning mode; `commit` and not `dispatch`, so
   *  Back from the results returns to the view it was clicked from (D4). */
  function runQuery(text: string): void {
    setSearchMode("meaning");
    commit({ type: "runQuery", text, mode: "meaning" });
  }

  /** Re-runs a committed meaning query, like the mode and folder matching: a
   *  setting that only applied to the *next* search makes trying it a
   *  two-step. */
  function setTuning(next: Tuning, opts: { defer?: boolean } = {}): void {
    setSearchTuning(next);
    clearTimeout(tuningTimerRef.current);
    tuningForRef.current = null;
    if (opts.defer !== true) {
      commit({ type: "setTuning", tuning: next, run: true });
      return;
    }
    // Recorded, not committed: every intermediate digit is a whole query, and
    // projecting one would mint a history entry per keystroke (R3's fence).
    dispatch({ type: "setTuning", tuning: next, run: false });
    tuningForRef.current = { ...liveView(state), tuning: next };
    tuningTimerRef.current = setTimeout(() => {
      tuningForRef.current = null;
      commit({ type: "setTuning", tuning: next, run: true });
    }, TUNING_DEBOUNCE_MS);
  }

  /** Fired against another view the re-run would be the newest request, and
   *  latest-wins would drag the user back to the view they just left.
   *  `sameListing` is the test: the whole question minus the model. */
  useEffect(() => {
    const scheduled = tuningForRef.current;
    if (scheduled === null || sameListing(liveView(state), scheduled)) return;
    tuningForRef.current = null;
    clearTimeout(tuningTimerRef.current);
  }, [state]);

  /** Both re-ask, as a committed query does, and no debounce: the panel holds
   *  the draft. Nothing is written to storage — these belong to the view they
   *  were set on, since a count right for one neighbourhood says nothing about
   *  another's. */
  const setSimilarTuning = useCallback(
    (k: number, pool?: Tuning["pool"]): void => {
      commit({ type: "similarTuning", k, pool });
    },
    [commit],
  );

  function setKinds(next: SearchKinds): void {
    setSearchKinds(next);
    commit({ type: "setKinds", kinds: next });
  }

  function submitSearch(): void {
    const text = state.drafts.queryText.trim();
    if (text === "") return;
    // Asked of the other corpus for this one search when the words plainly
    // belong to it, and said so over the results, with the way back one click
    // away.
    if (live.mode === "meaning" && looksLikeFileName(text)) {
      setAutoMode({ text, mode: "name" });
      commit({ type: "submit", mode: "name" });
      return;
    }
    if (
      live.mode === "name" &&
      looksLikeDescription(text) &&
      meaningRunnableAt(state.index, target)
    ) {
      setAutoMode({ text, mode: "meaning" });
      commit({ type: "submit", mode: "meaning" });
      return;
    }
    setAutoMode(null);
    commit({ type: "submit" });
  }

  // A restoration, so the view is seeded via replaceState and pushed entries
  // start with the first real navigation (D4). A meaning link fetches nothing
  // until the probe answers: the listing meanwhile would flatten the volume for
  // tiles the results are about to replace.
  useEffect(() => {
    dispatch({ type: "restore", view: state.view });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An orbit overlay belongs to a tile on screen: a new view takes the tile
  // away, and must take its overlay with it rather than leave it floating
  // over whatever arrived.
  useEffect(() => {
    setViewer((v) => (v !== null && v.mode === "orbit" ? null : v));
  }, [state.view.path, state.view.flat, state.view.subject]);

  // One renderer, one purpose at a time (D2/D3). Keyed off `viewer` — what is
  // mounted — never off `view.model`, which disagrees with it for the whole
  // teardown (R7).
  //
  // A search in flight holds the queue too: renders for the view being
  // replaced compete with the answer for the page, the GPU and the server.
  // It does not stop renders already started, so it narrows that contention
  // rather than removing it.
  const searchInFlight =
    state.inflight !== null &&
    state.inflight.followUp !== true &&
    state.inflight.view.subject.kind !== "none";
  useEffect(() => {
    if (viewer !== null || searchInFlight) queue.suspend();
    else queue.resume();
  }, [viewer, searchInFlight, queue]);

  // A separate service that may start after this app did, so it is re-read on
  // the interactions the app already makes rather than on a timer (3.8).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (): void => {
      void api.indexAvailability().then(
        (s) => {
          if (!alive) return;
          dispatch({ type: "index", availability: s });
          // The one state that must re-check unasked: nothing the user does
          // moves it along.
          if (s.state === "warming") timer = setTimeout(read, 2000);
        },
        () => {
          if (alive)
            dispatch({ type: "index", availability: { state: "absent" } });
        },
      );
    };
    read();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, dispatch, state.view.path]);

  /** Mount, then each navigation *until it resolves*, so a server that answers
   *  late becomes usable without a reload (feature-report D3). A failed read
   *  leaves `null`, which is not a re-render, so nothing retries. */
  useEffect(() => {
    if (features !== null) return;
    let alive = true;
    void api.features().then(
      (report) => {
        if (!alive) return;
        // The client and the sweep read through `readFeatures`, and must not
        // be rebuilt when this resolves (D6).
        featuresRef.current = report;
        setFeatures(report);
      },
      () => {
        // Deliberately nothing: withholding on a failed read is the point (D3).
      },
    );
    return () => {
      alive = false;
    };
  }, [api, features, state.view.path]);

  /**
   * The introduction's starting mode, once per page (`landing-page` D5). The
   * *live* path, because a deep link into an archive interior would otherwise
   * start in a mode the server answers 400; nothing committed, because
   * `'setMode'` re-asks a committed query; the URL read live, because the
   * clause is about one view. The store is left alone, so a browser that never
   * chose keeps following the deployment.
   */
  useEffect(() => {
    if (introModeApplied.current) return;
    if (features?.intro !== true) return;
    const live = liveView(state);
    if (!meaningRunnableAt(state.index, live.path)) return;
    if (hasStoredSearchMode() || parseUrl().mode !== undefined) return;
    if (live.subject.kind !== "none") return;
    introModeApplied.current = true;
    applySessionSearchMode("meaning");
    dispatch({ type: "setMode", mode: "meaning" });
  }, [dispatch, features, state]);

  /** A failed read is `null`, not a retained stale answer: offering a launch
   *  into an application the registry no longer reports is worse than offering
   *  none. */
  const refreshApps = useCallback((): void => {
    void api.apps().then(
      (report) => setApps(report),
      () => setApps(null),
    );
  }, [api]);

  // Once per session (L5): the registry's other moment of change is a chooser,
  // and *Open with…* asks for that re-read itself.
  useEffect(() => {
    refreshApps();
  }, [refreshApps]);

  // Taken from the browser deliberately: the app's own find matches the full
  // relative path a tile is only labeled by, and does not stop at the tiles the
  // browser has painted.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // From anywhere, but not while a viewer or a menu owns Escape (2.3).
      if (
        e.key === "Escape" &&
        findOpenRef.current &&
        viewerRef.current === null &&
        !menuOpenRef.current
      ) {
        closeFind();
        return;
      }
      // The event's own target, not `document.activeElement`: for a real
      // keydown they are the same element, and the target is the one the
      // keystroke belongs to.
      const el =
        e.target instanceof HTMLElement ? e.target : document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (
        e.key === "ArrowUp" &&
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        if (typing || viewerRef.current !== null || menuOpenRef.current) return;
        e.preventDefault();
        goUpRef.current();
        return;
      }
      // `/` jumps to the search box, as it does on most sites that have one.
      if (
        e.key === "/" &&
        !typing &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        viewerRef.current === null &&
        !menuOpenRef.current
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key !== "f" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      // An empty search box is not typing: it is where dismissing the
      // introduction leaves the keyboard, and Narrow is what Ctrl-F means
      // there. A half-written query keeps the browser's own find.
      const idleSearch =
        el instanceof HTMLInputElement &&
        el.hasAttribute("data-search-input") &&
        el.value === "";
      if (typing && el.closest("[data-find-bar]") === null && !idleSearch)
        return;
      if (viewerRef.current !== null) return;
      e.preventDefault();
      openFind();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hover = useMemo(
    () => createHoverWarmer((p, m) => lru.warm(p, m)),
    [lru],
  );

  viewerRef.current = viewer;

  const openRestoredLightbox = useCallback((entry: DirEntry) => {
    suppressViewerPushRef.current = true;
    const size = Math.min(window.innerWidth, window.innerHeight) / 4;
    setViewer({
      mode: "lightbox",
      entry,
      rect: {
        left: (window.innerWidth - size) / 2,
        top: (window.innerHeight - size) / 2,
        width: size,
        height: size,
      },
      originEl: null,
    });
  }, []);

  // One dispatch of the whole resolved view (D2), so this needs no mirror of
  // the state and subscribes once: the reducer compares, and an entry differing
  // only in which model is open patches.
  useEffect(() => {
    function onPop(): void {
      const v = parseUrl();
      setFindText("");
      setFindOpen(false);
      setMarked(null);
      // The browser has already moved, so a settle timer still pending belongs
      // to the entry just left and must not file under this one (D2/D4).
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = undefined;
      const view = resolveView(v);
      raisePlacement({
        kind: "entry",
        placement: trailPlacement(historyIndex(), listingKey(view)),
      });
      dispatch({ type: "restore", view });
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [dispatch, raisePlacement]);

  // A `model` the view names but nothing has mounted (url-navigation D3):
  // honored once its entry is in a landed listing, dropped silently after a
  // successful listing that lacks it.
  useEffect(() => {
    const model = state.view.model;
    if (model === null || viewer !== null) return;
    if (
      state.result === null ||
      state.inflight !== null ||
      state.failure !== null
    )
      return;
    const entry = state.result.entries.find(
      (e) => e.kind === "model" && e.path === model,
    );
    if (entry !== undefined) {
      openRestoredLightbox(entry);
      return;
    }
    // Bridge 4 (R7): the drop rewrites that one field of the live URL, because
    // the projection's fence keeps model transitions off the wholesale writer.
    const url = parseUrl();
    if (url.model !== undefined)
      commitUrl({ ...url, model: undefined }, { replace: true });
    dispatch({ type: "modelDrop" });
  }, [
    state.view.model,
    state.result,
    state.inflight,
    state.failure,
    viewer,
    openRestoredLightbox,
    dispatch,
  ]);

  /**
   * Place the grid on arrival, once per landing, by the answer's id (D5).
   * "Settled" includes the skeleton being down, since it clears in a passive
   * effect and on that commit there is no tile to place against. A request
   * rides one question, the first in flight after it was raised: another
   * supersedes it, a patch does not.
   */
  const appliedRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const result = state.result;
    if (
      pendingPlacement !== null &&
      state.inflight !== null &&
      state.inflight.followUp !== true
    ) {
      if (pendingQuestionRef.current === null)
        pendingQuestionRef.current = state.inflight.id;
      else if (pendingQuestionRef.current !== state.inflight.id) {
        setPendingPlacement(null);
        return;
      }
    }
    // `busy`, not `inflight !== null`: a stale answer's follow-up must not hold
    // the apply, or the place lands on the follow-up instead.
    if (result === null || busy(state) || showSkeleton) return;
    if (
      pendingPlacement !== null &&
      pendingPlacement.raisedWith?.id === result.id
    ) {
      setPendingPlacement(null);
      return;
    }
    if (appliedRef.current === result.id) return;
    appliedRef.current = result.id;
    if (result.followUp === true) {
      if (pendingPlacement !== null) setPendingPlacement(null);
      return;
    }
    const request = pendingPlacement?.request ?? TOP_REQUEST;
    const resolved = resolvePlacement(request, result.entries);
    const main = mainRef.current;
    if (main !== null) applyIn(main, resolved);
    if (pendingPlacement !== null) setPendingPlacement(null);
    if (request.kind !== "reveal" || resolved.kind !== "center") return;
    setMarked(request.path);
    clearTimeout(markTimerRef.current);
    markTimerRef.current = setTimeout(() => setMarked(null), MARK_MS);
  }, [
    pendingPlacement,
    state.result,
    state.inflight,
    state.failure,
    showSkeleton,
  ]);

  // Hooked to the transition INTO 'lightbox', not `openLightbox`, which is the
  // keyboard entrance only: the pointer route promotes the overlay in place.
  const prevModeRef = useRef<"orbit" | "lightbox" | null>(null);
  useEffect(() => {
    const mode = viewer?.mode ?? null;
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (mode !== "lightbox" || prev === "lightbox" || viewer === null) return;
    if (suppressViewerPushRef.current) {
      // Preserve the state this entry carries: a forward-restored lightbox
      // sits on the entry we pushed.
      suppressViewerPushRef.current = false;
      commit(
        { type: "modelOpen", path: viewer.entry.path },
        {
          replace: true,
          state: window.history.state,
        },
      );
    } else {
      commit(
        { type: "modelOpen", path: viewer.entry.path },
        { state: LIGHTBOX_ENTRY },
      );
    }
  }, [viewer, commit]);

  // Only once the view had named it: the overlay is promoted a transition
  // before that dispatch, and signalling in between would close the lightbox as
  // it opened (bridge 2).
  useEffect(() => {
    if (viewer?.mode !== "lightbox") {
      namedModelRef.current = null;
      return;
    }
    if (state.view.model === viewer.entry.path) {
      namedModelRef.current = viewer.entry.path;
      return;
    }
    if (namedModelRef.current !== viewer.entry.path) return;
    namedModelRef.current = null;
    setCloseSignal((n) => n + 1);
  }, [viewer, state.view.model]);

  // A lightbox whose entry we pushed closes through history, so ✕ and back are
  // one path; a deep-linked one has nothing behind it, so its param drops via
  // replaceState (D3).
  const onViewerCloseIntent = useCallback(() => {
    if (isLightboxEntry()) {
      window.history.back();
      return;
    }
    const v = parseUrl();
    if (v.model !== undefined)
      commitUrl({ ...v, model: undefined }, { replace: true });
    dispatch({ type: "modelClose" });
  }, [dispatch]);

  // Matches the full `name`, which in flat views is a relative path rather than
  // the tile's label. Trimmed, because a trailing space must not blank a grid
  // of names with spaces in them.
  const needle = findText.trim().toLowerCase();
  // Kind first, then the filter, so an empty grid can name what emptied it. The
  // dep is deliberately narrower than the selector's argument: a fresh array
  // per state change would re-render every tile for an availability tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kept = useMemo(() => {
    const k = byKind(state);
    const v = state.result?.forView;
    // A flat view or a name search is asked for to find models; the folders
    // they also list are a way onward, so they go after rather than burying
    // the first model. A meaning search keeps its ranking.
    if (v === undefined) return k;
    const meaning =
      state.result?.scope !== undefined && state.result.scope !== null;
    const flatPlain = v.flat && v.subject.kind === "none";
    const byName = v.subject.kind === "query" && !meaning;
    if (!flatPlain && !byName) return k;
    return [
      ...k.filter((e) => e.kind === "model"),
      ...k.filter((e) => e.kind !== "model"),
    ];
  }, [state.result]);
  /** The strongest z among the results. The index's own `weak` flag misses
   *  some phrases that match nothing, and a top this low reads as a guess
   *  whatever the flag says. */
  const topZ = useMemo(() => {
    let top = Number.NEGATIVE_INFINITY;
    if (label.meaning)
      for (const e of kept) {
        const z = scoreFor(e.path)?.z;
        if (z !== undefined && z > top) top = z;
      }
    return top;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, label.meaning, scoreFor]);
  const weakSet =
    labelQuery !== null &&
    label.meaning &&
    (label.weak || (Number.isFinite(topZ) && topZ < WEAK_TOP_Z));
  /** A set whose best is only middling: its words stop at "Fair", so a guess
   *  is never called a good match. */
  const modestSet =
    label.meaning && Number.isFinite(topZ) && topZ < STRONG_TOP_Z;
  /** How many entries a name search would find for the meaning query on
   *  screen, asked beside it. */
  const [nameHits, setNameHits] = useState<{
    key: string;
    count: number;
  } | null>(null);
  const hitsPath = state.result?.forView.path;
  /** The whole question — where, how names match, and what — so an answer is
   *  never shown for another folder or another option. */
  const hitsKey =
    labelQuery !== null && label.meaning && hitsPath !== undefined
      ? `${hitsPath}\u0000${live.folderMatching}\u0000${labelQuery}`
      : null;
  useEffect(() => {
    setNameHits(null);
    if (hitsKey === null || labelQuery === null || hitsPath === undefined)
      return;
    const ctrl = new AbortController();
    const key = hitsKey;
    api
      .nameMatchCount?.(hitsPath, labelQuery, live.folderMatching, ctrl.signal)
      .then(
        (count) => setNameHits({ key, count }),
        () => {},
      );
    return () => ctrl.abort();
    // `hitsKey` carries every input the question reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, hitsKey]);
  const nameMatches =
    nameHits !== null && nameHits.key === hitsKey ? nameHits.count : 0;
  /** The query whose weak guesses were all asked for, past the first row. */
  const [allGuessesFor, setAllGuessesFor] = useState<string | null>(null);
  const guessesCapped =
    weakSet && allGuessesFor !== labelQuery && kept.length > WEAK_SHOWN;

  const filteredListing = useMemo(() => {
    const narrowed =
      needle === ""
        ? kept
        : kept.filter((e) => e.name.toLowerCase().includes(needle));
    // A weak set is a row of guesses, not a page of them, until asked.
    return guessesCapped ? narrowed.slice(0, WEAK_SHOWN) : narrowed;
  }, [kept, needle, guessesCapped]);
  // Prepended here and nowhere earlier, so it is shown and never counted —
  // **exempt from the find filter** too, or the neighbours have nothing to say
  // what they are near.
  const shownEntries = useMemo(
    () =>
      anchor === undefined ? filteredListing : [anchor, ...filteredListing],
    [anchor, filteredListing],
  );
  /** Models on screen still waiting for a picture — said once in the results
   *  line, rather than only as a spinner per tile. */
  const pendingThumbs = useMemo(() => {
    const waiting = (path: string): boolean => {
      const t = thumbs.get(path);
      return t === undefined || (t.status === "loading" && t.url === undefined);
    };
    let n = 0;
    for (const e of shownEntries) {
      if (e.kind === "model") {
        if (waiting(e.path)) n++;
      } else {
        // A folder's sheet is rendered model by model too.
        for (const cell of previews.get(e.path) ?? [])
          if (waiting(cell.path)) n++;
      }
    }
    return n;
  }, [shownEntries, thumbs, previews]);

  /** Held a beat before it shows, so a set the caches answer at once never
   *  flashes a count. */
  const renderingShown = useDelayedFlag(pendingThumbs > 0, RENDERING_DELAY_MS);

  /** What a plain listing holds — the line a search spends on its label. */
  const listingSummary = useMemo(() => {
    const n = { folder: 0, archive: 0, model: 0 };
    for (const e of kept)
      n[
        e.kind === "model" ? "model" : e.kind === "zip" ? "archive" : "folder"
      ]++;
    return (Object.keys(n) as (keyof typeof n)[])
      .filter((k) => n[k] > 0)
      .map((k) => `${n[k]} ${k}${n[k] === 1 ? "" : "s"}`)
      .join(" · ");
  }, [kept]);
  /** Off `shownEntries`, so stepping honours a find filter and skips folders
   *  (lightbox-sibling-stepping D1). */
  const modelSiblings = useMemo(
    () => shownEntries.filter((e) => e.kind === "model"),
    [shownEntries],
  );
  // At `sibIdx === -1` — the open model is no longer shown, which a background
  // revalidation can do — BOTH are null: stepping goes inert rather than
  // teleporting to the list's first entry.
  const sibIdx =
    viewer !== null
      ? modelSiblings.findIndex((e) => e.path === viewer.entry.path)
      : -1;
  const prevEntry = sibIdx > 0 ? (modelSiblings[sibIdx - 1] ?? null) : null;
  const nextEntry =
    sibIdx >= 0 && sibIdx < modelSiblings.length - 1
      ? (modelSiblings[sibIdx + 1] ?? null)
      : null;
  /**
   * A hidden model has a slot but no tile, so no observer reports it and the
   * sweep goes on reading what the user filtered away (D3). The hidden set is
   * `entries` minus `filteredListing`, never `thumbEntries` minus
   * `shownEntries`, which holds every preview model by construction; and a
   * reported band is never overwritten, since a hidden tile can also be a
   * visible folder's preview cell.
   */
  const filteredRef = useRef(filteredListing);
  filteredRef.current = filteredListing;
  const reportBands = useCallback(
    (bands: ReadonlyMap<string, Band>) => {
      if (filteredRef.current === listingRef.current) {
        setBands(bands);
        return;
      }
      let merged: Map<string, Band> | null = null;
      const hide = (path: string): void => {
        if (bands.has(path)) return; // never overwrite a reported band
        merged ??= new Map(bands);
        if (!merged.has(path)) merged.set(path, "far");
      };
      const shown = new Set(filteredRef.current.map((e) => e.path));
      const previews = previewsRef.current;
      for (const e of listingRef.current) {
        if (shown.has(e.path)) continue;
        if (e.kind === "model") hide(e.path);
        else if (e.kind === "dir")
          for (const cell of previews.get(e.path) ?? []) hide(cell.path);
      }
      setBands(merged ?? bands);
    },
    [setBands],
  );
  const kindHidesAll = entries.length > 0 && kept.length === 0;
  const filterHidesAll =
    needle !== "" && kept.length > 0 && filteredListing.length === 0;
  // On the subject, not a phrase: an empty *similarity* result is an answer
  // that found nothing, and no query string says so (4.6b).
  const searchHasNoMatches =
    label.subject.kind !== "none" && entries.length === 0;

  /** The image's box, not the tile's: same pixels, same square aspect, which is
   *  what makes the handoff seamless. */
  const overlayRectFor = useCallback((el: HTMLElement): Box => {
    const img = el.querySelector("img");
    if (img !== null) {
      const r = img.getBoundingClientRect();
      // An `<img>` reporting no box has not been given one yet, and the
      // overlay must not open at 0×0.
      if (r.width > 0 && r.height > 0)
        return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    const content = el.querySelector("[data-tile-content]") ?? el;
    return fitSquareBox(content.getBoundingClientRect());
  }, []);

  // A memoized tile compares on these, so a fresh function per keystroke would
  // re-render the whole grid.
  const onModelPointerDown = useCallback(
    (e: React.PointerEvent, entry: DirEntry, el: HTMLElement): void => {
      if (e.button !== 0) return;
      trackerRef.current.start(e.clientX, e.clientY);
      setViewer({
        mode: "orbit",
        entry,
        rect: overlayRectFor(el),
        originEl: el,
      });
    },
    [overlayRectFor],
  );

  const openLightbox = useCallback((entry: DirEntry, el: HTMLElement): void => {
    trackerRef.current.start(0, 0);
    const r = el.getBoundingClientRect();
    setViewer({
      mode: "lightbox",
      entry,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      originEl: el,
    });
  }, []);

  const enterEntry = useCallback(
    (entry: DirEntry): void => {
      if (entry.kind === "dir" || entry.kind === "zip") navigate(entry.path);
    },
    [navigate],
  );

  const onModelHover = useCallback(
    (p: string | null, m?: number) =>
      p !== null ? hover.enter(p, m) : hover.leave(),
    [hover],
  );

  /**
   * What the shared commands act through: App supplies the app-shaped halves
   * and `entryActions` owns what each command does with them (R1).
   */
  const actionHost = useMemo<ActionHost>(
    () => ({
      navigate,
      // Not `commit`, so the leaving grid's place is filed here too (D2).
      dispatch: (action) => {
        recordNow();
        dispatch(
          action.type === "similar" ? { ...action, prefs: ownPrefs() } : action,
        );
      },
      markOnArrival: (path) => raisePlacement({ kind: "reveal", path }),
      open: (entry, el) => {
        if (entry.kind !== "model") {
          enterEntry(entry);
          return;
        }
        if (el !== null) openLightbox(entry, el);
      },
      // Both halves route alike: a confirmation owed briefly (R1) must not
      // land under the lightbox's scrim.
      confirm: () => sayWhereLooking("Path copied.", "ok"),
      report: (message) => sayWhereLooking(message, "error"),
      poses,
      // A string, not the client: no command asks `/api/library` (library R2).
      libraryTop,
      api,
      lru,
      queue,
      setThumb,
      discardThumbFraming,
      refreshApps,
      // The runner un-dismisses its chip on the way out, which is D2's
      // substantive answer to a second press.
      launchJob: (operation, scope) => {
        if (jobs.launch(operation, scope) === "busy") say(JOB_BUSY, "error");
      },
      framingChanged: noteFramingChanged,
    }),
    [
      noteFramingChanged,
      navigate,
      dispatch,
      recordNow,
      raisePlacement,
      enterEntry,
      openLightbox,
      sayWhereLooking,
      poses,
      libraryTop,
      api,
      lru,
      queue,
      setThumb,
      discardThumbFraming,
      refreshApps,
      jobs,
      say,
    ],
  );

  const onEntryMenu = useCallback(
    (
      entry: DirEntry,
      el: HTMLElement | null,
      at: { x: number; y: number },
    ): void => {
      setMenu({ entry, el, x: at.x, y: at.y });
    },
    [],
  );
  /** The orbit overlay swallows `contextmenu` for the tile it sits over. */
  const onViewerEntryMenu = useCallback(
    (entry: DirEntry, el: HTMLElement | null, at: { x: number; y: number }) =>
      setMenu({ entry, el, x: at.x, y: at.y }),
    [],
  );
  const closeMenu = useCallback((): void => {
    menuRef.current?.el?.focus();
    setMenu(null);
  }, []);
  const onChooseCommand = useCallback(
    (command: EntryCommand): void => {
      const raised = menuRef.current;
      closeMenu();
      if (raised === null) return;
      command.run?.(raised.entry, actionHost, raised.el);
    },
    [closeMenu, actionHost],
  );
  /** The spindle this model is stored about (6.7), or `null` where the group is
   *  not offered. From the thumbs map, which is what the tile drew; a model
   *  never given one is marked at the default it is framed about. */
  const menuAxis = useMemo<OrbitAxis | null>(() => {
    if (menu === null || !orbitAxisApplies(menu.entry)) return null;
    return (
      thumbs.get(menu.entry.path)?.axis ??
      defaultAxisFor(formatOfEntry(menu.entry))
    );
  }, [menu, thumbs]);
  /** The spindle in force rides along: re-choosing is a no-op, and that rule
   *  belongs to the command. */
  const onChooseAxis = useCallback(
    (axis: OrbitAxis): void => {
      const raised = menuRef.current;
      closeMenu();
      if (raised !== null && menuAxis !== null) {
        setOrbitAxis(raised.entry, actionHost, axis, menuAxis);
      }
    },
    [closeMenu, actionHost, menuAxis],
  );
  /** The applications for this model's type, default first (L3). `null` rather
   *  than `[]` for an empty answer: a caption with no pills under it is an
   *  affordance that does nothing. From `apps`, so raising fires no request. */
  const menuOpenIn = useMemo(() => {
    if (menu === null) return null;
    const list = openInApps(menu.entry, { index: state.index, apps, features });
    return list.length === 0 ? null : list;
  }, [menu, state.index, apps, features]);
  const onChooseApp = useCallback(
    (appId: string): void => {
      const raised = menuRef.current;
      closeMenu();
      if (raised !== null) openEntryIn(raised.entry, actionHost, appId);
    },
    [closeMenu, actionHost],
  );
  const menuCommands = useMemo(
    () =>
      menu === null
        ? []
        : commandsFor(menu.entry, { index: state.index, apps, features }),
    [menu, state.index, apps, features],
  );

  /** The same table under the panel's own exclusions (6.6): *reset framing* is
   *  withheld from the menu and offered here, because only the panel's press
   *  carries the live-session semantics that make it honest. */
  const panelCommands = useMemo(
    () =>
      viewer === null
        ? []
        : commandsFor(
            viewer.entry,
            { index: state.index, apps, features },
            LIGHTBOX_PANEL_EXCLUDES,
          ),
    [viewer, state.index, apps, features],
  );
  const panelOpenIn = useMemo(() => {
    if (viewer === null) return null;
    const list = openInApps(
      viewer.entry,
      { index: state.index, apps, features },
      LIGHTBOX_PANEL_EXCLUDES,
    );
    return list.length === 0 ? null : list;
  }, [viewer, state.index, apps, features]);
  const onPanelChooseApp = useCallback(
    (appId: string): void => {
      const entry = viewerRef.current?.entry;
      if (entry === undefined) return;
      openEntryIn(entry, actionHost, appId);
    },
    [actionHost],
  );
  /** *Reset framing* takes the live view with it, and that different body is
   *  the whole reason this surface may offer a command the menu withholds. */
  const onViewerCommand = useCallback(
    (id: CommandId, live: LiveFramingView | null): void => {
      const entry = viewerRef.current?.entry;
      if (entry === undefined) return;
      if (id === "resetFraming") {
        resetFramingLive(entry, actionHost, live);
        return;
      }
      runCommand(id, entry, actionHost);
    },
    [actionHost],
  );

  /** The app's **root**, which is what "the library" means on screen (D8).
   *  Memoized on the primitive: the library is re-probed, and a scope changing
   *  identity per probe would recount it each time. */
  const rootPath = libraryState?.state === "ready" ? libraryState.root : null;
  const rootScope = useMemo(
    () => (rootPath === null ? null : { path: rootPath, label: "the library" }),
    [rootPath],
  );
  /** The panel recounts whenever `count` changes identity, so both closures are
   *  keyed on as little as possible and `launch` reaches the host through a
   *  ref: `actionHost` is rebuilt on every pose landing, and a `launch` keyed on
   *  it would re-enumerate the library each time. */
  const actionHostRef = useRef(actionHost);
  actionHostRef.current = actionHost;
  const countLibrary = useCallback(
    () =>
      rootScope === null
        ? Promise.reject(new Error("no library"))
        : jobs.count(rootScope),
    [jobs, rootScope],
  );
  const launchLibrary = useCallback(
    (op: JobOperation) => {
      if (rootScope !== null) actionHostRef.current.launchJob(op, rootScope);
    },
    [rootScope],
  );
  // Keyed on the run, never the state object: every patch carries the same
  // `settled`/`wrote`, so identity would re-derive the library per press.
  const settledRunRef = useRef<number | null>(null);
  useEffect(() => {
    if (job === null || !job.settled || settledRunRef.current === job.runId)
      return;
    settledRunRef.current = job.runId;
    if (job.wrote > 0) setJobsEnded((n) => n + 1);
  }, [job]);
  /** `maintenance` is the field, because the tab's every occupant acts on the
   *  server's derived state for every viewer at once (`public-deployment` D4) —
   *  and it alone, since reset is maintenance whatever a deployment does with
   *  thumbnail writes. */
  const libraryJobs = useMemo(
    () =>
      features?.maintenance === true && rootScope !== null
        ? {
            count: countLibrary,
            launch: launchLibrary,
            recountKey: jobsEnded,
            resetAdjust: handDelta,
          }
        : null,
    [
      features?.maintenance,
      rootScope,
      countLibrary,
      launchLibrary,
      jobsEnded,
      handDelta,
    ],
  );

  goUpRef.current = goUp;

  function goUp(): void {
    // From `dest`, not the committed path (D3): ↑ twice during a slow listing
    // must reach the grandparent.
    const parent = containingFolder(target);
    if (parent === target) return;
    // Where the parent was when the user went *into* this folder, not its
    // latest visit on another branch (D3). The key names the flat state it will
    // land in, so a parent visited nested and left flat has no row. Raised
    // after `navigate`, in the same batch, so it rides the parent's question.
    const parentKey = listingKey({
      ...liveView(state),
      path: parent,
      subject: { kind: "none" },
      model: null,
    });
    navigate(parent);
    arrivalFocusRef.current = { child: target };
    raisePlacement({
      kind: "up",
      placement: trailWalkBack(historyIndex(), parentKey)?.placement ?? null,
      child: target,
    });
  }

  const persist = useCallback(
    async (session: ViewerSession) => {
      const entry = viewer?.entry;
      if (entry === undefined) return;
      try {
        // Captured before the await, all three: a toggle mid-snapshot would
        // file occluded pixels under the unoccluded slot with matching labels,
        // a wrong-recipe hit nothing invalidates (D4a). The `ao` store, not the
        // pill's state, which is this render's snapshot of it.
        const { state, axis } = session;
        const ao = aoEnabled();
        const png = await session.snapshot(ao);
        const url = URL.createObjectURL(png);
        // The orbit overlay holds its dismissal on this promise, and the
        // tile's <img> swap must not paint a half-decoded frame.
        const decode = createImageBitmap(png).then(
          (bitmap) => bitmap.close(),
          () => {
            const img = new Image();
            img.src = url;
            return img.decode().catch(() => {});
          },
        );
        const [, written] = await Promise.all([
          decode,
          api.putThumb({
            path: entry.path,
            mtime: entry.mtime,
            png,
            // Every caller is a decision of the user's, so camera and axis
            // ride with the pixels and no `posed` label does (D4).
            camera: state,
            axis,
            lighting: THUMB_LIGHTING,
            rig: RIG_VERSION,
            ao,
          }),
        ]);
        // Before the map is updated, because that is where the before-state is.
        noteFramingChanged(entry.path, { camera: state, axis });
        setThumb(entry.path, {
          status: "ready",
          url,
          camera: state,
          axis,
          gen: written.gen,
        });
      } catch {
        // persistence is best-effort; the orbit itself already happened
      }
    },
    [api, setThumb, viewer, noteFramingChanged],
  );

  function closeViewer(): void {
    const origin = viewer?.originEl;
    setViewer(null);
    const v = parseUrl();
    if (v.model !== undefined)
      commitUrl({ ...v, model: undefined }, { replace: true });
    dispatch({ type: "modelClose" });
    origin?.focus();
  }

  /**
   * Refuses unless a lightbox is still up: a step whose persist lost its race to
   * a close must write no `modelOpen`, or the re-open effect resurrects it over
   * the listing the user backed onto (D3). `setViewer` runs BEFORE `commit`, so
   * no split render can read the step as the model leaving the view.
   */
  const navigateSibling = useCallback(
    (entry: DirEntry): void => {
      if (viewerRef.current?.mode !== "lightbox") return;
      const main = mainRef.current;
      const tile = main !== null ? findTile(main, entry.path) : null;
      setViewer((v) =>
        v !== null ? { ...v, entry, originEl: tile ?? v.originEl } : v,
      );
      commit(
        { type: "modelOpen", path: entry.path },
        { replace: true, state: window.history.state },
      );
    },
    [commit],
  );

  /** The probe walks the same capped search the names would, so a count at
   *  the cap is a floor. */
  const nameCountText =
    nameMatches >= NAME_COUNT_CAP ? `${NAME_COUNT_CAP}+` : String(nameMatches);
  /** A weak set's ways out, in the order they are likeliest to help. Names
   *  are offered until the probe has said there are none. */
  const probeSaidNone =
    nameHits !== null && nameHits.key === hitsKey && nameHits.count === 0;
  const weakWaysOut: { label: string; run: () => void }[] = [
    ...(guessesCapped && labelQuery !== null
      ? [
          {
            label: `Show all ${label.shown}`,
            run: () => {
              setAllGuessesFor(labelQuery);
              // Onto the first guess that was held back.
              requestAnimationFrame(() => {
                const main = mainRef.current;
                if (main !== null) tilesIn(main)[WEAK_SHOWN]?.focus();
              });
            },
          },
        ]
      : []),
    ...(probeSaidNone
      ? []
      : [
          {
            label:
              nameMatches > 0
                ? `See the ${nameCountText} name ${nameMatches === 1 ? "match" : "matches"}`
                : "Search names instead",
            run: () => switchModeOnce("name"),
          },
        ]),
    ...(labelQuery !== null &&
    state.view.path !== "/" &&
    meaningRunnableAt(state.index, "/")
      ? [
          {
            label: "Search the whole library",
            run: () =>
              commit({ type: "runQuery", text: labelQuery, mode: "meaning" }),
          },
        ]
      : []),
  ];

  /**
   * The results line: the count first, so a narrow screen truncates the query
   * rather than the number, then the query as a chip, then whatever qualifies
   * the set. No `weak`/`capped` notes for neighbours: the index publishes
   * neither for them, and rendering them off `false` would report a
   * measurement that came out negative (4.7).
   */
  const resultsHead: {
    count: string;
    query: string;
    icon: IconName;
    notes: ReactNode[];
  } | null =
    labelQuery !== null
      ? {
          count: searchHasNoMatches
            ? "No matches"
            : weakSet
              ? "No strong matches"
              : label.meaning
                ? // A different act from the index's ceiling, in different
                  // words (D9). Gated on *both* bounds being in force: floorless,
                  // `matched` is everything scored, and countless the short set
                  // is the cap saying so twice.
                  label.capping &&
                  label.matched !== undefined &&
                  label.matched > label.shown
                  ? `Top ${label.shown} of ${label.matched} ${modestSet ? "fair " : ""}matches`
                  : modestSet
                    ? `${label.shown} fair ${label.shown === 1 ? "match" : "matches"}`
                    : `${label.shown} closest ${label.shown === 1 ? "match" : "matches"}`
                : `${kept.length} ${kept.length === 1 ? "result" : "results"}`,
          query: labelQuery,
          icon: label.meaning ? "sparkles" : "type",
          notes: searchHasNoMatches
            ? []
            : [
                weakSet && (
                  <>
                    Nothing stood out —{" "}
                    {guessesCapped ? "here are" : "these are"} the closest
                    guesses.{" "}
                    {weakWaysOut.map((way, i) => (
                      <Fragment key={way.label}>
                        {i > 0 && " · "}
                        <button
                          type="button"
                          onClick={way.run}
                          className={NOTE_ACTION_CLASS}
                        >
                          {way.label}
                        </button>
                      </Fragment>
                    ))}
                  </>
                ),
                // Asked beside every meaning search: a model's own name is
                // never lost among guesses.
                label.meaning && !weakSet && nameMatches > 0 && (
                  <>
                    {nameCountText}{" "}
                    {nameMatches === 1 ? "name matches" : "names match"} “
                    {labelQuery}” too.{" "}
                    <button
                      type="button"
                      onClick={() => switchModeOnce("name")}
                      className={NOTE_ACTION_CLASS}
                    >
                      Show them
                    </button>
                  </>
                ),
                // Not the ranking's horizon but the index's own ceiling (D2).
                label.capped &&
                  "The index returned fewer than asked for — its cap.",
                !label.meaning &&
                  autoMode?.mode === "name" &&
                  autoMode.text === labelQuery && (
                    <>
                      Searched file names — “{labelQuery}” looks like one.{" "}
                      <button
                        type="button"
                        onClick={() => switchModeOnce("meaning")}
                        className={NOTE_ACTION_CLASS}
                      >
                        Search by meaning instead
                      </button>
                    </>
                  ),
                label.meaning &&
                  autoMode?.mode === "meaning" &&
                  autoMode.text === labelQuery && (
                    <>
                      Searched by meaning — “{labelQuery}” reads like a
                      description.{" "}
                      <button
                        type="button"
                        onClick={() => switchModeOnce("name")}
                        className={NOTE_ACTION_CLASS}
                      >
                        Search names instead
                      </button>
                    </>
                  ),
              ].filter((n): n is Exclude<typeof n, false> => n !== false),
        }
      : labelModel !== null
        ? {
            count: searchHasNoMatches
              ? "Nothing similar"
              : `${label.shown} similar ${label.shown === 1 ? "model" : "models"}`,
            query: baseName(labelModel),
            icon: "box",
            notes: searchHasNoMatches ? [] : ["From across the collection."],
          }
        : null;

  /** Always present, so the grid starts at the same height in every state, the
   *  skeleton included. Opposite ends, so a long query cannot push the caveat
   *  off screen. */
  const noticeBar = (
    summary: string,
    caveat: string,
    stale = false,
    /** Off over the skeleton: the renders it would count, and the answer
     *  whose count and query it would head, belong to the view that left. */
    status = true,
  ) => {
    const head = status ? resultsHead : null;
    return (
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-3 pb-1 text-[13px]">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {head !== null ? (
            <>
              <p className="shrink-0 font-semibold text-ink">{head.count}</p>
              <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-surface py-1 pr-2.5 pl-2 text-xs text-ink-2 ring-1 ring-line">
                <Icon name={head.icon} className="size-3 text-ink-3" />
                <span className="min-w-[6ch] truncate">“{head.query}”</span>
              </span>
            </>
          ) : (
            summary !== "" && (
              <p className="min-w-0 truncate text-xs text-ink-3">{summary}</p>
            )
          )}
          {/* The ONLY way out of a committed view on screen (D9), and the same
            transition emptying the input delegates to. Rendered for a model as
            for a phrase — which is the whole reason a similarity view is
            leaveable at all, since there is no text to empty. */}
          {dismissable && (
            <button
              type="button"
              onClick={() => {
                // The button unmounts with the results it leaves.
                arrivalFocusRef.current = {};
                leaveSubject({ type: "clearSubject", prefs: ownPrefs() });
              }}
              // One sentence for both destinations: where it lands is the entry's
              // provenance, and reading `history.state` during a render would
              // read it one render stale.
              title="Leave these results"
              aria-label="Dismiss"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface hover:text-ink touch:size-11"
            >
              <Icon name="x" className="size-3.5" strokeWidth={2.25} />
            </button>
          )}
        </div>
        {/* One status at a time on the right: a refresh outranks the renders
          it will restart. The whole of §5.2's affordance — not a panel, an
          overlay or a spinner, but the same weight as the notes below. On a
          phone it takes its own line rather than crowd the count. */}
        {!status ? null : waitLabel !== "" ? (
          <p
            aria-live="polite"
            className="shrink-0 text-xs text-ink-3 max-sm:basis-full"
          >
            {waitLabel}
          </p>
        ) : stale ? (
          <p
            aria-live="polite"
            className="shrink-0 text-xs text-ink-3 max-sm:basis-full"
          >
            Refreshing…
          </p>
        ) : (
          renderingShown &&
          pendingThumbs > 0 && (
            <p className="flex shrink-0 items-center gap-2 text-xs text-ink-3 max-sm:basis-full">
              <span
                aria-hidden="true"
                className="size-3 animate-[spin_1s_linear_infinite] rounded-full border-[1.5px] border-white/10 border-t-white/50"
              />
              Rendering {pendingThumbs} thumbnail
              {pendingThumbs === 1 ? "" : "s"}…
            </p>
          )
        )}
        {/* What qualifies the set, on its own line under it. */}
        {(caveat !== "" || (head !== null && head.notes.length > 0)) && (
          <div className="flex basis-full flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            {caveat !== "" && <p className="text-warn">{caveat}</p>}
            {head?.notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Over `kept`: the kind option is part of the view's identity, the live
  // filter is not.
  const shownModels = kept.filter((e) => e.kind === "model").length;
  const shownFolders = kept.length - shownModels;
  // `byKind` leaves a plain listing alone, so the notice counts the same way
  // rather than describing a restriction the grid is not under.
  const counted = noticeKinds(state);
  const shownParts = [
    counted !== "folders" ? `${shownModels} models` : "",
    counted !== "models" && labelQuery !== null
      ? `${shownFolders} folders`
      : "",
  ].filter((part) => part !== "");
  const omittedNotice =
    truncated && !searchHasNoMatches && !kindHidesAll
      ? `Showing ${shownParts.join(" and ")}; some entries were omitted.`
      : "";
  // A value and not a ternary in the JSX, because this does not *replace* the
  // grid: a similarity anchor is still drawn above it.
  /** A listing that failed with nothing else to show in its place. */
  const failedPath =
    state.failure !== null &&
    state.failure.forView.subject.kind === "none" &&
    state.result === null
      ? state.failure.forView.path
      : null;
  const emptyNotice = searchHasNoMatches ? (
    labelModel !== null ? (
      <p className="mx-auto mt-20 max-w-md px-6 text-center text-sm leading-relaxed text-ink-2">
        Nothing in the collection is similar to "{baseName(labelModel)}" — the
        index holds no neighbours for it.
      </p>
    ) : // A truncated search never finished, so "no match" would be false: the
    // walk ran out before covering the tree (D5).
    truncated ? (
      <p className="mx-auto mt-20 max-w-md px-6 text-center text-sm leading-relaxed text-ink-2">
        Nothing matched "{labelQuery}" in the part of the tree the search could
        cover — it ran out of budget before finishing. Try searching from a
        deeper folder.
      </p>
    ) : scope !== null && scope.status === "unindexed" ? (
      // Three outcomes, and only "nothing indexed" is fixed by indexing (4.1).
      <p className="mx-auto mt-20 max-w-md px-6 text-center text-sm leading-relaxed text-ink-2">
        Nothing here has been indexed yet — meaning search covers{" "}
        {scope.covers.join(", ")} files outside archives.
      </p>
    ) : (
      <div className="mx-auto mt-20 flex max-w-md flex-col items-center gap-4 px-6 text-center">
        <Icon name="search" className="size-8 text-ink-3" strokeWidth={1.5} />
        <p className="text-sm leading-relaxed text-ink-2">
          Nothing matched “{labelQuery}”
          {state.view.path !== "/" && <> in {baseName(state.view.path)}</>}.
          {scope !== null &&
            scope.status === "partial" &&
            ` ${scope.indexed} of ${scope.scanned} models here are indexed.`}
        </p>
        {/* A search covers this folder and below, so the likeliest repair for
            "nothing" is the same query from the top. */}
        {labelQuery !== null &&
          state.view.path !== "/" &&
          (!label.meaning || meaningRunnableAt(state.index, "/")) && (
            <button
              type="button"
              onClick={() =>
                commit({
                  type: "runQuery",
                  text: labelQuery,
                  mode: label.meaning ? "meaning" : "name",
                })
              }
              className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-ink hover:bg-accent-hover touch:h-11"
            >
              <Icon name="search" className="size-3.5" strokeWidth={2.25} />
              Search the whole library
            </button>
          )}
        {/* The other corpus, for this one search: a phrase asked of the names
            or a name asked of meaning is the likeliest mismatch after scope. */}
        {labelQuery !== null &&
          (label.meaning ||
            meaningRunnableAt(state.index, state.view.path)) && (
            <button
              type="button"
              onClick={() => switchModeOnce(label.meaning ? "name" : "meaning")}
              className="flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] text-ink-2 ring-1 ring-line-strong hover:bg-surface hover:text-ink touch:h-11"
            >
              <Icon
                name={label.meaning ? "type" : "sparkles"}
                className="size-3.5"
              />
              {label.meaning
                ? "Search names instead"
                : "Search by meaning instead"}
            </button>
          )}
      </div>
    )
  ) : failedPath !== null ? (
    // A listing that could not be had: where it was asked for, and the
    // nearest place that can be — not "nothing here", which is a claim
    // about a folder that may not exist.
    <div className="mx-auto mt-20 flex max-w-md flex-col items-center gap-4 px-6 text-center">
      <Icon name="warning" className="size-8 text-ink-3" strokeWidth={1.5} />
      <p className="text-sm leading-relaxed text-ink-2">
        Couldn't open “
        {failedPath === "/" ? "the library" : baseName(failedPath)}”.
      </p>
      {/* The top, not the parent: a mistyped path's parent is as likely
          not to exist. */}
      {failedPath !== "/" && (
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] text-ink-2 ring-1 ring-line-strong hover:bg-surface hover:text-ink touch:h-11"
        >
          <Icon name="home" className="size-3.5" />
          Go to the library
        </button>
      )}
    </div>
  ) : kindHidesAll ? (
    <p className="mx-auto mt-20 max-w-md px-6 text-center text-sm leading-relaxed text-ink-2">
      {counted === "folders"
        ? "No folders matched — the results are models only."
        : "No models matched — the results are folders only."}
    </p>
  ) : filterHidesAll ? (
    <p className="mx-auto mt-20 max-w-md px-6 text-center text-sm leading-relaxed text-ink-2">
      The filter is hiding everything below.
    </p>
  ) : null;

  /** A command's line outranks the view's failure while it is up, in either
   *  tone: a copy that succeeds owes a *brief* confirmation (entry-actions R1),
   *  which an error-first rule would swallow for as long as a failure stood. */
  const headerMessage: { text: string; tone: "ok" | "error" } | null =
    actionText ??
    // Above the view's own failure, because it explains it: every path route
    // 503s while the library is unmounted, and the route's sentence describes
    // the symptom where this one names the cause (library R4).
    (libraryMessage !== null
      ? { text: libraryMessage, tone: "error" }
      : error !== null
        ? { text: error, tone: "error" }
        : null);

  /** Any search option off its default — name or meaning — marked on the
   *  button that opens them. */
  const optionsChanged =
    optionsOffDefault(live.folderMatching, live.kinds, live.tuning) ||
    (live.subject.kind === "similar" && live.subject.pool !== undefined);

  /** Meaning is offered where it can run, and shown wherever it is in force:
   *  a link can put the app in meaning mode on a machine with no index, and a
   *  mode you cannot see or leave is a trap. */
  const showMode =
    meaningRunnableAt(state.index, target) || live.mode === "meaning";
  /** Says what a search will match and where it starts, since it covers
   *  this folder and below. */
  const meaningInForce = showMode && live.mode === "meaning";
  const searchPlaceholder =
    target === "/"
      ? meaningInForce
        ? "Describe what you are looking for…"
        : "Search file and folder names…"
      : meaningInForce
        ? `Describe a model in ${baseName(target)}…`
        : `Search names in ${baseName(target)}…`;

  /** `=== true` and nothing looser: unknown, failed and off all withhold, as
   *  every gated offer is withheld (`landing-page` D3). */
  const introOffered = features?.intro === true;
  /** The top and not the current path, because that is where an
   *  introduction-supplied phrase is committed. */
  const introSearchable = meaningRunnableAt(state.index, "/");
  /** The *committed* view, not the live one: a banner that vanished the instant
   *  a chip was clicked, before its results arrived, would be a flicker. */
  const atTop =
    state.view.path === "/" &&
    state.view.subject.kind === "none" &&
    !state.view.flat;
  const bannerDrawn = introOffered && !introDismissed && atTop;
  /** For a visitor the banner no longer reaches (D6), and withheld wherever the
   *  example as typed would fail to find what it names. */
  const placeholderExample = useCyclingPlaceholder(
    EXAMPLE_QUERIES,
    introOffered &&
      !bannerDrawn &&
      state.view.mode === "meaning" &&
      meaningRunnableAt(state.index, state.view.path) &&
      state.drafts.queryText === "",
  );

  /** Focus moves *before* React commits the removal — updates in an event
   *  handler are flushed after it returns — so nothing is focused inside the
   *  disappearing banner by the time it goes and dropped to `<body>`. */
  function dismissIntro(): void {
    introDismissedStore.write(true);
    setIntroDismissed(true);
    searchInputRef.current?.focus();
  }

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      {/* A block around the row, so the transient line can grow the header
          without pushing the controls out of line with the path input.
          `z-chrome` is for the suggestion list, which hangs over a grid whose
          score badges outrank its own `z-20`. */}
      <header className="relative z-chrome border-b border-line bg-canvas">
        {/* Global row: where you are in the app, and what you can ask of the
            whole library. */}
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            title="Library top"
            aria-label="Model Browser — library top"
            className="flex shrink-0 items-center gap-2 rounded-md py-1 pr-1.5 pl-1 text-ink hover:bg-surface touch:min-w-11 touch:py-2"
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-ink">
              <Icon name="box" className="size-4" strokeWidth={2} />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight md:inline">
              Model Browser
            </span>
          </button>
          <div
            role="search"
            className="mx-auto flex h-10 min-w-0 max-w-2xl flex-1 items-center rounded-lg border border-line bg-surface pr-1 transition-colors touch:h-12 focus-within:border-accent/60 focus-within:bg-raised"
          >
            <Icon
              name={live.mode === "meaning" && showMode ? "sparkles" : "search"}
              className="ml-3 hidden size-4 text-ink-3 sm:block"
            />
            <input
              ref={searchInputRef}
              type="search"
              enterKeyHint="search"
              value={state.drafts.queryText}
              onChange={(e) => handleQueryTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSearch();
                // Down from the box is down into the results.
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  focusFirstTile();
                }
              }}
              placeholder={
                placeholderExample !== null
                  ? `Try “${placeholderExample}”`
                  : searchPlaceholder
              }
              // Never the placeholder: the accessible name must not change under
              // a screen reader while the visible hint cycles (D6). It follows
              // the mode, which only the user changes.
              aria-label={
                meaningInForce
                  ? "Search by meaning"
                  : "Search file and folder names"
              }
              data-search-input
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {showMode && (
              <div
                role="group"
                aria-label="Search by"
                className="mr-1 flex shrink-0 rounded-md bg-sunken p-0.5 text-xs"
              >
                {(["name", "meaning"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={live.mode === m}
                    onClick={() => setMode(m)}
                    title={
                      m === "name"
                        ? "Match file and folder names"
                        : "Match what the models look like"
                    }
                    aria-label={m === "name" ? "Name" : "Meaning"}
                    className={
                      live.mode === m
                        ? "flex h-7 items-center gap-1 rounded bg-raised px-2 font-medium capitalize text-ink shadow-sm ring-1 ring-line-strong touch:h-10 touch:min-w-11 touch:px-3"
                        : "flex h-7 items-center gap-1 rounded px-2 capitalize text-ink-3 hover:text-ink-2 touch:h-10 touch:min-w-11 touch:px-3"
                    }
                  >
                    <Icon
                      name={m === "name" ? "type" : "sparkles"}
                      className="size-3.5 sm:hidden"
                    />
                    <span className="hidden sm:inline">{m}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={submitSearch}
              disabled={state.drafts.queryText.trim() === ""}
              title={
                meaningInForce
                  ? "Search this folder and everything below it by what the models look like"
                  : "Search this folder and everything below it by name — files and folders"
              }
              aria-label="Search"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-white/5 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent touch:size-11"
            >
              <Icon name="arrowLeft" className="size-4 rotate-180" />
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {introOffered && introSearchable && (
              <button
                type="button"
                onClick={() => runQuery(pickExample(EXAMPLE_QUERIES))}
                title="Run an example search"
                aria-label="Surprise me"
                className="hidden h-9 items-center gap-2 rounded-md px-2.5 text-sm text-ink-2 hover:bg-surface hover:text-ink sm:flex"
              >
                <Icon name="dice" />
                <span className="hidden lg:inline">Surprise me</span>
              </button>
            )}
            {/* What the banner offered, after it is gone: the header never
                scrolls (`landing-page` D3). */}
            {introOffered && (
              <a
                href={ABOUT_URL}
                aria-label="About"
                className="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-ink-2 hover:bg-surface hover:text-ink touch:h-11 touch:min-w-11"
              >
                <Icon name="info" />
                <span className="hidden lg:inline">About</span>
              </a>
            )}
          </div>
        </div>
        {/* Local row: this folder, and how to look at it. */}
        <div className="flex h-11 items-center gap-1 border-t border-line px-2 sm:px-3">
          <button
            type="button"
            onClick={goUp}
            disabled={target === "/"}
            aria-label="Parent directory"
            title="Up a folder (Alt+↑)"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent touch:size-11"
          >
            <Icon name="cornerUp" />
          </button>
          <PathBar path={target} api={api} onNavigate={navigate} />
          <div className="flex shrink-0 items-center gap-1 pl-1">
            <button
              type="button"
              onClick={findOpen ? closeFind : openFind}
              aria-pressed={findOpen}
              data-narrow-toggle
              title="Narrow these by name (Ctrl-F)"
              className={
                findOpen
                  ? "flex h-8 items-center gap-1.5 rounded-md touch:h-11 touch:min-w-11 touch:rounded-[10px] touch:border-y-4 touch:border-transparent touch:bg-clip-padding touch:justify-center bg-surface px-2.5 text-[13px] text-ink"
                  : "flex h-8 items-center gap-1.5 rounded-md touch:h-11 touch:min-w-11 touch:rounded-[10px] touch:border-y-4 touch:border-transparent touch:bg-clip-padding touch:justify-center px-2.5 text-[13px] text-ink-2 hover:bg-surface hover:text-ink"
              }
            >
              <Icon name="filter" className="size-3.5" />
              <span className="hidden sm:inline">Narrow</span>
            </button>
            <button
              type="button"
              onClick={toggleFlat}
              aria-pressed={live.flat}
              data-flat-toggle
              title="Show every model under this folder in one grid"
              className={
                live.flat
                  ? "flex h-8 items-center gap-1.5 rounded-md touch:h-11 touch:min-w-11 touch:rounded-[10px] touch:border-y-4 touch:border-transparent touch:bg-clip-padding touch:justify-center bg-accent-soft px-2.5 text-[13px] font-medium text-accent"
                  : "flex h-8 items-center gap-1.5 rounded-md touch:h-11 touch:min-w-11 touch:rounded-[10px] touch:border-y-4 touch:border-transparent touch:bg-clip-padding touch:justify-center px-2.5 text-[13px] text-ink-2 hover:bg-surface hover:text-ink"
              }
            >
              <Icon name="layers" className="size-3.5" />
              <span className="hidden sm:inline">Flat</span>
            </button>
            <span
              aria-hidden="true"
              className="mx-1 hidden h-5 w-px bg-line sm:block"
            />
            <div
              role="group"
              aria-label="Tile size"
              className="hidden items-center rounded-md p-0.5 sm:flex"
            >
              {TILE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  data-tile-size={size}
                  aria-label={`${TILE_SIZE_NAME[size]} tiles`}
                  title={`${TILE_SIZE_NAME[size]} tiles`}
                  onClick={() => {
                    setTileSize(size);
                    tileSizeStore.write(size);
                  }}
                  className={
                    tileSize === size
                      ? "flex size-8 items-center justify-center rounded-md bg-surface text-ink"
                      : "flex size-8 items-center justify-center rounded-md text-ink-3 hover:text-ink-2"
                  }
                >
                  <Icon
                    name="grid"
                    className={
                      size === "s"
                        ? "size-2.5"
                        : size === "m"
                          ? "size-3.5"
                          : "size-4.5"
                    }
                    strokeWidth={size === "s" ? 2.5 : 1.75}
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-pressed={ao}
              title="Ambient occlusion: soft shading in creases. Turn it off if turning a model feels slow."
              onClick={() => {
                setAoEnabled(!ao);
                setAoState(!ao);
              }}
              // On a phone the toolbar's room goes to the path; the switch
              // lives in Options there.
              className="hidden h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-surface hover:text-ink touch:h-11 touch:min-w-11 sm:flex"
            >
              <span className="hidden md:inline">Occlusion</span>
              <span className="md:hidden">AO</span>
              <span
                aria-hidden="true"
                className={
                  ao
                    ? "flex h-4 w-7 items-center justify-end rounded-full bg-accent p-0.5"
                    : "flex h-4 w-7 items-center justify-start rounded-full bg-white/15 p-0.5"
                }
              >
                <span
                  className={
                    ao
                      ? "size-3 rounded-full bg-accent-ink"
                      : "size-3 rounded-full bg-ink-2"
                  }
                />
              </span>
            </button>
            {/* The panel's own dot, carried out to where it is opened from:
                it answers "why are my results strange?" while closed (D5). */}
            <button
              ref={panelToggleRef}
              type="button"
              data-panel-toggle
              aria-expanded={panelOpen}
              aria-label="Options"
              title="Search options and library tools"
              onClick={() => {
                setPanelOpen(!panelOpen);
                collapseStore.write(panelOpen);
              }}
              className={
                panelOpen
                  ? "relative flex h-8 items-center gap-1.5 rounded-md touch:h-11 touch:min-w-11 touch:rounded-[10px] touch:border-y-4 touch:border-transparent touch:bg-clip-padding touch:justify-center bg-surface px-2.5 text-[13px] text-ink"
                  : "relative flex h-8 items-center gap-1.5 rounded-md touch:h-11 touch:min-w-11 touch:rounded-[10px] touch:border-y-4 touch:border-transparent touch:bg-clip-padding touch:justify-center px-2.5 text-[13px] text-ink-2 hover:bg-surface hover:text-ink"
              }
            >
              <Icon name="sliders" className="size-3.5" />
              <span className="hidden lg:inline">Options</span>
              {optionsChanged && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-accent"
                />
              )}
            </button>
          </div>
        </div>
        {headerMessage !== null && (
          <p
            role={headerMessage.tone === "error" ? "alert" : "status"}
            data-header-message={headerMessage.tone}
            // A failure stands in the flow until it is dealt with; a brief
            // confirmation floats over the grid instead of shifting it.
            className={
              headerMessage.tone === "error"
                ? "border-t border-line bg-danger/10 px-4 py-1.5 text-xs text-danger"
                : "pointer-events-none absolute top-full left-1/2 mt-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-raised px-3.5 py-1.5 text-xs whitespace-nowrap text-ink shadow-xl shadow-black/50"
            }
          >
            {headerMessage.text}
          </p>
        )}
      </header>
      {/* **Outside** `<main>` (D3), so the strip spans the side panel, does not
          scroll with the grid, and leaves the grid's height the same whether
          the listing is in flight or rendered. */}
      {bannerDrawn && (
        <IntroBanner
          queries={EXAMPLE_QUERIES}
          meaningRunnable={introSearchable}
          onRun={runQuery}
          onDismiss={dismissIntro}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {/* Without the stable gutter, a listing that fits and one that does not
            differ by the scrollbar's width — enough to change the auto-fill
            column count and resize every tile. */}
        <main
          ref={mainRef}
          className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
          aria-busy={(libraryMessage === null && showSkeleton) || undefined}
        >
          {/* Nothing at all while the library is not there (R4): not a
              skeleton, which promises a listing that is not coming, nor an
              "empty folder", which is a claim nobody could check. */}
          {libraryMessage !== null ? null : showSkeleton ? (
            // Unmounting the grid is what makes the old tiles unclickable. The
            // notice line is rendered empty rather than omitted, so these tiles
            // sit where the real ones will.
            <>
              {findOpen && (
                <FindBar
                  value={findText}
                  count={null}
                  focusSignal={findFocus}
                  onChange={setFindText}
                  onClose={closeFind}
                  onDown={focusFirstTile}
                />
              )}
              {noticeBar(waitLabel, "", false, false)}
              <SkeletonGrid size={tileSize} />
            </>
          ) : (
            <>
              {findOpen && (
                <FindBar
                  value={findText}
                  count={filteredListing.length}
                  focusSignal={findFocus}
                  onChange={setFindText}
                  onClose={closeFind}
                  onDown={focusFirstTile}
                />
              )}
              {deferredSubject.kind !== "none" && (
                <p className="mx-4 mt-3 rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-xs text-warn">
                  {deferredSubject.kind === "query" ? (
                    <>
                      This view is a meaning search for &ldquo;
                      {deferredSubject.text}&rdquo;
                    </>
                  ) : (
                    <>
                      This view is the models similar to &ldquo;
                      {baseName(deferredSubject.model)}&rdquo;
                    </>
                  )}
                  , and the index is{" "}
                  {state.index?.state === "warming"
                    ? "still starting up"
                    : "not answering"}
                  . Showing this folder meanwhile —{" "}
                  {/* Only warming is polled, so promising that an absent index
                      will be noticed on return is a promise nothing keeps. */}
                  {state.index?.state === "warming"
                    ? "it runs as soon as the index answers."
                    : "it runs if the index comes back, and searching again will look for it."}{" "}
                  {/* Only for a phrase: substituting the name corpus needs
                      something to type at it, and a model is not text (4.6a). */}
                  {deferredSubject.kind === "query" && (
                    <button
                      type="button"
                      onClick={() => runDeferredByName()}
                      className="font-medium underline underline-offset-2 hover:text-ink"
                    >
                      Search names instead
                    </button>
                  )}
                </p>
              )}
              {noticeBar(listingSummary, omittedNotice, refreshing)}
              {/* An anchor is something to show, so it stays above its own
                  "nothing similar". */}
              {emptyNotice === null || anchor !== undefined ? (
                // Dimmed while the view it will be replaced by is on its way,
                // so a press on the old answer does not read as the new one.
                <div
                  className={
                    waitLabel !== ""
                      ? "opacity-50 transition-opacity duration-150"
                      : "transition-opacity duration-150"
                  }
                >
                  <Grid
                    entries={shownEntries}
                    thumbs={thumbs}
                    onEnter={enterEntry}
                    onModelPointerDown={onModelPointerDown}
                    onModelOpen={openLightbox}
                    onModelHover={onModelHover}
                    onEntryMenu={onEntryMenu}
                    onImageError={reportImageError}
                    markedPath={marked}
                    anchorPath={anchor?.path}
                    scoreFor={scoreFor}
                    scoreScale={scoreScale}
                    previews={previews}
                    onPeek={requestPeek}
                    onBands={reportBands}
                    scrollRoot={mainRef}
                    size={tileSize}
                    showScores={showScores}
                    modestSet={modestSet}
                  />
                </div>
              ) : null}
              {emptyNotice}
            </>
          )}
        </main>
        {/* Whole, not as booleans derived here: the panel gates two things on
            two fields, and two props would put the unknown-is-null rule in two
            places (`public-deployment` D7/D9). */}
        <SidePanel
          query={liveQuery}
          similar={liveSimilar}
          library={libraryJobs}
          onSimilarTuning={setSimilarTuning}
          ao={ao}
          onAo={(on) => {
            setAoEnabled(on);
            setAoState(on);
          }}
          showScores={showScores}
          onShowScores={(on) => {
            setShowScores(on);
            showScoresStore.write(on);
          }}
          open={panelOpen}
          onClose={() => {
            setPanelOpen(false);
            collapseStore.write(true);
            panelToggleRef.current?.focus();
          }}
          path={target}
          folderMatching={live.folderMatching}
          kinds={live.kinds}
          mode={live.mode}
          tuning={live.tuning}
          onTuning={setTuning}
          index={state.index ?? { state: "absent" }}
          scope={scope}
          features={features}
          onFolderMatching={setFolderMatching}
          onKinds={setKinds}
        />
      </div>
      {glLost && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-menu flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-danger/40 bg-raised px-4 py-2.5 text-[13px] text-ink shadow-2xl shadow-black/60"
        >
          <Icon name="warning" className="size-4 text-danger" />
          <span>
            Graphics stopped — the GPU dropped this page's drawing context.
            Models and thumbnails won't draw until it is back.
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-hover touch:py-3"
          >
            Reload
          </button>
        </div>
      )}
      {/* Outside the body row, so it outlives every listing navigated through
          (D2). `dismissed` hides it without cancelling anything. */}
      {job !== null && !job.dismissed && (
        <JobChip
          state={job}
          onConfirm={() => jobs.confirm()}
          onCancel={() => jobs.cancel()}
          onDismiss={() => jobs.dismiss()}
          viewOpen={viewer !== null}
        />
      )}
      {/* Which items an entry offers, and which a surface declines, both live
          in `entryActions`, never here (D6). */}
      {menu !== null && menuCommands.length > 0 && (
        <EntryMenu
          x={menu.x}
          y={menu.y}
          commands={menuCommands}
          axis={
            menuAxis === null
              ? null
              : { current: menuAxis, onChoose: onChooseAxis }
          }
          openIn={
            menuOpenIn === null
              ? null
              : { apps: menuOpenIn, onChoose: onChooseApp }
          }
          onChoose={onChooseCommand}
          onClose={closeMenu}
        />
      )}
      {viewer !== null && (
        <ViewerLayer
          viewer={viewer}
          actionNote={viewerNote}
          camera={thumbs.get(viewer.entry.path)?.camera}
          axis={thumbs.get(viewer.entry.path)?.axis}
          pose={poses[viewer.entry.path]}
          // Through `scoreFor`, so the panel reports what the tile did (D7).
          score={scoreFor(viewer.entry.path)}
          scoreScale={scoreScale}
          showScores={showScores}
          modestSet={modestSet}
          ao={ao}
          api={api}
          lru={lru}
          tracker={trackerRef.current}
          onPromote={() =>
            setViewer((v) => (v !== null ? { ...v, mode: "lightbox" } : v))
          }
          closeSignal={closeSignal}
          onCloseIntent={onViewerCloseIntent}
          onDismiss={closeViewer}
          onPersist={persist}
          onLoadError={() =>
            // Non-revoking, like the hook's own catches: a failed load
            // produced no replacement, so the tile keeps the thumbnail it was
            // showing.
            setThumb(viewer.entry.path, {
              status: "error",
              url: thumbs.get(viewer.entry.path)?.url,
            })
          }
          onEntryMenu={onViewerEntryMenu}
          onNavigate={navigateSibling}
          prevEntry={prevEntry}
          nextEntry={nextEntry}
          menuOpen={menuOpenRef}
          panelCommands={panelCommands}
          libraryTop={libraryTop}
          openIn={
            panelOpenIn === null
              ? null
              : { apps: panelOpenIn, onChoose: onPanelChooseApp }
          }
          onCommand={onViewerCommand}
        />
      )}
    </div>
  );
}
