/**
 * Bulk thumbnail jobs: warm a scope to fully thumbnailed, or give up its stored
 * framings (`bulk-thumbnail-jobs` §1).
 *
 * A job is `(operation, scope)` and nothing else (D1). Its work list is
 * **derived at launch** from the per-entry state the server's caches already
 * hold — the scope enumeration `ApiClient.models` answers — and is never
 * persisted: every completed entry's own state change drops it out of any later
 * derivation, so "resume" is "launch it again" and the second run's derivation
 * is exactly the remainder. Cancel plus re-run *is* pause.
 *
 * One job at a time (D2). A launch while one is alive answers `'busy'`, starts
 * nothing, and un-dismisses the running job's chip — the chip being the job's
 * whole UI, and surfacing it is what the second press is for.
 *
 * **Every write carries the generation the derivation snapshotted** (D4), so a
 * model the user orbited after the launch refuses the job's write (412) and is
 * counted as skipped rather than overwritten. That works because each operation
 * here writes each entry exactly **once**: an accepted write moves the entry's
 * generation, so a second write under the same launch snapshot would refuse
 * itself. An operation that ever needs two writes to one entry must re-key from
 * the generation the first PUT answered with, not from the snapshot.
 */
import { useSyncExternalStore } from 'react'
import type * as THREE from 'three'
import type { DirEntry, IndexPose } from '../../../shared/types'
import { HttpError, type ApiClient } from '../api/client'
import { isCurrentRender } from '../hooks/useThumbnails'
import { renderEntryThumbnail, resettable, type ActionHost } from '../lib/entryActions'
import type { MeshLru } from '../three/lru'
import type { RenderQueue } from '../three/queue'

export type JobOperation = 'generate' | 'reset'

/** Where a job runs and what the chip calls it. `label` is display only — the
 *  folder's own name, or "the library" for the root. */
export interface JobScope {
  path: string
  label: string
}

/**
 * `deriving` → (`confirming` →) `running` → `done`, or `cancelled` from any of
 * the three live phases. `confirming` is reset's alone (D5): it discards
 * framings no re-run can rederive, so it asks before it sends anything.
 */
export type JobPhase = 'deriving' | 'confirming' | 'running' | 'done' | 'cancelled'

export interface JobState {
  /**
   * Which launch this state describes — a counter, new per `launch`. Every
   * patch builds a new state object, so a reader that wants "once per job"
   * (App's recount on a job that wrote) keys on this, not on object identity:
   * keyed on identity, a Dismiss after the job settled re-fired the recount.
   */
  runId: number
  operation: JobOperation
  scope: JobScope
  phase: JobPhase
  /** What the derivation found. Zero until it lands. */
  total: number
  done: number
  failed: number
  /** Entries whose generation had moved: the user's write stands (D4). */
  skipped: number
  /**
   * Entries this job actually wrote — a landed PUT. `done` counts entries
   * processed, which includes a generate finding its entry already current
   * (one lookup, no write); the tab recounts only for a job that wrote.
   */
  wrote: number
  /**
   * The run loop has finished — its last entry landed, whether the job ended
   * `done` or was cancelled. `cancelled` is set the instant the user presses
   * Cancel, while the in-flight entry may still land and count; anything that
   * wants "the job is over and its counters are final" waits for this. One
   * write can still go unreported: a relaunch the instant after Cancel makes
   * the abandoned run's landing patch stale (`patchRun` refuses it), so its
   * `wrote` never reaches a reader — narrow, and cancel-plus-relaunch is
   * "pause" by D1; the next derivation absorbs it.
   */
  settled: boolean
  /**
   * A generate entry has been handed to the render queue and has not started:
   * it is pinned to the far band, so it waits behind everything the user is
   * looking at — and behind the far gate while nearer lookups are pending.
   * Seen live at a 200-folder root (2026-09-03): a job sat at "0 of 96" for
   * over twelve seconds with nothing wrong, and the chip could not say why.
   * This is one of the two facts the chip's "waiting behind what you're
   * looking at" reads; the other is App's — an open lightbox or orbit overlay
   * suspends the queue, and an entry that already started then waits inside
   * the core's own `whenResumed()` gates, which this flag cannot see (it went
   * false the moment the callback began). Never true for a reset, which sends
   * its writes directly.
   */
  waiting: boolean
  /** The enumeration ran out of budget — this job covers what was found, and
   *  the chip says the scope was cut. */
  incomplete: boolean
  /** The chip is hidden. Never a cancellation (D2): the job runs on. */
  dismissed: boolean
  /** Set only where the job as a whole failed — no work list at all, or a work
   *  list of which nothing could proceed. */
  failure?: string
}

