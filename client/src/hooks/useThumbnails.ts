import { useCallback, useEffect, useState } from 'react'
import type * as THREE from 'three'
import type { CameraState, DirEntry, IndexPose, OrbitAxis } from '../../../shared/types'
import type { ApiClient } from '../api/client'
import { DEFAULT_CAMERA } from '../three/camera'
import type { MeshLru } from '../three/lru'
import { cameraForPose } from '../three/pose'
import type { RenderQueue } from '../three/queue'
import { RIG_VERSION, renderThumbnail } from '../three/renderer'
import { getLightingMode } from '../viewer/lighting'

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
   * Orientations the semantic index supplied for these entries. Used only when
   * the cache holds no camera or axis of its own: the index's opinion is a
   * default, never an override of the user's (semantic-search D5).
   */
  poses: Record<string, IndexPose> = {},
) {
  const [thumbs, setThumbs] = useState<Map<string, ThumbState>>(new Map())

  const setThumb = useCallback((path: string, state: ThumbState) => {
    setThumbs((prev) => {
      const next = new Map(prev)
      next.set(path, state)
      return next
    })
  }, [])

  /** Placeholder hook for the LRU loader (embedded 3MF previews). */
  const setPlaceholder = useCallback((path: string, url: string) => {
    setThumbs((prev) => {
      const cur = prev.get(path)
      if (cur === undefined || cur.status !== 'loading' || cur.url !== undefined) return prev
      const next = new Map(prev)
      next.set(path, { ...cur, url })
      return next
    })
  }, [])

  useEffect(() => {
    let alive = true
    const models = entries.filter((e) => e.kind === 'model')
    setThumbs(new Map(models.map((e) => [e.path, { status: 'loading' as const }])))

    const cancels: (() => void)[] = []
    for (const entry of models) {
      cancels.push(
        lookupLimit(async () => {
          if (!alive) return
          try {
            const cached = await api.getThumb(entry.path, entry.mtime)
            if (!alive) {
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
            const wantsPose = poses[entry.path] !== undefined
            const poseStale = wantsPose && cached.posed !== true
            if (
              cached.status === 'hit' &&
              cached.pngUrl !== undefined &&
              cached.lighting === getLightingMode() &&
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
            // A hit lit under another mode (or none — pre-lighting entry) is
            // stale pixels over good camera state: re-render, but keep the old
            // PNG until the replacement exists — a failed tail falls back to
            // it rather than degrading a previously fine tile to an error.
            let staleUrl = cached.pngUrl
            const dropStale = () => {
              if (staleUrl !== undefined) {
                URL.revokeObjectURL(staleUrl)
                staleUrl = undefined
              }
            }
            // A cancelled job never runs — cleanup must release the URL.
            cancels.push(dropStale)
            // Only the miss/stale tail touches the shared renderer — it alone
            // goes through the queue. Registered synchronously after the
            // `alive` check above, so cleanup always sees this handle.
            cancels.push(
              queue.push(async () => {
                if (!alive) return dropStale()
                try {
                  // In-flight jobs must not parse or drive the shared renderer
                  // while an orbit/lightbox is active — wait out the
                  // suspension first.
                  await queue.whenResumed()
                  if (!alive) return dropStale()
                  const object = await lru.acquire(entry.path)
                  if (!alive) return dropStale()
                  await queue.whenResumed()
                  if (!alive) return dropStale()
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
                      ? cameraForPose(poses[entry.path], DEFAULT_CAMERA)
                      : null
                  const camera = cached.camera ?? posed?.camera ?? DEFAULT_CAMERA
                  const axis = cached.axis ?? posed?.axis ?? 'y'
                  const lighting = getLightingMode() // the mode this render uses
                  const png = await renderThumbnail(object, camera, axis)
                  await api.putThumb({
                    path: entry.path,
                    mtime: entry.mtime,
                    png,
                    lighting,
                    rig: RIG_VERSION,
                    posed: posed !== null,
                  })
                  if (!alive) return dropStale()
                  setThumb(entry.path, {
                    status: 'ready',
                    url: URL.createObjectURL(png),
                    camera: cached.camera,
                    axis: cached.axis,
                  })
                  dropStale()
                } catch {
                  if (alive && staleUrl !== undefined) {
                    // Displayed now — ownership moves to the thumbs map.
                    const url = staleUrl
                    staleUrl = undefined
                    setThumb(entry.path, {
                      status: 'ready',
                      url,
                      camera: cached.camera,
                      axis: cached.axis,
                    })
                  } else if (alive) {
                    setThumb(entry.path, { status: 'error' })
                  } else {
                    dropStale()
                  }
                }
              }),
            )
          } catch {
            if (alive) setThumb(entry.path, { status: 'error' })
          }
        }),
      )
    }
    return () => {
      alive = false
      for (const cancel of cancels) cancel()
    }
  }, [entries, api, lru, queue, setThumb])

  return { thumbs, setThumb, setPlaceholder }
}
