import { useCallback, useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { CameraState, DirEntry, IndexPose, OrbitAxis } from '../../../shared/types'
import type { ApiClient } from '../api/client'
import { DEFAULT_CAMERA } from '../three/camera'
import type { MeshLru } from '../three/lru'
import { cameraForPose, POSE_VERSION } from '../three/pose'
import type { RenderQueue } from '../three/queue'
import { RIG_VERSION, renderThumbnail, THUMB_LIGHTING } from '../three/renderer'

export interface ThumbState {
  status: 'loading' | 'ready' | 'error'
  url?: string
  camera?: CameraState
  axis?: OrbitAxis
}

/**
 * Cache lookups are pure I/O and must not occupy a render-queue slot — a fully
 * cached directory fills at the speed of the cache, not renderer concurrency.
 * Module-level so a superseded listing's in-flight lookups share the limit
 * with its successor's, which is exactly why queued lookups must stay
 * cancellable: leaving the render queue also left its cancellation behind, and
 * a dead listing's 500 lookups would otherwise block its successor's.
 */
const lookupLimit = makeLimiter(8)

interface Job {
  run: () => Promise<void>
  cancelled: boolean
}

/** Same job/cancel shape as RenderQueue, minus the suspend/resume gate. */
function makeLimiter(limit: number) {
  const jobs: Job[] = []
  let active = 0

  function pump(): void {
    // active++ happens here, synchronously with the slot test, so a caller
    // arriving mid-drain cannot claim a slot a woken job already owns.
    while (active < limit) {
      const job = jobs.shift()
      if (job === undefined) return
      if (job.cancelled) continue
      active++
      void job.run().finally(() => {
        active--
        pump()
      })
    }
  }

  return (run: () => Promise<void>): (() => void) => {
    const job: Job = { run, cancelled: false }
    jobs.push(job)
    pump()
    return () => {
      job.cancelled = true
    }
  }
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
  /** The mtime this slot's work was started for; with the path, the cache key. */
  mtime: number
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
   * The object URL the tile is displaying, and which this hook owns — including
   * URLs minted *outside* the hook and handed in through `setThumb` (`App`'s
   * `persist`, `entryActions`' re-render). Ownership lives here rather than in a
   * hook-private list precisely so those cannot leak while the hook revokes its
   * own superseded ones.
   */
  url: string | undefined
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
) {
  const [thumbs, setThumbs] = useState<Map<string, ThumbState>>(new Map())
  const slotsRef = useRef<Map<string, EntrySlot>>(new Map())

  const setThumb = useCallback((path: string, state: ThumbState) => {
    // Revoke the URL this state displaces, whoever minted it — the hook's own
    // renders and the two outside writers alike. Safe against the tile's <img>
    // still pointing at it for one commit: the image is already decoded.
    const slot = slotsRef.current.get(path)
    if (slot !== undefined) {
      if (slot.url !== undefined && slot.url !== state.url) URL.revokeObjectURL(slot.url)
      slot.url = state.url
    }
    setThumbs((prev) => {
      const next = new Map(prev)
      next.set(path, state)
      return next
    })
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
    setThumbs((prev) => {
      const cur = prev.get(path)
      if (cur === undefined || cur.status !== 'loading' || cur.url !== undefined) return prev
      // Joins the slot's ownership like any other displayed URL, so the render
      // that replaces this preview revokes it instead of leaking a decoded PNG
      // per embedded thumbnail.
      const slot = slotsRef.current.get(path)
      if (slot !== undefined && slot.url === undefined) slot.url = url
      const next = new Map(prev)
      next.set(path, { ...cur, url })
      return next
    })
  }, [])

  useEffect(() => {
    const slots = slotsRef.current
    const models = entries.filter((e) => e.kind === 'model')
    const wanted = new Map(models.map((e) => [e.path, e]))
    const removed: string[] = []
    const added: string[] = []

    /** Stop this slot's work without touching what its tile is showing. */
    function retire(slot: EntrySlot): void {
      slot.generation++
      const cancels = slot.cancels
      slot.cancels = []
      for (const cancel of cancels) cancel()
    }

    function start(entry: DirEntry, slot: EntrySlot): void {
      const generation = slot.generation
      const pose = slot.pose
      /**
       * Whether this pass is still the one that should answer for this tile.
       * Two gates on one fact: the slot must still be the map's — an unmount
       * clears the map — and still on the generation that issued this work.
       */
      const alive = (): boolean =>
        slotsRef.current.get(entry.path) === slot && slot.generation === generation

      slot.cancels.push(
        lookupLimit(async () => {
          if (!alive()) return
          try {
            // The occlusion recipe this entry is looked up, rendered and filed
            // under — one value for the whole pass, so the request and the
            // write that answers it cannot name two different renders (D4/D4a).
            // A toggle mid-load retires this pass rather than bending it.
            const cached = await api.getThumb(entry.path, entry.mtime, ao)
            if (!alive()) {
              // The lookup already minted an object URL for a tile that no
              // longer exists — release it rather than leak the decoded PNG.
              if (cached.pngUrl !== undefined) URL.revokeObjectURL(cached.pngUrl)
              return
            }
            // A pose is an input to the pixels that path+mtime does not carry —
            // the same shape as a RIG_VERSION bump. Without this, a thumbnail
            // rendered before the index had an opinion keeps its default angle
            // forever, and the orientation appears only once the user opens the
            // model and the lightbox's close persists a posed snapshot.
            //
            // Only where nothing of the user's is stored, because that is the
            // only case the re-render below poses: with a stored camera or
            // axis it computes `posed = null` and PUTs unlabelled pixels, so
            // the label could never arrive and every visit re-rendered and
            // re-uploaded the same picture. A stored camera wins over the
            // index's opinion anyway (semantic-search D5) — there is nothing
            // stale about pixels that already show it.
            const wantsPose = pose !== undefined
            const poseStale =
              wantsPose &&
              cached.camera === undefined &&
              cached.axis === undefined &&
              cached.posed !== POSE_VERSION
            if (
              cached.status === 'hit' &&
              cached.pngUrl !== undefined &&
              cached.lighting === THUMB_LIGHTING &&
              cached.rig === RIG_VERSION &&
              !poseStale
            ) {
              setThumb(entry.path, {
                status: 'ready',
                url: cached.pngUrl,
                camera: cached.camera,
                axis: cached.axis,
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
                URL.revokeObjectURL(staleUrl)
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
            slot.cancels.push(
              queue.push(async () => {
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
                  await api.putThumb({
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
                  if (!alive()) return dropStale()
                  setThumb(entry.path, {
                    status: 'ready',
                    url: URL.createObjectURL(png),
                    camera: cached.camera,
                    axis: cached.axis,
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
                    })
                  } else if (alive()) {
                    setThumb(entry.path, { status: 'error' })
                  } else {
                    dropStale()
                  }
                }
              }),
            )
          } catch {
            if (alive()) setThumb(entry.path, { status: 'error' })
          }
        }),
      )
    }

    // Entries that left — or came back at a new mtime, which is a different
    // cache key and so a different entry. Only a removal revokes.
    for (const [path, slot] of slots) {
      const entry = wanted.get(path)
      if (entry !== undefined && entry.mtime === slot.mtime) continue
      retire(slot)
      if (slot.url !== undefined) URL.revokeObjectURL(slot.url)
      slots.delete(path)
      removed.push(path)
    }

    // Entries that arrived, and survivors whose recipe moved under them.
    for (const entry of models) {
      const slot = slots.get(entry.path)
      const pose = poses[entry.path]
      if (slot === undefined) {
        const fresh: EntrySlot = {
          mtime: entry.mtime,
          generation: 0,
          ao,
          pose,
          cancels: [],
          url: undefined,
        }
        slots.set(entry.path, fresh)
        added.push(entry.path)
        start(entry, fresh)
        continue
      }
      // A survivor whose inputs are unchanged keeps its state, its image and
      // its work in flight — a peek landing beside it must not restart it.
      if (slot.ao === ao && samePose(slot.pose, pose)) continue
      // Retirement, not a reset: cancel what is running and look this entry up
      // again under the new recipe, while the tile keeps the image and the
      // state it is showing until the replacement lands (D3). This is also
      // where a *parked* entry — one cancelled unstarted by a future far-band
      // rule — would be restarted when its tile comes back.
      retire(slot)
      slot.ao = ao
      slot.pose = pose
      start(entry, slot)
    }

    if (removed.length > 0 || added.length > 0) {
      setThumbs((prev) => {
        const next = new Map(prev)
        // Removals first: a same-path new-mtime entry is a removal *then* an
        // addition on one key, and the addition has to win.
        for (const path of removed) next.delete(path)
        for (const path of added) next.set(path, { status: 'loading' })
        return next
      })
    }
    // `poses` is deliberately absent (1.2a): a pose arriving after a tile's
    // pixels is handled *inside* a pass, by `poseStale` against POSE_VERSION,
    // and re-running the whole sweep whenever a meaning search lands its poses
    // is the "consistency fix" that would undo this. Surviving entries still
    // see a new pose — the reconciler above compares it by value, and a landing
    // replaces `entries` and `poses` together. `RIG_VERSION` is absent for D2's
    // reason: it changes with a build, not with a gesture, and nothing on
    // screen is waiting on it.
  }, [entries, api, lru, queue, setThumb, ao])

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
        if (slot.url !== undefined) URL.revokeObjectURL(slot.url)
      }
      // Cleared, as an invariant. `main.tsx` renders under <StrictMode>, which
      // simulates unmount→remount on the same instance with refs preserved: a
      // map left populated would make the remount's reconciler see every entry
      // as already present and start nothing (the dev grid would never load),
      // and one left holding revoked URLs would show them.
      slots.clear()
    }
  }, [])

  return { thumbs, setThumb, setPlaceholder, discardThumbFraming }
}