/** One derived entry, with everything the per-entry op needs and nothing it
 *  would have to go and read again. */
export interface JobEntry {
  entry: DirEntry
  /** The write generation at launch — every write is conditional on it (D4). */
  gen: number
  /** The index's orientation: the enumeration's own — a settled `null`
   *  included — else the job's wave. */
  pose: IndexPose | null | undefined
}

export interface Derivation {
  entries: JobEntry[]
  incomplete: boolean
}

export interface JobDeps {
  api: Pick<ApiClient, 'models' | 'getThumb' | 'putThumb' | 'semanticPosesFor'>
  lru: Pick<MeshLru<THREE.Object3D>, 'acquire'>
  queue: Pick<RenderQueue, 'push' | 'whenResumed'>
  setThumb: ActionHost['setThumb']
  /** `useThumbnails`' per-path restart, for the in-memory half of a reset: an
   *  on-screen tile drops the image the write just deleted and looks up again.
   *  A path this listing does not have is a no-op there. */
  refetch: (path: string) => void
  /** The occlusion preference in force, read once per derivation — it decides
   *  which of an entry's two render blocks the staleness test reads. */
  ao: () => boolean
}

/** The scope could not be enumerated, so there is no work list and no job. The
 *  one failure that lands before anything runs. */
export const SCOPE_UNREADABLE = 'Could not enumerate the scope.'
/** Every derived entry failed. The spec's "the job fails as a whole only when
 *  nothing in it could proceed" — one skip or one success is not this. */
export const NOTHING_PROCESSED = 'Nothing in this scope could be processed.'

/**
 * One run's identity, handed to the loop rather than read off the state.
 *
 * It carries the cancel flag, which is what the loop tests before every push
 * and every send — but the object itself is the more important half. A run
 * outlives the job it belongs to: a cancel does not recall the entry already in
 * flight (nothing can), and the user is free to launch a *second* job the
 * instant the first is cancelled. The abandoned entry then settles inside a
 * process whose `this.current` describes somebody else's job, and every
 * unguarded write from it — a counter, a phase — lands on that job instead.
 *
 * So `this.token === token` is what "this run still owns the state" means, and
 * `patchRun` is the only way a run may write. A bare `cancelled` flag cannot
 * express it: the stale run *is* cancelled, and it is exactly its cancelled
 * tail that would otherwise flip a freshly launched job to `cancelled` while
 * its own derivation was still in flight.
 */
interface RunToken {
  cancelled: boolean
}

/**
 * Whether an operation touches this model — the derivation's one filter,
 * shared by `derive` (the work list) and `count` (the buttons), so the button
 * cannot promise a different number from the one the job touches.
 *
 * The judgement stays client-side (D8). The server states facts per model —
 * presence and labels per variant, `gen`, `framed` — and the recipe constants
 * that decide what those facts *mean* live here, so generate asks
 * `isCurrentRender`, the very predicate the sweep's hit branch asks, rather
 * than a second reading of it.
 */
function keeps(operation: JobOperation, c: JobEntry, ao: boolean): boolean {
  const { thumb } = c.entry
  if (operation === 'reset') {
    // `framed` is the server's word for "a camera **or** an axis is stored"
    // (M4), and since `pose-rerender` D7 that is exactly what a reset changes
    // — both are given up, whatever the index holds — asked of the shared
    // rule, never restated. (`framed` itself is not consulted: the server
    // spells the camera and axis whenever either is stored, so the rule's own
    // answer already implies it.)
    return thumb !== undefined && resettable(thumb.camera, thumb.axis)
  }
  // An absent annotation means nothing is cached, not "unknown": the server's
  // index is seeded by the startup sweep and learns every write, so an entry
  // it holds nothing for has no stored render.
  return thumb === undefined || !isCurrentRender(ao ? thumb.ao : thumb.noao, thumb.camera, thumb.axis, c.pose)
}

