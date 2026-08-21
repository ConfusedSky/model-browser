import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type {
  DirEntry,
  IndexAvailability,
  IndexPose,
  LightingMode,
  SemanticScope,
} from '../../shared/types'
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
import { commitUrl, isLightboxEntry, LIGHTBOX_ENTRY, parseUrl, type UrlView } from './lib/urlState'
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
function optionsOf(view: UrlView): {
  folderMatching: boolean
  kinds: SearchKinds
  mode: SearchMode
  tuning: Tuning
} {
  if (view.q === undefined || view.q === '') {
    return {
      folderMatching: folderMatchingEnabled(),
      kinds: searchKinds(),
      mode: searchMode(),
      tuning: searchTuning(),
    }
  }
  return {
    folderMatching: view.folderMatching ?? true,
    kinds: view.kinds ?? 'both',
    mode: view.mode ?? 'name',
    // Absent means the default here too — a tuned link that omitted a field
    // must not pick up the reader's setting for it.
    tuning: { ...TUNING_DEFAULTS, ...view.tuning },
  }
}

/**
 * Whether two availability reads say the same thing. The warming poll asks
 * every 2s and each answer is a fresh object, so without this the whole app
 * re-renders on a probe that changed nothing. Every rendered field is
 * compared, `elapsed` included — the side panel counts the wait out loud.
 */
