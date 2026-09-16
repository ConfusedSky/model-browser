/**
 * Bulk thumbnail jobs: warm a scope, or give up its stored framings
 * (`bulk-thumbnail-jobs` §1). A job is `(operation, scope)` and nothing else
 * (D1); its work list is derived at launch and never persisted, so "resume" is
 * "launch it again" and cancel plus re-run *is* pause. One job at a time (D2).
 *
 * **Every write carries the generation the derivation snapshotted** (D4), so a
 * model the user orbited after the launch refuses the write (412) and counts as
 * skipped. That holds only because each operation writes each entry **once**:
 * an operation needing two writes must re-key from the first PUT's answer.
 */
import { useSyncExternalStore } from "react";
import type * as THREE from "three";
import type { DirEntry, IndexPose } from "../../../shared/types";
import { HttpError, type ApiClient } from "../api/client";
import { isCurrentRender } from "../hooks/useThumbnails";
import {
  renderEntryThumbnail,
  resettable,
  type ActionHost,
} from "../lib/entryActions";
import type { MeshLru } from "../three/lru";
import type { RenderQueue } from "../three/queue";

export type JobOperation = "generate" | "reset";

/** `label` is display only — the folder's name, or "the library" for the root. */
export interface JobScope {
  path: string;
  label: string;
}

/**
 * `deriving` → (`confirming` →) `running` → `done`, or `cancelled` from any live
 * phase. `confirming` is reset's alone (D5): it discards framings no re-run can
 * rederive, so it asks before sending anything.
 */
export type JobPhase =
  | "deriving"
  | "confirming"
  | "running"
  | "done"
  | "cancelled";

export interface JobState {
  /** A reader wanting "once per job" must key on this: every patch is a new
   *  state object, so on identity a Dismiss after settling fires again. */
  runId: number;
  operation: JobOperation;
  scope: JobScope;
  phase: JobPhase;
  total: number;
  done: number;
  failed: number;
  /** Entries whose generation had moved: the user's write stands (D4). */
  skipped: number;
  /** Entries a PUT landed on, where `done` counts entries processed: a generate
   *  can find its entry current. The tab recounts only on a write. */
  wrote: number;
  /** The counters are final: `cancelled` is set the instant Cancel is pressed,
   *  while the in-flight entry may still land and count. */
  settled: boolean;
  /** Pinned far and not started, so a job can sit at zero with nothing wrong —
   *  which the chip has to be able to say. It cannot see an entry that
   *  *started* and then parked in a `whenResumed()` gate; that half is App's. */
  waiting: boolean;
  /** The enumeration ran out of budget, so the chip says the scope was cut. */
  incomplete: boolean;
  /** The chip is hidden. Never a cancellation (D2): the job runs on. */
  dismissed: boolean;
  /** Only where the job as a whole failed. */
  failure?: string;
}

export interface JobEntry {
  entry: DirEntry;
  /** The generation at launch; every write is conditional on it (D4). */
  gen: number;
  /** The enumeration's own, a settled `null` included, else the job's wave. */
  pose: IndexPose | null | undefined;
}

export interface Derivation {
  entries: JobEntry[];
  incomplete: boolean;
}

export interface JobDeps {
  api: Pick<ApiClient, "models" | "getThumb" | "putThumb" | "semanticPosesFor">;
  lru: Pick<MeshLru<THREE.Object3D>, "acquire">;
  queue: Pick<RenderQueue, "push" | "whenResumed">;
  setThumb: ActionHost["setThumb"];
  /** The in-memory half of a reset; off-screen paths are a no-op there. */
  refetch: (path: string) => void;
  /** Read once per derivation, so half a scope cannot be judged on the other
   *  variant. */
  ao: () => boolean;
}

/** No work list and no job: the one failure that lands before anything runs. */
export const SCOPE_UNREADABLE = "Could not enumerate the scope.";
/** Every derived entry failed; one skip or one success is not this. */
export const NOTHING_PROCESSED = "Nothing in this scope could be processed.";

/**
 * One run's identity, because a run outlives its job: a cancel cannot recall the
 * entry in flight, and the next job may already be running when it settles.
 * `this.token === token` is what "this run still owns the state" means, and
 * `patchRun` is the only way a run may write — a bare `cancelled` flag cannot
 * express it, since the stale run *is* cancelled and would flip the new job.
 */
interface RunToken {
  cancelled: boolean;
}

/**
 * Shared by `derive` and `count`, so a button cannot promise a different number
 * from the one the job touches. The judgement stays client-side (D8): the server
 * states facts, and the constants that decide what they *mean* live here.
 */