export class BulkJobs {
  /** Null until the first launch; the last job's state stays readable after it
   *  ends, because the chip outlives the work it reported on. */
  private current: JobState | null = null
  private listeners = new Set<() => void>()
  private token: RunToken | null = null
  /** Launches so far — `JobState.runId`'s source. */
  private runs = 0
  /** Resolves the `confirming` wait — by `confirm()`, and by `cancel()`, which
   *  has to release the loop so it can unwind rather than sit there forever. */
  private confirmWaiter: (() => void) | null = null

  constructor(private readonly deps: JobDeps) {}

  get state(): JobState | null {
    return this.current
  }

  /**
   * For `useSyncExternalStore`. An arrow property, not a method: the hook holds
   * the reference across renders and an unbound method would re-subscribe on
   * every one of them.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * The work list for `(operation, scope)`, derived from the enumeration and
   * nothing else. Public because the library tab's counts are the same
   * derivation run without launching anything (D5): a count is a derivation,
   * not a reservation.
   *
   * The judgement stays client-side (D8). The server states facts per model —
   * presence and labels per variant, `gen`, `framed` — and the recipe constants
   * that decide what those facts *mean* live here, so generate asks
   * `isCurrentRender`, the very predicate the sweep's hit branch asks, rather
   * than a second reading of it.
   */
  async derive(operation: JobOperation, scope: JobScope): Promise<Derivation> {
    const scan = await this.enumerate(scope, operation)
    return {
      entries: scan.candidates.filter((c) => keeps(operation, c, scan.ao)),
      incomplete: scan.incomplete,
    }
  }

  /**
   * Both operations' counts from **one** enumeration and one wave — what the
   * library tab's buttons show (D5). Two `derive` calls would walk the same
   * scope twice and ask the index about the same unknowns twice, for two
   * numbers that are two filters over one answer.
   */
  async count(scope: JobScope): Promise<{ generate: number; reset: number; incomplete: boolean }> {
    const scan = await this.enumerate(scope, 'count')
    let generate = 0
    let reset = 0
    for (const c of scan.candidates) {
      if (keeps('generate', c, scan.ao)) generate++
      if (keeps('reset', c, scan.ao)) reset++
    }
    return { generate, reset, incomplete: scan.incomplete }
  }

  /**
   * The enumeration and the wave, once per ask; `keeps` applies an operation
   * over the result. Every model beneath the scope is a candidate; which ones
   * a job touches is the operation's filter — and the wave is sized to the
   * purpose, so the filter sees a pose exactly where its rule reads one.
   */
  private async enumerate(
    scope: JobScope,
    purpose: JobOperation | 'count',
  ): Promise<{ candidates: JobEntry[]; incomplete: boolean; ao: boolean }> {
    const listing = await this.deps.api.models(scope.path)
    const models = listing.entries.filter((e) => e.kind === 'model')
    // Wave only over the models whose rule needs a pose it does not have.
    // Measured on the real library (2026-09-02; re-run: `curl -s
    // 'http://127.0.0.1:3177/api/models?path=/'` and count entries, entries
    // without `pose`, bytes and time): 18,737 models, 7.8 MB in 0.47 s, 15,357
    // with no pose in the enumeration, so a full wave is sixteen index requests — paid
    // once per opening of the tab and once per press of Reset before Masa
    // objected. Only *generate* needs the index's opinion of every unowned
    // model (a render whose `posed` is behind is stale). A *reset* and a
    // *count* need none (`pose-rerender` D7): a reset gives up the camera and
    // the axis whatever the index holds, so the wire's `framed` is the whole
    // answer. The generate count can miss a pose-stale render the layer has
    // not learned yet; a generate launch's full wave still finds it.
    const needsPose = (_e: DirEntry): boolean => purpose === 'generate'
    // Only the models the enumeration could not answer for. The tree cache's
    // pose layer rides an enumeration as it rides a listing, so asking about a
    // model that already carries one would be asking the library what the index
    // has already said (D8, the 6.4 rule). No unknowns, no round trip at all.
    const unknown = models.filter((e) => e.pose === undefined && needsPose(e)).map((e) => e.path)
    // Failure is silence — the listing wave's own contract. A wave that did not
    // land leaves every model it covered unposed, which is exactly what an
    // index that has no opinion looks like, and is the state the per-entry
    // render already handles.
    const wave =
      unknown.length === 0
        ? {}
        : await this.deps.api
            .semanticPosesFor(unknown)
            .then((r) => r.poses)
            .catch(() => ({}) as Record<string, IndexPose | null>)
    // Read once for the whole scan: a preference toggled mid-derivation must
    // not have half the scope judged against one variant and half the other.
    const ao = this.deps.ao()
    // A missing annotation is generation zero, which is what the server calls
    // an entry it has never written: the conditional write then refuses if
    // anything wrote it between the enumeration and the job's turn. The
    // enumeration's order is the job's order: the answer is the tree's own
    // traversal, which is the order a user would have walked it in.
    const candidates = models.map((entry) => ({
      entry,
      gen: entry.thumb?.gen ?? 0,
      // Not `??`: a settled `null` on the entry is an answer (`pose-rerender`
      // D5) and such an entry was never in `unknown`, so `??` would fall to a
      // wave that has no key for it and read the settle as unsettled.
      pose: entry.pose !== undefined ? entry.pose : wave[entry.path],
    }))
    return { candidates, incomplete: !listing.complete, ao }
  }

