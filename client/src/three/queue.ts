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
 * How long a far gate may hold far work before it is dispatched regardless
 * (`thumbnail-image-serving` D5). The gate exists so a lookup for a tile the
 * user can see never waits on a deferred tile's mesh read off the same disk;
 * the bound exists because a lookup has no abort and no timeout, so one
 * wedged on a contended disk would otherwise close the gate for the life of
 * the tab and silently revoke "a listing left open warms itself". Above the
 * worst lookup measured on the real library (3.7 s, 2026-09-02 profile);
 * tuned in task 6.2.
 */
export const FAR_GATE_MAX_MS = 5000

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
  /** The jobs running now — a set, not a count, so their ranks can be asked. */
  private running = new Set<Job>()
  private suspended = false
  private resumeWaiters: (() => void)[] = []
  private ranking: ReadonlyMap<string, Band> = new Map()
  /**
   * Whether far-ranked work may start (`thumbnail-image-serving` D5): null is
   * no gate. Read at every take; when it reads closed, far jobs are skipped —
   * for at most `FAR_GATE_MAX_MS`, timed from the first closed reading, after
   * which they are taken regardless.
   */
  private farGate: (() => boolean) | null = null
  private gateClosedSince: number | null = null
  private gateTimer: ReturnType<typeof setTimeout> | null = null
  private settleFn: (() => void) | null = null

  constructor(private concurrency = 2) {}

  /**
   * Live jobs — queued and not cancelled, plus running. Cancelled husks are
   * spliced only as `take` meets them, so `jobs.length` overcounts.
   */
  get pending(): number {
    let n = this.running.size
    for (const job of this.jobs) if (!job.cancelled) n++
    return n
  }

  /**
   * Live jobs ranked nearer than far — what a gate on another queue asks
   * (D5): a far lookup is nobody's wait, so it must not hold far renders.
   */
  pendingNearerThanFar(): number {
    let n = 0
    for (const job of this.running) if (this.rankOf(job) < RANK.far) n++
    for (const job of this.jobs) if (!job.cancelled && this.rankOf(job) < RANK.far) n++
    return n
  }

  /** Install (or clear, with null) the gate far work is taken under. */
  setFarGate(open: (() => boolean) | null): void {
    this.farGate = open
    this.gateClosedSince = null
    this.pump()
  }

  /**
   * Called after every job finishes, **after** the decrement that may have
   * emptied the queue — so a caller that pokes another queue's gate from here
   * finds the gate already open (D5, the ordering F9 asked for). Null clears.
   */
  onSettle(fn: (() => void) | null): void {
    this.settleFn = fn
  }

  /** Re-pump: something outside this queue — another queue's settle — may
   *  have opened the gate. Cheap when nothing changed. */
  poke(): void {
    this.pump()
  }

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
    this.farGate = null
    this.settleFn = null
    this.gateClosedSince = null
    if (this.gateTimer !== null) {
      clearTimeout(this.gateTimer)
      this.gateTimer = null
    }
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

  /**
   * Whether far work may be taken right now. Reads the gate; a closed reading
   * starts the bound's clock (and a timer to re-pump when it expires, since
   * nothing else may happen to pump a queue holding only far work), an open
   * reading resets it.
   */
  private farAllowed(): boolean {
    if (this.farGate === null || this.farGate()) {
      this.gateClosedSince = null
      return true
    }
    const now = Date.now()
    if (this.gateClosedSince === null) this.gateClosedSince = now
    const remaining = FAR_GATE_MAX_MS - (now - this.gateClosedSince)
    if (remaining <= 0) return true
    if (this.gateTimer === null) {
      this.gateTimer = setTimeout(() => {
        this.gateTimer = null
        this.pump()
      }, remaining)
    }
    return false
  }

  /** The best-ranked pending job, ties by insertion order — `jobs` is kept in
   *  arrival order, so the first of the best rank is the oldest of them. Far
   *  work is skipped while the gate says so (D5). */
  private take(): Job | undefined {
    let bestAt = -1
    let bestRank = Number.POSITIVE_INFINITY
    let farAllowed: boolean | null = null
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
        // The gate is asked once per take and only when a far job is the
        // best so far — a queue with nearer work never consults it.
        if (rank === RANK.far) {
          if (farAllowed === null) farAllowed = this.farAllowed()
          if (!farAllowed) {
            i++
            continue
          }
        }
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
    while (!this.suspended && this.running.size < this.concurrency) {
      const job = this.take()
      if (job === undefined) return
      job.started = true
      this.running.add(job)
      void job.run().finally(() => {
        this.running.delete(job)
        // The settle callback runs after the decrement, so a gate read from it
        // sees this job gone (D5/F9) — and before this queue's own pump, so a
        // poke it makes lands on the other queue first.
        this.settleFn?.()
        this.pump()
      })
    }
  }
}
