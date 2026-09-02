export interface LruModel {
  object: unknown
  bytes: number
  dispose: () => void
}

export interface LoadedModel<T> {
  object: T
  bytes: number
}

const DEFAULT_BUDGET = 1024 ** 3 // ~1GB of parsed geometry on the JS heap

/**
 * Byte-budgeted LRU of parsed meshes. Budget measures parsed geometry on the
 * JS heap, not entry count. Eviction calls dispose() so GPU buffers are freed
 * — dropping the reference alone leaks VRAM.
 */
export class MeshLru<T> {
  private entries = new Map<string, { object: T; bytes: number }>()
  private loading = new Map<string, Promise<T>>()
  private inFlight = 0
  private waiters: (() => void)[] = []

  constructor(
    private load: (path: string) => Promise<LoadedModel<T>>,
    private disposeFn: (object: T) => void,
    private budget: number = DEFAULT_BUDGET,
    private parseConcurrency: number = 2,
  ) {}

  get size(): number {
    let total = 0
    for (const e of this.entries.values()) total += e.bytes
    return total
  }

  has(path: string): boolean {
    return this.entries.has(path)
  }

  /** Get the mesh, loading it if needed. Marks the entry most-recently-used. */
  async acquire(path: string): Promise<T> {
    const hit = this.entries.get(path)
    if (hit !== undefined) {
      this.entries.delete(path)
      this.entries.set(path, hit) // re-insert = most recently used
      return hit.object
    }
    const pending = this.loading.get(path)
    if (pending !== undefined) return pending

    const promise = this.slot(async () => {
      const { object, bytes } = await this.load(path)
      this.insert(path, object, bytes)
      return object
    }).finally(() => this.loading.delete(path))
    this.loading.set(path, promise)
    return promise
  }

  /** Hover-warm: same as acquire but swallows errors (the real use surfaces them). */
  warm(path: string): void {
    void this.acquire(path).catch(() => {})
  }

  /** Remove everything (e.g. on navigation away), disposing each entry. */
  clear(): void {
    for (const e of this.entries.values()) this.disposeFn(e.object)
    this.entries.clear()
  }

  private insert(path: string, object: T, bytes: number): void {
    this.entries.set(path, { object, bytes })
    let total = this.size
    for (const [key, entry] of this.entries) {
      if (total <= this.budget || key === path) continue
      this.entries.delete(key)
      this.disposeFn(entry.object)
      total -= entry.bytes
    }
  }

  private async slot<R>(fn: () => Promise<R>): Promise<R> {
    while (this.inFlight >= this.parseConcurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.inFlight++
    try {
      return await fn()
    } finally {
      this.inFlight--
      this.waiters.shift()?.()
    }
  }
}
