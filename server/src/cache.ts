import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CameraState, OrbitAxis, ThumbGetResponse } from '../../shared/types'
import { parseVPath } from './vpath'

interface Meta {
  path: string
  /** mtime the PNG was rendered against; undefined when only camera is stored. */
  mtime?: number
  camera?: CameraState
  /** Orbit spindle axis; undefined reads as 'y' (pre-axis entries). */
  axis?: OrbitAxis
  /** Last time the PNG was served — LRU clock for size-cap eviction. */
  lastRead: number
}

const DEFAULT_CAP = 2 * 1024 ** 3
/** PNG writes between automatic maintenance runs (D4: "after writes crossing a threshold"). */
const MAINTAIN_EVERY = 32

/**
 * Server-side `{png, cameraState}` store, filed under a hash of the virtual
 * path (paths contain `/`, `!`, spaces). PNG keyed by path+mtime; camera by
 * path only.
 */
export class ThumbCache {
  private writesSinceMaintain = 0
  private maintaining = false

  constructor(
    readonly dir: string = process.env.MODEL_BROWSER_CACHE ?? join(homedir(), '.cache', 'model-browser'),
    readonly sizeCap: number = Number(process.env.MODEL_BROWSER_CACHE_CAP ?? DEFAULT_CAP),
    readonly maintainEvery: number = MAINTAIN_EVERY,
  ) {}

  private key(path: string): string {
    return createHash('sha256').update(path).digest('hex')
  }

  private metaFile(key: string): string {
    return join(this.dir, `${key}.json`)
  }

  private pngFile(key: string): string {
    return join(this.dir, `${key}.png`)
  }

  private async readMeta(key: string): Promise<Meta | null> {
    try {
      return JSON.parse(await readFile(this.metaFile(key), 'utf8')) as Meta
    } catch {
      return null
    }
  }

  private async writeMeta(key: string, meta: Meta): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.metaFile(key), JSON.stringify(meta))
  }

  async get(path: string, mtime: number): Promise<ThumbGetResponse> {
    const key = this.key(path)
    const meta = await this.readMeta(key)
    if (meta === null) return { status: 'miss' }
    const axis = meta.axis ?? 'y'
    if (meta.mtime !== mtime) return { status: meta.camera !== undefined || meta.mtime !== undefined ? 'stale' : 'miss', camera: meta.camera, axis }
    let png
    try {
      png = await readFile(this.pngFile(key))
    } catch {
      return { status: 'stale', camera: meta.camera, axis }
    }
    await this.writeMeta(key, { ...meta, lastRead: Date.now() })
    return { status: 'hit', camera: meta.camera, axis, png: png.toString('base64') }
  }

  async put(path: string, opts: { mtime: number; png?: Buffer; camera?: CameraState; axis?: OrbitAxis }): Promise<void> {
    const key = this.key(path)
    const prev = await this.readMeta(key)
    const meta: Meta = {
      path,
      mtime: opts.png !== undefined ? opts.mtime : prev?.mtime,
      camera: opts.camera ?? prev?.camera,
      axis: opts.axis ?? prev?.axis,
      lastRead: Date.now(),
    }
    if (opts.png !== undefined) {
      await mkdir(this.dir, { recursive: true })
      // Superseded-mtime PNG is inherently replaced: one PNG per path hash.
      await writeFile(this.pngFile(key), opts.png)
    }
    await this.writeMeta(key, meta)
    if (opts.png !== undefined && ++this.writesSinceMaintain >= this.maintainEvery) {
      this.writesSinceMaintain = 0
      void this.runMaintain()
    }
  }

  private async runMaintain(): Promise<void> {
    if (this.maintaining) return
    this.maintaining = true
    try {
      await this.maintain()
    } catch {
      // best-effort background sweep
    } finally {
      this.maintaining = false
    }
  }

  /**
   * Sweep + size cap. Existence is tested against the containing zip for
   * virtual paths. The sweep removes whole entries (camera included); the size
   * cap deletes only least-recently-read PNGs and spares camera state.
   */
  async maintain(): Promise<void> {
    let files
    try {
      files = await readdir(this.dir)
    } catch {
      return
    }
    const metas: { key: string; meta: Meta; pngSize: number }[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const key = f.slice(0, -'.json'.length)
      const meta = await this.readMeta(key)
      if (meta === null) continue
      const source = parseVPathSafe(meta.path)
      const exists = source !== null && (await stat(source).catch(() => null)) !== null
      if (!exists) {
        await rm(this.metaFile(key), { force: true })
        await rm(this.pngFile(key), { force: true })
        continue
      }
      const pngStat = await stat(this.pngFile(key)).catch(() => null)
      metas.push({ key, meta, pngSize: pngStat?.size ?? 0 })
    }

    let total = metas.reduce((sum, m) => sum + m.pngSize, 0)
    if (total <= this.sizeCap) return
    metas.sort((a, b) => a.meta.lastRead - b.meta.lastRead)
    for (const m of metas) {
      if (total <= this.sizeCap) break
      if (m.pngSize === 0) continue
      await rm(this.pngFile(m.key), { force: true })
      await this.writeMeta(m.key, { ...m.meta, mtime: undefined })
      total -= m.pngSize
    }
  }
}

function parseVPathSafe(vpath: string): string | null {
  try {
    return parseVPath(vpath).fsPath
  } catch {
    return null
  }
}