function keeps(operation: JobOperation, c: JobEntry, ao: boolean): boolean {
  const { thumb } = c.entry;
  if (operation === "reset") {
    // Asked of the shared rule, never restated (`pose-rerender` D7).
    return thumb !== undefined && resettable(thumb.camera, thumb.axis);
  }
  // An absent annotation is nothing cached, not "unknown": the server's index
  // is seeded at startup and learns every write.
  return (
    thumb === undefined ||
    !isCurrentRender(
      ao ? thumb.ao : thumb.noao,
      thumb.camera,
      thumb.axis,
      c.pose,
    )
  );
}

export class BulkJobs {
  /** The last job's state stays readable: the chip outlives its work. */
  private current: JobState | null = null;
  private listeners = new Set<() => void>();
  private token: RunToken | null = null;
  private runs = 0;
  /** `cancel()` resolves it too, or the loop waits for ever. */
  private confirmWaiter: (() => void) | null = null;

  constructor(private readonly deps: JobDeps) {}

  get state(): JobState | null {
    return this.current;
  }

  /** An arrow property, not a method: `useSyncExternalStore` holds the reference
   *  across renders and an unbound method would re-subscribe on each. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Public because the tab's counts are this derivation without a launch: a
   *  count is not a reservation (D5). */
  async derive(operation: JobOperation, scope: JobScope): Promise<Derivation> {
    const scan = await this.enumerate(scope, operation);
    return {
      entries: scan.candidates.filter((c) => keeps(operation, c, scan.ao)),
      incomplete: scan.incomplete,
    };
  }

  /** Both counts from **one** enumeration and wave: two `derive` calls would
   *  walk the scope twice for two filters over one answer. */
  async count(
    scope: JobScope,
  ): Promise<{ generate: number; reset: number; incomplete: boolean }> {
    const scan = await this.enumerate(scope, "count");
    let generate = 0;
    let reset = 0;
    for (const c of scan.candidates) {
      if (keeps("generate", c, scan.ao)) generate++;
      if (keeps("reset", c, scan.ao)) reset++;
    }
    return { generate, reset, incomplete: scan.incomplete };
  }