  /**
   * Start `(operation, scope)`, or surface the job already running.
   *
   * `'busy'` is not a refusal the user has to decode: D2's answer to a second
   * launch is the running job's chip, so the dismissed flag is cleared on the
   * way out and nothing else happens.
   */
  launch(operation: JobOperation, scope: JobScope): 'started' | 'busy' {
    const phase = this.current?.phase
    if (phase === 'deriving' || phase === 'confirming' || phase === 'running') {
      this.patch({ dismissed: false })
      return 'busy'
    }
    const token: RunToken = { cancelled: false }
    this.token = token
    this.current = {
      runId: ++this.runs,
      operation,
      scope,
      phase: 'deriving',
      total: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      incomplete: false,
      dismissed: false,
      wrote: 0,
      settled: false,
      waiting: false,
    }
    this.notify()
    void this.run(token, operation)
    return 'started'
  }

  /** Reset's consent (D5). A no-op in every other phase, so a stray press on a
   *  chip that has moved on cannot start anything. */
  confirm(): void {
    if (this.current?.phase !== 'confirming') return
    const go = this.confirmWaiter
    this.confirmWaiter = null
    this.patch({ phase: 'running' })
    go?.()
  }

  /**
   * Stop at once: nothing further is pushed or sent. The entry already in
   * flight finishes or fails and is still counted — a render cannot be recalled
   * from the GPU and a PUT cannot be recalled from the wire, and pretending
   * otherwise would lose a count for work that really happened.
   *
   * A derivation still in flight is discarded on arrival: nothing was started,
   * so there is nothing to stop.
   */
  cancel(): void {
    const phase = this.current?.phase
    if (phase !== 'deriving' && phase !== 'confirming' && phase !== 'running') return
    if (this.token !== null) this.token.cancelled = true
    const go = this.confirmWaiter
    this.confirmWaiter = null
    this.patch({ phase: 'cancelled' })
    // Release a loop parked on the confirmation, so it unwinds instead of
    // waiting for a consent that is never coming.
    go?.()
  }

  /** Hide the chip. **Never** a cancellation (D2): the job runs on, and the
   *  next launch brings the chip back rather than starting a second job. */
  dismiss(): void {
    if (this.current === null) return
    this.patch({ dismissed: true })
  }

  /**
   * A write from inside `run`, applied only while that run still owns the
   * state. Every patch the loop makes goes through here; `cancel`, `confirm`
   * and `dismiss` use `patch` directly, because they are pressed on the job
   * that is live by construction.
   */
  private patchRun(token: RunToken, fields: Partial<JobState>): void {
    if (this.token !== token) return
    this.patch(fields)
  }