function sameAvailability(a: IndexAvailability | null, b: IndexAvailability): boolean {
  return (
    a !== null &&
    a.state === b.state &&
    a.collectionRoot === b.collectionRoot &&
    a.elapsed === b.elapsed &&
    a.detail === b.detail &&
    (a.covers ?? []).length === (b.covers ?? []).length &&
    (a.covers ?? []).every((c, i) => c === (b.covers ?? [])[i])
  )
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

  // Boot view (url-navigation D4): a URL carrying `path` wins over the
  // localStorage last-path; a bare URL keeps the last-path behavior and the
  // first commit seeds the URL via replaceState.
  const boot = useMemo(() => parseUrl(), [])
  const [path, setPath] = useState(boot.path ?? getLastPath)
  const [listing, setListing] = useState<DirEntry[]>([])
  const [flat, setFlat] = useState(boot.flat)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Three pieces of text, one job each — they shared two controls until
  // find-in-listing separated them.
  //
  // `queryText` is what is typed in the search input, submitted to become a
  // search. `query` is the last *committed* search (null otherwise); the input
  // keeps its text after submitting, so refining a query is editing rather
  // than retyping. `findText` narrows the rendered entries with zero requests
  // and is typed in the find control, which the user summons — it starts empty
  // in every state, including one restored from a URL, because a filter is
  // ephemeral view state and nothing in a URL describes one.
  const [queryText, setQueryText] = useState(boot.q ?? '')
  const [query, setQuery] = useState<string | null>(boot.q ?? null)
  const [findText, setFindText] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [findFocus, setFindFocus] = useState(0)
  // Read by the window-level Ctrl-F listener, which subscribes once and would
  // otherwise close over the viewer state as it was at mount.
  const viewerRef = useRef<ViewerState | null>(null)
  const findOpenRef = useRef(false)
  findOpenRef.current = findOpen
  // A `model` param waiting for its listing (deep link or history forward):
  // honored once the entry exists in a landed listing, silently dropped after
  // a successful listing that lacks it (url-navigation D3).
  const [pendingModel, setPendingModel] = useState<string | null>(boot.model ?? null)
  // Search options: the URL governs the view it names and is NOT written back
  // to storage — a link from someone else must not reconfigure this profile
  // (D2). See `optionsOf`: over a URL-named search, absent means the *default*,
  // not this profile's preference.
  const [folderMatching, setFolderMatchingState] = useState(optionsOf(boot).folderMatching)
  const [kinds, setKindsState] = useState<SearchKinds>(optionsOf(boot).kinds)
  const [mode, setModeState] = useState<SearchMode>(optionsOf(boot).mode)
  const [tuning, setTuningState] = useState<Tuning>(optionsOf(boot).tuning)
  // Availability of the semantic index, re-read on the interactions this app
  // already makes rather than on a timer of its own (D4/3.8).
  // `null` until the first probe answers — distinct from a known-absent index,
  // because a meaning link must wait for the answer rather than act on a guess.
  const [index, setIndex] = useState<IndexAvailability | null>(null)
  const [scope, setScope] = useState<SemanticScope | null>(null)
  const [weak, setWeak] = useState(false)
  // The index's own ceiling bit — distinct from a ranking's horizon (D2).
  const [capped, setCapped] = useState(false)
  // Orientations the index supplied for the tiles on screen. Advisory: a stored
  // axis wins, and applying one persists nothing (D5).
  const [poses, setPoses] = useState<Record<string, IndexPose>>({})
  // Read inside `fetchListing`, which is memoised on `api` alone: several
  // effects key off its identity, so the options travel by ref rather than
  // widening its deps and re-creating it whenever a control is touched.
  const matchingRef = useRef(folderMatching)
  const kindsRef = useRef(kinds)
  const modeRef = useRef(mode)
  const tuningRef = useRef(tuning)
  matchingRef.current = folderMatching
  kindsRef.current = kinds
  modeRef.current = mode
  tuningRef.current = tuning
  // Same mirror, for the view a *deferred* tuning query was scheduled against:
  // read at fire time to tell whether it is still the view on screen.
  const queryRef = useRef(query)
  const destRef = useRef<string | null>(null)
  queryRef.current = query
  // The meaning query in flight, and the deferred re-run waiting to become one.
  const semanticAbortRef = useRef<AbortController | null>(null)
  const tuningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(tuningTimerRef.current), [])
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [lighting, setLightingState] = useState<LightingMode>(getLightingMode)
  // AO preference pill state (persisted per browser profile, aoToggle.ts).
  const [ao, setAoState] = useState(aoEnabled)
  const trackerRef = useRef(new GestureTracker())

  const showSkeleton = useDelayedFlag(pending, SKELETON_DELAY_MS)
  const { thumbs, setThumb, setPlaceholder } = useThumbnails(listing, api, lru, queue, poses)
  placeholderRef.current = setPlaceholder

  // A flat walk can take seconds while a nested listing returns immediately,
  // so responses can land out of order — only the newest request may write.
  const requestRef = useRef(0)
  // The newest requested target, in flight or committed — reset to null on
  // failure so the toggle and ↑ fall back to the committed path instead of
  // re-chasing a destination that just failed. A still-pending request keeps
  // its claim: the user asked to go there, and later actions should follow.
  // State, not a ref: the path bar shows it the moment it is requested (D4),
  // so consecutive ↑ presses read as movement while the listing loads.
  const [target, setTarget] = useState<string | null>(null)

  // The query of the last listing that actually LANDED (null for a plain
  // listing) — what a failed search's label revert restores. `query` itself is
  // optimistic (set at submit), so reverting to a previous `query` could name
  // a search that never produced the results on screen.
  const landedQueryRef = useRef<string | null>(null)

  // Which request id is a history restoration (url-navigation D2). Never a
  // boolean held across the fetch: an ordinary commit landing mid-restore
  // must still push, and it is classified by its own id, not shared state.
  const restoreReqRef = useRef(0)
  // Whether any listing has landed yet — the deep-link `model` effect must
  // not judge (or drop) the param against the empty pre-boot listing.
  const hasLandedRef = useRef(false)
  // Set when the next lightbox open comes from history/deep-link restore, so
  // the mode-transition effect skips its push.
  const suppressViewerPushRef = useRef(false)
  // Increment to ask ViewerLayer to run its persisting close (url-navigation
  // D3: App cannot run the teardown — the session is private to ViewerLayer).
  const [closeSignal, setCloseSignal] = useState(0)

  const fetchListing = useCallback(
    (
      target: string,
      asFlat: boolean,
      q: string | null,
      onFail?: () => void,
      restore = false,
      /** Render without renaming the view — see the deferred-meaning comment. */
      keepUrl = false,
    ) => {
      const req = ++requestRef.current
      if (restore) restoreReqRef.current = req
      setTarget(target)
      setPending(true)
      void api
        // Sent only when off, so an ordinary request is identical to what it
        // was before the option existed — absence means the default at every
        // layer: this call, the query string, and the URL.
        .listDir(target, {
          flat: asFlat,
          q: q ?? undefined,
          folderMatching: matchingRef.current ? undefined : false,
        })
        .then((res) => {
          if (req !== requestRef.current) return
          landedQueryRef.current = q
          hasLandedRef.current = true
          setPending(false)
          setPath(target)
          setListing(res.entries)
          setTruncated(res.truncated === true)
          setError(null)
          pushRecent(target)
          // The view is real now — record it (url-navigation D1/D2). A
          // restoration replaces (back must not mint forward-erasing entries)
          // and keeps the URL's own `model`; a user navigation pushes, and any
          // lightbox is necessarily closed, so `model` drops.
          const restoring = req === restoreReqRef.current
          // `keepUrl`: the URL already names a view this app intends to render
          // and cannot yet — a meaning link opened before the index answers.
          // Overwriting it here would destroy the link rather than defer it.
          if (keepUrl) return
          // Options appear only alongside a committed query and only when not
          // the default: they describe which entries this view contains, and
          // over a plain listing they select nothing (D1/D4).
          const searching = q !== null && q !== ''
          commitUrl(
            {
              path: target,
              flat: asFlat,
              q: q ?? undefined,
              folderMatching: searching && !matchingRef.current ? false : undefined,
              kinds: searching && kindsRef.current !== 'both' ? kindsRef.current : undefined,
              mode: searching ? 'name' : undefined,
              model: restoring ? parseUrl().model : undefined,
            },
            { replace: restoring },
          )
        })
        .catch((err: unknown) => {
          if (req !== requestRef.current) return
          setPending(false)
          setError(err instanceof Error ? err.message : String(err))
          setTarget(null)
          onFail?.()
        })
    },
    [api],
  )

  /**
   * A meaning search. Shares the listing commit path's shape — same request
   * counter, same latest-wins, same skeleton — because the results replace the
   * grid and must behave like any other view that does (3.4).
   */
  const fetchSemantic = useCallback(
    (target: string, text: string, onFail?: () => void) => {
      const req = ++requestRef.current
      setTarget(target)
      setPending(true)
      // Latest-wins already ignores a superseded answer; aborting stops the
      // index computing it at all, which is what a run of tuning changes would
      // otherwise queue up behind the one query the user is waiting for.
      semanticAbortRef.current?.abort()
      const controller = new AbortController()
      semanticAbortRef.current = controller
      void api
        .semanticSearch(text, target, tuningRef.current, controller.signal)
        .then((res) => {
          if (req !== requestRef.current) return
          landedQueryRef.current = text
          hasLandedRef.current = true
          setPending(false)
          setPath(target)
          // Relevance order is the server's; the client sorts nothing (3.4).
          setListing(res.entries)
          setTruncated(false)
          setScope(res.scope)
          setWeak(res.weak)
          setCapped(res.capped)
          setPoses(res.poses)
          setError(null)
          commitUrl({
            path: target,
            flat: true,
            q: text,
            mode: 'meaning',
            tuning: tuningRef.current,
          })
        })
        .catch((err: unknown) => {
          if (req !== requestRef.current) return
          setPending(false)
          // A 503 carries the index's own state; re-read it so the affordance
          // and the message agree about what is wrong.
          void api.indexAvailability({ fresh: true }).then(setIndex, () => {})
          setError(err instanceof Error ? err.message : String(err))
          setTarget(null)
          onFail?.()
        })
    },
    [api],
  )

  const navigate = useCallback(
    (target: string) => {
      // Navigation is itself the request that clears search state (D2/D3) —
      // no extra fetch needed to drop a filter or a committed query. That
      // includes the options: a link's options governed the view it named, so
      // once the user leaves it their own stored preferences are in force again.
      setQueryText('')
      setFindText('')
      setFindOpen(false)
      setQuery(null)
      setScope(null)
      setWeak(false)
      setCapped(false)
      setPoses({})
      const own = { folderMatching: folderMatchingEnabled(), kinds: searchKinds() }
      setFolderMatchingState(own.folderMatching)
      setKindsState(own.kinds)
      matchingRef.current = own.folderMatching
      kindsRef.current = own.kinds
      fetchListing(target, flat, null)
    },
    [fetchListing, flat],
  )

  // The place the user most recently asked for, in flight or committed (D4).
  // Every header control keys off this one value: the bar shows it, ↑ ascends
  // from it (and disables at its root), the flat toggle re-requests it.
  const dest = target ?? path
  destRef.current = dest

  function toggleFlat(): void {
    const next = !flat
    setFlat(next)
    // Deep results are flat-shaped regardless of the toggle; pressing it
    // issues an ordinary request that supersedes the search by latest-wins,
    // so the query stops being "committed" the moment that happens (D4).
    setQuery(null)
    // The button reflects the request immediately so a second click reads as
    // "turn it back off", but a failed request must not leave it lit over a
    // grid that never changed — nor make every later navigation go flat.
    // Re-request the newest place the user asked for — not just the committed
    // path — so untoggling mid-navigation follows the user rather than
    // snapping back to where they started.
    if (dest !== '') fetchListing(dest, next, null, () => setFlat(!next))
  }

  function handleQueryTextChange(value: string): void {
    setQueryText(value)
    // Emptying the input while a query is committed is how a search is left —
    // it clears both states and re-issues the ordinary listing (file-search's
    // "Clearing a committed query" rule). This survived the filter moving out:
    // the input still holds the query, so emptying it still means "no search".
    if (value.trim() === '' && query !== null) {
      setQuery(null)
      fetchListing(dest, flat, null)
    }
  }

  /**
   * Run the deferred phrase as a name search. Offered rather than done for the
   * user: substituting the corpus is only honest when it was asked for, and
   * this is the asking. Being a user action, it may rename the view.
   */
  function runDeferredByName(): void {
    const q = deferred
    if (q === null) return
    setDeferred(null)
    setModeState('name')
    modeRef.current = 'name'
    setQuery(q)
    fetchListing(dest, true, q, () => setQuery(landedQueryRef.current))
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
   * that writes to storage (D2).
   */
  function setFolderMatching(on: boolean): void {
    setFolderMatchingEnabled(on)
    setFolderMatchingState(on)
    matchingRef.current = on
    if (query !== null) fetchListing(dest, true, query, () => setQuery(landedQueryRef.current))
  }

  /**
   * The mode decides which corpus a submit consults, so changing it with a
   * query committed re-runs that query there — search by name, find nothing,
   * flip, and the same words go to the index without being retyped (D2).
   */
  function setMode(next: SearchMode): void {
    setSearchMode(next)
    setModeState(next)
    modeRef.current = next
    if (query === null) return
    if (next === 'meaning' && index?.state === 'ready') {
      fetchSemantic(dest, query, () => setQuery(landedQueryRef.current))
    } else {
      setScope(null)
      setWeak(false)
      fetchListing(dest, true, query, () => setQuery(landedQueryRef.current))
    }
  }

  /**
   * Tuning shapes what the index returns, so changing it with a meaning query
   * committed re-runs that query — the same rule the mode and folder matching
   * follow. Trying a parameter is the point, and a setting that only applied to
   * the *next* search would make trying it a two-step.
   */
  function setTuning(next: Tuning, opts: { defer?: boolean } = {}): void {
    setSearchTuning(next)
    setTuningState(next)
    tuningRef.current = next
    // Whatever a previous change scheduled is superseded by this one, whether
    // this one waits or runs now.
    clearTimeout(tuningTimerRef.current)
    if (query === null || mode !== 'meaning' || index?.state !== 'ready') return
    const run = () => {
      // The view can move inside the debounce window — a navigation, another
      // search, a mode flip — and this re-run belongs to the view that
      // scheduled it. Firing it anyway would make it the newest request, so
      // latest-wins would hand it the grid and the URL, dragging the user back
      // to the view they just left.
      if (queryRef.current !== query || destRef.current !== dest || modeRef.current !== 'meaning') {
        return
      }
      fetchSemantic(dest, query, () => setQuery(landedQueryRef.current))
    }
    // A typed number arrives one keystroke at a time and every intermediate
    // value is a whole query the index would have to answer; a click on a
    // toggle is the finished value already, and waiting for it would only make
    // the control feel broken.
    if (opts.defer === true) tuningTimerRef.current = setTimeout(run, TUNING_DEBOUNCE_MS)
    else run()
  }

  /** The kind option only selects among entries already returned — no request. */
  function setKinds(next: SearchKinds): void {
    setSearchKinds(next)
    setKindsState(next)
    kindsRef.current = next
    // The URL names the view, and this changed which entries it shows.
    if (query !== null) {
      commitUrl({
        path,
        flat: true,
        q: query,
        folderMatching: folderMatching ? undefined : false,
        kinds: next === 'both' ? undefined : next,
        mode,
      })
    }
  }

  function submitSearch(): void {
    const q = queryText.trim()
    // A blank/whitespace-only submit is not a search (D1) — nothing to commit.
    if (q === '') return
    // The label reflects the request immediately, but a failed search must not
    // leave the grid — still showing whatever last landed — claiming to be its
    // results. Reverting to the last *landed* query (not the previous optimistic
    // one) keeps the label describing what is actually on screen even when two
    // in-flight searches fail on top of each other.
    setQuery(q)
    // Targeted at the newest requested directory, not the committed path, so
    // a search submitted mid-navigation follows the user there (D3).
    if (modeRef.current === 'meaning') {
      if (index?.state === 'ready') {
        fetchSemantic(dest, q, () => setQuery(landedQueryRef.current))
        return
      }
      // Asked for meaning, cannot run it: hold the request rather than answer a
      // different one, and let the URL name the view that was asked for.
      setDeferred(q)
      setQuery(null)
      setScope(null)
      setWeak(false)
      setCapped(false)
      setPoses({})
      commitUrl({ path: dest, flat: true, q, mode: 'meaning' })
      fetchListing(dest, flat, null, undefined, false, true)
      return
    }
    setScope(null)
    setWeak(false)
    setPoses({})
    fetchListing(dest, true, q, () => setQuery(landedQueryRef.current))
  }

  useEffect(() => {
    // Boot fetch (url-navigation D4): honors the URL's flat/q (navigate()
    // would clear them by design) and lands as a restoration, so the resolved
    // view is seeded into the URL via replaceState — pushed entries start
    // with the user's first real navigation.
    if (path === '') return
    // A meaning link fetches nothing here. The obvious thing — render the
    // ordinary listing while the index is asked — is wrong twice over on a URL
    // like `?path=/library&flat=1&q=…&mode=meaning`: `flat=1` came from the
    // search, so it lists the *whole volume*, and those hundreds of tiles
    // render and cache thumbnails at the default angle moments before the
    // meaning results arrive with orientations for the same models. The
    // deferred effect below waits for the one availability call and then either
    // runs the query or falls back — see it for what happens when it cannot.
    if (boot.mode === 'meaning' && boot.q !== undefined && boot.q !== '') {
      setPending(true)
      return
    }
    fetchListing(path, boot.flat, boot.q ?? null, undefined, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The shared renderer serves one purpose at a time: suspend the thumbnail
  // queue while an orbit overlay or lightbox is active.
  useEffect(() => {
    if (viewer !== null) queue.suspend()
    else queue.resume()
  }, [viewer, queue])

  // Re-read availability on mount and whenever a listing lands: the index is a
  // separate service that may start after this app did, and a warming one must
  // become usable without a reload. No timer of its own — these are the
  // interactions the app already makes (3.8).
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = (): void => {
      void api.indexAvailability().then(
        (s) => {
          if (!alive) return
          // Kept by identity when nothing about it changed: while the index
          // warms this re-reads every 2s, and a fresh object each tick
          // re-rendered the whole app — grid included — for an answer that
          // said the same thing.
          setIndex((prev) => (sameAvailability(prev, s) ? prev : s))
          // Warming is the one state that must re-check without being asked:
          // "the interactions the app already makes" is an empty set while a
          // user waits for SigLIP, because nothing they do changes the path.
          // The server's own per-state TTL makes this cheap.
          if (s.state === 'warming') timer = setTimeout(read, 2000)
        },
        () => {
          if (alive) setIndex({ state: 'absent' })
        },
      )
    }
    read()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [api, path])

  /**
   * A meaning search the app has been asked for and cannot run yet — from a
   * link, or from a submit while the index is down.
   *
   * It is *deferred*, not substituted. Running a name search for the same words
   * would answer a different question without being asked, and rewriting the
   * URL to name that answer would destroy the link: the recipient could not
   * retry it after starting the index, a reload would not help, and copying it
   * on would pass the substitution along. So the URL keeps naming the meaning
   * view, the grid shows the location's ordinary listing, a notice says which
   * of the two is on screen — and when the index becomes ready the query runs,
   * which is the link finally doing what it named (D2).
   */
  const [deferred, setDeferred] = useState<string | null>(
    boot.mode === 'meaning' && boot.q !== undefined && boot.q !== '' ? boot.q : null,
  )

  // Whether the ordinary listing has been drawn in place of a deferred query,
  // so it is fetched once rather than on every availability re-read.
  const standInRef = useRef(false)

  useEffect(() => {
    if (deferred === null || index === null) return // not probed yet: wait
    if (index.state === 'ready') {
      standInRef.current = false
      setDeferred(null)
      setQuery(deferred)
      fetchSemantic(dest, deferred, () => setQuery(landedQueryRef.current))
      return
    }
    if (standInRef.current) return
    standInRef.current = true
    // Cannot answer: stand in with the location's own contents. Nested, not
    // flat — the URL's `flat` belonged to the search being deferred, and
    // flattening a volume to fill time is the opposite of standing in.
    fetchListing(dest, false, null, undefined, true, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred, index?.state])

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

  // Live mirror for the popstate handler: subscribed once, it reads current
  // state through this ref instead of re-subscribing every render.
  const stateRef = useRef({ path, flat, query, viewer, listing, folderMatching, kinds, mode })
  stateRef.current = { path, flat, query, viewer, listing, folderMatching, kinds, mode }
  viewerRef.current = viewer

  /** Enter lightbox mode from history/deep-link restore — no tile element, no push. */
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

  useEffect(() => {
    function onPop(): void {
      const v = parseUrl()
      const cur = stateRef.current
      // Lightbox side (url-navigation D3): `model` gone while a lightbox is
      // open → ask ViewerLayer for its persisting close; `model` present with
      // no viewer → re-open without pushing (forward), if the entry is here.
      const openModel = cur.viewer?.mode === 'lightbox' ? cur.viewer.entry.path : undefined
      if (openModel !== undefined && v.model === undefined) {
        setCloseSignal((n) => n + 1)
      } else if (v.model !== undefined && v.model !== openModel) {
        const entry = cur.listing.find((e) => e.kind === 'model' && e.path === v.model)
        if (entry !== undefined) openRestoredLightbox(entry)
        else setPendingModel(v.model)
      }
      // Listing side (url-navigation D2): restore the composite view in one
      // request — not navigate(), which clears search state by design.
      if (v.path === undefined) return
      const q = v.q ?? null
      // Options are part of the view, so they decide whether this entry differs
      // — two entries that share a path and query but ran under different
      // options are different views, and comparing without them made Back
      // change the URL and nothing else.
      const opts = optionsOf(v)
      const changed =
        v.path !== cur.path ||
        v.flat !== cur.flat ||
        q !== cur.query ||
        opts.folderMatching !== cur.folderMatching ||
        opts.kinds !== cur.kinds ||
        opts.mode !== cur.mode
      if (changed) {
        setFlat(v.flat)
        setQuery(q)
        // The input shows the restored query; the filter is not part of the
        // view a URL names, so it starts empty here as everywhere else.
        setQueryText(v.q ?? '')
        setFindText('')
        setFindOpen(false)
        // Before the fetch: `fetchListing` reads the matching option through
        // its ref, so restoring after would request under the outgoing view's
        // options and land results the URL does not describe.
        setFolderMatchingState(opts.folderMatching)
        setKindsState(opts.kinds)
        setModeState(opts.mode)
        matchingRef.current = opts.folderMatching
        kindsRef.current = opts.kinds
        modeRef.current = opts.mode
        // The corpus is part of the view: restoring a meaning view by running a
        // name search would put different models under the same URL. When the
        // index cannot answer, the view is deferred rather than substituted —
        // the same rule a link gets.
        if (opts.mode === 'meaning' && q !== null) {
          setScope(null)
          setWeak(false)
          setPoses({})
          if (index?.state === 'ready') {
            setQuery(q)
            fetchSemantic(v.path, q)
          } else {
            setQuery(null)
            setDeferred(q)
            fetchListing(v.path, v.flat, null, undefined, true, true)
          }
          return
        }
        setScope(null)
        setWeak(false)
        setPoses({})
        fetchListing(v.path, v.flat, q, undefined, true)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [fetchListing, openRestoredLightbox])

  // A waiting `model` param (url-navigation D3): honored once its entry is in
  // a landed listing; dropped silently after a successful listing lacks it.
  useEffect(() => {
    if (pendingModel === null || pending || error !== null || !hasLandedRef.current) return
    const entry = listing.find((e) => e.kind === 'model' && e.path === pendingModel)
    if (entry !== undefined) openRestoredLightbox(entry)
    else commitUrl({ path, flat, q: query ?? undefined }, { replace: true })
    setPendingModel(null)
  }, [pendingModel, listing, pending, error, path, flat, query, openRestoredLightbox])

  // The lightbox history push hooks the transition INTO 'lightbox' mode, not
  // openLightbox — that function is the keyboard entrance only; the pointer
  // route promotes the orbit overlay in place (url-navigation D3).
  const prevModeRef = useRef<'orbit' | 'lightbox' | null>(null)
  useEffect(() => {
    const mode = viewer?.mode ?? null
    const prev = prevModeRef.current
    prevModeRef.current = mode
    if (mode !== 'lightbox' || prev === 'lightbox' || viewer === null) return
    const view = { path, flat, q: query ?? undefined, model: viewer.entry.path }
    if (suppressViewerPushRef.current) {
      // Restored from history or a deep link: the entry (if any) is the
      // browser's, not ours — record the view without minting one.
      suppressViewerPushRef.current = false
      // Preserve whatever state this entry already carries: a forward-restored
      // lightbox is sitting on the entry we originally pushed, marker included.
      commitUrl(view, { replace: true, state: window.history.state })
    } else {
      commitUrl(view, { state: LIGHTBOX_ENTRY })
    }
  }, [viewer, path, flat, query])

  // In-app close affordances route here (url-navigation D3): a lightbox whose
  // entry we pushed closes through history so ✕ and browser-back are one
  // path; a deep-linked one has nothing behind it — back would leave the app —
  // so its param drops via replaceState and the teardown is signalled direct.
  const onViewerCloseIntent = useCallback(() => {
    if (isLightboxEntry()) {
      window.history.back()
    } else {
      const v = parseUrl()
      if (v.model !== undefined) commitUrl({ ...v, model: undefined }, { replace: true })
      setCloseSignal((n) => n + 1)
    }
  }, [])

  // Pure view state over `listing` — never reaches useThumbnails, whose effect
  // resets the whole thumb map to `loading` on any `entries` identity change
  // (D2). Matches each entry's full `name`, which in flat/deep views is its
  // relative path, not the shortened tile label.
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
  const { byKind, filteredListing } = useMemo(() => {
    const byKind =
      query !== null && kinds !== 'both'
        ? listing.filter((e) => (kinds === 'folders' ? e.kind !== 'model' : e.kind === 'model'))
        : listing
    const filteredListing =
      needle === '' ? byKind : byKind.filter((e) => e.name.toLowerCase().includes(needle))
    return { byKind, filteredListing }
  }, [listing, needle, kinds, query])
  // A kind restriction can empty the grid too, and it is a different sentence:
  // the results are there, this view is not showing them. It is decided first
  // and from `byKind`, so the message names the control that actually hid the
  // entries rather than the one that happened to run last.
  const kindHidesAll = listing.length > 0 && byKind.length === 0
  const filterHidesAll = needle !== '' && byKind.length > 0 && filteredListing.length === 0
  const searchHasNoMatches = query !== null && listing.length === 0

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
    const zipSep = dest.lastIndexOf('!/')
    if (zipSep !== -1) {
      const entry = dest.slice(zipSep + 2)
      const parent = entry.includes('/')
        ? dest.slice(0, zipSep + 2) + entry.slice(0, entry.lastIndexOf('/'))
        : dest.slice(0, zipSep)
      navigate(parent)
      return
    }
    const slash = dest.lastIndexOf('/')
    if (slash > 0) navigate(dest.slice(0, slash))
    else if (dest !== '/') navigate('/')
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
    const v = parseUrl()
    if (v.model !== undefined) commitUrl({ ...v, model: undefined }, { replace: true })
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
  const noticeBar = (label: string, caveat: string, narrow = false) => (
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
        <p className="min-w-0 truncate text-zinc-400">{label}</p>
      </div>
      <p className="shrink-0 text-amber-400">{caveat}</p>
    </div>
  )

  const meaning = scope !== null
  const resultsLabel =
    query !== null && !searchHasNoMatches
      ? `${meaning ? 'Meaning matches' : 'Search results'} for "${query}".${
          // The set is weak, not the results: these are the best the index
          // found and none of them stood out (D10 — no per-result numbers).
          weak ? ' Nothing stood out — these are the closest.' : ''
        }${
          // Not the ranking's horizon (there is always an N+1th) but the
          // index's own ceiling, met by a bound the user set (D2).
          capped ? ' The index returned fewer than asked for — its cap.' : ''
        }`
      : ''
  // Counted over `byKind`, not the whole listing: the kind option is part of
  // the view's identity — in the URL, in history, shareable — so a notice that
  // counted entries the option is hiding would describe a view nobody is
  // looking at. (The live filter is the opposite case and still does not enter
  // here: it is ephemeral, so the notice keeps describing the listing beneath
  // it.) Suppressed when the restriction leaves nothing, since `kindHidesAll`
  // already says what happened and "showing 0 folders" adds only noise.
  const shownModels = byKind.filter((e) => e.kind === 'model').length
  const shownFolders = byKind.length - shownModels
  // The kind option restricts search results only — `byKind` leaves a plain
  // listing alone — so the notice counts it the same way. Reading the stored
  // preference here regardless left the sentence with no parts at all under
  // `kinds=folders` with nothing committed ("Showing ; some entries were
  // omitted."), while the grid was in fact showing the models it denied.
  const noticeKinds = query !== null ? kinds : 'both'
  const shownParts = [
    noticeKinds !== 'folders' ? `${shownModels} models` : '',
    noticeKinds !== 'models' && query !== null ? `${shownFolders} folders` : '',
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
          disabled={dest === '' || dest === '/'}
          aria-label="Parent directory"
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          ↑
        </button>
        <PathBar path={dest} error={error} api={api} onNavigate={navigate} />
        <input
          value={queryText}
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
          disabled={queryText.trim() === ''}
          title="Search this folder and everything below it by name — files and folders"
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          Deep
        </button>
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
        {/* `scrollbar-gutter: stable` keeps the gutter reserved whether or not
            this scrolls. Without it a listing that fits and one that does not
            differ by the scrollbar's ~15px, which is enough to drop the grid's
            auto-fill from 7 columns to 6 and resize every tile by ~29px. */}
        <main
          className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
          aria-busy={showSkeleton || undefined}
        >
          {path === '' && !showSkeleton ? (
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
                  {index?.state === 'warming' ? 'still starting up' : 'not answering'}. Showing this
                  folder meanwhile — it runs as soon as the index answers.{' '}
                  <button
                    type="button"
                    onClick={() => runDeferredByName()}
                    className="underline hover:text-amber-300"
                  >
                    Search names instead
                  </button>
                </p>
              )}
              {noticeBar(resultsLabel, omittedNotice, listing.length > 0)}
              {searchHasNoMatches ? (
                // An empty truncated search never finished: claiming "no match"
                // would be false — the walk ran out before covering the tree (D5).
                truncated ? (
                  <p className="mt-16 text-center text-sm text-zinc-600">
                    Nothing matched "{query}" in the part of the tree the search could cover — it
                    ran out of budget before finishing. Try searching from a deeper folder.
                  </p>
                ) : meaning ? (
                  // Three outcomes, not one empty grid: nothing matched, nothing
                  // here is indexed, or what is here is outside the corpus. Only
                  // the second is fixed by indexing again (4.1).
                  <p className="mt-16 text-center text-sm text-zinc-600">
                    {scope.status === 'unindexed'
                      ? `Nothing here has been indexed yet — meaning search covers ${scope.covers.join(', ')} files outside archives.`
                      : `Nothing matched "${query}".${
                          scope.status === 'partial'
                            ? ` ${scope.indexed} of ${scope.scanned} models here are indexed.`
                            : ''
                        }`}
                  </p>
                ) : (
                  <p className="mt-16 text-center text-sm text-zinc-600">
                    Nothing matched "{query}".
                  </p>
                )
              ) : kindHidesAll ? (
                <p className="mt-16 text-center text-sm text-zinc-600">
                  {kinds === 'folders'
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
          query={query}
          path={dest}
          folderMatching={folderMatching}
          kinds={kinds}
          mode={mode}
          tuning={tuning}
          onTuning={setTuning}
          index={index ?? { state: 'absent' }}
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
