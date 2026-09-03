import { useCallback, useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import type {
  CameraState,
  DirEntry,
  IndexPose,
  LightingMode,
  OrbitAxis,
  ThumbRenderInfo,
} from '../../../shared/types'
import type { ApiClient } from '../api/client'
import { DEFAULT_CAMERA } from '../three/camera'
import type { MeshLru } from '../three/lru'
import { cameraForPose, POSE_VERSION } from '../three/pose'
import { RenderQueue, type Band } from '../three/queue'
import { RIG_VERSION, renderThumbnail, THUMB_LIGHTING } from '../three/renderer'

export interface ThumbState {
  status: 'loading' | 'ready' | 'error'
  url?: string
  camera?: CameraState
  axis?: OrbitAxis
  /**
   * The server write generation these pixels answer for, when the writer knows
   * it (`immutable-thumbnail-serving` D4). `setThumb` adopts it as the slot's
   * `thumbGen` — and adopts its *absence* too: a write that cannot name its
   * generation invalidates the one the slot had learned, because the entry's
   * next fetch must not ask under a number some out-of-hook PUT just outdated.
   * An immutable-cached answer at a stale number is served by the browser
   * without ever reaching the server, so the stale-gen tier cannot catch it —
   * clearing here is what keeps that tier reachable.
   */
  gen?: number
}

/**
 * Cache lookups are pure I/O and must not occupy a render-queue slot — a fully
 * cached directory fills at the speed of the cache, not renderer concurrency.
 * Module-level so a superseded listing's in-flight lookups share the limit
 * with its successor's, which is exactly why queued lookups must stay
 * cancellable: a dead listing's 500 lookups would otherwise block its
 * successor's.
 *
 * A `RenderQueue` rather than a plain limiter since `thumbnail-image-serving`
 * §0: lookups are ranked by the same band map that ranks renders, so a visible
 * tile's answer is never queued behind off-screen ones. Ranked, not held — a
 * far tile's lookup runs after everything nearer, but it does run, because
 * the capability's own text says a recipe change consults every entry's
 * cache "at once whatever its position", and a held lookup would leave a far
 * tile showing the old recipe until approached. Never suspended: `App`
 * suspends only the render queue it created and holds no reference to this
 * one.
 */
let lookupQueue = new RenderQueue(8)

/** Test seam: drop the module-level queue's pending lookups and ranking, so
 *  a pending lookup one cell leaves behind is not dispatched during the next. */
export function resetLookupQueueForTests(): void {
  lookupQueue.clear()
  lookupQueue = new RenderQueue(8)
}

/**
 * Release a URL a tile was showing — if it is one this hook can release. Only
 * an object URL is (`thumbnail-image-serving` D3): an image URL is a string
 * naming the server's route, owned by nobody, and revoking it is a no-op the
 * browser would only log. Decided by scheme, because a tile holds either over
 * its life — drawn from the listing at an image URL, re-rendered to a `blob:`.
 */
function release(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * The client's usability test for a cached render — the one predicate,
 * applied to a `getThumb` answer and to a listing entry's annotation alike,
 * so the two cannot drift (`thumbnail-image-serving` D2/D3). The labels are
 * compared against the client's own constants, which the server never
 * interprets; `poseStale` is the pose's own rule: only where nothing of the
 * user's is stored does the index's opinion make an un-posed render stale.
 */
function usable(
  labels: { lighting?: LightingMode; rig?: number; posed?: number },
  camera: CameraState | undefined,
  axis: OrbitAxis | undefined,
  pose: IndexPose | undefined,
): boolean {
  const poseStale =
    pose !== undefined && camera === undefined && axis === undefined && labels.posed !== POSE_VERSION
  return labels.lighting === THUMB_LIGHTING && labels.rig === RIG_VERSION && !poseStale
}

/**
 * One entry's lifecycle, held in a ref that outlives the sweep effect.
 *
 * It cannot live in the effect's closure: React runs an effect's cleanup before
 * *every* re-run, so per-entry flags created there are torn down together
 * however fine-grained they are — which is the whole reason a re-run used to
 * mean "reset every tile". Held here, the effect body can *reconcile* the new
 * entry list against the work already in flight and touch only what moved.
 *
 * Keyed by path; identity is path **and** `mtime` — the cache key — so a
 * same-path new-mtime entry is a removal followed by an addition on the one
 * key, in that order.
 */
interface EntrySlot {
  /** The entry this slot answers for; its `mtime` is half the cache key. */
  entry: DirEntry
  /**
   * Bumped on every retirement. The work a start issued captures this value and
   * compares it, so a retired pass can neither write the cache nor paint: the
   * generation is (identity, effective preference, pose), and a change in any
   * of them retires what is running.
   */
  generation: number
  /** The occlusion recipe this slot's current generation was started under. */
  ao: boolean
  /** The index's opinion this generation was started under, kept for by-value comparison. */
  pose: IndexPose | undefined
  /** Cancel handles for this generation's in-flight work. */
  cancels: (() => void)[]
  /**
   * The server's **write** generation for this entry, as last reported by a GET
   * or a PUT of this hook's own (`immutable-thumbnail-serving` D4). Passed on
   * the next fetch for this entry, which is what earns a cacheable answer.
   *
   * Not to be confused with `generation` above, which is this slot's
   * *retirement* counter and a purely client-side affair. These two numbers
   * share nothing: one is bumped by `retire`, the other only ever arrives from
   * the server.
   *
   * `undefined` until something says otherwise, and never persisted — a fresh
   * session simply rides the validator tier until its first answer teaches it
   * one. Entry-level, matching the server's own scoping, so it survives an
   * occlusion toggle: the number describes the entry, not the render.
   */
  thumbGen: number | undefined
  /**
   * The URL the tile is displaying. An object URL here is one this hook owns —
   * including URLs minted *outside* the hook and handed in through `setThumb`
   * (`App`'s `persist`, `entryActions`' re-render) — and ownership lives here
   * rather than in a hook-private list precisely so those cannot leak while
   * the hook revokes its own superseded ones. An image URL (drawn from the
   * listing) is held the same way and released by `release`, which knows the
   * difference.
   */
  url: string | undefined
  /**
   * The listing generation whose image URL this tile asked for and could not
   * load (`thumbnail-image-serving` D3) — an entry evicted between emission
   * and fetch, or a pulled disk. Remembered so the next `start` for this slot
   * (a pose wave, a toggle) does not rebuild the same URL and fail again; a
   * listing naming a *different* generation is a new fact and is tried.
   */
  refusedGen: number | undefined
}

/**
 * Stop this slot's work without touching what its tile is showing.
 *
 * Module-level rather than local to the sweep effect because `setThumb` retires
 * too: a state that answers for a tile has to stop everything older that could
 * still answer for it, and that rule is not the sweep's alone.
 */
function retire(slot: EntrySlot): void {
  slot.generation++
  const cancels = slot.cancels
  slot.cancels = []
  for (const cancel of cancels) cancel()
}

function sameVec3(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/**
 * Whether two index poses say the same thing — **by value, never by reference**.
 *
 * `poses` is rebuilt on every landing (a meaning search replaces `entries` and
 * `poses` together), so reference comparison would report every tile's pose as
 * changed on every landing and re-look-up the whole grid — against the
 * requirement's "an entry whose opinion is unchanged SHALL issue nothing".
 */
function samePose(a: IndexPose | undefined, b: IndexPose | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (!sameVec3(a.up, b.up) || !sameVec3(a.azimuth_zero, b.azimuth_zero)) return false
  if (a.source !== b.source || a.confidence !== b.confidence) return false
  if (a.front === null || b.front === null) return a.front === b.front
  return (
    a.front.view === b.front.view &&
    a.front.azimuth_deg === b.front.azimuth_deg &&
    a.front.elevation_deg === b.front.elevation_deg
  )
}

/** Whether two band maps say the same thing — `setBands`' cheap-when-equal
 *  early exit compares by value, since the grid republishes a fresh map
 *  identity on every observer batch and every find-filter keystroke. */
function sameBands(a: ReadonlyMap<string, Band>, b: ReadonlyMap<string, Band>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [path, band] of a) if (b.get(path) !== band) return false
  return true
}

/**
 * Whether a cached render is the one this build would draw — **the** staleness
 * test, and the only one.
 *
 * Extracted rather than restated because three readers ask it and they must
 * never disagree about what is stale: the sweep's own hit branch below, the
 * bulk generate job's derivation over an enumerated scope
 * (`bulk-thumbnail-jobs` D8), and the listing-annotation branch
 * `thumbnail-image-serving` 2.2 adds. It deliberately reads the client's
 * constants — `THUMB_LIGHTING`, `RIG_VERSION`, `POSE_VERSION` — which the
 * server stores and echoes but never interprets, so the judgement stays where
 * the recipe is.
 *
 * The pose clause is the one that needs saying. A pose is an input to the
 * pixels that path+mtime does not carry — the same shape as a RIG_VERSION
 * bump. Without it, a thumbnail rendered before the index had an opinion keeps
 * its default angle forever, and the orientation appears only once the user
 * opens the model and the lightbox's close persists a posed snapshot. It
 * applies only where nothing of the user's is stored, because that is the only
 * case a re-render poses: with a stored camera or axis the render computes
 * `posed = null` and PUTs unlabelled pixels, so the label could never arrive
 * and every visit re-rendered and re-uploaded the same picture. A stored
 * camera wins over the index's opinion anyway (semantic-search D5) — there is
 * nothing stale about pixels that already show it.
 *
 * `camera` and `axis` are the entry's stored orientation, not the render's;
 * `render` is the one variant in force (the occlusion recipe being asked
 * about). An absent render is not current, which is what a `miss` on an
 * annotation that carries no block for the variant means.
 */
export function isCurrentRender(
  render: ThumbRenderInfo | undefined,
  camera: CameraState | undefined,
  axis: OrbitAxis | undefined,
  pose: IndexPose | undefined,
): boolean {
  // The recipe half is `usable` — the sweep's own test, landed by
  // `thumbnail-image-serving` 2.2 — so the two cannot drift; this adds only
  // the presence half, which an annotation states as `state` and a lookup as
  // `status`.
  return render !== undefined && render.state === 'hit' && usable(render, camera, axis, pose)
}

/**
 * Per-tile thumbnail pipeline: check the server cache (own concurrency limit),
 * and on miss/stale run load → parse → render → PUT through the render queue.
 * Meshes load through the LRU, so thumbnail bytes seed later orbits.
 */
export function useThumbnails(
  entries: DirEntry[],
  api: ApiClient,
  lru: MeshLru<THREE.Object3D>,
  queue: RenderQueue,
  /**
   * The effective ambient-occlusion preference — the recipe every lookup,
   * render and PUT below names. A **primitive**, and passed in rather than read
   * from `aoToggle`'s store, for two reasons: `App` already holds this value in
   * state for the pill and the viewer, so there is no second source of truth
   * (D1); and an equal value must not re-trigger the sweep, which an object
   * rebuilt per render would (that is the failure that turns a toggle into a
   * render loop).
   */
  ao: boolean,
  /**
   * Orientations the semantic index supplied for these entries. Used only when
   * the cache holds no camera or axis of its own: the index's opinion is a
   * default, never an override of the user's (semantic-search D5).
   */
  poses: Record<string, IndexPose> = {},
  /**
   * What "a different listing is on screen" means for the band ranking's
   * reset — App's own `entries`, the landing's array. Not `entries` above,
   * which is `thumbEntries`: that is rebuilt whenever a folder peek lands (the
   * preview models are appended to it), and a reset keyed on it wiped the
   * ranking at exactly the moment the user had stopped scrolling and the
   * peeks answered — every pending job fell back to listing order until the
   * next scroll (2026-09-02 review, F1). Defaults to `entries` for callers
   * that have no separate listing.
   */
  listingKey: unknown = entries,
) {
  const [thumbs, setThumbs] = useState<Map<string, ThumbState>>(new Map())
  const slotsRef = useRef<Map<string, EntrySlot>>(new Map())
  // `startRef` — the sweep effect's own `start`, published for `refetch` below
  // and for the survivor re-read — is declared beside the far gate further
  // down; both readers want the same ref, and it is a ref rather than a hoist
  // so the effect's closure and dependency array stay exactly as they are.

  const setThumb = useCallback((path: string, state: ThumbState) => {
    const slot = slotsRef.current.get(path)
    // No slot is no entry, and a write for an entry the listing no longer has
    // is stale by definition. The outside writers (`App`'s `persist`,
    // `entryActions`' commands) are not registered on any slot's cancels, so
    // one of them can still be working on a path a navigation already removed.
    // Accepting that write would strand both halves of it: the `thumbs` entry
    // it creates is deleted by nothing (the removal loop walks slots) and the
    // URL it carries is revoked by nothing (disposal walks slots too). Release
    // what it minted and leave the state alone.
    if (slot === undefined) {
      if (state.url !== undefined) release(state.url)
      return
    }
    // Revoke the URL this state displaces, whoever minted it — the hook's own
    // renders and the two outside writers alike. Safe against the tile's <img>
    // still pointing at it for one commit: the image is already decoded.
    if (slot.url !== undefined && slot.url !== state.url) release(slot.url)
    slot.url = state.url
    // The generation travels with the write, absence included: an external
    // writer that did not (or could not) plumb its PUT echo leaves `undefined`
    // here, which demotes the entry's next fetch to the validator tier instead
    // of letting an immutable-cached response answer for bytes a write just
    // replaced (the pinning hole the 2026-09-02 review confirmed). The hook's
    // own passes hand back the value they already learned, so for them this
    // assignment is a no-op.
    slot.thumbGen = state.gen
    // This state is the tile's answer now, so nothing older may still answer
    // for it. An outside write does not go through the sweep and so retires
    // nothing by itself: a tail queued behind a suspended queue — rendering at
    // the camera *its* lookup captured — would otherwise land afterwards,
    // replace the newer image, revoke its URL, and pair old-angle pixels with
    // the fresh camera in the cache, a wrong-picture hit nothing invalidates.
    // Retiring here fails that tail's `alive()` before its PUT and before it
    // paints — for a tail still queued or between awaits. One residue remains
    // (the class tasks.md 2.3 records for preference changes): a tail that
    // passed its pre-PUT check before this write lands still files its PUT —
    // cancellation cannot reach an in-flight await — so old-angle pixels can
    // land in the cache after the newer camera write; the paint is still
    // suppressed, and the mismatched render heals on its next camera write. Safe for the hook's own writers by construction: every internal
    // `setThumb` is the last act of its pass, and the one handle this runs
    // ahead of them — `dropStale` — is idempotent.
    retire(slot)
    setThumbs((prev) => {
      const next = new Map(prev)
      next.set(path, state)
      return next
    })
  }, [])

  /**
   * Start this path's pipeline over from scratch, blank tile and all — the
   * in-memory half of a write somebody else made to the entry on the server
   * (`bulk-thumbnail-jobs` 1.3's reset).
   *
   * It exists because **nothing restarts a slot on a server-side write**. The
   * sweep effect reconciles entries, so it restarts one only on an add, an
   * mtime change, an `ao` change or a pose change by value — a bulk reset
   * changes none of those, and an on-screen tile in its scope would otherwise
   * sit showing pixels the server has already deleted, until the next
   * navigation.
   *
   * It blanks rather than keeps the image, which is the opposite of the
   * keep-until-replaced rule the rest of this hook follows, and that is
   * accepted rather than accidental (`bulk-thumbnail-jobs` D3): those pixels
   * were just deleted for lying — they were drawn under a framing that has
   * been discarded — so leaving them up would be showing a picture the write
   * has ruled false. One tile can be redrawn in place; a scope cannot, so the
   * blank is what a bulk reset costs an on-screen tile until the lookup below
   * refills it.
   *
   * A path with no slot is a no-op: a tile off screen is simply not in the
   * map, and inventing a slot would start work for an entry this listing does
   * not have.
   */
  const refetch = useCallback((path: string) => {
    const slot = slotsRef.current.get(path)
    if (slot === undefined) return
    // Everything in flight for this entry was started against the state the
    // write replaced; a tail of it landing afterwards would paint the deleted
    // render back.
    retire(slot)
    if (slot.url !== undefined) release(slot.url)
    slot.url = undefined
    // The entry's annotation is the listing's word from BEFORE the write that
    // brought us here, so it still says the render is there. `start` trusts an
    // annotation first (the listing-drawn branch), and its seeded state would
    // point an image URL at pixels the server just deleted — and be returned to
    // a caller that has nothing to do with it, leaving the tile on "loading"
    // forever (found live, 2026-09-02). Refuse the annotation's generation, the
    // same word `reportImageError` uses for an annotation the image route
    // contradicted, so the restart goes through the lookup.
    slot.refusedGen = slot.entry.thumb?.gen
    // The entry's generation moved under us and the caller may not know where
    // to — the same reasoning as `setThumb`'s adoption of absence and
    // `discardThumbFraming`'s clearing. The next lookup rides the validator
    // tier rather than letting an immutable-cached answer stand for bytes a
    // write just deleted.
    slot.thumbGen = undefined
    setThumbs((prev) => {
      const next = new Map(prev)
      next.set(path, { status: 'loading' })
      return next
    })
    // The same per-slot start the reconciler runs for a new entry, so the
    // lookup and — on a miss — the queued render happen exactly as a visit's
    // would, at the band the tile is in.
    startRef.current?.(slot.entry, slot)
  }, [])

  /**
   * Give up the framing a tile is carrying without touching its pixels — the
   * in-memory half of *reset framing* pressed from the open lightbox
   * (entry-context-menu D7's margin).
   *
   * `setThumb` cannot express this: it replaces the whole entry, and the
   * caller has no URL to put back. Nor should it mint one — the lightbox's
   * closing persist redraws this tile from the re-framed view, so a render
   * here would be a second one nobody asked for.
   *
   * A path with nothing in the map is left alone: there is nothing to discard,
   * and inventing a `ready` entry with no image would blank the tile.
   */
  const discardThumbFraming = useCallback((path: string, dropAxis: boolean) => {
    // The discard's PUT (resetFramingLive's, pixel-less) moved the entry's
    // generation on the server, and its echo is not plumbed this far — so the
    // learned number is stale the moment this runs. Cleared for the same
    // reason `setThumb` adopts absence: the next fetch must revalidate rather
    // than let an immutable-cached answer stand for a discarded framing.
    const slot = slotsRef.current.get(path)
    if (slot !== undefined) slot.thumbGen = undefined
    setThumbs((prev) => {
      const cur = prev.get(path)
      if (cur === undefined) return prev
      if (cur.camera === undefined && (!dropAxis || cur.axis === undefined)) return prev
      const next = new Map(prev)
      next.set(path, { ...cur, camera: undefined, axis: dropAxis ? undefined : cur.axis })
      return next
    })
  }, [])

  /** Placeholder hook for the LRU loader (embedded 3MF previews). */
  const setPlaceholder = useCallback((path: string, url: string) => {
    // Ownership is decided here, outside the updater, mirroring `setThumb`'s
    // shape — slot first, then a pure map write. An updater is a function React
    // may replay, so it must be a pure function of `prev`; assigning `slot.url`
    // inside one also let an interleave write the preview into state without it
    // ever joining ownership (the slot had taken a URL already), which is a
    // decoded PNG nothing releases.
    const slot = slotsRef.current.get(path)
    // Not this hook's to show: the entry left, or the tile already owns an
    // image. The LRU loader mints the preview and keeps no handle of its own
    // (`App`'s `MeshLru` factory), so returning without revoking leaks it.
    if (slot === undefined || slot.url !== undefined) {
      release(url)
      return
    }
    // Joins the slot's ownership like any other displayed URL, so the render
    // that replaces this preview revokes it instead of leaking a decoded PNG
    // per embedded thumbnail.
    slot.url = url
    setThumbs((prev) => {
      // The state guard stays here — a stale decision must not overwrite a
      // landed render — and it can still refuse what the slot just accepted: a
      // tile sitting in a bare `{status:'error'}` owns no URL, so the check
      // above passes where this one does not. The slot is then left owning a
      // URL its tile never displayed, and that is deliberate: ownership is
      // exactly what every release path walks, so the preview is still revoked
      // by the next displacing `setThumb`, by the reconciler's removal loop,
      // and by the unmount disposal. Detecting the case would cost either an
      // impure updater or a second, staler copy of `thumbs` outside it — both
      // worse than a URL that is owned but unshown for as long as a tile stays
      // in error.
      const cur = prev.get(path)
      if (cur === undefined || cur.status !== 'loading' || cur.url !== undefined) return prev
      const next = new Map(prev)
      next.set(path, { ...cur, url })
      return next
    })
  }, [])

  /**
   * The band map last accepted — kept only so a republished-but-equal map
   * costs nothing (the grid republishes a fresh identity per observer batch
   * and per find-filter keystroke), and reset per listing below. Nothing reads
   * it at commit time: position ranks work, it never withholds it (D4).
   */
  const bandsRef = useRef<ReadonlyMap<string, Band>>(new Map())
  const lastListingRef = useRef<unknown>(null)

  /**
   * Replace the visibility ranking wholesale — the grid's report, forwarded
   * through App (D2/D3). Contract: idempotent and **cheap when equal**,
   * latest-wins per path, safe at scroll-settle frequency, and it re-ranks
   * *without* a sweep-effect re-run: a `bands` argument beside `ao` and
   * `poses` was rejected because the dependency array is what triggers the
   * reconciler's walk over every entry, and bands change on every scroll
   * settle — a 500-entry reconcile per scroll for a signal the reconciler
   * does not read (D3). A path absent from the map is unreported, **never
   * far** — only an explicit `far` report defers (D1/D3).
   */
  /**
   * The one writer of a ranking: both queues take the same map, so a lookup
   * can never be held by a verdict the render queue has already forgotten.
   * Both `setBands` and the per-listing reset below go through it.
   */
  const applyRanking = useCallback(
    (bands: ReadonlyMap<string, Band>) => {
      bandsRef.current = bands
      queue.setRanking(bands)
      lookupQueue.setRanking(bands)
    },
    [queue],
  )

  const setBands = useCallback(
    (bands: ReadonlyMap<string, Band>) => {
      if (sameBands(bandsRef.current, bands)) return
      applyRanking(bands)
    },
    [applyRanking],
  )

  /**
   * Far renders yield to pending lookups for nearer tiles (D5): the render
   * queue's far gate reads the lookup queue, and every lookup that settles
   * pokes the render queue in case it was the last nearer one. Both cleared
   * on unmount so a module-level queue never points at a dead render queue.
   */
  useEffect(() => {
    queue.setFarGate(() => lookupQueue.pendingNearerThanFar() === 0)
    lookupQueue.onSettle(() => queue.poke())
    return () => {
      queue.setFarGate(null)
      lookupQueue.onSettle(null)
    }
  }, [queue])

  /**
   * The current sweep's `start`, for the image-error path below, which runs
   * from an `<img>` event long after the effect that defined `start` ran.
   */
  const startRef = useRef<((entry: DirEntry, slot: EntrySlot) => ThumbState | undefined) | null>(null)

  /**
   * A tile drawn from the listing could not load its image (D3): the entry
   * was evicted between emission and fetch, or the library is unmounted. The
   * tile goes back to loading and the entry takes the lookup path, with the
   * refused generation remembered on the slot so nothing rebuilds the same
   * URL. Never the error state: a 404 for an image is not a failed model.
   *
   * Only an image URL can fail this way. An error reported for a `blob:` URL
   * — or for a tile whose state has already moved on — is not this path's.
   */
  const reportImageError = useCallback((path: string) => {
    const slot = slotsRef.current.get(path)
    if (slot === undefined || slot.url === undefined || slot.url.startsWith('blob:')) return
    if (startRef.current === null) return
    slot.refusedGen = slot.entry.thumb?.gen
    slot.url = undefined
    retire(slot)
    // The restart can only take the lookup path — the refusal just recorded
    // is what its annotation branch checks against — and a lookup never
    // answers synchronously, so this seed is raced by nothing `start` writes
    // (D3's ordering, from the other side).
    startRef.current(slot.entry, slot)
    setThumbs((prev) => {
      const next = new Map(prev)
      next.set(path, { status: 'loading' })
      return next
    })
  }, [])

  useEffect(() => {
    const slots = slotsRef.current
    // A new listing starts unreported: the previous listing's verdicts must
    // not order this one's work (a same-path survivor included) until its own
    // grid reports. Keyed on `listingKey`, never on `entries` — see its doc.
    if (lastListingRef.current !== listingKey) {
      lastListingRef.current = listingKey
      applyRanking(new Map())
    }
    const models = entries.filter((e) => e.kind === 'model')
    const wanted = new Map(models.map((e) => [e.path, e]))
    const removed: string[] = []
    const added: string[] = []
    /**
     * Tiles the listing itself answered (D3): their state is seeded in the
     * same updater as the added-entry placeholders, never through `setThumb`
     * — that batch would overwrite a synchronous write, and with nothing
     * pushed to any queue the tile would then spin forever.
     */
    const answered = new Map<string, ThumbState>()

    /**
     * Start (or restart) this slot's pass. Returns the tile's state when the
     * listing's annotation answers it outright — a render the entry vouches
     * for, usable under the client's own constants — and then pushes nothing;
     * otherwise pushes the lookup and returns undefined.
     */
    function start(entry: DirEntry, slot: EntrySlot): ThumbState | undefined {
      const generation = slot.generation
      const pose = slot.pose
      /**
       * Whether this pass is still the one that should answer for this tile.
       * Two gates on one fact: the slot must still be the map's — an unmount
       * clears the map — and still on the generation that issued this work.
       */
      const alive = (): boolean =>
        slotsRef.current.get(entry.path) === slot && slot.generation === generation

      // The listing's answer, where it has one (D2/D3): the recipe-in-force
      // variant reads `hit`, the client's predicate passes, and this slot has
      // not already been refused an image at this generation. The URL names
      // the entry's generation, so the browser can pin it; the slot learns
      // the generation exactly as a lookup would teach it.
      const info = entry.thumb
      const variant = info === undefined ? undefined : ao ? info.ao : info.noao
      if (
        info !== undefined &&
        variant?.state === 'hit' &&
        info.gen !== slot.refusedGen &&
        usable(variant, info.camera, info.axis, pose)
      ) {
        const url = api.thumbImageUrl(entry.path, entry.mtime, ao, info.gen)
        if (slot.url !== undefined && slot.url !== url) release(slot.url)
        slot.url = url
        slot.thumbGen = info.gen
        return { status: 'ready', url, camera: info.camera, axis: info.axis, gen: info.gen }
      }

      slot.cancels.push(
        lookupQueue.push(async () => {
          if (!alive()) return
          try {
            // The occlusion recipe this entry is looked up, rendered and filed
            // under — one value for the whole pass, so the request and the
            // write that answers it cannot name two different renders (D4/D4a).
            // A toggle mid-load retires this pass rather than bending it.
            // Named only when known, mirroring the URL rule one level up: a
            // slot that has learned nothing asks exactly the call every pass
            // made before generations existed, rather than a fourth argument
            // spelling out its ignorance.
            const cached = await (slot.thumbGen === undefined
              ? api.getThumb(entry.path, entry.mtime, ao)
              : api.getThumb(entry.path, entry.mtime, ao, slot.thumbGen))
            if (!alive()) {
              // The lookup already minted an object URL for a tile that no
              // longer exists — release it rather than leak the decoded PNG.
              if (cached.pngUrl !== undefined) release(cached.pngUrl)
              return
            }
            // Adopted **after** the gate: only a pass that still answers for
            // this tile may say what generation the tile is keyed at.
            //
            // The first version learned it before the gate, reasoning that a
            // generation is a fact about the entry on the server rather than
            // about the pass — which holds only while both passes see the same
            // server state, and a write between them is exactly what breaks
            // that. After a `refetch` (a bulk reset's in-memory half) the
            // pre-write lookup can land *after* the restart's: adopting from a
            // retired pass would overwrite the new number with the deleted
            // entry's, the next fetch would ask under the stale one, and the
            // browser's immutable cache would answer it for bytes the server
            // has already deleted — without the server ever seeing the request
            // (`bulk-thumbnail-jobs` Stage A2 review). The cost is what the old
            // reasoning was protecting against: a replacement pass re-learns
            // the number, paying one revalidation. That is the cheap side.
            if (cached.gen !== undefined) slot.thumbGen = cached.gen
            // The one staleness test, shared with the bulk job and the
            // annotation readers — see `isCurrentRender`, which carries the
            // reasoning that used to live here.
            if (
              cached.status === 'hit' &&
              cached.pngUrl !== undefined &&
              usable(cached, cached.camera, cached.axis, pose)
            ) {
              setThumb(entry.path, {
                status: 'ready',
                url: cached.pngUrl,
                camera: cached.camera,
                axis: cached.axis,
                gen: slot.thumbGen,
              })
              return
            }
            // A hit carrying the retired spindle-aligned label (or none — a
            // pre-lighting entry) is stale pixels over good camera state: re-render, but keep the old
            // PNG until the replacement exists — a failed tail falls back to
            // it rather than degrading a previously fine tile to an error.
            let staleUrl = cached.pngUrl
            const dropStale = () => {
              if (staleUrl !== undefined) {
                release(staleUrl)
                staleUrl = undefined
              }
            }
            // A cancelled or retired job never runs — cleanup must release the
            // URL. Registered on the slot, so a retirement drops this lookup's
            // stale PNG while leaving the tile's *displayed* URL alone.
            slot.cancels.push(dropStale)
            // Only the miss/stale tail touches the shared renderer — it alone
            // goes through the queue. Registered synchronously after the
            // `alive` check above, so cleanup always sees this handle.
            // Keyed by path so the queue can rank it by the tile's band; a
            // far tile's job simply waits behind everything nearer and is
            // taken when nothing nearer is pending (D4).
            const cancelRender = queue.push(async () => {
              if (!alive()) return dropStale()
              try {
                  // In-flight jobs must not parse or drive the shared renderer
                  // while an orbit/lightbox is active — wait out the
                  // suspension first.
                  await queue.whenResumed()
                  if (!alive()) return dropStale()
                  const object = await lru.acquire(entry.path)
                  if (!alive()) return dropStale()
                  await queue.whenResumed()
                  if (!alive()) return dropStale()
                  // Nothing stored for this model: render it the way the index
                  // says it stands rather than at the default three-quarter
                  // view. The grid is where most models are looked at, so an
                  // orientation that only reached the viewer was an
                  // orientation almost nobody saw.
                  //
                  // Deliberately not persisted as camera/axis — the putThumb
                  // below sends pixels only. The index's opinion produces the
                  // picture without becoming the user's stored orientation, so
                  // their own orbit still wins and a re-classification is not
                  // locked out by this render.
                  const posed =
                    cached.camera === undefined && cached.axis === undefined
                      ? cameraForPose(pose, DEFAULT_CAMERA)
                      : null
                  const camera = cached.camera ?? posed?.camera ?? DEFAULT_CAMERA
                  const axis = cached.axis ?? posed?.axis ?? 'y'
                  const png = await renderThumbnail(object, camera, axis, ao)
                  // Above the PUT, not only below it. `queue.suspend()` cannot
                  // stop a job that already started (`whenResumed`'s own note),
                  // so a retired pass reaches this line with pixels drawn under
                  // the outgoing setting. `ao-as-recipe-dimension` made that
                  // write key-*correct* — it lands under its own recipe — but
                  // writing it still lets the outgoing pass overwrite the tile
                  // the incoming one is settling, which the delta's scenario
                  // forbids in as many words ("without the first pass's renders
                  // landing on top of it").
                  if (!alive()) return dropStale()
                  const written = await api.putThumb({
                    path: entry.path,
                    mtime: entry.mtime,
                    png,
                    lighting: THUMB_LIGHTING,
                    rig: RIG_VERSION,
                    posed: posed !== null ? POSE_VERSION : undefined,
                    // The same reading the lookup used, not a fresh one: these
                    // pixels are what that answer asked for.
                    ao,
                  })
                  // This write moved the entry's generation, and the answer
                  // says where to. Taking it here is what keeps the tile's next
                  // fetch cacheable — without it the very pass that changed the
                  // entry would go on asking under the number it invalidated.
                  if (written.gen !== undefined) slot.thumbGen = written.gen
                  if (!alive()) return dropStale()
                  setThumb(entry.path, {
                    status: 'ready',
                    url: URL.createObjectURL(png),
                    camera: cached.camera,
                    axis: cached.axis,
                    gen: slot.thumbGen,
                  })
                  dropStale()
                } catch {
                  if (alive() && staleUrl !== undefined) {
                    // Displayed now — ownership moves to the slot, via setThumb.
                    const url = staleUrl
                    staleUrl = undefined
                    setThumb(entry.path, {
                      status: 'ready',
                      url,
                      camera: cached.camera,
                      axis: cached.axis,
                      gen: slot.thumbGen,
                    })
                  } else if (alive()) {
                    // The same rule as the lookup catch above (F3): carry the
                    // URL the slot already owns, so a render that fails after a
                    // miss — no staleUrl to fall back on — does not blank an
                    // image a previous pass put on this tile. The review that
                    // pinned the lookup catch flagged this branch as its
                    // sibling; the setThumb guard makes the write non-revoking.
                    setThumb(entry.path, { status: 'error', url: slot.url, gen: slot.thumbGen })
                } else {
                  dropStale()
                }
              }
            }, entry.path)
            slot.cancels.push(cancelRender)
          } catch {
            // Carrying the URL the slot already owns, not a bare error: the
            // requirement keeps each existing image until its replacement
            // exists, and a failed *lookup* produced no replacement. Written
            // bare, this would displace the slot's URL and revoke it — a
            // toggle whose lookup 500s would blank every tile it touched over
            // pixels that are still perfectly good. `slot.url === state.url`
            // makes this a non-revoking write; `alive()` is what says the slot
            // is still this entry's.
            if (alive()) setThumb(entry.path, { status: 'error', url: slot.url, gen: slot.thumbGen })
          }
        }, entry.path),
      )
      return undefined
    }
    // Published on every run, so `refetch` and the survivor re-read reach the
    // newest closure — the one whose `ao` and `api` are in force.
    startRef.current = start

    // Entries that left — or came back at a new mtime, which is a different
    // cache key and so a different entry. Only a removal revokes.
    for (const [path, slot] of slots) {
      const entry = wanted.get(path)
      if (entry !== undefined && entry.mtime === slot.entry.mtime) continue
      retire(slot)
      if (slot.url !== undefined) release(slot.url)
      slots.delete(path)
      removed.push(path)
    }

    // Entries that arrived, and survivors whose recipe moved under them.
    for (const entry of models) {
      const slot = slots.get(entry.path)
      const pose = poses[entry.path]
      if (slot === undefined) {
        const fresh: EntrySlot = {
          entry,
          generation: 0,
          ao,
          pose,
          cancels: [],
          url: undefined,
          thumbGen: undefined,
          refusedGen: undefined,
        }
        slots.set(entry.path, fresh)
        added.push(entry.path)
        const seeded = start(entry, fresh)
        if (seeded !== undefined) answered.set(entry.path, seeded)
        continue
      }
      // The listing's annotation is an input to the pixels (D3): a listing
      // naming a generation this slot has not seen — not the one its own
      // lookup or PUT taught it, not the one its previous entry carried — is
      // another writer's work (another tab, a lightbox persist, a bulk job),
      // and a tile pinned `immutable` at the old number would otherwise show
      // wrong pixels with no request that could ever discover it. A listing
      // that carries *no* annotation is not a new fact: the server has simply
      // not learned this entry, and the slot keeps what it knows.
      const newGen =
        entry.thumb !== undefined &&
        entry.thumb.gen !== slot.thumbGen &&
        entry.thumb.gen !== slot.entry.thumb?.gen
      // The survivor answers for the new entry object either way — its mtime
      // is the same (the removal loop above is what decides that), and its
      // annotation is what the next reconcile compares against.
      slot.entry = entry
      // A survivor whose inputs are unchanged keeps its state, its image and
      // its work in flight — a peek landing beside it must not restart it.
      if (slot.ao === ao && samePose(slot.pose, pose) && !newGen) continue
      // Retirement, not a reset: cancel what is running and look this entry up
      // again under the new recipe, while the tile keeps the image and the
      // state it is showing until the replacement lands (D3). The fresh
      // lookup's tail queues at whatever rank the band map gives the tile —
      // a far one waits its turn, nothing is withheld (D5).
      retire(slot)
      slot.ao = ao
      slot.pose = pose
      const seeded = start(entry, slot)
      if (seeded !== undefined) answered.set(entry.path, seeded)
    }

    if (removed.length > 0 || added.length > 0 || answered.size > 0) {
      setThumbs((prev) => {
        const next = new Map(prev)
        // Removals first: a same-path new-mtime entry is a removal *then* an
        // addition on one key, and the addition has to win.
        for (const path of removed) next.delete(path)
        for (const path of added) next.set(path, { status: 'loading' })
        // The listing's own answers land in this same updater, after the
        // placeholders — added entries and restarted survivors alike — so
        // nothing can seed `loading` over a tile the listing has already
        // drawn (D3/F1).
        for (const [path, state] of answered) next.set(path, state)
        return next
      })
    }
    // `poses` is a dependency since `pose-for-every-model`, and the sentence it
    // replaces (1.2a's "deliberately absent") was true only while poses arrived
    // *with* entries. A plain listing's second wave (D3) changes this map and
    // nothing else, so without the dependency this effect never re-runs, the
    // by-value compare above is never reached, and the wave is inert — every
    // tile keeps the un-posed picture it was drawn with until the next landing.
    //
    // 1.2a's two reasons are both spent. Its premise — a landing replaces
    // `entries` and `poses` together — is what this change ends. Its fear was
    // that a re-run meant a reset; the reconciliation above ended that
    // separately (a re-run keeps every image, every slot and everything in
    // flight, and touches only what arrived, left or changed by value). A pose
    // arriving after a tile's pixels is still handled *inside* a pass, by
    // `poseStale` against POSE_VERSION — this only gets the pass started.
    //
    // What keeps it from churning is reference stability, not absence: `App`'s
    // map is a landing's own, the slot the wave filled, the `NO_POSES`
    // constant, or App's memoised merge of the previews' wave under the
    // listing's — reference-stable per render in every case (the merge
    // rebuilds only when a wave actually answers). `RIG_VERSION` is
    // still absent for D2's reason: it changes with a build, not with a
    // gesture, and nothing on screen is waiting on it.
  }, [entries, api, lru, queue, setThumb, ao, poses, applyRanking])

  // Only an unmount disposes. Separate from the sweep effect on purpose: that
  // one must have no cleanup at all, or React would tear every entry down
  // before each re-run and the reconciliation above would have nothing to
  // reconcile against.
  useEffect(() => {
    return () => {
      const slots = slotsRef.current
      for (const slot of slots.values()) {
        slot.generation++
        for (const cancel of slot.cancels) cancel()
        if (slot.url !== undefined) release(slot.url)
      }
      // Cleared, as an invariant. `main.tsx` renders under <StrictMode>, which
      // simulates unmount→remount on the same instance with refs preserved: a
      // map left populated would make the remount's reconciler see every entry
      // as already present and start nothing (the dev grid would never load),
      // and one left holding revoked URLs would show them.
      slots.clear()
    }
  }, [])

  return { thumbs, setThumb, refetch, setPlaceholder, discardThumbFraming, setBands, reportImageError }
}