  /** One new state object per change, so `state` is a stable reference between
   *  changes — which is what `useSyncExternalStore` requires of a snapshot. */
  private patch(fields: Partial<JobState>): void {
    if (this.current === null) return
    this.current = { ...this.current, ...fields }
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private async run(token: RunToken, operation: JobOperation): Promise<void> {
    const scope = this.current!.scope
    let derivation: Derivation
    try {
      derivation = await this.derive(operation, scope)
    } catch {
      // Not a per-entry failure: with no work list there is no job at all.
      // Settled either way: a derivation that failed while cancelled is over too.
      this.patchRun(
        token,
        token.cancelled ? { settled: true } : { phase: 'done', failure: SCOPE_UNREADABLE, settled: true },
      )
      return
    }
    if (token.cancelled) {
      this.patchRun(token, { settled: true })
      return
    }
    this.patchRun(token, { total: derivation.entries.length, incomplete: derivation.incomplete })
    if (derivation.entries.length === 0) {
      // An honest nothing: the scope was read and holds no work. Not a failure
      // — a generate over a fully warm folder ends here every time.
      this.patchRun(token, { phase: 'done', settled: true })
      return
    }

    if (operation === 'reset') {
      // D5: the count exists now, and the surface states it before anything is
      // discarded. Cancelling here sends nothing at all.
      this.patchRun(token, { phase: 'confirming' })
      await new Promise<void>((resolve) => {
        this.confirmWaiter = resolve
      })
      if (token.cancelled) {
        this.patchRun(token, { settled: true })
        return
      }
    } else {
      this.patchRun(token, { phase: 'running' })
    }

    let done = 0
    let failed = 0
    let skipped = 0
    let wrote = 0
    // Sequential, one entry in flight (1.2). The queue is two wide, so a single
    // pending job entry always leaves a slot for interactive work — and cancel
    // is instant, because there is never a backlog of the job's own pushes to
    // discard.
    for (const job of derivation.entries) {
      if (token.cancelled) break
      if (operation === 'generate') {
        await new Promise<void>((resolve) => {
          // Pushed, not started: the far band and the far gate decide when.
          this.patchRun(token, { waiting: true })
          this.deps.queue.push(
            async () => {
              this.patchRun(token, { waiting: false })
              try {
                const outcome = await renderEntryThumbnail(job.entry, this.deps, {
                  discardFraming: false,
                  pose: job.pose,
                  ifGen: job.gen,
                  // The derivation judged from an annotation; the core's own
                  // fresh lookup is the last word, and an entry that went
                  // current in between costs one GET rather than a render.
                  skipIfCurrent: true,
                })
                if (outcome === 'skipped') skipped++
                else {
                  done++
                  if (outcome === 'done') wrote++
                }
              } catch {
                // Counted, never reported through a host: one sentence per
                // failed model, fanned over a kit, is a wall of them (D7). The
                // chip carries the number instead.
                failed++
              } finally {
                resolve()
              }
            },
            job.entry.path,
            // Pinned, not ranked (1.2): the key is an ordinary model path the
            // grid may well call `visible`, and the spec says job work ranks no
            // better than deferred far work whatever the grid says.
            'far',
          )
        })
      } else {
        // No queue, no mesh, no render (D3): reset is a write.
        try {
          const written = await this.deps.api.putThumb({
            path: job.entry.path,
            mtime: job.entry.mtime,
            // The discard, exactly as the per-model action writes it: the
            // camera and the axis, both (`pose-rerender` D7).
            camera: null,
            axis: null,
            // And the pixels go with it — both variants were drawn under the
            // orientation just given up (D3).
            png: null,
            ifGen: job.gen,
          })
          done++
          // The same rule the generate path gets through `renderEntryThumbnail`'s
          // `skipped`, applied to the write this path makes itself: `wrote`
          // counts entries a PUT actually landed on, and a resolved `putThumb`
          // is not that on its own. Where the deployment refuses writes the
          // local-framing decorator answers `{ dropped: true }` without
          // reaching the store, and counting it would have the chip report
          // writes nobody made.
          if (written.dropped !== true) wrote++
          // The in-memory half: a tile on screen is showing pixels the server
          // no longer has.
          this.deps.refetch(job.entry.path)
        } catch (err) {
          if (err instanceof HttpError && err.status === 412) skipped++
          else failed++
        }
      }
      // Published per entry, so the chip's counters actually move.
      this.patchRun(token, { done, failed, skipped, wrote })
    }

    const total = derivation.entries.length
    const failure = done === 0 && skipped === 0 && failed === total ? NOTHING_PROCESSED : undefined
    this.patchRun(token, {
      phase: token.cancelled ? 'cancelled' : 'done',
      settled: true,
      ...(failure !== undefined ? { failure } : {}),
    })
  }
}

/** The chip's read of the running job. One line, and the only React in this
 *  module — the runner itself is plain and testable without a DOM. */
export function useBulkJobState(jobs: BulkJobs): JobState | null {
  return useSyncExternalStore(jobs.subscribe, () => jobs.state)
}
