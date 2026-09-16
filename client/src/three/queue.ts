/** Coarse on purpose: a two-wide queue cannot exploit finer resolution. */
export type Band = "visible" | "near" | "far";

interface Job {
  run: () => Promise<void>;
  cancelled: boolean;
  started: boolean;
  /** Undefined for keyless work — a render the user pressed for, belonging to
   *  no slot and never re-ranked. */
  key: string | undefined;
  /** Pinned by the pusher; undefined lets the ranking decide. See `push`. */
  band: Band | undefined;
}

/** Keyless work ranks `visible` — the user pressed something. An unreported key
 *  sits *between* near and far, `far` being the one band known to be off
 *  screen. Far work is deferred, never discarded (D1/D4). */
const RANK: Record<Band, number> = { visible: 0, near: 1, far: 3 };
const UNREPORTED = 2;

/** The gate keeps a visible tile's lookup off the same disk as a deferred
 *  tile's mesh read; the bound exists because a lookup has no abort and no
 *  timeout, so a wedged one would close the gate for the tab's life (D5). */
export const FAR_GATE_MAX_MS = 5000;

/**
 * Limited-concurrency thumbnail render queue, suspended while an overlay is up
 * because the shared renderer serves one purpose at a time. Taken by rank, ties
 * by insertion order, so with no ranking it is a plain FIFO (D1).
 */
export class RenderQueue {
  private jobs: Job[] = [];
  /** A set, not a count, so their ranks can be asked. */
  private running = new Set<Job>();
  private suspended = false;
  private resumeWaiters: (() => void)[] = [];
  private ranking: ReadonlyMap<string, Band> = new Map();
  /** Read at every take; closed skips far jobs, for at most
   *  `FAR_GATE_MAX_MS` from the first closed reading (D5). */
  private farGate: (() => boolean) | null = null;
  private gateClosedSince: number | null = null;
  private gateTimer: ReturnType<typeof setTimeout> | null = null;
  private settleFn: (() => void) | null = null;

  constructor(private concurrency = 2) {}

  /** What a gate on another queue asks (D5). Walks `jobs` rather than reading
   *  its length: cancelled husks are spliced only as `take` meets them. */
  pendingNearerThanFar(): number {
    let n = 0;
    for (const job of this.running) if (this.rankOf(job) < RANK.far) n++;
    for (const job of this.jobs)
      if (!job.cancelled && this.rankOf(job) < RANK.far) n++;
    return n;
  }

  /** Install (or clear, with null) the gate far work is taken under. */
  setFarGate(open: (() => boolean) | null): void {
    this.farGate = open;
    // No gate is nothing to hold for. A replaced gate keeps the clock the far
    // job already has — resetting it would let a gate re-installed on a cadence
    // shorter than the bound hold far work forever.
    if (open === null) this.releaseHold();
    else this.syncHold();
    this.pump();
  }

  /** Forget the bound's clock, so it measures a *contiguous* run of held far
   *  work: left running across a gap, an already-expired clock dispatches the
   *  next far job at once with a nearer lookup still pending. */
  private releaseHold(): void {
    this.gateClosedSince = null;
    if (this.gateTimer !== null) {
      clearTimeout(this.gateTimer);
      this.gateTimer = null;
    }
  }

  /** Called **after** the decrement that may have emptied the queue, so a
   *  caller poking another queue's gate finds it already open (D5). */
  onSettle(fn: (() => void) | null): void {
    this.settleFn = fn;
  }

  /** Something outside this queue may have opened the gate. */
  poke(): void {
    // Only a take reads the gate, and a saturated queue takes nothing, so an
    // open window between takes would go unobserved and the bound could span it.
    if (this.farGate !== null && this.farGate()) this.releaseHold();
    this.pump();
  }

  /** `band` pins the rank permanently — the ranking is never consulted for a
   *  pinned job. Bulk work needs that: its key is an ordinary model path the
   *  grid may rank `visible`, and only the pusher knows it is bulk. */
  push(run: () => Promise<void>, key?: string, band?: Band): () => boolean {
    const job: Job = { run, cancelled: false, started: false, key, band };
    this.jobs.push(job);
    this.pump();
    return () => {
      if (job.started || job.cancelled) return false;
      job.cancelled = true;
      // A retired far job may have been the last live one.
      this.syncHold();
      return true;
    };
  }

