import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type * as THREE from 'three'
import type {
  AppsReport,
  DirEntry,
  IndexPose,
  IndexScore,
  LibraryState,
  OrbitAxis,
} from '../../shared/types'
import { HttpApiClient, HttpError } from './api/client'
import EntryMenu from './components/EntryMenu'
import FindBar from './components/FindBar'
import Grid from './components/Grid'
import SidePanel from './components/SidePanel'
import PathBar from './components/PathBar'
import { SKELETON_DELAY_MS, useDelayedFlag } from './hooks/useDelayedFlag'
import { useThumbnails } from './hooks/useThumbnails'
import {
  commandsFor,
  DEFAULT_ORBIT_AXIS,
  LIGHTBOX_MENU_EXCLUDES,
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
  type MenuItemId,
} from './lib/entryActions'
import { GestureTracker } from './lib/gesture'
import { createHoverWarmer } from './lib/hover'
import { fitSquareBox, type Box } from './lib/layout'
import { pushRecent } from './lib/recents'
import { scaleOf } from './lib/scoreScale'
import {
  folderMatchingEnabled,
  searchKinds,
  searchMode,
  searchTuning,
  setFolderMatchingEnabled,
  setSearchKinds,
  setSearchMode,
  setSearchTuning,
  resolveTuning,
  type SearchKinds,
  type SearchMode,
  type Tuning,
} from './lib/searchOptions'
import {
  commitUrl,
  isLightboxEntry,
  isSimilarEntry,
  LIGHTBOX_ENTRY,
  parseUrl,
  serializeView,
  SIMILAR_ENTRY,
  similarDepth,
  type UrlView,
} from './lib/urlState'
import { initialState, reducer, type Action, type Landed } from './state/reducer'
import {
  busy,
  byKind,
  controls,
  dest,
  labelInputs,
  liveView,
  noticeKinds,
  pendingRequest,
} from './state/selectors'
import { sameListing, SIMILAR_K, toUrlView, type Prefs, type Subject, type View } from './state/view'
import { MeshLru } from './three/lru'
import { disposeModel, embedded3mfThumbnail, formatOf, geometryBytes, parseModel } from './three/models'
import { POSE_VERSION } from './three/pose'
import { RenderQueue } from './three/queue'
import { RIG_VERSION, THUMB_LIGHTING } from './three/renderer'
import ViewerLayer, { type ViewerState } from './viewer/ViewerLayer'
import { aoEnabled, setAoEnabled } from './viewer/aoToggle'
import type { ViewerSession } from './viewer/session'

/**
 * How long a typed tuning value waits before it becomes a query. Long enough
 * that a number typed digit by digit is one search rather than four, short
 * enough that a finished value still feels like it ran on its own.
 */
const TUNING_DEBOUNCE_MS = 300

/**
 * How long a revealed entry stays marked. Matches the `reveal-mark` animation
 * in `index.css`, which does the fading: this is only when the class comes off,
 * so a second reveal of the same entry replays it.
 */
const MARK_MS = 1800

/** How long a command's brief report stays on the path bar's transient line. */
const ACTION_TEXT_MS = 2500

/**
 * Stable empties for "nothing has landed yet". `useThumbnails` no longer resets
 * every thumb on an `entries` identity change — it reconciles the new array
 * against the per-entry work it already holds, keeping what is displayed — but
 * that reconciliation still runs, so a fresh `[]` per render would walk it on
 * every keystroke for an answer that never changes.
 */
const NO_ENTRIES: DirEntry[] = []
const NO_POSES: Record<string, IndexPose> = {}
const NO_SCORES: Record<string, IndexScore> = {}
/**
 * No folder has been previewed yet. One module-level map rather than a fresh
 * one per clear, so clearing an already-empty map is a `useState` bail-out
 * instead of a render — and, because it is shared, **never written to**: every
 * landing builds a new Map rather than mutating what it was handed.
 */
const NO_PREVIEWS: ReadonlyMap<string, DirEntry[]> = new Map()
/** A folder with nothing to preview — an empty peek, or one that failed. One
 *  array for both, so a tile that draws the icon draws it from a stable value. */
const NO_PREVIEW: DirEntry[] = []
/** "Nothing is deferred", as a subject, so the banner branches on one union
 *  rather than on a null *and* a kind. */
const NO_SUBJECT: Subject = { kind: 'none' }

/** Nothing withheld. One module-level list rather than a fresh `[]` per raised
 *  menu, and a name for what an empty exclusion list means. */
const NO_EXCLUDES: readonly MenuItemId[] = []

/**
 * What the surface the menu was raised on withholds (D6's margin, 6.8).
 *
 * **The lightbox is the only surface that withholds anything.** A tile offers
 * the whole table, and so does the orbit overlay — which is a transient layer
 * over a tile rather than a view the user opened, so as far as the menu is
 * concerned it *is* that tile. `LIGHTBOX_MENU_EXCLUDES` carries the reasoning
 * for every id on the list, and why none of it reaches the overlay.
 */
function menuExcludes(surface: 'tile' | 'orbit' | 'lightbox'): readonly MenuItemId[] {
  return surface === 'lightbox' ? LIGHTBOX_MENU_EXCLUDES : NO_EXCLUDES
}

/**
 * A model named for a person rather than for the path bar. A similarity view's
 * subject is a vpath — `/run/media/…/Kits/Baal/hero.stl` — and the results
 * label is a single truncating line, so spelling the whole thing there pushes
 * out the part that says what the view is. The full path is still in the URL,
 * which is where an identity belongs.
 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * The two ways a model can fail to be a similarity subject, and they are two
 * sentences because only one of them is fixable (D4/4.5).
 *
 * *Not yet embedded* is a 404 from the index: it walked the collection and this
 * model was not in the cache. Running the classifier over it fixes that, so the
 * sentence says so.
 *
 * *Inside an archive* is knowable here without asking anything —
 * `classify_stls.py` walks real `.stl` files on disk and archives are unpacked
 * before classification, so a `zip!/` vpath is never a key on either side. The
 * menu does not offer the action there (D6), but a shared or hand-edited
 * `?similar=…!/…` link reaches the fetch layer, and it must not spend a request
 * to be told something the path already says — nor borrow the other sentence,
 * which would promise that indexing again would help.
 */
const NOT_EMBEDDED =
  'This model has not been indexed yet, so the index knows no neighbours for it — run the classifier over it and try again.'
const OUTSIDE_CORPUS =
  'Models inside an archive are outside what the index covers, so it can find nothing similar to this one.'

/**
 * The options a view runs under.
 *
 * When the URL names a committed search, an absent option means the
 * **default** — never this profile's stored preference. Omitting defaults
 * keeps an ordinary search URL byte-identical to what it was before options
 * existed (D4), but that only reproduces the sender's view if the recipient
 * reads the omission the same way the sender wrote it. Reading it as "my
 * preference" would hand two people different results from one link, and would
 * make Back restore a past view under present settings — which is the same bug
 * wearing a different hat.
 *
 * With no committed search in the URL there is no view to reproduce, so the
 * stored preferences govern: they are what this profile's next fresh search
 * uses.
 */
function optionsOf(view: UrlView): Prefs {
  if (view.q === undefined || view.q === '') return ownPrefs()
  return {
    folderMatching: view.folderMatching ?? true,
    kinds: view.kinds ?? 'both',
    mode: view.mode ?? 'name',
    // Absent means the default here too — a tuned link that omitted a field
    // must not pick up the reader's setting for it. Not a spread: the bounds
    // read by presence, and a spread would re-add the one the link left out
    // (`resolveTuning`, design D4).
    tuning: resolveTuning(view.tuning),
  }
}

/** This profile's own four options, read where a transition needs them and
 *  carried on the action — never read inside the reducer, which must stay pure
 *  under StrictMode (design R2). */
function ownPrefs(): Prefs {
  return {
    folderMatching: folderMatchingEnabled(),
    kinds: searchKinds(),
    mode: searchMode(),
    tuning: searchTuning(),
  }
}

/**
 * A parsed URL, resolved into a whole `View`: every option present, no
 * absences left to interpret downstream. This is the only place an absence is
 * read, and `optionsOf` is the rule it reads by.
 */
function resolveView(url: UrlView): View {
  return {
    // Always a string, and `/` when the URL named none: the library's top is
    // the default view (design D2/D7), so there is no absence left to read and
    // no last-path to fall back on. What a previous session was looking at is
    // still recorded (`pushRecent`) and is no longer where the app opens.
    path: url.path,
    flat: url.flat,
    // Where the URL's deliberate leniency is resolved (D4): the parameter that
    // names a subject is the more specific one, so a hand-edited link carrying
    // both `similar` and `q` is the similarity view, and the stray `q` is read
    // by nothing.
    subject:
      url.similar !== undefined
        ? // The parser reports every param it recognises; the *resolver* is
          // where a subject claims the ones it reads. `k` absent is the
          // default, the same absence `toUrlView` writes; `pool` absent is the
          // index's own, which is not any of the three named values.
          { kind: 'similar', model: url.similar, k: url.k ?? SIMILAR_K, pool: url.pool }
        : url.q !== undefined
          ? { kind: 'query', text: url.q }
          : { kind: 'none' },
    model: url.model ?? null,
    ...optionsOf(url),
  }
}

/**
 * What the header says while the library cannot be browsed (library R4).
 *
 * `missing` names the configured root because mounting it is the remedy and it
 * takes seconds; `unconfigured` names the two places a root is set, because
 * there is nothing to mount and the fix is a line of configuration; `nested`
 * names the library the root would have swallowed, because pointing at that
 * path is the remedy. All are *states*, not failures — hence one line in the
 * header's existing slot and an empty grid, rather than an error surface of
 * their own (design D4/D7).
 */
const LIBRARY_UNCONFIGURED =
  'No library configured — set MODEL_BROWSER_ROOT or root in config.json'
const libraryMissingText = (root: string): string => `The library at ${root} is not present`
const libraryNestedText = (library: string): string =>
  `This root contains a library at ${library}. Point the root at it, or at a folder inside it.`

/**
 * The library states that mean "the library is why this failed" — the ones a
 * path route 503s with. `ready` is not among them: it is the state in which a
 * route answers rather than faults.
 *
 * Exhaustive over `LibraryState` by construction, so a variant added to that
 * union is a type error here until someone says which side of the line it
 * falls on. The set exists because `HttpError.state` is the `state` field of
 * *any* failure body: an index route 503s with the index's state in the same
 * field, and matching on the field's mere presence would send those to
 * `library()` too.
 */
