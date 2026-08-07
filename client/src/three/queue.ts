interface Job {
  run: () => Promise<void>
  cancelled: boolean
}

/**
 * Limited-concurrency thumbnail render queue. Suspends while an orbit overlay
 * or lightbox is active (the shared renderer may only serve one purpose at a
 * time) and resumes where it left off.
 */
export class RenderQueue {
  private jobs: Job[] = []
  private running = 0
  private suspended = false

  constructor(private concurrency = 2) {}

  push(run: () => Promise<void>): () => void {
    const job: Job = { run, cancelled: false }
    this.jobs.push(job)
    this.pump()
    return () => {
      job.cancelled = true
    }
  }

  suspend(): void {
    this.suspended = true
  }

  resume(): void {
    this.suspended = false
    this.pump()
  }

  private pump(): void {
    while (!this.suspended && this.running < this.concurrency) {
      const job = this.jobs.shift()
      if (job === undefined) return
      if (job.cancelled) continue
      this.running++
      void job.run().finally(() => {
        this.running--
        this.pump()
      })
    }
  }
}