  /** The wave is sized to the purpose, so the filter sees a pose exactly where
   *  its rule reads one. */
  private async enumerate(
    scope: JobScope,
    purpose: JobOperation | "count",
  ): Promise<{ candidates: JobEntry[]; incomplete: boolean; ao: boolean }> {
    const listing = await this.deps.api.models(scope.path);
    const models = listing.entries.filter((e) => e.kind === "model");
    // Only *generate* needs the index's opinion of every unowned model; a reset
    // gives the framing up whatever the index holds (`pose-rerender` D7), and a
    // full wave over the library is many requests. The cost is a generate
    // *count* that can miss a pose-stale render the launch itself still finds.
    const needsPose = (_e: DirEntry): boolean => purpose === "generate";
    // Only what the enumeration could not answer for: its pose layer already
    // carries the rest (D8), so no unknowns means no round trip.
    const unknown = models
      .filter((e) => e.pose === undefined && needsPose(e))
      .map((e) => e.path);
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
            .catch(() => ({}) as Record<string, IndexPose | null>);
    // Read once for the whole scan: a preference toggled mid-derivation must
    // not have half the scope judged against one variant and half the other.
    const ao = this.deps.ao();
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
    }));
    return { candidates, incomplete: !listing.complete, ao };
  }

  /** D2's answer to a second launch is the running job's chip, so `'busy'`
   *  clears the dismissed flag and does nothing else. */
  launch(operation: JobOperation, scope: JobScope): "started" | "busy" {
    const phase = this.current?.phase;
    if (phase === "deriving" || phase === "confirming" || phase === "running") {
      this.patch({ dismissed: false });
      return "busy";
    }
    const token: RunToken = { cancelled: false };
    this.token = token;
    this.current = {
      runId: ++this.runs,
      operation,
      scope,
      phase: "deriving",
      total: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      incomplete: false,
      dismissed: false,
      wrote: 0,
      settled: false,
      waiting: false,
    };
    this.notify();
    void this.run(token, operation);
    return "started";
  }

  /** Reset's consent (D5), a no-op in every other phase. */
  confirm(): void {
    if (this.current?.phase !== "confirming") return;
    const go = this.confirmWaiter;
    this.confirmWaiter = null;
    this.patch({ phase: "running" });
    go?.();
  }

  /**
   * Nothing further is pushed or sent. The entry already in flight finishes and
   * is still counted: a render cannot be recalled from the GPU, and pretending
   * otherwise loses a count for work that happened.
   */
  cancel(): void {
    const phase = this.current?.phase;
    if (phase !== "deriving" && phase !== "confirming" && phase !== "running")
      return;
    if (this.token !== null) this.token.cancelled = true;
    const go = this.confirmWaiter;
    this.confirmWaiter = null;
    this.patch({ phase: "cancelled" });
    // Release a loop parked on the confirmation, so it unwinds instead of
    // waiting for a consent that is never coming.
    go?.();
  }

  /** **Never** a cancellation (D2): the job runs on. */
  dismiss(): void {
    if (this.current === null) return;
    this.patch({ dismissed: true });
  }

  /** Every patch the loop makes goes through here; the pressed actions use
   *  `patch`, being on the live job by construction. */
  private patchRun(token: RunToken, fields: Partial<JobState>): void {
    if (this.token !== token) return;
    this.patch(fields);
  }

  /** One new object per change, so `state` is the stable reference
   *  `useSyncExternalStore` requires of a snapshot. */
  private patch(fields: Partial<JobState>): void {
    if (this.current === null) return;
    this.current = { ...this.current, ...fields };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private async run(token: RunToken, operation: JobOperation): Promise<void> {
    const scope = this.current!.scope;
    let derivation: Derivation;
    try {
      derivation = await this.derive(operation, scope);
    } catch {
      // With no work list there is no job. Settled either way.
      this.patchRun(
        token,
        token.cancelled
          ? { settled: true }
          : { phase: "done", failure: SCOPE_UNREADABLE, settled: true },
      );
      return;
    }
    if (token.cancelled) {
      this.patchRun(token, { settled: true });
      return;
    }
    this.patchRun(token, {
      total: derivation.entries.length,
      incomplete: derivation.incomplete,
    });
    if (derivation.entries.length === 0) {
      // Not a failure: a generate over a fully warm folder ends here.
      this.patchRun(token, { phase: "done", settled: true });
      return;
    }

    if (operation === "reset") {
      // The count exists now, and the chip states it before anything is
      // discarded (D5). Cancelling here sends nothing.
      this.patchRun(token, { phase: "confirming" });
      await new Promise<void>((resolve) => {
        this.confirmWaiter = resolve;
      });
      if (token.cancelled) {
        this.patchRun(token, { settled: true });
        return;
      }
    } else {
      this.patchRun(token, { phase: "running" });
    }

    let done = 0;
    let failed = 0;
    let skipped = 0;
    let wrote = 0;
    // Sequential, one entry in flight: a single pending job entry always leaves
    // a queue slot for interactive work, and cancel is instant because there is
    // never a backlog of the job's own pushes to discard.
    for (const job of derivation.entries) {
      if (token.cancelled) break;
      if (operation === "generate") {
        await new Promise<void>((resolve) => {
          // Pushed, not started: the band and the far gate decide when.
          this.patchRun(token, { waiting: true });
          this.deps.queue.push(
            async () => {
              this.patchRun(token, { waiting: false });
              try {
                const outcome = await renderEntryThumbnail(
                  job.entry,
                  this.deps,
                  {
                    discardFraming: false,
                    pose: job.pose,
                    ifGen: job.gen,
                    // The derivation judged from an annotation, so the fresh
                    // lookup is the last word.
                    skipIfCurrent: true,
                  },
                );
                if (outcome === "skipped") skipped++;
                else {
                  done++;
                  if (outcome === "done") wrote++;
                }
              } catch {
                // Counted, never said: one sentence per failed model is a wall
                // of them (D7).
                failed++;
              } finally {
                resolve();
              }
            },
            job.entry.path,
            // Pinned, not ranked: the key is an ordinary model path the grid
            // may well call `visible`, and job work ranks no better than
            // deferred far work whatever the grid says.
            "far",
          );
        });
      } else {
        // No queue, no mesh, no render (D3).
        try {
          const written = await this.deps.api.putThumb({
            path: job.entry.path,
            mtime: job.entry.mtime,
            // The discard as the per-model action writes it (`pose-rerender` D7).
            camera: null,
            axis: null,
            // The pixels go too: both were drawn under the discarded framing.
            png: null,
            ifGen: job.gen,
          });
          done++;
          // A resolved `putThumb` is not a landed write: a write-refusing
          // deployment answers `{ dropped: true }` without reaching the store.
          if (written.dropped !== true) wrote++;
          // A tile on screen is showing pixels the server no longer has.
          this.deps.refetch(job.entry.path);
        } catch (err) {
          if (err instanceof HttpError && err.status === 412) skipped++;
          else failed++;
        }
      }
      // Per entry, so the chip's counters move.
      this.patchRun(token, { done, failed, skipped, wrote });
    }

    const total = derivation.entries.length;
    const failure =
      done === 0 && skipped === 0 && failed === total
        ? NOTHING_PROCESSED
        : undefined;
    this.patchRun(token, {
      phase: token.cancelled ? "cancelled" : "done",
      settled: true,
      ...(failure !== undefined ? { failure } : {}),
    });
  }
}

/** The only React here: the runner is plain, and testable without a DOM. */
export function useBulkJobState(jobs: BulkJobs): JobState | null {
  return useSyncExternalStore(jobs.subscribe, () => jobs.state);
}