  /** Wholesale: the grid recomputes bands on scroll (D1/D2). An absent key is
   *  unreported, never far. */
  setRanking(bands: ReadonlyMap<string, Band>): void {
    this.ranking = bands;
    this.syncHold();
    this.pump();
  }

  /** For tests: the lookup queue is module-level, so one cell's leftovers
   *  would dispatch during the next. Running jobs finish on their own. */
  clear(): void {
    for (const job of this.jobs) job.cancelled = true;
    this.jobs = [];
    this.ranking = new Map();
    this.farGate = null;
    this.settleFn = null;
    this.releaseHold();
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const w of waiters) w();
    this.pump();
  }

  /** `suspend()` cannot stop a started job, so jobs await this before each
   *  renderer-touching stage. */
  whenResumed(): Promise<void> {
    if (!this.suspended) return Promise.resolve();
    return new Promise((resolve) => this.resumeWaiters.push(resolve));
  }

  private rankOf(job: Job): number {
    // Not consulted even for a key it covers: the grid's opinion of a bulk
    // job's path is about the tile, not the job.
    if (job.band !== undefined) return RANK[job.band];
    if (job.key === undefined) return RANK.visible;
    const band = this.ranking.get(job.key);
    return band === undefined ? UNREPORTED : RANK[band];
  }

  /** `held` arms a timer, since nothing else may pump a queue holding only far
   *  work; `expired` **keeps** the clock, so the backlog drains rather than one
   *  job per bound. */
  private farAllowed(): "open" | "held" | "expired" {
    if (this.farGate === null || this.farGate()) {
      this.releaseHold();
      return "open";
    }
    const now = Date.now();
    if (this.gateClosedSince === null) this.gateClosedSince = now;
    const remaining = FAR_GATE_MAX_MS - (now - this.gateClosedSince);
    if (remaining <= 0) return "expired";
    if (this.gateTimer === null) {
      this.gateTimer = setTimeout(() => {
        this.gateTimer = null;
        this.pump();
      }, remaining);
    }
    return "held";
  }

  private hasLiveFar(): boolean {
    for (const job of this.jobs)
      if (!job.cancelled && this.rankOf(job) === RANK.far) return true;
    return false;
  }

  /** **The clock runs only while a live far job is queued**, so this is called
   *  at every door that set can shrink through: a clock outliving its last far
   *  job lets the next one dispatch at once under a closed gate. */
  private syncHold(): void {
    if (this.gateClosedSince !== null && !this.hasLiveFar()) this.releaseHold();
  }

  /**
   * The gate is read on the first far job the scan meets, won or not, or the
   * clock would depend on arrival order — `[near, far]` never consulting it
   * where `[far, near]` did. The scan runs to the end for that reason, and to
   * splice husks behind the winner.
   */
  private take(): Job | undefined {
    let bestAt = -1;
    let bestRank = Number.POSITIVE_INFINITY;
    let verdict: "open" | "held" | "expired" | null = null;
    for (let i = 0; i < this.jobs.length; ) {
      const job = this.jobs[i]!;
      if (job.cancelled) {
        // Dropped as the scan meets it: a listing's retirements otherwise pile
        // up husks, each holding its run closure reachable.
        this.jobs.splice(i, 1);
        continue;
      }
      const rank = this.rankOf(job);
      if (rank === RANK.far) {
        if (verdict === null) verdict = this.farAllowed();
        if (verdict === "held") {
          i++;
          continue;
        }
      }
      if (rank < bestRank) {
        bestRank = rank;
        bestAt = i;
      }
      i++;
    }
    if (bestAt === -1) return undefined;
    const job = this.jobs[bestAt]!;
    this.jobs.splice(bestAt, 1);
    // The job taken may have been the last live far job.
    this.syncHold();
    return job;
  }

  private pump(): void {
    while (!this.suspended && this.running.size < this.concurrency) {
      const job = this.take();
      if (job === undefined) return;
      job.started = true;
      this.running.add(job);
      void job.run().finally(() => {
        this.running.delete(job);
        // After the decrement, so a gate read from it sees this job gone, and
        // before this queue's pump, so its poke lands on the other queue first.
        this.settleFn?.();
        this.pump();
      });
    }
  }
}
