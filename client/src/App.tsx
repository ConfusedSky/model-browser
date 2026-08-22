import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { DirEntry, IndexPose, LightingMode } from '../../shared/types'
import { HttpApiClient } from './api/client'
import FindBar from './components/FindBar'
import Grid from './components/Grid'
import SidePanel from './components/SidePanel'
import PathBar from './components/PathBar'
import { SKELETON_DELAY_MS, useDelayedFlag } from './hooks/useDelayedFlag'
import { useThumbnails } from './hooks/useThumbnails'
import { GestureTracker } from './lib/gesture'
import { createHoverWarmer } from './lib/hover'
import { fitSquareBox, type Box } from './lib/layout'
import { getLastPath, pushRecent } from './lib/recents'
import {
  folderMatchingEnabled,
  searchKinds,
  searchMode,
  searchTuning,
  setFolderMatchingEnabled,
  setSearchKinds,
  setSearchMode,
  setSearchTuning,
  TUNING_DEFAULTS,
  type SearchKinds,
  type SearchMode,
  type Tuning,
} from './lib/searchOptions'
import {
  commitUrl,
  isLightboxEntry,
  LIGHTBOX_ENTRY,
  parseUrl,
  serializeView,
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
import { sameListing, toUrlView, type Prefs, type View } from './state/view'
import { MeshLru } from './three/lru'
import { disposeModel, embedded3mfThumbnail, formatOf, geometryBytes, parseModel } from './three/models'
import { POSE_VERSION } from './three/pose'
import { RenderQueue } from './three/queue'
import { RIG_VERSION } from './three/renderer'
import ViewerLayer, { type ViewerState } from './viewer/ViewerLayer'
import { aoEnabled, setAoEnabled } from './viewer/aoToggle'
import { getLightingMode, LIGHTING_MODES, setLightingMode } from './viewer/lighting'
import type { ViewerSession } from './viewer/session'

/**
 * How long a typed tuning value waits before it becomes a query. Long enough
 * that a number typed digit by digit is one search rather than four, short
 * enough that a finished value still feels like it ran on its own.
 */
const TUNING_DEBOUNCE_MS = 300

/**
 * Stable empties for "nothing has landed yet". `useThumbnails` resets every
 * thumb to `loading` whenever the entries array changes identity (D2), so a
 * fresh `[]` per render would restart every lookup on every keystroke.
 */
const NO_ENTRIES: DirEntry[] = []
const NO_POSES: Record<string, IndexPose> = {}

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
    // must not pick up the reader's setting for it.
    tuning: { ...TUNING_DEFAULTS, ...view.tuning },
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
    path: url.path ?? getLastPath(),
    flat: url.flat,
    q: url.q ?? null,
    model: url.model ?? null,
    ...optionsOf(url),
  }
}

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
  // view (url-navigation D4): a URL carrying `path` wins over the localStorage
  // last-path; a bare URL keeps the last-path behavior and the first landing
  // seeds the URL via replaceState.
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
  /** The last view the projection wrote, as it wrote it. The URL can run ahead
   *  of the view — the browser rewinds it on Back while the restoration is
   *  still in flight — so "has anything been asserted since" is asked of what
   *  we projected, never of what the address bar currently says. */
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

  // The tuning re-run waiting to become a query. An effect handle, not state:
  // nothing renders it.
  const tuningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The view a debounced tuning re-run was scheduled for. The re-run belongs to
  // it, and the effect below drops the timer the moment it stops being the
  // question on screen.
  const tuningForRef = useRef<View | null>(null)
  useEffect(() => () => clearTimeout(tuningTimerRef.current), [])
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [lighting, setLightingState] = useState<LightingMode>(getLightingMode)
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
  const scope = state.result?.scope ?? null
  const truncated = state.result?.truncated === true
  const entries = state.result?.entries ?? NO_ENTRIES
  const poses = state.result?.poses ?? NO_POSES
  const deferred = state.phase === 'deferred' ? state.view.q : null
  const error = state.failure?.message ?? null

  const showSkeleton = useDelayedFlag(busy(state), SKELETON_DELAY_MS)
  const { thumbs, setThumb, setPlaceholder } = useThumbnails(entries, api, lru, queue, poses)
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
   * than assert, and writing the unadvanced view then is not a no-op after a
   * Back — the browser has already rewound the URL, so it would push the view
   * the user just left back on top of history.
   */
  useEffect(() => {
    const intent = urlIntent.current
    if (intent === null) return
    urlIntent.current = null
    const url = serializeView(toUrlView(state.view))
    if (url === projectedRef.current) return
    projectedRef.current = url
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
      urlIntent.current = { replace: requestSource === 'restore' }
      dispatch({ type: 'landing', id, forView, landed })
    }
    const fail = (err: unknown): void => {
      if (controller.signal.aborted) return
      dispatch({
        type: 'failure',
        id,
        forView,
        message: err instanceof Error ? err.message : String(err),
      })
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
            poses: res.poses,
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
      commit({ type: 'navigate', path, prefs: ownPrefs() })
    },
    [commit],
  )

  function toggleFlat(): void {
    // Deep results are flat-shaped regardless of the toggle; pressing it issues
    // an ordinary request that supersedes the search, so the query stops being
    // committed. Targeted at `dest` — the newest place the user asked for — so
    // untoggling mid-navigation follows the user rather than snapping back.
    if (target === '') return
    commit({ type: 'toggleFlat' })
  }

  function handleQueryTextChange(value: string): void {
    // Emptying the input while a query is committed is how a search is left: it
    // drops the query, cancels any deferral, and re-issues the ordinary listing
    // (file-search's "Clearing a committed query" rule). That cancel asserts the
    // view at dispatch, so it owns the URL; ordinary typing owns nothing.
    if (value.trim() === '' && live.query !== null) {
      commit({ type: 'queryText', text: value })
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
    if (state.phase !== 'deferred') return
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

  // Boot (url-navigation D4): one restore of the view the URL and the last-path
  // resolved to. It lands as a restoration, so the resolved view is seeded via
  // replaceState — pushed entries start with the user's first real navigation.
  // A meaning link fetches nothing here: the corpus decision reads the
  // availability probe from state, and until it answers the answer is `wait` —
  // rendering the ordinary listing meanwhile would flatten the whole volume for
  // tiles the meaning results are about to replace.
  useEffect(() => {
    if (state.view.path === '') return
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
      if (e.key === 'Escape' && findOpenRef.current && viewerRef.current === null) {
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
      if (v.path === undefined) return
      // The input shows the restored query; the filter is not part of the view
      // a URL names, so it starts empty here as everywhere else.
      setFindText('')
      setFindOpen(false)
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
  const kept = useMemo(() => byKind(state), [state.result])
  const filteredListing = useMemo(
    () => (needle === '' ? kept : kept.filter((e) => e.name.toLowerCase().includes(needle))),
    [kept, needle],
  )
  // A kind restriction can empty the grid too, and it is a different sentence:
  // the results are there, this view is not showing them. It is decided first
  // and from `kept`, so the message names the control that actually hid the
  // entries rather than the one that happened to run last.
  const kindHidesAll = entries.length > 0 && kept.length === 0
  const filterHidesAll = needle !== '' && kept.length > 0 && filteredListing.length === 0
  const searchHasNoMatches = label.query !== null && entries.length === 0

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
    async (session: ViewerSession, opts: { camera?: boolean } = {}) => {
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
            // Omitted when this view records no decision of the user's — see
            // ViewerLayer's close path. An absent camera leaves whatever was
            // stored (nothing, for a posed model) rather than writing the
            // index's suggestion into their sidecar.
            camera: opts.camera === false ? undefined : state,
            axis: opts.camera === false ? undefined : axis,
            lighting,
            rig: RIG_VERSION,
            // The pose is an input to these pixels the cache key does not
            // carry, exactly like `rig`. Declining the camera is what says the
            // view was the index's and the user never touched it, so the same
            // condition labels the picture: unlabelled, the grid would read
            // these posed pixels as stale and render them a second time.
            posed: opts.camera === false ? POSE_VERSION : undefined,
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
      </div>
      <p className="shrink-0 text-amber-400">{caveat}</p>
    </div>
  )

  const resultsLabel =
    label.query !== null && !searchHasNoMatches
      ? `${label.meaning ? 'Meaning matches' : 'Search results'} for "${label.query}".${
          // The set is weak, not the results: these are the best the index
          // found and none of them stood out (D10 — no per-result numbers).
          label.weak ? ' Nothing stood out — these are the closest.' : ''
        }${
          // Not the ranking's horizon (there is always an N+1th) but the
          // index's own ceiling, met by a bound the user set (D2).
          label.capped ? ' The index returned fewer than asked for — its cap.' : ''
        }`
      : ''
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
    counted !== 'models' && label.query !== null ? `${shownFolders} folders` : '',
  ].filter((part) => part !== '')
  const omittedNotice =
    truncated && !searchHasNoMatches && !kindHidesAll
      ? `Showing ${shownParts.join(' and ')}; some entries were omitted.`
      : ''

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-2 border-b border-zinc-800 p-3">
        <button
          type="button"
          onClick={goUp}
          disabled={target === '' || target === '/'}
          aria-label="Parent directory"
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          ↑
        </button>
        <PathBar path={target} error={error} api={api} onNavigate={navigate} />
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
          Deep
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
      </header>
      <div className="flex min-h-0 flex-1">
        {/* `scrollbar-gutter: stable` keeps the gutter reserved whether or not
            this scrolls. Without it a listing that fits and one that does not
            differ by the scrollbar's ~15px, which is enough to drop the grid's
            auto-fill from 7 columns to 6 and resize every tile by ~29px. */}
        <main
          className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
          aria-busy={showSkeleton || undefined}
        >
          {target === '' && !showSkeleton ? (
            <p className="mt-24 text-center text-sm text-zinc-500">
              Enter a directory path above to browse your models.
            </p>
          ) : showSkeleton ? (
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
              {deferred !== null && (
                <p className="px-4 pt-1 text-xs text-amber-400">
                  This view is a meaning search for &ldquo;{deferred}&rdquo;, and the index is{' '}
                  {state.index?.state === 'warming' ? 'still starting up' : 'not answering'}. Showing
                  this folder meanwhile — it runs as soon as the index answers.{' '}
                  <button
                    type="button"
                    onClick={() => runDeferredByName()}
                    className="underline hover:text-amber-300"
                  >
                    Search names instead
                  </button>
                </p>
              )}
              {noticeBar(resultsLabel, omittedNotice, entries.length > 0)}
              {searchHasNoMatches ? (
                // An empty truncated search never finished: claiming "no match"
                // would be false — the walk ran out before covering the tree (D5).
                truncated ? (
                  <p className="mt-16 text-center text-sm text-zinc-600">
                    Nothing matched "{label.query}" in the part of the tree the search could cover —
                    it ran out of budget before finishing. Try searching from a deeper folder.
                  </p>
                ) : scope !== null ? (
                  // Three outcomes, not one empty grid: nothing matched, nothing
                  // here is indexed, or what is here is outside the corpus. Only
                  // the second is fixed by indexing again (4.1).
                  <p className="mt-16 text-center text-sm text-zinc-600">
                    {scope.status === 'unindexed'
                      ? `Nothing here has been indexed yet — meaning search covers ${scope.covers.join(', ')} files outside archives.`
                      : `Nothing matched "${label.query}".${
                          scope.status === 'partial'
                            ? ` ${scope.indexed} of ${scope.scanned} models here are indexed.`
                            : ''
                        }`}
                  </p>
                ) : (
                  <p className="mt-16 text-center text-sm text-zinc-600">
                    Nothing matched "{label.query}".
                  </p>
                )
              ) : kindHidesAll ? (
                <p className="mt-16 text-center text-sm text-zinc-600">
                  {counted === 'folders'
                    ? 'No folders matched — the results are models only.'
                    : 'No models matched — the results are folders only.'}
                </p>
              ) : filterHidesAll ? (
                <p className="mt-16 text-center text-sm text-zinc-600">
                  The filter is hiding everything below.
                </p>
              ) : (
                <Grid
                  entries={filteredListing}
                  thumbs={thumbs}
                  onEnter={enterEntry}
                  onModelPointerDown={onModelPointerDown}
                  onModelOpen={openLightbox}
                  onModelHover={onModelHover}
                />
              )}
            </>
          )}
        </main>
        <SidePanel
          query={live.query}
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
      {/* Corner pill: the EXPERIMENTAL lighting-mode picker (remove those buttons
          once a winner is chosen) plus the SHIPPED ssao preference — the container
          outlives the lighting experiment. */}
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
        {/* Ambient occlusion on/off, live view only — a per-profile performance preference */}
        <span className="h-4 w-px bg-zinc-700" />
        <button
          type="button"
          aria-pressed={ao}
          title="Ambient occlusion in the live view — turn off to speed up orbiting on weaker GPUs; thumbnails keep the shipped recipe"
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
      {viewer !== null && (
        <ViewerLayer
          viewer={viewer}
          camera={thumbs.get(viewer.entry.path)?.camera}
          axis={thumbs.get(viewer.entry.path)?.axis}
          pose={poses[viewer.entry.path]}
          lighting={lighting}
          ao={ao}
          api={api}
          lru={lru}
          tracker={trackerRef.current}
          onPromote={() => setViewer((v) => (v !== null ? { ...v, mode: 'lightbox' } : v))}
          closeSignal={closeSignal}
          onCloseIntent={onViewerCloseIntent}
          onDismiss={closeViewer}
          onPersist={persist}
          onLoadError={() => setThumb(viewer.entry.path, { status: 'error' })}
        />
      )}
    </div>
  )
}
