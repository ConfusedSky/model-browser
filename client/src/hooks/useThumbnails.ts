import { useCallback, useEffect, useState } from 'react'
import type * as THREE from 'three'
import type { CameraState, DirEntry } from '../../../shared/types'
import type { ApiClient } from '../api/client'
import { DEFAULT_CAMERA } from '../three/camera'
import type { MeshLru } from '../three/lru'
import type { RenderQueue } from '../three/queue'
import { renderThumbnail } from '../three/renderer'

export interface ThumbState {
  status: 'loading' | 'ready' | 'error'
  url?: string
  camera?: CameraState
}

/**
 * Per-tile thumbnail pipeline: check the server cache, and on miss/stale run
 * load → parse → render → PUT through the render queue. Meshes load through
 * the LRU, so thumbnail bytes seed later orbits.
 */
export function useThumbnails(
  entries: DirEntry[],
  api: ApiClient,
  lru: MeshLru<THREE.Object3D>,
  queue: RenderQueue,
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

    const cancels = models.map((entry) =>
      queue.push(async () => {
        if (!alive) return
        try {
          const cached = await api.getThumb(entry.path, entry.mtime)
          if (!alive) return
          if (cached.status === 'hit' && cached.pngUrl !== undefined) {
            setThumb(entry.path, { status: 'ready', url: cached.pngUrl, camera: cached.camera })
            return
          }
          const object = await lru.acquire(entry.path)
          if (!alive) return
          const camera = cached.camera ?? DEFAULT_CAMERA
          const png = await renderThumbnail(object, camera)
          await api.putThumb({ path: entry.path, mtime: entry.mtime, png })
          if (!alive) return
          setThumb(entry.path, {
            status: 'ready',
            url: URL.createObjectURL(png),
            camera: cached.camera,
          })
        } catch {
          if (alive) setThumb(entry.path, { status: 'error' })
        }
      }),
    )
    return () => {
      alive = false
      for (const cancel of cancels) cancel()
    }
  }, [entries, api, lru, queue, setThumb])

  return { thumbs, setThumb, setPlaceholder }
}
