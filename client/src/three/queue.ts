/** Where a tile stands relative to the viewport, as the grid reports it.
 *  Coarse on purpose: the queue is two jobs wide and cannot exploit finer
 *  resolution than "on screen, about to be, known to be neither". */
export type Band = 'visible' | 'near' | 'far'

interface Job {
  run: () => Promise<void>
  cancelled: boolean
  started: boolean
  /** The path this render is for, or undefined for keyless work — a render the
   *  user pressed for, which belongs to no slot and is never re-ranked. */
  key: string | undefined
}

/**
 * How a job's band orders it. Keyless work ranks with `visible`: it exists only
 * because the user pressed an on-screen control, and ranking it unreported
 * would put a press behind a screenful of sweep misses. `undefined` (a key no
 * report covers) sits *between* near and far — an unreported path may be
 * anywhere, while `far` is the one band known to be off screen, so far work is
 * taken last of all — and it *is* taken, when nothing nearer is pending: far
 * work is deferred, never discarded, which is how a listing left open drains
 * itself nearest-first (thumbnail-sweep-priority D4). Absent is never far: a
 * ranking that defaulted missing keys to far would push the world to the back
 * (D1).
 */
const RANK: Record<Band, number> = { visible: 0, near: 1, far: 3 }
const UNREPORTED = 2

/**
 * Limited-concurrency thumbnail render queue. Suspends while an orbit overlay
 * or lightbox is active (the shared renderer may only serve one purpose at a
 * time) and resumes where it left off.
 *
 * Pending work is taken by rank, not arrival: the grid replaces the whole
 * ranking as the view scrolls (`setRanking`), and `pump` takes the best-ranked
 * pending job, ties keeping insertion order — so a queue with no ranking at
 * all behaves exactly as the FIFO it used to be (D1). A running job is never
 * interrupted by a re-ranking; only what runs *next* changes.
 */
export class RenderQueue {
  private jobs: Job[] = []
  private running = 0
  private suspended = false
  private resumeWaiters: (() => void)[] = []
  private ranking: ReadonlyMap<string, Band> = new Map()

  constructor(private concurrency = 2) {}

  /**
   * Queue a job, optionally keyed by the path it renders, and get back a
   * cancel handle that **reports whether the job was still pending** — true
   * exactly when the cancel prevented a run, and idempotent. Nothing in the
   * app reads that answer today: the hook's `retire` releases a job's stale
   * PNG unconditionally and `dropStale` is idempotent, so a started job that
   * loses its fallback simply errors into the image it already shows. The
   * answer is kept because it is the honest contract of a cancel, and pinned
   * in `queue.test.ts`.
   */
  push(run: () => Promise<void>, key?: string): () => boolean {
    const job: Job = { run, cancelled: false, started: false, key }
    this.jobs.push(job)
    this.pump()
    return () => {
      if (job.started || job.cancelled) return false
      job.cancelled = true
      return true
    }
  }

  /**
   * Replace the ranking wholesale — the grid recomputes bands on scroll rather
   * than moving keys one at a time (D1/D2). Keys absent from the map are
   * unreported, never far.
   */
  setRanking(bands: ReadonlyMap<string, Band>): void {
    this.ranking = bands
    // A re-ranking changes what runs next; pumping here costs nothing when
    // every slot is busy and lets a queue that emptied its runnable set
    // re-check without waiting for a push or a finish.
    this.pump()
  }

  /**
   * Drop every pending job and the ranking. For tests: the lookup queue is
   * module-level, so a pending lookup one cell leaves behind would otherwise
   * be dispatched during the next cell. Running jobs finish on their own;
   * their `alive()` checks already refuse a departed listing.
   */
  clear(): void {
    for (const job of this.jobs) job.cancelled = true
    this.jobs = []
    this.ranking = new Map()
  }

  suspend(): void {
    this.suspended = true
  }

  resume(): void {
    this.suspended = false
    const waiters = this.resumeWaiters
    this.resumeWaiters = []
    for (const w of waiters) w()
    this.pump()
  }

  /**
   * Gate for in-flight jobs: suspend() cannot stop a job that already started,
   * so jobs await this before each renderer-touching stage (parse, render).
   */
  whenResumed(): Promise<void> {
    if (!this.suspended) return Promise.resolve()
    return new Promise((resolve) => this.resumeWaiters.push(resolve))
  }

  private rankOf(job: Job): number {
    if (job.key === undefined) return RANK.visible
    const band = this.ranking.get(job.key)
    return band === undefined ? UNREPORTED : RANK[band]
  }

  /** The best-ranked pending job, ties by insertion order — `jobs` is kept in
   *  arrival order, so the first of the best rank is the oldest of them. */
  private take(): Job | undefined {
    let bestAt = -1
    let bestRank = Number.POSITIVE_INFINITY
    for (let i = 0; i < this.jobs.length; ) {
      const job = this.jobs[i]!
      if (job.cancelled) {
        // Dropped as the scan meets it, not left for every later take to
        // rescan: a listing's lifetime of retirements would otherwise pile up
        // hundreds of husks, each holding its run closure reachable.
        this.jobs.splice(i, 1)
        continue
      }
      const rank = this.rankOf(job)
      if (rank < bestRank) {
        bestRank = rank
        bestAt = i
        if (rank === 0) break
      }
      i++
    }
    if (bestAt === -1) return undefined
    const job = this.jobs[bestAt]!
    this.jobs.splice(bestAt, 1)
    return job
  }

  private pump(): void {
    while (!this.suspended && this.running < this.concurrency) {
      const job = this.take()
      if (job === undefined) return
      job.started = true
      this.running++
      void job.run().finally(() => {
        this.running--
        this.pump()
      })
    }
  }
}