const LIBRARY_STATES: ReadonlySet<string> = new Set(
  Object.entries({
    ready: false,
    unconfigured: true,
    missing: true,
    nested: true,
  } satisfies Record<LibraryState['state'], boolean>)
    .filter(([, isFault]) => isFault)
    .map(([state]) => state),
)

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

  // The search/view state, whole (design R1): the question asserted, the one in
  // flight, the phase, the answer, the failure, the index, the drafts. Boot
  // view (url-navigation D4, library D2/D7): the URL alone names it — a `path`
  // it carries, and the library's top when it carries none. Where the last
  // session ended is recorded (`pushRecent`) and read only by the path bar's
  // recents; it is never a boot source. The first landing seeds the URL via
  // replaceState.
  const [state, rawDispatch] = useReducer(reducer, undefined, () =>
    initialState(resolveView(parseUrl())),
  )
  const dispatch = useCallback((action: Action): void => {
    // The nested state's answer to twenty greppable cells: every transition, in
    // order, by name. Dev only, and off under the test runner, where it would
    // bury the assertions it is meant to explain.
    if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
      // eslint-disable-next-line no-console
      console.debug('[view]', action.type, action)
    }
    rawDispatch(action)
  }, [])

  /**
   * What the URL owes the view once React has reduced this action — set only
   * by dispatches that own the URL (design R3): the landings, the transitions
   * that assert without asking, and the lightbox open. Never by model-close or
   * model-drop, whose window overlaps an async teardown (bridge 4), and never
   * by a recorded-but-unrun tuning value, which would mint a history entry per
   * keystroke.
   */
  const urlIntent = useRef<{ replace?: boolean; state?: unknown } | null>(null)
  /** The view as of the last time the projection looked — updated on any pass
   *  that wrote, and on an intentless pass only where the address bar already
   *  agrees (see the effect). The URL can run ahead of the view (the
   *  browser rewinds it on Back while the restoration is still in flight), so
   *  "did this dispatch advance the view" is asked of what the view was, never
   *  of what the address bar currently says. Tracking only the writes made this
   *  go stale the other way: a Back that *patched* the view, or a bridge-4 URL
   *  rewrite, moved the URL without a projection, and re-asserting the last
   *  view we happened to have written then read as a no-op. */
  const projectedRef = useRef<string | null>(null)
  const commit = useCallback(
    (action: Action, opts: { replace?: boolean; state?: unknown } = {}): void => {
      urlIntent.current = opts
      dispatch(action)
    },
    [dispatch],
  )

  // Three pieces of text, one job each — they shared two controls until
  // find-in-listing separated them.
  //
  // `drafts.queryText` (in the reducer, because submit reads it) is what is
  // typed in the search input. `view.q` is the last *committed* search; the
  // input keeps its text after submitting, so refining a query is editing
  // rather than retyping. `findText` narrows the rendered entries with zero
  // requests and is typed in the find control, which the user summons — it
  // stays component-local because the reducer never reads it (design R8), and
  // it starts empty in every state, including one restored from a URL, because
  // a filter is ephemeral view state and nothing in a URL describes one.
  const [findText, setFindText] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [findFocus, setFindFocus] = useState(0)
  // Read by the window-level Ctrl-F listener, which subscribes once and would
  // otherwise close over the viewer state as it was at mount.
  const viewerRef = useRef<ViewerState | null>(null)
  const findOpenRef = useRef(false)
  findOpenRef.current = findOpen

  /**
   * The entry menu, what it was raised on, and which surface raised it.
   * Ephemeral by construction — no view field, no URL — and **not a viewer**:
   * it never sets `viewer`, which is what the render-queue suspension keys off
   * (2.4), so raising or dismissing it starts and cancels no thumbnail work.
   *
   * `surface` is not derivable from `viewer`: an orbit overlay covers one tile
   * and leaves the rest of the grid right-clickable, so "a viewer is mounted"
   * and "this menu was raised on it" are different facts.
   *
   * The two viewer surfaces are told apart (6.8) because only one of them
   * filters: `'lightbox'` is a view the user opened and holds, `'orbit'` is an
   * overlay that lingers over a tile for a moment and offers what that tile
   * offers. See `LIGHTBOX_MENU_EXCLUDES`.
   */
  const [menu, setMenu] = useState<{
    entry: DirEntry
    el: HTMLElement | null
    x: number
    y: number
    surface: 'tile' | 'orbit' | 'lightbox'
  } | null>(null)
  const menuRef = useRef<typeof menu>(null)
  menuRef.current = menu
  /** Read by the window-level Escape listener, which subscribes once and would
   *  otherwise close over the menu as it was at mount. */
  const menuOpenRef = useRef(false)
  menuOpenRef.current = menu !== null

  /**
   * The library's state (library R4), the app's one new concept (design D7).
   * App-level state deliberately, never a `View` field: it is a fact about the
   * *server*, not about the view a URL names, so it belongs in neither the URL,
   * the history, nor the reducer.
   *
   * `null` is "not asked yet", which is not the same as any of the states: the
   * boot listing goes out beside the probe, so treating the unknown as blocked
   * would blank the grid for a round trip on every healthy start.
   */
  const [libraryState, setLibraryState] = useState<LibraryState | null>(null)
  /**
   * Re-read it. Stable, so the callbacks that re-probe do not rebuild for it.
   *
   * A rejection is swallowed: `/api/library` is the one route that answers in
   * every state, so a failure here is the server being unreachable, which the
   * request that provoked this is already reporting in the header. Overwriting
   * that with a second sentence about the same outage says nothing new.
   */
  const probeLibrary = useCallback((): void => {
    void api.library().then(setLibraryState, () => {})
  }, [api])
  useEffect(() => probeLibrary(), [probeLibrary])
  /**
   * Read by the re-probe conditions without making them depend on the value —
   * `navigate` is `actionHost`'s, and rebuilding the host on every library
   * answer would churn every memoized surface that holds it.
   */
  const libraryRef = useRef<LibraryState | null>(null)
  libraryRef.current = libraryState

  /**
   * A command's brief report, shown on the path bar's transient line (task
   * 1.1a). Component-local, and an override at this one call site rather than a
   * new reducer failure kind: `state.failure` belongs to a *question* — it
   * carries the view it was asked for and is cleared by the next answer — and a
   * clipboard refusal belongs to no question. It is also not a third surface:
   * this is the app's one place for transient text, told what tone to draw.
   */
  /**
   * The platform's applications for the model types this app handles, and
   * whether a chooser is configured — one reading per session (open-in-slicer
   * L5), held here so the menu's open-in group and *Open with…* are decided
   * from state and never from a probe fired when a menu opens (D6/2.5).
   *
   * Component-local, like `actionText` and `findText` and for their reason: the
   * reducer holds what the *search machine* reads, and nothing in it reads a
   * launcher registry. `null` until the first answer lands, and again if the
   * read fails — which the actions read as "no applications, no chooser", so
   * they are absent rather than present and inert.
   */
  const [apps, setApps] = useState<AppsReport | null>(null)
  const [actionText, setActionText] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(actionTimerRef.current), [])
  const say = useCallback((text: string, tone: 'ok' | 'error'): void => {
    clearTimeout(actionTimerRef.current)
    setActionText({ text, tone })
    actionTimerRef.current = setTimeout(() => setActionText(null), ACTION_TEXT_MS)
  }, [])
  /**
   * The same sentence, sent to the lightbox instead of the path bar. The
   * lightbox covers that bar (`fixed inset-0 z-lightbox`, 70% scrim), so a failure
   * raised from its panel is otherwise dimmed and corner-parked away from the
   * pill that raised it — and since success is silent, it is the *only* signal
   * a launch gives. Where the sentence lands is per-surface; the sentence
   * itself is not, so both paths still spell it from `entryActions`.
   */
  const [viewerError, setViewerError] = useState<string | null>(null)
  const viewerErrorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(viewerErrorTimerRef.current), [])
  const sayInViewer = useCallback((text: string): void => {
    clearTimeout(viewerErrorTimerRef.current)
    setViewerError(text)
    viewerErrorTimerRef.current = setTimeout(() => setViewerError(null), ACTION_TEXT_MS)
  }, [])

  /**
   * Reveal's two ephemeral cells (D3/D8): the entry whose containing folder is
   * being navigated to, and the entry the arrival located. Component-local, like
   * `findText` and for the same reason — the reducer never reads a highlight —
   * so neither reaches the URL, history, or a reload.
   */
  const [pendingReveal, setPendingReveal] = useState<string | null>(null)
  const [marked, setMarked] = useState<string | null>(null)
  const markTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(markTimerRef.current), [])

  // The tuning re-run waiting to become a query. An effect handle, not state:
  // nothing renders it.
  const tuningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The view a debounced tuning re-run was scheduled for. The re-run belongs to
  // it, and the effect below drops the timer the moment it stops being the
  // question on screen.
  const tuningForRef = useRef<View | null>(null)
  useEffect(() => () => clearTimeout(tuningTimerRef.current), [])
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  // A launch failure belongs to the model that was open when it happened. Drop
  // it on close and on a swap, or a reopen inside the 2.5s window would greet
  // the next model with the last one's sentence.
  useEffect(() => {
    clearTimeout(viewerErrorTimerRef.current)
    setViewerError(null)
  }, [viewer?.entry.path])
  // AO preference pill state (persisted per browser profile, aoToggle.ts).
  const [ao, setAoState] = useState(aoEnabled)
  const trackerRef = useRef(new GestureTracker())

  // Set when the next lightbox open comes from history or a deep link. The
  // provenance bridge for the projection (R7 bridge 1 / R2): `history.state`
  // cannot live in a reducer, so which entry a model open writes — a new one
  // carrying the marker, or the browser's own — is carried here from the
  // dispatch site to the effect that writes it. Not a leftover: deleting it
  // makes a restored lightbox mint an entry the user never asked for.
  const suppressViewerPushRef = useRef(false)
  // Increment to ask ViewerLayer to run its persisting close (url-navigation
  // D3: App cannot run the teardown — the session is private to ViewerLayer).
  const [closeSignal, setCloseSignal] = useState(0)
  // The model this session was opened for, once the view named it. Bridge 3:
  // the overlay leads `view.model` by one transition, so "the model left the
  // view" is only meaningful after it arrived.
  const namedModelRef = useRef<string | null>(null)

  // What the render reads — the answered view for the grid and the notices,
  // the live one for the controls (design R1's corollary).
  const target = dest(state)
  const live = controls(state)
  const label = labelInputs(state)
  // The committed *phrase*, where a phrase is what is being rendered — the
  // side panel's "Results for …", the label, the "nothing matched" sentences.
  // A similarity subject has none, and names a model instead: the two are read
  // separately rather than flattened to one string, because every place below
  // has a different sentence for each and a blank is not one of them.
  const liveQuery = live.subject.kind === 'query' ? live.subject.text : null
  // The similarity view's own parameters, for the panel block that sets them.
  // Read off the LIVE subject, like every other control (selectors' third
  // case): a spinner that showed the answered view's count would snap back
  // between the press and the answer.
  const liveSimilar = live.subject.kind === 'similar' ? live.subject : null
  const labelQuery = label.subject.kind === 'query' ? label.subject.text : null
  const labelModel = label.subject.kind === 'similar' ? label.subject.model : null
  const scope = state.result?.scope ?? null
  const truncated = state.result?.truncated === true
  const entries = state.result?.entries ?? NO_ENTRIES
  const poses = state.result?.poses ?? NO_POSES
  // What the index scored each tile at, and which scale those numbers are on.
  // The scale is read off the answer's own question — `label` is the view this
  // result answers — so a tile can only ever be labelled as the thing that
  // asked for it (D3), and a listing nobody scored yields `null` and draws
  // nothing.
  const scores = state.result?.scores ?? NO_SCORES
  const scoreScale = scaleOf(label.subject, label.meaning)
  // The model a similarity answer was computed from. It is never counted with
  // the neighbours — `entries` above is what every count and every "nothing
  // similar" sentence reads — and it is folded in at the render layer alone.
  const anchor = state.result?.anchor
  /**
   * The only way to obtain a result's score. The anchor guard lives here rather
   * than beside each caller, which is the difference between a convention and a
   * constraint: a surface cannot reach past this to the raw map, so a new one
   * inherits the rule by having no alternative. It was two call sites, spelled
   * two ways, and the panel simply forgot its copy — found by review, not by
   * either of the two people who had read the code.
   *
   * **Returns the map's own object, never a constructed one.** `Tile`'s memo
   * compares `score` by identity, so an accessor that built `{score, z}` per
   * call would hand every tile a fresh object on each render and silently undo
   * the memoisation the per-tile-value shape exists for (D6) — a performance
   * regression with no failing test to catch it. The accessor form invites that
   * mistake in a way the raw map did not.
   *
   * `anchor?.path` rather than `anchor` because the path is all the closure
   * reads — a dependency should name what is used. It buys nothing today, and
   * saying so is the point: `anchor` and `scores` change identity together (only
   * `landing` replaces either, and it replaces both; `patch` spreads the result
   * and preserves both), so the narrower dep can never be the thing that spares
   * a rebuild. It is precision, not an optimisation, and a later reader should
   * not treat it as load-bearing.
   */
  const scoreFor = useCallback(
    (path: string): IndexScore | undefined =>
      path === anchor?.path ? undefined : scores[path],
    [scores, anchor?.path],
  )
  /**
   * What each folder tile on screen previews: the models a peek found inside
   * it, keyed by the folder's path (folder-contact-sheets D1). Rendered — the
   * sheet is drawn from it — so it is state, not a ref.
   *
   * A path is in the map exactly once its peek has answered, **including when
   * it answered with nothing and when it failed**, both of which store the
   * empty list: the tile then draws its icon and the failure is not retried
   * within this listing, which is what "requested once per listing" and "the
   * rest of the grid is unaffected" mean together.
   */
  const [previews, setPreviews] = useState<ReadonlyMap<string, DirEntry[]>>(NO_PREVIEWS)
  /**
   * Peeks that have been asked for and have not answered. A ref and not state
   * because nothing renders it: a tile that is in flight has no map entry, so
   * it is already drawing its icon, and re-rendering the grid as each request
   * departs would buy a repaint per folder for no visible change.
   */
  const inFlightPeeks = useRef<Set<string>>(new Set())
  /**
   * The two values `requestPeek` must read at the moment it runs rather than at
   * the moment it was built — the same trick `placeholderRef` uses above, and
   * for the same reason: the callback is handed to `Grid` by identity, so it
   * cannot close over this render's map or this render's listing.
   */
  const previewsRef = useRef(previews)
  previewsRef.current = previews
  const listingRef = useRef(entries)
  listingRef.current = entries
  /**
   * Ask for one folder's preview, at most once per listing.
   *
   * No abort and no retry: the request is bounded server-side, so an abandoned
   * one costs less than the machinery to stop it (`peek`'s docstring), and a
   * failure is recorded as "nothing to preview" rather than surfaced — a folder
   * tile that could not be peeked is a tile with an icon, not an error the user
   * is asked to do something about.
   */
  const requestPeek = useCallback(
    (path: string) => {
      if (previewsRef.current.has(path) || inFlightPeeks.current.has(path)) return
      inFlightPeeks.current.add(path)
      // The listing this answer will belong to, captured before the await. A
      // peek outlives the tile that asked for it by design, so it can land
      // after the grid has moved on — and an answer about the folder the user
      // has left must not become an entry in the map the new listing is drawn
      // from.
      const asked = listingRef.current
      const land = (found: DirEntry[]): void => {
        // Generation first, delete second: the marker is keyed by path alone,
        // and a listing change may have re-issued this folder's peek — a
        // superseded answer deleting the marker would strip the successor's
        // once-per-listing guard while it is still in flight. The superseded
        // request's own marker is already gone (the clearing effect wiped the
        // set), so returning early leaks nothing.
        if (listingRef.current !== asked) return
        inFlightPeeks.current.delete(path)
        setPreviews((prev) => {
          const next = new Map(prev)
          next.set(path, found)
          return next
        })
      }
      void api.peek(path).then(land, () => land(NO_PREVIEW))
    },
    [api],
  )
  /**
   * One listing, one set of previews (D1). A tile scrolled away and back inside
   * the same listing reuses what the map holds and asks for nothing.
   *
   * Keyed on `entries` and deliberately **not** on `state.result`: `patch`
   * (state/reducer.ts) spreads the result on every fetchless view change — a
   * kind option, a lightbox opening — while preserving `entries` identity, so
   * keying on the result would throw away every landed sheet and re-issue every
   * peek each time the user opened a model. `entries` is replaced wholesale by
   * a landing and only by a landing (R5), which is exactly "a different listing
   * is on screen" — navigation and search landings alike — and it is the same
   * identity `useThumbnails` reconciles on.
   */
  useEffect(() => {
    inFlightPeeks.current.clear()
    setPreviews(NO_PREVIEWS)
  }, [entries])
  // The anchor needs a thumbnail like any tile, so it goes to useThumbnails —
  // memoized because that effect reconciles its per-entry state against
  // `entries` on any identity change (D2), and a fresh array per render would
  // pay that walk on every keystroke. The walk is all it would cost now: since
  // `ao-refreshes-thumbnails` a re-run keeps every surviving tile's image and
  // touches only what arrived or left.
  //
  // Preview models are appended to that same list rather than given a pipeline
  // of their own (folder-contact-sheets D3): a sheet cell is an ordinary
  // thumbnail, so it shares the cache entry, the queue, the LRU and the recipe
  // with the tile the same model has elsewhere. Deduplicated by path — in a
  // flat listing a previewed model is often also a tile, and the anchor counts
  // as present too — so the shared model is looked up once and both images are
  // drawn from the one entry.
  const thumbEntries = useMemo(() => {
    const base = anchor === undefined ? entries : [anchor, ...entries]
    if (previews.size === 0) return base
    const seen = new Set(base.map((e) => e.path))
    const extra: DirEntry[] = []
    for (const found of previews.values()) {
      for (const entry of found) {
        if (seen.has(entry.path)) continue
        seen.add(entry.path)
        extra.push(entry)
      }
    }
    // Identity preserved when a peek added nothing new, which spares the grid
    // even the reconcile walk for a sheet drawn entirely from tiles it already
    // has.
    return extra.length === 0 ? base : [...base, ...extra]
  }, [entries, anchor, previews])
  // The subject a deferral is holding — a phrase or a model, and the banner
  // says a different sentence for each. Read off `view` rather than the answer,
  // like the projection: while a stand-in listing is on screen the *answer* is
  // about the folder, and the banner's whole job is to explain the question
  // that answer is not about.
  const deferredSubject = state.phase !== 'idle' ? state.view.subject : NO_SUBJECT
  // Whether there is anything to dismiss, asked of the question the app stands
  // behind rather than the one it has answered (selectors' third case). That is
  // what makes ONE control serve both a landed result and a deferral, whose
  // stand-in answer is about the folder and would report nothing committed —
  // and a second copy in the banner is exactly the two-that-resemble-each-other
  // D9 exists to refuse.
  const dismissable = live.subject.kind !== 'none'
  const error = state.failure?.message ?? null
  /**
   * The library's top, filesystem-side, or null while it is not `ready` —
   * `expandLibraryPath`'s first argument wherever a path leaves the app.
   */
  const libraryTop = libraryState?.state === 'ready' ? libraryState.top : null
  /**
   * The one sentence a not-`ready` library gets, or null. Non-null is also what
   * "there is nothing to browse" means below: a library that is unconfigured or
   * unmounted has no listing to show, no folder to call empty, and nothing on
   * its way — so the grid, the skeleton and the landing line are all withheld
   * and the message stands alone (library R4).
   *
   * `null` state — not asked yet — reads as unblocked on purpose: the boot
   * listing is already in flight beside the probe, and blanking the grid until
   * the probe answers would cost every healthy start a flash of nothing.
   */
  const libraryMessage: string | null =
    libraryState === null || libraryState.state === 'ready'
      ? null
      : libraryState.state === 'unconfigured'
        ? LIBRARY_UNCONFIGURED
        : libraryState.state === 'nested'
          ? libraryNestedText(libraryState.library)
          : libraryMissingText(libraryState.root)

  const showSkeleton = useDelayedFlag(busy(state), SKELETON_DELAY_MS)
  const { thumbs, setThumb, setPlaceholder, discardThumbFraming } = useThumbnails(
    thumbEntries,
    api,
    lru,
    queue,
    // The pill's own state, not a second read of `aoToggle`'s store: this is
    // what makes a press (or, after `adaptive-ao-default`, an automatic
    // decision) re-run the sweep over the grid already on screen.
    ao,
    poses,
  )
  placeholderRef.current = setPlaceholder

  /**
   * The one URL writer (design R3): serialize the asserted view and commit it.
   *
   * Two conditions, and both are the fence. A URL-owning dispatch must have
   * left an intent behind — a wholesale write on every state change would
   * `replaceState` over an entry the user already Backed off, since lightbox
   * teardown is asynchronous (PERSIST_HOLD_MS, ViewerLayer.tsx) and the view
   * disagrees with what is mounted for its whole duration (R7). And that
   * dispatch must have actually asserted something: most controls *ask* rather
   * than assert, and pushing the unadvanced view then is not a no-op after a
   * Back — the browser has already rewound the URL, so it would push the view
   * the user just left back on top of history.
   *
   * A `replace` is exempt from the second condition, and only a `replace`. The
   * boot seed asserts nothing — the view was resolved before any dispatch — yet
   * it is exactly the write that has to land, and `commitUrl` already declines
   * a replace the address bar makes redundant. It is the *push* of an
   * unadvanced view that mints the entry nobody asked for.
   */
  useEffect(() => {
    const intent = urlIntent.current
    urlIntent.current = null
    const url = serializeView(toUrlView(state.view))
    const advanced = url !== projectedRef.current
    if (intent === null) {
      // An intentless pass may only *absorb* a view the address bar already
      // agrees with. That still covers what this ref exists for — a Back that
      // patched the view, or a URL rewritten out from under it, both of which
      // leave the view matching the bar once the dust settles — while refusing
      // to absorb a view this app recorded and deliberately did not project.
      //
      // The debounced tuning re-run is exactly that: `setTuning` records a
      // keystroke with `run: false` precisely so it does *not* mint a history
      // entry per character, then commits for real when the typing stops.
      // Absorbing the record made the commit read as unadvanced, so it declined
      // to write and a typed count or floor never reached the URL at all —
      // the grid re-ran under a bound the link then failed to carry.
      if (url === window.location.search) projectedRef.current = url
      return
    }
    projectedRef.current = url
    if (!advanced && intent.replace !== true) return
    commitUrl(toUrlView(state.view), intent)
  }, [state])

  /**
   * The fetch layer: `pendingRequest` names the call, the response is tagged
   * with the asking event and the question as asked, and the reducer decides
   * whether it still belongs (R2). Superseded requests are aborted — listings
   * too, not only meaning queries: a flat walk nobody waits for otherwise runs
   * to completion on the server. The abort is also what tells a late response
   * to say nothing at all, so a stale answer never reaches the URL.
   */
  const request = pendingRequest(state)
  const requestId = request?.id ?? null
  const requestSource = state.inflight?.source ?? 'user'
  useEffect(() => {
    if (request === null) return
    const controller = new AbortController()
    const { id, forView } = request
    const land = (landed: Landed): void => {
      if (controller.signal.aborted) return
      pushRecent(request.path)
      // The view is real now — record it (url-navigation D1/D2). A restoration
      // replaces (back must not mint forward-erasing entries); a user
      // navigation pushes.
      //
      // A similarity view the user asked for *from inside the app* marks the
      // entry it pushes, through the projection's existing `state` channel —
      // the `LIGHTBOX_ENTRY` pattern, for the same reason (D9): the mark says
      // this entry has the view it was raised from behind it, so dismissing can
      // go back to that view rather than re-asking the folder's listing.
      // Restored and deep-linked landings must not gain it and cannot: this is
      // gated on `user`, and a restore onto an entry that already carries the
      // marker writes nothing at all, since the browser has already rewound the
      // URL and `commitUrl` declines the redundant write, marker included.
      //
      // The depth counts from the entry being pushed *from*, read here because
      // here is where that entry is still current: one deeper than whatever the
      // current entry is, so a re-tune and a chained find-similar both stack,
      // and a landing from anywhere else starts at 1. The dismissal goes back
      // that many hops, leaving the excursion whole rather than one step of it.
      urlIntent.current = {
        replace: requestSource === 'restore',
        ...(request.kind === 'similar' && requestSource === 'user'
          ? { state: SIMILAR_ENTRY(similarDepth() + 1) }
          : {}),
      }
      dispatch({ type: 'landing', id, forView, landed })
    }
    const fail = (err: unknown): void => {
      if (controller.signal.aborted) return
      // A 503 naming one of the *library's* states says the library is why
      // this failed, not the path (library R4). Re-read the state so the header
      // names it — and so `missing` can name the configured root, which the
      // error body carries but `HttpError` deliberately does not: one place
      // knows both. Matched against `LIBRARY_STATES` rather than on the field
      // being present at all, because an index route puts the *index's* state
      // in that same field: a wedged index is not news about the library.
      if (err instanceof HttpError && err.state !== undefined && LIBRARY_STATES.has(err.state)) {
        probeLibrary()
      }
      dispatch({
        type: 'failure',
        id,
        forView,
        message: err instanceof Error ? err.message : String(err),
      })
    }
    if (request.kind === 'similar') {
      // Knowable without asking, so it is not asked: an archive-resident model
      // has no embedding and never will. This fails the question rather than
      // spending a round trip that would come back 404 and be reported as the
      // fixable kind.
      if (request.model.includes('!/')) {
        dispatch({ type: 'failure', id, forView, message: OUTSIDE_CORPUS })
        return () => controller.abort()
      }
      // `pool` is passed through as the subject holds it — `undefined` where
      // nothing set one, which the client drops from the body so the index's
      // own default applies (4.2's rule, now that something on screen can set
      // it).
      void api.similar(request.model, request.k, request.pool, controller.signal).then(
        // Similarity order is the index's; the client sorts nothing. No scope,
        // no `weak`, no `capped`: the index publishes none of them for
        // neighbours, and a landing that invented them would give the label
        // meaning-query residue to render (4.7).
        // The anchor rides along beside the entries, never among them: it is the
        // question, and the neighbours are the answer (D4's addition).
        (res) =>
          land({ entries: res.entries, poses: res.poses, scores: res.scores, anchor: res.anchor }),
        (err: unknown) => {
          const notEmbedded = err instanceof HttpError && err.status === 404
          // A 404 means the index *answered* — about this model, not about
          // itself. Re-probing availability over it would flash the "index is
          // not there" affordance across a perfectly healthy index, so the
          // re-probe is kept for the failures that really are availability's.
          if (!controller.signal.aborted && !notEmbedded) {
            void api.indexAvailability({ fresh: true }).then(
              (availability) => dispatch({ type: 'index', availability }),
              () => {},
            )
          }
          // The status is the contract (`ApiClient.similar`), so the sentence is
          // chosen from it rather than from the index's own words, which name a
          // cache the user has never heard of.
          if (notEmbedded) {
            if (!controller.signal.aborted) {
              dispatch({ type: 'failure', id, forView, message: NOT_EMBEDDED })
            }
            return
          }
          fail(err)
        },
      )
      return () => controller.abort()
    }
    if (request.kind === 'meaning') {
      void api.semanticSearch(request.text, request.path, request.tuning, controller.signal).then(
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
          // A 503 carries the index's own state; re-read it so the affordance
          // and the message agree about what is wrong.
          if (!controller.signal.aborted) {
            void api.indexAvailability({ fresh: true }).then(
              (availability) => dispatch({ type: 'index', availability }),
              () => {},
            )
          }
          fail(err)
        },
      )
    } else {
      void api
        // `folderMatching` is sent only when off, so an ordinary request is
        // identical to what it was before the option existed — absence means
        // the default at every layer: this call, the query string, and the URL.
        .listDir(
          request.path,
          {
            flat: request.flat,
            q: request.q ?? undefined,
            folderMatching: request.folderMatching ? undefined : false,
          },
          controller.signal,
        )
        .then((res) => land({ entries: res.entries, truncated: res.truncated }), fail)
    }
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  const navigate = useCallback(
    (path: string) => {
      // Navigation is itself the request that clears search state (D2/D3) — no
      // extra fetch needed to drop a filter or a committed query, and the
      // filter is the caller's to clear because the reducer never reads it.
      setFindText('')
      setFindOpen(false)
      // The reveal mark is ephemeral in exactly the same sense (3.5), so it is
      // dropped here — one place a new ephemeral reset gets added, rather than
      // one per caller. Reveal arms the mark *after* calling this, deliberately:
      // it belongs to the arrival this navigation causes, not to the view being
      // left.
      setPendingReveal(null)
      setMarked(null)
      // A volume mounted after the server started is picked up by the next
      // navigation rather than by a reload (library R4): the state is asked
      // again on the way out, so pressing ↑ or retyping the path is enough.
      // Only while it is not `ready` — a healthy library is not re-asked on
      // every click.
      const lib = libraryRef.current
      if (lib !== null && lib.state !== 'ready') probeLibrary()
      commit({ type: 'navigate', path, prefs: ownPrefs() })
    },
    [commit, probeLibrary],
  )

  function toggleFlat(): void {
    // Deep results are flat-shaped regardless of the toggle; pressing it issues
    // an ordinary request that supersedes the search, so the query stops being
    // committed. Targeted at `dest` — the newest place the user asked for — so
    // untoggling mid-navigation follows the user rather than snapping back.
    commit({ type: 'toggleFlat' })
  }

  /**
   * Leave the committed subject — **the** dismissal, whichever affordance asked
   * for it (D9). One function with the branch inside it; two call sites, zero
   * copies.
   *
   * The branch is provenance, and it is the whole of what this adds: a
   * similarity view entered from inside the app sits on an entry we pushed and
   * marked, so going back restores the view it was raised from *whole* — a
   * query search with its options, a listing with its place — rather than
   * re-asking the location's listing and throwing that answer away. On a cold
   * link there is nothing of this app's behind the entry, so back would leave
   * the app; the reducer path clears to the listing instead.
   *
   * How far back is the marker's depth, not one hop. Every in-app similar
   * landing pushes a marked entry — tuning `k` or the pool is a different
   * question, and Back must reach the neighbours actually shown — so an
   * excursion is a *run* of marked entries. Going back one landed on the
   * intermediate tuning step, which is not a view the user asked to return to;
   * going back the depth leaves the whole excursion in one press, tuning steps
   * and chains alike. Back still walks the steps individually.
   *
   * And a query view is untouched by all of this: its entry is never marked, so
   * `otherwise` is what runs — exactly as before.
   */
  const leaveSubject = useCallback(
    (otherwise: Action): void => {
      if (isSimilarEntry()) {
        // popstate does the rest: the restoration is one dispatch of the
        // previous URL resolved whole, which is the machinery that already
        // exists for Back (url-navigation D2).
        window.history.go(-similarDepth())
        return
      }
      commit(otherwise)
    },
    [commit],
  )

  function handleQueryTextChange(value: string): void {
    // Emptying the input while a subject is committed is how it is left: it
    // drops the subject, cancels any deferral, and re-issues the ordinary
    // listing (file-search's "Clearing a committed query" rule, now one rule
    // for both kinds of subject — D9). That cancel asserts the view at
    // dispatch, so it owns the URL; ordinary typing owns nothing.
    //
    // Through the one dismissal, so erasing stale text under an in-app
    // similarity view returns where the ✕ returns. Left as its own commit, the
    // tidying gesture and the control would be two exits again — which is the
    // resemblance D9 refuses, in the one place D9 already had to argue about.
    if (value.trim() === '' && live.subject.kind !== 'none') {
      leaveSubject({ type: 'queryText', text: value })
      return
    }
    dispatch({ type: 'queryText', text: value })
  }

  /**
   * Run the deferred phrase as a name search. Offered rather than done for the
   * user: substituting the corpus is only honest when it was asked for, and
   * this is the asking. Being a user action, it may rename the view.
   */
  function runDeferredByName(): void {
    if (state.phase === 'idle') return
    commit({ type: 'deferredToName' })
  }

  /** Open the find control, or focus it if it is already open. */
  function openFind(): void {
    setFindOpen(true)
    setFindFocus((n) => n + 1)
  }

  /** Dismissing clears the filter: a closed control must never leave the grid
   *  silently narrowed. */
  function closeFind(): void {
    setFindOpen(false)
    setFindText('')
  }

  /**
   * Folder matching decides what the *server* returns, so changing it with a
   * query committed re-issues that query — the `toggleFlat` precedent:
   * re-request, land, commit (D3). Operating a control is also the only thing
   * that writes to storage (D2): a restore or a link never does.
   */
  function setFolderMatching(on: boolean): void {
    setFolderMatchingEnabled(on)
    commit({ type: 'setFolderMatching', on })
  }

  /**
   * The mode decides which corpus a submit consults, so changing it with a
   * query committed re-runs that query there — search by name, find nothing,
   * flip, and the same words go to the index without being retyped (D2). One
   * function decides which corpus that is, shared with submit (R6), so the flip
   * defers exactly where a submit would rather than substituting a name search.
   */
  function setMode(next: SearchMode): void {
    setSearchMode(next)
    commit({ type: 'setMode', mode: next })
  }

  /**
   * Tuning shapes what the index returns, so changing it with a meaning query
   * committed re-runs that query — the same rule the mode and folder matching
   * follow. Trying a parameter is the point, and a setting that only applied to
   * the *next* search would make trying it a two-step.
   */
  function setTuning(next: Tuning, opts: { defer?: boolean } = {}): void {
    setSearchTuning(next)
    // Whatever a previous change scheduled is superseded by this one, whether
    // this one waits or runs now.
    clearTimeout(tuningTimerRef.current)
    tuningForRef.current = null
    // A click on a toggle is the finished value already, and waiting for it
    // would only make the control feel broken.
    if (opts.defer !== true) {
      commit({ type: 'setTuning', tuning: next, run: true })
      return
    }
    // A typed number arrives one keystroke at a time and every intermediate
    // value is a whole query the index would have to answer — so it is recorded
    // now and run later. Recorded only: projecting it would mint a history
    // entry per keystroke (R3's fence).
    dispatch({ type: 'setTuning', tuning: next, run: false })
    // The re-run belongs to the view that scheduled it, which is the live view
    // with this value already applied. The effect below drops the timer as soon
    // as that stops being the question on screen.
    tuningForRef.current = { ...liveView(state), tuning: next }
    tuningTimerRef.current = setTimeout(() => {
      tuningForRef.current = null
      commit({ type: 'setTuning', tuning: next, run: true })
    }, TUNING_DEBOUNCE_MS)
  }

  /**
   * A scheduled tuning re-run belongs to the view that scheduled it. Fired
   * against another one it would be the newest request, so latest-wins would
   * hand it the grid and the URL, dragging the user back to the view they just
   * left. `sameListing` is the test — the whole question minus the model, since
   * which model is open says nothing about which entries the view contains — so
   * a navigation, another search, or a popstate restoring different tuning drops
   * it, while an unrelated landing or a lightbox open leaves it armed.
   */
  useEffect(() => {
    const scheduled = tuningForRef.current
    if (scheduled === null || sameListing(liveView(state), scheduled)) return
    tuningForRef.current = null
    clearTimeout(tuningTimerRef.current)
  }, [state])

  /**
   * The similarity view's parameters — how many neighbours, and how the index
   * pools a model's views. Both re-ask, for the reason the mode and folder
   * matching re-ask a committed query: trying a parameter is the point, and a
   * setting that only applied to the *next* find-similar would make trying it a
   * two-step.
   *
   * No debounce here and no record-only phase, unlike `setTuning`: the count is
   * typed digit by digit, so the panel holds the draft and only calls this with
   * a finished value. `commit` rather than `dispatch` because a deferred
   * re-parameterisation asserts its view at dispatch and owes the URL that
   * assertion; a landed one is written by its landing, as every ask is.
   *
   * Nothing is written to storage. These are not sticky preferences: they
   * belong to the view they were set on, they travel in its URL, and the next
   * find-similar starts from the defaults again — deliberately, since a count
   * that was right for one model's neighbourhood says nothing about another's.
   */
  const setSimilarTuning = useCallback(
    (k: number, pool?: Tuning['pool']): void => {
      commit({ type: 'similarTuning', k, pool })
    },
    [commit],
  )

  /** The kind option only selects among entries already returned — no request,
   *  but the URL names the view and this changed which entries it shows. */
  function setKinds(next: SearchKinds): void {
    setSearchKinds(next)
    commit({ type: 'setKinds', kinds: next })
  }

  function submitSearch(): void {
    // A blank/whitespace-only submit is not a search (D1) — nothing to commit,
    // and nothing for the URL to own.
    if (state.drafts.queryText.trim() === '') return
    commit({ type: 'submit' })
  }

  // Boot (url-navigation D4): one restore of the view the URL resolved to —
  // `/` when it named no path (library D2/D7), never a stored last path. It
  // lands as a restoration, so the resolved view is seeded via replaceState —
  // pushed entries start with the user's first real navigation.
  // A meaning link fetches nothing here: the corpus decision reads the
  // availability probe from state, and until it answers the answer is `wait` —
  // rendering the ordinary listing meanwhile would flatten the whole volume for
  // tiles the meaning results are about to replace.
  useEffect(() => {
    dispatch({ type: 'restore', view: state.view })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The shared renderer serves one purpose at a time: suspend the thumbnail
  // queue while an orbit overlay or lightbox is active. Keyed off `viewer` —
  // what is mounted — never off `view.model`, which is what the URL names and
  // disagrees with it for the whole teardown (R7).
  useEffect(() => {
    if (viewer !== null) queue.suspend()
    else queue.resume()
  }, [viewer, queue])

  // Re-read availability on mount and whenever a listing lands: the index is a
  // separate service that may start after this app did, and a warming one must
  // become usable without a reload. No timer of its own — these are the
  // interactions the app already makes (3.8). The reducer keeps the reading by
  // identity when nothing about it changed, so a 2s poll that says the same
  // thing re-renders nothing.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = (): void => {
      void api.indexAvailability().then(
        (s) => {
          if (!alive) return
          dispatch({ type: 'index', availability: s })
          // Warming is the one state that must re-check without being asked:
          // "the interactions the app already makes" is an empty set while a
          // user waits for SigLIP, because nothing they do changes the path.
          // The server's own per-state TTL makes this cheap.
          if (s.state === 'warming') timer = setTimeout(read, 2000)
        },
        () => {
          if (alive) dispatch({ type: 'index', availability: { state: 'absent' } })
        },
      )
    }
    read()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [api, dispatch, state.view.path])

  /**
   * Read the platform registry into the session's held report — the whole of
   * the app's I/O for the launch actions, in one place.
   *
   * A failed read is `null` and not a retained stale answer: the report decides
   * whether actions are *offered*, and offering a launch into an application
   * the registry no longer reports is worse than offering none.
   */
  const refreshApps = useCallback((): void => {
    void api.apps().then(
      (report) => setApps(report),
      () => setApps(null),
    )
  }, [api])

  // Once per session, and that is the whole schedule (L5) — the deliberate
  // difference from the index reading above, which re-reads on every landing
  // because a service that starts late must become usable without a reload.
  // The registry has one other moment when it can change under us, and it is
  // not a landing: a chooser the user just used. *Open with…*'s own body asks
  // for the re-read then (`refreshApps` on the host), so this effect stays a
  // mount effect rather than growing a dependency that would re-read on every
  // navigation for nothing.
  useEffect(() => {
    refreshApps()
  }, [refreshApps])

  // Ctrl-F / Cmd-F takes the browser's find, deliberately: the app's own is the
  // better one on this content — it matches the full relative path a tile is
  // only labeled by, it knows when it has hidden everything, and it does not
  // stop at the tiles the browser happens to have painted.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // Escape dismisses the find control from anywhere, not only from inside
      // its own input: the user opens it, clicks a tile, and Escape is what
      // they reach for. Not while a viewer is up — the lightbox owns Escape
      // then, and closing a control behind it is not what was asked.
      // Nor while an entry menu is raised, for the same reason and by the same
      // test (2.3): the menu is the thing on top, its own window listener closes
      // it, and this one stands down so one Escape does not dismiss both. With
      // no menu up the ref is false and find's Escape is untouched.
      if (
        e.key === 'Escape' &&
        findOpenRef.current &&
        viewerRef.current === null &&
        !menuOpenRef.current
      ) {
        closeFind()
        return
      }
      if (e.key !== 'f' || !(e.ctrlKey || e.metaKey) || e.altKey) return
      // Not while the user is typing somewhere else for their own reasons —
      // Ctrl-F inside a query or a path is a surprise, not a shortcut.
      // The event's own target, not `document.activeElement`: for a real
      // keydown they are the same element, and the target is the one the
      // keystroke actually belongs to.
      const el = e.target instanceof HTMLElement ? e.target : document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing && el.closest('[data-find-bar]') === null) return
      // Not while a viewer owns the keyboard. The lightbox traps focus, and
      // opening a find control behind it would pull focus out of the trap into
      // a box the user cannot see — and the orbit overlay has no listing to
      // narrow either. Filtering is about the grid; both of these cover it.
      if (viewerRef.current !== null) return
      e.preventDefault()
      openFind()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hover = useMemo(() => createHoverWarmer((p) => lru.warm(p)), [lru])

  viewerRef.current = viewer

  /** Enter lightbox mode from history/deep-link restore — no tile element, and
   *  the entry it sits on is the browser's, not one to mint. */
  const openRestoredLightbox = useCallback((entry: DirEntry) => {
    suppressViewerPushRef.current = true
    const size = Math.min(window.innerWidth, window.innerHeight) / 4
    setViewer({
      mode: 'lightbox',
      entry,
      rect: {
        left: (window.innerWidth - size) / 2,
        top: (window.innerHeight - size) / 2,
        width: size,
        height: size,
      },
      originEl: null,
    })
  }, [])

  // History is one dispatch (url-navigation D2): the parsed URL, resolved into
  // a whole view, restored as a whole. It needs no live mirror of the state to
  // decide what changed — the reducer compares, and a history entry that
  // differs only in which model is open patches that field instead of
  // re-requesting a listing it already has. Subscribed once, for the same
  // reason.
  useEffect(() => {
    function onPop(): void {
      const v = parseUrl()
      // No path guard: a URL naming none names the library's top (design D2),
      // which is a view like any other, so popping back to a bare URL restores
      // the root instead of being ignored.
      // The input shows the restored query; the filter is not part of the view
      // a URL names, so it starts empty here as everywhere else.
      setFindText('')
      setFindOpen(false)
      // Nor is the reveal mark: going back to a folder an entry was revealed in
      // lists it with nothing marked (3.5).
      setPendingReveal(null)
      setMarked(null)
      dispatch({ type: 'restore', view: resolveView(v) })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [dispatch])

  // A `model` the view names but nothing has mounted yet (url-navigation D3):
  // honored once its entry is in a landed listing, dropped silently after a
  // successful listing that lacks it.
  useEffect(() => {
    const model = state.view.model
    if (model === null || viewer !== null) return
    if (state.result === null || state.inflight !== null || state.failure !== null) return
    const entry = state.result.entries.find((e) => e.kind === 'model' && e.path === model)
    if (entry !== undefined) {
      openRestoredLightbox(entry)
      return
    }
    // Bridge 4 (R7): the drop rewrites that one field of the live URL rather
    // than projecting a view, because the projection's fence keeps model
    // transitions off the wholesale writer.
    const url = parseUrl()
    if (url.model !== undefined) commitUrl({ ...url, model: undefined }, { replace: true })
    dispatch({ type: 'modelDrop' })
  }, [state.view.model, state.result, state.inflight, state.failure, viewer, openRestoredLightbox, dispatch])

  // Locate on arrival (3.2) — the honor-or-drop pattern the effect above
  // follows, with a highlight instead of a lightbox: hold the payload, act only
  // on a settled answer, honor it when the entry is in the listing that landed,
  // drop it silently when it is not. A revealed entry that has since been moved
  // or deleted leaves the folder presented normally, with no error and nothing
  // marked.
  useEffect(() => {
    if (pendingReveal === null) return
    if (state.result === null || state.inflight !== null || state.failure !== null) return
    setPendingReveal(null)
    if (!state.result.entries.some((e) => e.path === pendingReveal)) return
    setMarked(pendingReveal)
    // The fade is the animation's (index.css); this only decides when the class
    // comes off, so revealing the same entry twice replays it.
    clearTimeout(markTimerRef.current)
    markTimerRef.current = setTimeout(() => setMarked(null), MARK_MS)
  }, [pendingReveal, state.result, state.inflight, state.failure])

  // The lightbox history push hooks the transition INTO 'lightbox' mode, not
  // openLightbox — that function is the keyboard entrance only; the pointer
  // route promotes the orbit overlay in place (url-navigation D3).
  const prevModeRef = useRef<'orbit' | 'lightbox' | null>(null)
  useEffect(() => {
    const mode = viewer?.mode ?? null
    const prev = prevModeRef.current
    prevModeRef.current = mode
    if (mode !== 'lightbox' || prev === 'lightbox' || viewer === null) return
    if (suppressViewerPushRef.current) {
      // Restored from history or a deep link: preserve whatever state this
      // entry already carries — a forward-restored lightbox is sitting on the
      // entry we originally pushed, marker included.
      suppressViewerPushRef.current = false
      commit({ type: 'modelOpen', path: viewer.entry.path }, {
        replace: true,
        state: window.history.state,
      })
    } else {
      commit({ type: 'modelOpen', path: viewer.entry.path }, { state: LIGHTBOX_ENTRY })
    }
  }, [viewer, commit])

  // The model left the view while a session is open — browser-back, or a close
  // that dropped the param — so ask ViewerLayer for its persisting close
  // (bridge 2: the teardown is private to it). Only once the view had named it:
  // the overlay is promoted a transition before the dispatch that names it, and
  // signalling in that window would close the lightbox as it opened.
  useEffect(() => {
    if (viewer?.mode !== 'lightbox') {
      namedModelRef.current = null
      return
    }
    if (state.view.model === viewer.entry.path) {
      namedModelRef.current = viewer.entry.path
      return
    }
    if (namedModelRef.current !== viewer.entry.path) return
    namedModelRef.current = null
    setCloseSignal((n) => n + 1)
  }, [viewer, state.view.model])

  // In-app close affordances route here (url-navigation D3): a lightbox whose
  // entry we pushed closes through history so ✕ and browser-back are one
  // path; a deep-linked one has nothing behind it — back would leave the app —
  // so its param drops via replaceState and the view drops it too, which is
  // what the watcher above turns into the teardown.
  const onViewerCloseIntent = useCallback(() => {
    if (isLightboxEntry()) {
      window.history.back()
      return
    }
    const v = parseUrl()
    if (v.model !== undefined) commitUrl({ ...v, model: undefined }, { replace: true })
    dispatch({ type: 'modelClose' })
  }, [dispatch])

  // Pure view state over the landed entries — never reaches useThumbnails,
  // whose effect resets the whole thumb map to `loading` on any `entries`
  // identity change (D2). Matches each entry's full `name`, which in flat/deep
  // views is its relative path, not the shortened tile label.
  // Trimmed once and used everywhere the filter is read: whitespace-only text
  // is no filter (the same rule a submitted query follows), and a trailing
  // space mid-word must not blank a grid full of names that contain spaces.
  const needle = findText.trim().toLowerCase()
  // Two layers over the same listing: the kind option (a committed view
  // setting, in the URL) and the live name filter (ephemeral). Both are view
  // state over what the server returned — neither issues a request. Kept as a
  // pair because an empty grid has to name the one that emptied it, and the
  // kind restriction runs first: if it left nothing, the filter never had a
  // chance to hide anything.
  // Narrower than the selector's argument on purpose: `byKind` reads the
  // landed answer and nothing else, and re-running it on every state change
  // would mint a fresh array — which `filteredListing` and then the grid
  // compare on, re-rendering every tile for an availability tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kept = useMemo(() => byKind(state), [state.result])
  const filteredListing = useMemo(
    () => (needle === '' ? kept : kept.filter((e) => e.name.toLowerCase().includes(needle))),
    [kept, needle],
  )
  // The anchor is prepended here and nowhere earlier: it is shown, never
  // counted. It is also **exempt from the find filter** — the filter narrows
  // the answer, and the reference is what the answer is about, so hiding it
  // would leave a grid of neighbours with nothing to say what they are near.
  // The kind option needs no exemption: `byKind` already passes a similarity
  // result through untouched, since that view reads no kind restriction.
  const shownEntries = useMemo(
    () => (anchor === undefined ? filteredListing : [anchor, ...filteredListing]),
    [anchor, filteredListing],
  )
  // A kind restriction can empty the grid too, and it is a different sentence:
  // the results are there, this view is not showing them. It is decided first
  // and from `kept`, so the message names the control that actually hid the
  // entries rather than the one that happened to run last.
  const kindHidesAll = entries.length > 0 && kept.length === 0
  const filterHidesAll = needle !== '' && kept.length > 0 && filteredListing.length === 0
  // Gated on the subject, not on a phrase: an empty *similarity* result is an
  // answer that found nothing, exactly as an empty search is, and reading a
  // query string here left it falling through to Grid's bare "Nothing to show
  // here" as though the folder were empty (4.6b).
  const searchHasNoMatches = label.subject.kind !== 'none' && entries.length === 0

  /**
   * The overlay replaces the thumbnail image, not the whole tile: same pixels,
   * same square aspect as the PNG (seamless handoff), and the label row below
   * stays visible. Falls back to the centered square of the content area when
   * no <img> has rendered yet.
   */
  const overlayRectFor = useCallback((el: HTMLElement): Box => {
    const img = el.querySelector('img')
    if (img !== null) {
      const r = img.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    const content = el.querySelector('[data-tile-content]') ?? el
    return fitSquareBox(content.getBoundingClientRect())
  }, [])

  // The tile handlers are held by identity rather than rebuilt each render:
  // they are what a memoized tile compares on, and a fresh function per
  // keystroke in the search box would re-render every tile in the grid.
  const onModelPointerDown = useCallback(
    (e: React.PointerEvent, entry: DirEntry, el: HTMLElement): void => {
      if (e.button !== 0) return
      trackerRef.current.start(e.clientX, e.clientY)
      setViewer({
        mode: 'orbit',
        entry,
        rect: overlayRectFor(el),
        originEl: el,
      })
    },
    [overlayRectFor],
  )

  const openLightbox = useCallback((entry: DirEntry, el: HTMLElement): void => {
    trackerRef.current.start(0, 0)
    const r = el.getBoundingClientRect()
    setViewer({
      mode: 'lightbox',
      entry,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      originEl: el,
    })
  }, [])

  const enterEntry = useCallback(
    (entry: DirEntry): void => {
      if (entry.kind === 'dir' || entry.kind === 'zip') navigate(entry.path)
    },
    [navigate],
  )

  const onModelHover = useCallback(
    (p: string | null) => (p !== null ? hover.enter(p) : hover.leave()),
    [hover],
  )

  /**
   * What the shared commands act through (entry-actions R1). App supplies the
   * app-shaped halves — the one navigate, the one dispatch, the ephemeral mark,
   * tile activation, and somewhere to put a sentence — and the module owns what
   * each command does with them.
   */
  const actionHost = useMemo<ActionHost>(
    () => ({
      navigate,
      dispatch,
      markOnArrival: setPendingReveal,
      open: (entry, el) => {
        if (entry.kind !== 'model') {
          enterEntry(entry)
          return
        }
        // Every surface offering *open* raises it from a tile, so there is
        // always an element for the lightbox to grow out of.
        if (el !== null) openLightbox(entry, el)
      },
      confirm: () => say('Path copied.', 'ok'),
      // Read off the ref, not the state: the host is memoized and `viewer`
      // changes on every open and close, so depending on it here would rebuild
      // the host for a reason that has nothing to do with what it holds. Only
      // the lightbox reroutes — an orbit overlay covers one tile, not the bar.
      report: (message) => {
        if (viewerRef.current?.mode === 'lightbox') sayInViewer(message)
        else say(message, 'error')
      },
      poses,
      // The one filesystem path the client holds, for the one command that puts
      // a path somewhere else (library R2). A string, not the client: no command
      // gets to ask `/api/library` itself.
      libraryTop,
      // The thumbnail half: the one cache client, the mesh LRU the grid loads
      // through, the one render queue, and `useThumbnails`' own setter. Handed
      // over rather than reimplemented — App has no business resolving an
      // orientation, and the module has no business constructing any of these.
      api,
      lru,
      queue,
      setThumb,
      discardThumbFraming,
      // The launch half: App holds the session's report, so App is who can read
      // it again. The *when* belongs to the command — see `openEntryWith`.
      refreshApps,
    }),
    [
      navigate,
      dispatch,
      enterEntry,
      openLightbox,
      say,
      sayInViewer,
      poses,
      libraryTop,
      api,
      lru,
      queue,
      setThumb,
      discardThumbFraming,
      refreshApps,
    ],
  )

  const onEntryMenu = useCallback(
    (entry: DirEntry, el: HTMLElement | null, at: { x: number; y: number }): void => {
      setMenu({ entry, el, x: at.x, y: at.y, surface: 'tile' })
    },
    [],
  )
  /**
   * The same menu, raised on the live view of the model instead of its tile —
   * which is a different *surface*, not a different menu (D6's margin).
   *
   * Which viewer surface comes from `viewerRef` rather than from the caller:
   * the mode is this component's own fact, and `ViewerLayer` reporting it back
   * would be a second copy of something App already holds. Read from the ref so
   * this callback stays stable — it is a prop on the layer that would otherwise
   * change on every mode flip.
   */
  const onViewerEntryMenu = useCallback(
    (entry: DirEntry, el: HTMLElement | null, at: { x: number; y: number }): void => {
      const surface = viewerRef.current?.mode === 'lightbox' ? 'lightbox' : 'orbit'
      setMenu({ entry, el, x: at.x, y: at.y, surface })
    },
    [],
  )
  /** Dismissal returns focus to the tile the menu was raised on. */
  const closeMenu = useCallback((): void => {
    menuRef.current?.el?.focus()
    setMenu(null)
  }, [])
  const onChooseCommand = useCallback(
    (command: EntryCommand): void => {
      const raised = menuRef.current
      // Closed first: choosing is a dismissal, and a command that navigates
      // would otherwise leave the menu hanging over a listing it no longer
      // belongs to.
      closeMenu()
      if (raised !== null) command.run?.(raised.entry, actionHost, raised.el)
    },
    [closeMenu, actionHost],
  )
  /**
   * The menu's orbit-axis group (6.7): the spindle this model is stored about,
   * or `null` where the group is not offered — a container, or the lightbox,
   * which carries the live picker instead. The orbit overlay carries no picker
   * and gets the group, exactly as the tile under it does (6.8).
   *
   * Read from the thumbs map, which is what the tile drew and what the lightbox
   * would open at; a model that has never been given one is marked at the
   * default rather than at nothing, because that is the spindle it is framed
   * about. An orbit drag moves the camera and never the axis, so an overlay's
   * pending persist cannot make this mark wrong while it is in flight.
   */
  const menuAxis = useMemo<OrbitAxis | null>(() => {
    if (menu === null || !orbitAxisApplies(menu.entry, menuExcludes(menu.surface))) return null
    return thumbs.get(menu.entry.path)?.axis ?? DEFAULT_ORBIT_AXIS
  }, [menu, thumbs])
  /** An axis chosen from the menu: the shared body, through the one host. The
   *  spindle already in force goes with it — re-choosing it is a no-op, and that
   *  rule belongs to the command rather than to this surface. */
  const onChooseAxis = useCallback(
    (axis: OrbitAxis): void => {
      const raised = menuRef.current
      closeMenu()
      if (raised !== null && menuAxis !== null) {
        setOrbitAxis(raised.entry, actionHost, axis, menuAxis)
      }
    },
    [closeMenu, actionHost, menuAxis],
  )
  /**
   * The menu's open-in group (L3): the applications the platform associates
   * with this model's type, default first, or `null` where the row is not
   * offered — a container, a type with no applications, a report that has not
   * landed, or a surface that withholds it (none of the three menu surfaces
   * does; since the 4.3 reversal the lightbox's panel offers it too, through
   * `panelOpenIn` below).
   *
   * `null` rather than `[]` for an empty answer: a caption with no pills under
   * it is an affordance that does nothing, and this menu's rule is absence.
   *
   * Read from `apps`, which is state — raising this menu fires no request.
   */
  const menuOpenIn = useMemo(() => {
    if (menu === null) return null
    const list = openInApps(menu.entry, { index: state.index, apps }, menuExcludes(menu.surface))
    return list.length === 0 ? null : list
  }, [menu, state.index, apps])
  /** A pill pressed: the shared body, through the one host — a launch and
   *  nothing else, so unlike an axis pick there is no current value to hand it. */
  const onChooseApp = useCallback(
    (appId: string): void => {
      const raised = menuRef.current
      closeMenu()
      if (raised !== null) openEntryIn(raised.entry, actionHost, appId)
    },
    [closeMenu, actionHost],
  )
  // D6's table, asked once per raised menu — never a probe when a menu opens
  // (2.5), for either cell it reads: `state.index` is the reducer's own, and
  // `apps` is the session's one reading of the registry (L5).
  const menuCommands = useMemo(
    () =>
      menu === null
        ? []
        : commandsFor(menu.entry, { index: state.index, apps }, menuExcludes(menu.surface)),
    [menu, state.index, apps],
  )

  /**
   * The same table again, for the lightbox panel's own affordances (6.6) — a
   * third surface asking the one question, with its own exclusion list. Not the
   * menu's list: *reset framing* is withheld from the menu and offered here,
   * because only the panel's press carries the live-session semantics that make
   * it honest (`LIGHTBOX_PANEL_EXCLUDES` says why).
   */
  const panelCommands = useMemo(
    () =>
      viewer === null
        ? []
        : commandsFor(viewer.entry, { index: state.index, apps }, LIGHTBOX_PANEL_EXCLUDES),
    [viewer, state.index, apps],
  )
  /**
   * The panel's open-in row (L10, reversed 2026-08-25): the same question the
   * menu asks, through the same body, under the panel's own exclusion list —
   * which no longer withholds it. `null` rather than `[]` for an empty answer,
   * the menu's rule: a caption with no pills under it is an affordance that
   * does nothing. Read from `apps`, which is state — opening the lightbox
   * fires no registry request.
   */
  const panelOpenIn = useMemo(() => {
    if (viewer === null) return null
    const list = openInApps(viewer.entry, { index: state.index, apps }, LIGHTBOX_PANEL_EXCLUDES)
    return list.length === 0 ? null : list
  }, [viewer, state.index, apps])
  /** A panel pill pressed: the shared launch body through the one host — a
   *  launch and nothing else, exactly as the menu's press (the entry read from
   *  `viewerRef` the way `onViewerCommand` reads it, so the callback is stable). */
  const onPanelChooseApp = useCallback(
    (appId: string): void => {
      const entry = viewerRef.current?.entry
      if (entry === undefined) return
      openEntryIn(entry, actionHost, appId)
    },
    [actionHost],
  )
  /**
   * A panel affordance pressed: the shared body, through the one host — the
   * panel holds no command of its own, exactly as the menu does not.
   *
   * *Reset framing* is the one that takes the live view with it. Its body is a
   * different one from the menu's (`resetFramingLive` rather than the queued
   * render), which is the whole reason this surface may offer a command the
   * menu withholds.
   */
  const onViewerCommand = useCallback(
    (id: CommandId, live: LiveFramingView | null): void => {
      const entry = viewerRef.current?.entry
      if (entry === undefined) return
      if (id === 'resetFraming') {
        resetFramingLive(entry, actionHost, live)
        return
      }
      runCommand(id, entry, actionHost)
    },
    [actionHost],
  )

  function goUp(): void {
    // Ascend from `dest`, not the committed path (D3): pressing ↑ twice during
    // a slow listing must reach the grandparent, not re-request the same parent.
    const zipSep = target.lastIndexOf('!/')
    if (zipSep !== -1) {
      const entry = target.slice(zipSep + 2)
      const parent = entry.includes('/')
        ? target.slice(0, zipSep + 2) + entry.slice(0, entry.lastIndexOf('/'))
        : target.slice(0, zipSep)
      navigate(parent)
      return
    }
    const slash = target.lastIndexOf('/')
    if (slash > 0) navigate(target.slice(0, slash))
    else if (target !== '/') navigate('/')
  }

  const persist = useCallback(
    async (session: ViewerSession, opts: { camera?: boolean; posed?: boolean } = {}) => {
      const entry = viewer?.entry
      if (entry === undefined) return
      try {
        // Capture before the await: a rapid axis change mid-snapshot must not
        // pair this PNG with newer values in one PUT. The occlusion preference
        // is captured here for the same reason and one worse: two independent
        // readings would let a toggle between them file occluded pixels under
        // the unoccluded slot with matching labels — a wrong-recipe hit that
        // nothing invalidates, because both readings looked correct where they
        // stood (D4a). One value renders and files.
        //
        // The store, not the pill's React state of the same name above: the
        // store is what every other render path reads, and `persist` must not
        // be the one site whose recipe comes from a re-render's snapshot of it.
        const { state, axis } = session
        const ao = aoEnabled()
        const png = await session.snapshot(ao)
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
            // Omitted when this view records no decision of the user's — see
            // ViewerLayer's close path. An absent camera leaves whatever was
            // stored (nothing, for a posed model) rather than writing the
            // index's suggestion into their sidecar.
            camera: opts.camera === false ? undefined : state,
            axis: opts.camera === false ? undefined : axis,
            lighting: THUMB_LIGHTING,
            rig: RIG_VERSION,
            // The pose is an input to these pixels the cache key does not
            // carry, exactly like `rig`. Declining the camera usually says the
            // view was the index's and the user never touched it, so that same
            // condition labels the picture: unlabelled, the grid would read
            // these posed pixels as stale and render them a second time.
            //
            // Usually, not always — a framing reset that found no usable pose
            // also declines the camera while showing the default (D7's margin),
            // and labelling *that* would claim a pose these pixels never had.
            // The caller says so when the two come apart.
            posed: (opts.posed ?? opts.camera === false) ? POSE_VERSION : undefined,
            // The captured reading, not a second one — see above.
            ao,
          }),
        ])
        setThumb(entry.path, {
          status: 'ready',
          url,
          camera: opts.camera === false ? undefined : state,
          axis: opts.camera === false ? undefined : axis,
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
    // Safety net for dismissals that bypass the history routes (e.g. a mesh
    // load failure): never leave a dangling model param on a closed viewer.
    // Bridge 4 again — the live URL is patched, never projected.
    const v = parseUrl()
    if (v.model !== undefined) commitUrl({ ...v, model: undefined }, { replace: true })
    dispatch({ type: 'modelClose' })
    origin?.focus()
  }

  /**
   * One line, always present, so the grid starts at the same height in every
   * state — including the skeleton, whose tiles used to sit 56px above where
   * the real ones would land. What the view *is* reads on the left, what was
   * left out on the right: the first is the answer to "what am I looking at",
   * the second a caveat about it, and giving them opposite ends stops a long
   * query pushing the caveat off screen.
   */
  const noticeBar = (labelText: string, caveat: string, narrow = false) => (
    <div className="flex h-8 shrink-0 items-baseline justify-between gap-4 px-4 pt-3 text-xs">
      <div className="flex min-w-0 items-baseline gap-2">
        {/* The find control is otherwise Ctrl-F-or-nothing, which is invisible
            to anyone who does not try it — a regression against a filter that
            used to be a box on screen. */}
        {narrow && !findOpen && (
          <button
            type="button"
            onClick={openFind}
            title="Narrow these by name (Ctrl-F)"
            className="shrink-0 rounded px-1.5 text-zinc-500 hover:text-zinc-200"
          >
            ⌕ Narrow
          </button>
        )}
        <p className="min-w-0 truncate text-zinc-400">{labelText}</p>
        {/* The way out of a committed view, and the ONLY one on screen (D9).
            Beside the label because that is where the view says what it is
            about, so what it is about and how to stop being about it sit
            together. It dispatches the one transition emptying the input
            delegates to — the same act, not a second implementation of it —
            and it is rendered for a model exactly as for a phrase, which is
            the whole reason a similarity view is leaveable at all: there is no
            text in the input for it to empty.

            Where it goes is `leaveSubject`'s to decide, not this button's: an
            in-app similarity view returns to the view it came from, everything
            else clears to the listing as before (D9's provenance branch). */}
        {dismissable && (
          <button
            type="button"
            onClick={() => leaveSubject({ type: 'clearSubject' })}
            // One sentence for both destinations, because the button cannot
            // honestly promise either: where it lands is the entry's
            // provenance, and reading `history.state` during a render would
            // read it one render stale.
            title="Stop showing this and go back to browsing"
            className="shrink-0 rounded px-1.5 text-zinc-500 hover:text-zinc-200"
          >
            ✕ Dismiss
          </button>
        )}
      </div>
      <p className="shrink-0 text-amber-400">{caveat}</p>
    </div>
  )

  // A similarity view says what it is about too, and says it in terms of the
  // model rather than of a phrase it does not have — the blank this used to
  // render was the label failing to describe a view that is perfectly
  // describable. The `weak`/`capped` clauses are deliberately NOT repeated
  // here: they are meaning-query residue, the index publishes neither for
  // neighbours, and rendering them off `false` would tell the reader something
  // was measured and came out negative (4.7). Order carries strength (D10).
  const similarLabel =
    labelModel !== null && !searchHasNoMatches
      ? `Models similar to "${baseName(labelModel)}", from across the collection.`
      : ''
  const resultsLabel =
    labelQuery !== null && !searchHasNoMatches
      ? `${label.meaning ? 'Meaning matches' : 'Search results'} for "${labelQuery}".${
          // The set is weak, not the results: these are the best the index
          // found and none of them stood out (D10 — no per-result numbers).
          label.weak ? ' Nothing stood out — these are the closest.' : ''
        }${
          // Not the ranking's horizon (there is always an N+1th) but the
          // index's own ceiling, met by a bound the user set (D2).
          label.capped ? ' The index returned fewer than asked for — its cap.' : ''
        }${
          // What the user's own count cut from, which is a different act from
          // the index's ceiling above and says so in different words (D9).
          // Gated on *both* bounds being in force, not merely on the numbers
          // differing — `capping` carries why, in both directions: floorless,
          // `matched` is everything scored rather than a floor set, and
          // countless, the short set is the index's cap saying so twice.
          // Beyond that: only when the index reported `matched` and it
          // exceeds what is shown — equal means the count cut nothing, absent
          // means the index did not say — and never counted from the tiles,
          // which are the cut set itself.
          label.capping && label.matched !== undefined && label.matched > label.shown
            ? ` Showing ${label.shown} of ${label.matched} above the floor.`
            : ''
        }`
      : similarLabel
  // Counted over `kept`, not the whole listing: the kind option is part of the
  // view's identity — in the URL, in history, shareable — so a notice that
  // counted entries the option is hiding would describe a view nobody is
  // looking at. (The live filter is the opposite case and still does not enter
  // here: it is ephemeral, so the notice keeps describing the listing beneath
  // it.) Suppressed when the restriction leaves nothing, since `kindHidesAll`
  // already says what happened and "showing 0 folders" adds only noise.
  const shownModels = kept.filter((e) => e.kind === 'model').length
  const shownFolders = kept.length - shownModels
  // The kind option restricts search results only — `byKind` leaves a plain
  // listing alone — so the notice counts it the same way. Reading the stored
  // preference here regardless left the sentence with no parts at all under
  // `kinds=folders` with nothing committed ("Showing ; some entries were
  // omitted."), while the grid was in fact showing the models it denied.
  const counted = noticeKinds(state)
  const shownParts = [
    counted !== 'folders' ? `${shownModels} models` : '',
    counted !== 'models' && labelQuery !== null ? `${shownFolders} folders` : '',
  ].filter((part) => part !== '')
  const omittedNotice =
    truncated && !searchHasNoMatches && !kindHidesAll
      ? `Showing ${shownParts.join(' and ')}; some entries were omitted.`
      : ''
  // The three ways a grid ends up with nothing in it, each with its own
  // sentence. A value rather than a ternary chain inside the JSX because the
  // sentence no longer *replaces* the grid unconditionally: a similarity view's
  // anchor is still drawn above it, so the two are rendered independently.
  const emptyNotice = searchHasNoMatches ? (
    // An empty similarity answer is its own sentence, said in terms of the
    // model it was derived from. It is decided first because every branch below
    // is about a *phrase*: without it an empty similarity result rendered
    // `Nothing matched ""` — or, before the subject reached this gate at all,
    // fell through to Grid's bare "Nothing to show here" as though the folder
    // were empty.
    labelModel !== null ? (
      <p className="mt-16 text-center text-sm text-zinc-600">
        Nothing in the collection is similar to "{baseName(labelModel)}" — the index holds no
        neighbours for it.
      </p>
    ) : // An empty truncated search never finished: claiming "no match"
    // would be false — the walk ran out before covering the tree (D5).
    truncated ? (
      <p className="mt-16 text-center text-sm text-zinc-600">
        Nothing matched "{labelQuery}" in the part of the tree the search could cover — it ran out
        of budget before finishing. Try searching from a deeper folder.
      </p>
    ) : scope !== null ? (
      // Three outcomes, not one empty grid: nothing matched, nothing here is
      // indexed, or what is here is outside the corpus. Only the second is
      // fixed by indexing again (4.1).
      <p className="mt-16 text-center text-sm text-zinc-600">
        {scope.status === 'unindexed'
          ? `Nothing here has been indexed yet — meaning search covers ${scope.covers.join(', ')} files outside archives.`
          : `Nothing matched "${labelQuery}".${
              scope.status === 'partial'
                ? ` ${scope.indexed} of ${scope.scanned} models here are indexed.`
                : ''
            }`}
      </p>
    ) : (
      <p className="mt-16 text-center text-sm text-zinc-600">Nothing matched "{labelQuery}".</p>
    )
  ) : kindHidesAll ? (
    <p className="mt-16 text-center text-sm text-zinc-600">
      {counted === 'folders'
        ? 'No folders matched — the results are models only.'
        : 'No models matched — the results are folders only.'}
    </p>
  ) : filterHidesAll ? (
    <p className="mt-16 text-center text-sm text-zinc-600">The filter is hiding everything below.</p>
  ) : null

  /**
   * The header's one transient line, in one of two tones — a command reporting
   * that it did something, or a failure — so a brief report never needs a
   * surface of its own.
   *
   * A command's line outranks the view's failure while it is up, in either
   * tone: it is the newer news, it is about the thing the user just did, and
   * entry-actions requires a copy that succeeds to confirm *briefly* — where
   * an error-first rule swallowed that confirmation outright rather than
   * delaying it, for as long as the path bar had a failure standing. Nothing
   * is lost by the yield: `say` clears its line after ACTION_TEXT_MS, and the
   * view's own error is what the line falls back to.
   */
  const headerMessage: { text: string; tone: 'ok' | 'error' } | null =
    actionText ??
    // Above the view's own failure, because it explains it: while the library
    // is unconfigured or unmounted every path route answers 503, and the
    // route's sentence describes the symptom where this one names the cause and
    // the remedy (library R4). A command's line still outranks both, unchanged
    // — it is the newer news, and `say` clears it on its own.
    (libraryMessage !== null
      ? { text: libraryMessage, tone: 'error' }
      : error !== null
        ? { text: error, tone: 'error' }
        : null)

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* A block header around a flex row, so the transient line below can grow
          the header without touching the row. Drawn inside the row (it used to
          be PathBar's) it made that one item taller than the controls beside
          it, and `items-center` slid all of them down by half of it while the
          path input stayed put.

          `z-chrome` (index.css) is what the layer is for: the path bar's
          suggestion list hangs down over the grid, and a tile's score badges
          sit above the list's own `z-20`, so they painted straight through the
          recents. Lifting the header rather than the list puts any later
          popover in this row over the grid too. */}
      <header className="relative z-chrome border-b border-zinc-800 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goUp}
            disabled={target === '/'}
            aria-label="Parent directory"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
          >
            ↑
          </button>
          <PathBar path={target} api={api} onNavigate={navigate} />
          <input
            value={state.drafts.queryText}
            onChange={(e) => handleQueryTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSearch()
            }}
            placeholder="Search names and folders…"
            aria-label="Search names and folders"
            spellCheck={false}
            className="w-64 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          />
          <button
            type="button"
            onClick={submitSearch}
            disabled={state.drafts.queryText.trim() === ''}
            title="Search this folder and everything below it by name — files and folders"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
          >
            Search
          </button>
          <button
            type="button"
            onClick={toggleFlat}
            aria-pressed={live.flat}
            title="Show every model under this folder in one grid"
            className={`rounded-lg border px-3 py-2 text-sm ${
              live.flat
                ? 'border-sky-500 text-sky-400 hover:border-sky-400'
                : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            Flat
          </button>
        </div>
        {headerMessage !== null && (
          <p
            className={`mt-1 text-xs ${
              headerMessage.tone === 'error' ? 'text-red-400' : 'text-zinc-400'
            }`}
          >
            {headerMessage.text}
          </p>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        {/* `scrollbar-gutter: stable` keeps the gutter reserved whether or not
            this scrolls. Without it a listing that fits and one that does not
            differ by the scrollbar's ~15px, which is enough to drop the grid's
            auto-fill from 7 columns to 6 and resize every tile by ~29px. */}
        <main
          className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
          aria-busy={(libraryMessage === null && showSkeleton) || undefined}
        >
          {/* Nothing at all while the library is not there (library R4). Not a
              skeleton, which promises a listing that is not coming; not an
              "empty folder", which is a claim about a folder nobody could open.
              The header's line above is the whole answer, and the region under
              it stays empty so it is the only thing to read. */}
          {libraryMessage !== null ? null : showSkeleton ? (
            // The old tiles are stale navigation targets while a slower listing
            // is fetched — unmounting the grid is what makes them unclickable.
            // The notice line is rendered empty rather than omitted, so the
            // skeleton's tiles sit where the real ones will.
            <>
              {findOpen && (
                <FindBar
                  value={findText}
                  count={null}
                  focusSignal={findFocus}
                  onChange={setFindText}
                  onClose={closeFind}
                />
              )}
              {noticeBar('', '')}
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
                />
              )}
              {deferredSubject.kind !== 'none' && (
                <p className="px-4 pt-1 text-xs text-amber-400">
                  {/* The banner names the subject it is waiting on, and for a
                      similarity view that is a model rather than a phrase.
                      Deriving this from a query string showed no banner at all
                      for a deferred similarity link — the one state whose whole
                      purpose is to explain itself, explaining nothing. */}
                  {deferredSubject.kind === 'query' ? (
                    <>This view is a meaning search for &ldquo;{deferredSubject.text}&rdquo;</>
                  ) : (
                    <>
                      This view is the models similar to &ldquo;
                      {baseName(deferredSubject.model)}&rdquo;
                    </>
                  )}
                  , and the index is{' '}
                  {state.index?.state === 'warming' ? 'still starting up' : 'not answering'}. Showing
                  this folder meanwhile —{' '}
                  {/* Only the warming state is polled (the availability effect
                      re-reads on a path change and every 2s while warming), so
                      promising an absent index will be noticed the moment it
                      returns would be a promise nothing keeps. */}
                  {state.index?.state === 'warming'
                    ? 'it runs as soon as the index answers.'
                    : 'it runs if the index comes back, and searching again will look for it.'}{' '}
                  {/* Offered only for a phrase: substituting the name corpus
                      needs something to type at it, and a model is not text
                      (4.6a). A deferred similarity view's only offer is the
                      dismiss, which is the one control in the line below — a
                      second copy of it here would be the two-that-resemble-
                      each-other D9 refuses. */}
                  {deferredSubject.kind === 'query' && (
                    <button
                      type="button"
                      onClick={() => runDeferredByName()}
                      className="underline hover:text-amber-300"
                    >
                      Search names instead
                    </button>
                  )}
                </p>
              )}
              {noticeBar(resultsLabel, omittedNotice, entries.length > 0)}
              {/* The grid is replaced by a sentence only when there is nothing
                  left to show. A similarity view's subject is something: it
                  stays on screen above its own "nothing similar", which is the
                  one thing that sentence is about. */}
              {emptyNotice === null || anchor !== undefined ? (
                <Grid
                  entries={shownEntries}
                  thumbs={thumbs}
                  onEnter={enterEntry}
                  onModelPointerDown={onModelPointerDown}
                  onModelOpen={openLightbox}
                  onModelHover={onModelHover}
                  onEntryMenu={onEntryMenu}
                  markedPath={marked}
                  anchorPath={anchor?.path}
                  scoreFor={scoreFor}
                  scoreScale={scoreScale}
                  previews={previews}
                  onPeek={requestPeek}
                />
              ) : null}
              {emptyNotice}
            </>
          )}
        </main>
        <SidePanel
          query={liveQuery}
          similar={liveSimilar}
          onSimilarTuning={setSimilarTuning}
          path={target}
          folderMatching={live.folderMatching}
          kinds={live.kinds}
          mode={live.mode}
          tuning={live.tuning}
          onTuning={setTuning}
          index={state.index ?? { state: 'absent' }}
          scope={scope}
          onFolderMatching={setFolderMatching}
          onKinds={setKinds}
          onMode={setMode}
        />
      </div>
      {/* Corner pill: the SHIPPED ssao preference. The experimental picker it
          was built around is gone with the retired spindle-aligned rig — one
          orientation leaves nothing to choose — and the container outlived it. */}
      <div className="fixed bottom-3 left-3 z-50 flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/90 p-1 text-xs">
        {/* Ambient occlusion on/off — a per-profile performance preference the
            live view and thumbnails both follow, so handoff is seamless either
            way (ao-as-recipe-dimension) */}
        <button
          type="button"
          aria-pressed={ao}
          title="Ambient occlusion — turn off to speed up orbiting on weaker GPUs; thumbnails follow this setting and are cached under each"
          onClick={() => {
            setAoEnabled(!ao)
            setAoState(!ao)
          }}
          className={`rounded-full px-2.5 py-1 ${
            ao ? 'bg-sky-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          ssao
        </button>
      </div>
      {/* D6's table, whole: three items on a container, five on a model, and a
          sixth when the index is answering for the collection it sits in — less
          whatever the raising surface withholds, plus the orbit-axis group on a
          model tile. Which ones an entry offers, and which a surface declines,
          both live in `entryActions`, never here. */}
      {menu !== null && menuCommands.length > 0 && (
        <EntryMenu
          x={menu.x}
          y={menu.y}
          commands={menuCommands}
          axis={menuAxis === null ? null : { current: menuAxis, onChoose: onChooseAxis }}
          openIn={menuOpenIn === null ? null : { apps: menuOpenIn, onChoose: onChooseApp }}
          onChoose={onChooseCommand}
          onClose={closeMenu}
        />
      )}
      {viewer !== null && (
        <ViewerLayer
          viewer={viewer}
          actionError={viewerError}
          camera={thumbs.get(viewer.entry.path)?.camera}
          axis={thumbs.get(viewer.entry.path)?.axis}
          pose={poses[viewer.entry.path]}
          // Looked up the way `pose` is, and paired with the scale that names
          // it — the panel reports what the tile reported, from the same two
          // sources (D7).
          //
          // Through `scoreFor`, which is where the anchor guard lives: the panel
          // gets it by construction rather than by remembering, which is how it
          // came to be missing here in the first place.
          score={scoreFor(viewer.entry.path)}
          scoreScale={scoreScale}
          ao={ao}
          api={api}
          lru={lru}
          tracker={trackerRef.current}
          onPromote={() => setViewer((v) => (v !== null ? { ...v, mode: 'lightbox' } : v))}
          closeSignal={closeSignal}
          onCloseIntent={onViewerCloseIntent}
          onDismiss={closeViewer}
          onPersist={persist}
          onLoadError={() =>
            // Non-revoking, like the hook's own catches (third review FND-2):
            // a failed mesh load produced no replacement, so the tile keeps the
            // thumbnail it was showing behind the error state instead of having
            // it displaced and revoked.
            setThumb(viewer.entry.path, { status: 'error', url: thumbs.get(viewer.entry.path)?.url })
          }
          onEntryMenu={onViewerEntryMenu}
          menuOpen={menuOpenRef}
          panelCommands={panelCommands}
          libraryTop={libraryTop}
          openIn={panelOpenIn === null ? null : { apps: panelOpenIn, onChoose: onPanelChooseApp }}
          onCommand={onViewerCommand}
        />
      )}
    </div>
  )
}
