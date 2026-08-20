import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { DirEntry, LightingMode } from '../../shared/types'
import { HttpApiClient } from './api/client'
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
  setFolderMatchingEnabled,
  setSearchKinds,
  type SearchKinds,
} from './lib/searchOptions'
import { commitUrl, isLightboxEntry, LIGHTBOX_ENTRY, parseUrl, type UrlView } from './lib/urlState'
import { MeshLru } from './three/lru'
import { disposeModel, embedded3mfThumbnail, formatOf, geometryBytes, parseModel } from './three/models'
import { RenderQueue } from './three/queue'
import { RIG_VERSION } from './three/renderer'
import ViewerLayer, { type ViewerState } from './viewer/ViewerLayer'
import { aoEnabled, setAoEnabled } from './viewer/aoToggle'
import { getLightingMode, LIGHTING_MODES, setLightingMode } from './viewer/lighting'
import type { ViewerSession } from './viewer/session'

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
function optionsOf(view: UrlView): { folderMatching: boolean; kinds: SearchKinds } {
  if (view.q === undefined || view.q === '') {
    return { folderMatching: folderMatchingEnabled(), kinds: searchKinds() }
  }
  return { folderMatching: view.folderMatching ?? true, kinds: view.kinds ?? 'both' }
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
  // `filter` is live typed text, narrowing rendered entries with zero
  // requests; `query` is the last *committed* deep search (set on submit,
  // null otherwise). Kept apart so typing over deep results filters them
  // client-side without re-searching (D2).
  const [filter, setFilter] = useState(boot.q ?? '')
  const [query, setQuery] = useState<string | null>(boot.q ?? null)
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
  // Read inside `fetchListing`, which is memoised on `api` alone: several
  // effects key off its identity, so the options travel by ref rather than
  // widening its deps and re-creating it whenever a control is touched.
  const matchingRef = useRef(folderMatching)
  const kindsRef = useRef(kinds)
  matchingRef.current = folderMatching
  kindsRef.current = kinds
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [lighting, setLightingState] = useState<LightingMode>(getLightingMode)
  // AO preference pill state (persisted per browser profile, aoToggle.ts).
  const [ao, setAoState] = useState(aoEnabled)
  const trackerRef = useRef(new GestureTracker())

  const showSkeleton = useDelayedFlag(pending, SKELETON_DELAY_MS)
  const { thumbs, setThumb, setPlaceholder } = useThumbnails(listing, api, lru, queue)
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
    (target: string, asFlat: boolean, q: string | null, onFail?: () => void, restore = false) => {
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

  const navigate = useCallback(
    (target: string) => {
      // Navigation is itself the request that clears search state (D2/D3) —
      // no extra fetch needed to drop a filter or a committed query. That
      // includes the options: a link's options governed the view it named, so
      // once the user leaves it their own stored preferences are in force again.
      setFilter('')
      setQuery(null)
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

  function handleFilterChange(value: string): void {
    setFilter(value)
    // Emptying the input while a query is committed is how deep search is
    // left — it clears both states and re-issues the ordinary listing (D2/D3).
    if (value.trim() === '' && query !== null) {
      setQuery(null)
      fetchListing(dest, flat, null)
    }
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
      })
    }
  }

  function submitSearch(): void {
    const q = filter.trim()
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
    fetchListing(dest, true, q, () => setQuery(landedQueryRef.current))
  }

  useEffect(() => {
    // Boot fetch (url-navigation D4): honors the URL's flat/q (navigate()
    // would clear them by design) and lands as a restoration, so the resolved
    // view is seeded into the URL via replaceState — pushed entries start
    // with the user's first real navigation.
    if (path !== '') fetchListing(path, boot.flat, boot.q ?? null, undefined, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The shared renderer serves one purpose at a time: suspend the thumbnail
  // queue while an orbit overlay or lightbox is active.
  useEffect(() => {
    if (viewer !== null) queue.suspend()
    else queue.resume()
  }, [viewer, queue])

  const hover = useMemo(() => createHoverWarmer((p) => lru.warm(p)), [lru])

  // Live mirror for the popstate handler: subscribed once, it reads current
  // state through this ref instead of re-subscribing every render.
  const stateRef = useRef({ path, flat, query, viewer, listing, folderMatching, kinds })
  stateRef.current = { path, flat, query, viewer, listing, folderMatching, kinds }

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
        opts.kinds !== cur.kinds
      if (changed) {
        setFlat(v.flat)
        setQuery(q)
        setFilter(v.q ?? '')
        // Before the fetch: `fetchListing` reads the matching option through
        // its ref, so restoring after would request under the outgoing view's
        // options and land results the URL does not describe.
        setFolderMatchingState(opts.folderMatching)
        setKindsState(opts.kinds)
        matchingRef.current = opts.folderMatching
        kindsRef.current = opts.kinds
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
  const needle = filter.trim().toLowerCase()
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
  const noticeBar = (label: string, caveat: string) => (
    <div className="flex h-8 shrink-0 items-baseline justify-between gap-4 px-4 pt-3 text-xs">
      <p className="min-w-0 truncate text-zinc-400">{label}</p>
      <p className="shrink-0 text-amber-400">{caveat}</p>
    </div>
  )

  const resultsLabel = query !== null && !searchHasNoMatches ? `Search results for "${query}".` : ''
  const omittedNotice =
    truncated && !searchHasNoMatches
      ? `Showing ${listing.filter((e) => e.kind === 'model').length} models${
          query !== null ? ` and ${listing.filter((e) => e.kind !== 'model').length} folders` : ''
        }; some entries were omitted.`
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
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSearch()
          }}
          placeholder="Filter, or search names and folders…"
          aria-label="Filter, or search names and folders"
          spellCheck={false}
          className="w-64 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
        />
        <button
          type="button"
          onClick={submitSearch}
          disabled={filter.trim() === ''}
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
              {noticeBar(resultsLabel, omittedNotice)}
              {searchHasNoMatches ? (
                // An empty truncated search never finished: claiming "no match"
                // would be false — the walk ran out before covering the tree (D5).
                truncated ? (
                  <p className="mt-16 text-center text-sm text-zinc-600">
                    Nothing matched "{query}" in the part of the tree the search could cover — it
                    ran out of budget before finishing. Try searching from a deeper folder.
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
                  onModelHover={(p) => (p !== null ? hover.enter(p) : hover.leave())}
                />
              )}
            </>
          )}
        </main>
        <SidePanel
          query={query}
          folderMatching={folderMatching}
          kinds={kinds}
          onFolderMatching={setFolderMatching}
          onKinds={setKinds}
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
