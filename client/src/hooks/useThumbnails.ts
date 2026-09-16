import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import type {
  CameraState,
  DirEntry,
  FeatureReport,
  IndexPose,
  LightingMode,
  OrbitAxis,
  ThumbRenderInfo,
} from "../../../shared/types";
import type { ApiClient } from "../api/client";
import {
  NO_LIBRARY,
  keepsFramingsLocally,
  readLocalFraming,
} from "../api/localFramings";
import { DEFAULT_CAMERA, defaultAxisFor } from "../three/camera";
import type { MeshLru } from "../three/lru";
import { formatOfEntry } from "../three/models";
import { cameraForPose, POSE_VERSION, poseKeyOf } from "../three/pose";
import { RenderQueue, type Band } from "../three/queue";
import {
  RIG_VERSION,
  renderThumbnail,
  THUMB_LIGHTING,
} from "../three/renderer";

export interface ThumbState {
  status: "loading" | "ready" | "error";
  url?: string;
  camera?: CameraState;
  axis?: OrbitAxis;
  /** The server write generation these pixels answer for. `setThumb` adopts its
   *  **absence** too: a stale number lets the browser answer the next fetch from
   *  its immutable cache without the server ever seeing it. */
  gen?: number;
}

/**
 * Pure I/O, so never a render-queue slot, but ranked by the same band map.
 * Ranked, not held: a far lookup still runs, since a recipe change must consult
 * every entry. Module-level, which is why queued lookups must stay cancellable.
 */
let lookupQueue = new RenderQueue(8);

/** Test seam: a lookup one cell leaves pending must not dispatch in the next. */
export function resetLookupQueueForTests(): void {
  lookupQueue.clear();
  lookupQueue = new RenderQueue(8);
}

function release(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

/**
 * Asked of a lookup and of a listing annotation alike, so the two cannot drift
 * (`thumbnail-image-serving` D2/D3). `pose` has three states (`pose-rerender`
 * D5): one the render must have been drawn under, a settled `null` that makes a
 * posed render stale, and `undefined` — unsettled, so the render stands.
 */
function usable(
  labels: {
    lighting?: LightingMode;
    rig?: number;
    posed?: number;
    poseKey?: string;
  },
  camera: CameraState | undefined,
  axis: OrbitAxis | undefined,
  pose: IndexPose | null | undefined,
): boolean {
  const unowned = camera === undefined && axis === undefined;
  // `undefined` where the pose is unsettled *or* frames no render — an
  // off-axis `up`, an `azimuth_zero` that is not perpendicular. Neither can
  // make a render stale: there is no orientation it should have been drawn
  // under.
  const poseKey = poseKeyFor(pose);
  const poseStale =
    unowned &&
    (pose === null
      ? labels.posed !== undefined || labels.poseKey !== undefined
      : poseKey !== undefined &&
        (labels.posed !== POSE_VERSION || labels.poseKey !== poseKey));
  return (
    labels.lighting === THUMB_LIGHTING &&
    labels.rig === RIG_VERSION &&
    !poseStale
  );
}

/** `undefined` for a pose that frames no render, which `usable` reads as
 *  nothing to be stale against. */
function poseKeyFor(pose: IndexPose | null | undefined): string | undefined {
  const resolved = cameraForPose(pose, DEFAULT_CAMERA);
  return resolved === null ? undefined : poseKeyOf(resolved);
}

/**
 * One entry's lifecycle, in a ref because React runs an effect's cleanup before
 * *every* re-run: in the sweep's closure, each re-run would reset every tile
 * rather than reconcile. Identified by path **and** `mtime`, so a new-mtime
 * entry is a removal then an addition on one key, in that order.
 */
interface EntrySlot {
  entry: DirEntry;
  /** Captured by the work a start issues, so a retired pass cannot write. */
  generation: number;
  ao: boolean;
  /** Compared **by value** — a settled `null` is an opinion too. */
  pose: IndexPose | null | undefined;
  cancels: (() => void)[];
  /** The server's **write** generation, passed on the next fetch to earn a
   *  cacheable answer. Not `generation`, which is this slot's own counter. */
  thumbGen: number | undefined;
  /** Where ownership lives, including URLs minted outside the hook, which
   *  would otherwise leak while the hook revoked only its own. */
  url: string | undefined;
  /** So the next `start` does not rebuild a URL that just failed. */
  refusedGen: number | undefined;
  /** Not `slot.entry.thumb?.gen`: a later listing can carry no annotation at
   *  all, and a refusal would then remember nothing. */
  urlGen: number | undefined;
  /** A refusal is per render — the variants' pixels are evicted independently. */
  urlAo: boolean | undefined;
  /** `undefined` refuses both variants, as a bulk reset needs. */
  refusedAo: boolean | undefined;
}

/** Module-level because `setThumb` retires too, not only the sweep. */
function retire(slot: EntrySlot): void {
  slot.generation++;
  const cancels = slot.cancels;
  slot.cancels = [];
  for (const cancel of cancels) cancel();
}

function sameVec3(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** By value: `poses` is rebuilt per landing, so a reference compare would
 *  re-look-up the whole grid each time. */
function samePose(
  a: IndexPose | null | undefined,
  b: IndexPose | null | undefined,
): boolean {
  // `null` and `undefined` are different states (`pose-rerender` D5): an ask
  // settling to none is a change worth re-evaluating.
  if (a == null || b == null) return a === b;
  if (!sameVec3(a.up, b.up) || !sameVec3(a.azimuth_zero, b.azimuth_zero))
    return false;
  if (a.source !== b.source || a.confidence !== b.confidence) return false;
  if (a.front === null || b.front === null) return a.front === b.front;
  return (
    a.front.view === b.front.view &&
    a.front.azimuth_deg === b.front.azimuth_deg &&
    a.front.elevation_deg === b.front.elevation_deg
  );
}

/** By value: the grid republishes a fresh identity per observer batch. */
function sameBands(
  a: ReadonlyMap<string, Band>,
  b: ReadonlyMap<string, Band>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [path, band] of a) if (b.get(path) !== band) return false;
  return true;
}

/** **The** staleness test: the sweep, the bulk job (D8) and the annotation
 *  branch all ask it. `camera`/`axis` are the *entry's*, not the render's. */
export function isCurrentRender(
  render: ThumbRenderInfo | undefined,
  camera: CameraState | undefined,
  axis: OrbitAxis | undefined,
  pose: IndexPose | null | undefined,
): boolean {
  return (
    render !== undefined &&
    render.state === "hit" &&
    usable(render, camera, axis, pose)
  );
}

/** Module-level, not an inline `() => null`: the default lands in the sweep
 *  effect's dependency array and a fresh function per call would re-run it. */
const NO_FEATURES = (): FeatureReport | null => null;

/** Per-tile pipeline: cache lookup, then on a miss load → render → PUT through
 *  the render queue. Meshes come from the LRU, seeding later orbits. */
export function useThumbnails(
  entries: DirEntry[],
  api: ApiClient,
  lru: MeshLru<THREE.Object3D>,
  queue: RenderQueue,
  /** A **primitive**, so an equal value cannot re-trigger the sweep — which is
   *  the failure that turns a toggle into a render loop. */
  ao: boolean,
  /** A default, never an override of a stored orientation (semantic-search D5). */
  poses: Record<string, IndexPose | null> = {},
  /** Not `entries` above, which a folder peek rebuilds: keyed on that, the
   *  ranking is wiped just as the user stops scrolling and the peeks answer. */
  listingKey: unknown = entries,
  /** A **getter** with a stable identity, since it lands in the sweep's
   *  dependency array. Needed here because a listing annotation never passes
   *  through `ApiClient`, and is *every* tile on a baked deployment. */
  features: () => FeatureReport | null = NO_FEATURES,
  /** A getter for `features`' reason, and keyed into the local-framing store so
   *  two libraries sharing relative paths cannot overlay each other. */
  libraryId: () => string | null = NO_LIBRARY,
) {
  const [thumbs, setThumbs] = useState<Map<string, ThumbState>>(new Map());
  const slotsRef = useRef<Map<string, EntrySlot>>(new Map());

  const setThumb = useCallback((path: string, state: ThumbState) => {
    const slot = slotsRef.current.get(path);
    // No slot is no entry. An outside writer is on no slot's cancels, so it
    // can still answer for a path a navigation removed — and both release paths
    // walk slots, so what it minted would be freed by nothing.
    if (slot === undefined) {
      if (state.url !== undefined) release(state.url);
      return;
    }
    // Safe against the tile's <img> holding it one more commit: it is decoded.
    if (slot.url !== undefined && slot.url !== state.url) release(slot.url);
    slot.url = state.url;
    slot.urlGen = undefined;
    slot.urlAo = undefined;
    // Absence included: it demotes the next fetch to the validator tier rather
    // than let an immutable-cached response answer for replaced bytes.
    slot.thumbGen = state.gen;
    // An outside write retires nothing by itself, so a tail queued behind a
    // suspended queue would land afterwards, replace the newer image and pair
    // old-angle pixels with the fresh camera. Retiring here fails that tail's
    // `alive()` before it writes or paints — except for one already past that
    // check, whose PUT still lands and heals on the next camera write.
    retire(slot);
    setThumbs((prev) => {
      const next = new Map(prev);
      next.set(path, state);
      return next;
    });
  }, []);

  /**
   * The in-memory half of someone else's server write, because **nothing else
   * restarts a slot for one**. It blanks the tile against this hook's
   * keep-until-replaced rule, deliberately (`bulk-thumbnail-jobs` D3): those
   * pixels were drawn under a framing just discarded.
   */
  const refetch = useCallback((path: string) => {
    const slot = slotsRef.current.get(path);
    if (slot === undefined) return;
    // A tail started before the write would paint the deleted render back.
    retire(slot);
    if (slot.url !== undefined) release(slot.url);
    slot.url = undefined;
    // The annotation is the listing's word from BEFORE this write, and `start`
    // trusts one first — which would point an image URL at deleted pixels.
    slot.refusedGen = slot.entry.thumb?.gen;
    slot.refusedAo = undefined;
    // `reportImageError`'s invariant: a non-blob `url` always has its `urlGen`.
    slot.urlGen = undefined;
    slot.urlAo = undefined;
    // The generation moved under us and the caller may not know where to, so
    // the next lookup rides the validator tier.
    slot.thumbGen = undefined;
    // Whatever the restart seeds is what the tile shows, never a bare
    // `loading` over a state it already decided.
    const seeded = startRef.current?.(slot.entry, slot);
    setThumbs((prev) => {
      const next = new Map(prev);
      next.set(path, seeded ?? { status: "loading" });
      return next;
    });
  }, []);

  /** What `setThumb` cannot express, since it replaces the whole entry and the
   *  caller has no URL to put back. */
  const discardThumbFraming = useCallback((path: string) => {
    // The discard's own PUT moved the entry's generation and its echo is not
    // plumbed this far, so the learned number is stale the moment this runs.
    const slot = slotsRef.current.get(path);
    if (slot !== undefined) slot.thumbGen = undefined;
    setThumbs((prev) => {
      const cur = prev.get(path);
      if (cur === undefined) return prev;
      if (cur.camera === undefined && cur.axis === undefined) return prev;
      const next = new Map(prev);
      next.set(path, { ...cur, camera: undefined, axis: undefined });
      return next;
    });
  }, []);

  /**
   * For the moment the sweep cannot cover: the report resolving to writes-off
   * *after* a listing drew. **An overlay, not a restart** — nothing questioned
   * these pixels. Idempotent, so the caller can be a plain effect.
   */
  const applyLocalFramings = useCallback(() => {
    if (!keepsFramingsLocally(features())) return;
    setThumbs((prev) => {
      let next: Map<string, ThumbState> | null = null;
      for (const [path, tile] of prev) {
        // The pass that answers a loading tile reads the store itself.
        if (tile.status !== "ready") continue;
        const local = readLocalFraming(path, undefined, libraryId);
        if (local === undefined) continue;
        const camera = local.camera ?? tile.camera;
        const axis = local.axis ?? tile.axis;
        if (camera === tile.camera && axis === tile.axis) continue;
        next ??= new Map(prev);
        next.set(path, { ...tile, camera, axis });
      }
      return next ?? prev;
    });
  }, [features, libraryId]);

  /** For the LRU loader's embedded 3MF previews. */
  const setPlaceholder = useCallback((path: string, url: string) => {
    // Outside the updater, which React may replay and must keep pure.
    const slot = slotsRef.current.get(path);
    // The LRU loader keeps no handle, so returning without revoking leaks it.
    if (slot === undefined || slot.url !== undefined) {
      release(url);
      return;
    }
    slot.url = url;
    setThumbs((prev) => {
      // This can refuse what the slot just accepted, leaving it owning a URL
      // the tile never displayed — still released, since releases walk slots.
      const cur = prev.get(path);
      if (
        cur === undefined ||
        cur.status !== "loading" ||
        cur.url !== undefined
      )
        return prev;
      const next = new Map(prev);
      next.set(path, { ...cur, url });
      return next;
    });
  }, []);

  /** Only so a republished-but-equal map costs nothing; nothing reads it at
   *  commit time, since position ranks work and never withholds it (D4). */
  const bandsRef = useRef<ReadonlyMap<string, Band>>(new Map());
  const lastListingRef = useRef<unknown>(null);

  /** Both queues take the same map, so a lookup cannot be held by a verdict the
   *  render queue has forgotten. */
  const applyRanking = useCallback(
    (bands: ReadonlyMap<string, Band>) => {
      bandsRef.current = bands;
      queue.setRanking(bands);
      lookupQueue.setRanking(bands);
    },
    [queue],
  );

  /**
   * The grid's ranking, wholesale (D2/D3). Must stay **cheap when equal** and
   * out of the sweep's dependencies: a `bands` dependency would reconcile the
   * whole listing on every scroll settle. A path absent from the map is
   * unreported, **never far** — only an explicit `far` report defers (D1/D3).
   */
  const setBands = useCallback(
    (bands: ReadonlyMap<string, Band>) => {
      if (sameBands(bandsRef.current, bands)) return;
      applyRanking(bands);
    },
    [applyRanking],
  );

  /** Far renders yield to pending nearer lookups (D5). Both handles are cleared
   *  on unmount, so the module-level queue never points at a dead one. */
  useEffect(() => {
    queue.setFarGate(() => lookupQueue.pendingNearerThanFar() === 0);
    lookupQueue.onSettle(() => queue.poke());
    return () => {
      queue.setFarGate(null);
      lookupQueue.onSettle(null);
    };
  }, [queue]);

  /** For the paths that run long after the effect that defined `start`. */
  const startRef = useRef<
    ((entry: DirEntry, slot: EntrySlot) => ThumbState | undefined) | null
  >(null);

  /** Back to loading and through the lookup, never to the error state: a 404
   *  for an image is not a failed model (D3). */
  const reportImageError = useCallback((path: string) => {
    const slot = slotsRef.current.get(path);
    if (
      slot === undefined ||
      slot.url === undefined ||
      slot.url.startsWith("blob:")
    )
      return;
    if (startRef.current === null) return;
    // The slot's record, not the entry's current word (see `urlGen`).
    slot.refusedGen = slot.urlGen ?? slot.entry.thumb?.gen;
    slot.refusedAo = slot.urlAo;
    slot.url = undefined;
    slot.urlGen = undefined;
    slot.urlAo = undefined;
    retire(slot);
    // The refusal forces the lookup path, which never answers synchronously,
    // so the seed below races nothing.
    startRef.current(slot.entry, slot);
    setThumbs((prev) => {
      const next = new Map(prev);
      next.set(path, { status: "loading" });
      return next;
    });
  }, []);

  useEffect(() => {
    const slots = slotsRef.current;
    // A new listing starts unreported: the previous one's verdicts must not
    // order this one's work.
    if (lastListingRef.current !== listingKey) {
      lastListingRef.current = listingKey;
      applyRanking(new Map());
    }
    const models = entries.filter((e) => e.kind === "model");
    const wanted = new Map(models.map((e) => [e.path, e]));
    const removed: string[] = [];
    const added: string[] = [];
    /** Seeded in the same updater as the placeholders: through `setThumb` that
     *  batch would overwrite a synchronous write and the tile would spin. */
    const answered = new Map<string, ThumbState>();

    /** Returns a state only where the listing's annotation answers outright —
     *  and then pushes nothing. */
    function start(entry: DirEntry, slot: EntrySlot): ThumbState | undefined {
      const generation = slot.generation;
      const pose = slot.pose;
      /** Still the map's slot, still on the generation that issued this work. */
      const alive = (): boolean =>
        slotsRef.current.get(entry.path) === slot &&
        slot.generation === generation;

      // The listing's own answer (D2/D3), at a URL naming the entry's
      // generation so the browser can pin it.
      const info = entry.thumb;
      const variant = info === undefined ? undefined : ao ? info.ao : info.noao;
      const refused =
        info !== undefined &&
        info.gen === slot.refusedGen &&
        (slot.refusedAo === undefined || slot.refusedAo === ao);
      if (
        info !== undefined &&
        variant?.state === "hit" &&
        !refused &&
        usable(variant, info.camera, info.axis, pose)
      ) {
        const url = api.thumbImageUrl(entry.path, entry.mtime, ao, info.gen);
        if (slot.url !== undefined && slot.url !== url) release(slot.url);
        slot.url = url;
        slot.urlGen = info.gen;
        slot.urlAo = ao;
        slot.thumbGen = info.gen;
        // Overlaid, deliberately **not** fed to `usable` above: that test is
        // about the server's render, not an orientation only this browser
        // holds (D6). The cost is one extra lookup in one case.
        const local = keepsFramingsLocally(features())
          ? readLocalFraming(entry.path, undefined, libraryId)
          : undefined;
        return {
          status: "ready",
          url,
          camera: local?.camera ?? info.camera,
          axis: local?.axis ?? info.axis,
          gen: info.gen,
        };
      }

      slot.cancels.push(
        lookupQueue.push(async () => {
          if (!alive()) return;
          try {
            // Named only when known, so a slot that has learned none asks the
            // plain call.
            const cached = await (slot.thumbGen === undefined
              ? api.getThumb(entry.path, entry.mtime, ao)
              : api.getThumb(entry.path, entry.mtime, ao, slot.thumbGen));
            if (!alive()) {
              // The lookup minted a URL for a tile that no longer exists.
              if (cached.pngUrl !== undefined) release(cached.pngUrl);
              return;
            }
            // Adopted **after** the gate: a retired pass's generation is one a
            // write has moved past, and keying the next fetch at it lets the
            // immutable cache answer without the server seeing the request.
            if (cached.gen !== undefined) slot.thumbGen = cached.gen;
            if (
              cached.status === "hit" &&
              cached.pngUrl !== undefined &&
              usable(cached, cached.camera, cached.axis, pose)
            ) {
              setThumb(entry.path, {
                status: "ready",
                url: cached.pngUrl,
                camera: cached.camera,
                axis: cached.axis,
                gen: slot.thumbGen,
              });
              return;
            }
            // Keep the old PNG until the replacement exists, so a failed tail
            // falls back to it rather than degrading a fine tile to an error.
            let staleUrl = cached.pngUrl;
            const dropStale = () => {
              if (staleUrl !== undefined) {
                release(staleUrl);
                staleUrl = undefined;
              }
            };
            // A cancelled job never runs, so cleanup must release this. On the
            // slot, so a retirement leaves the *displayed* URL alone.
            slot.cancels.push(dropStale);
            // Keyed by path, so the queue ranks this by the tile's band (D4).
            const cancelRender = queue.push(async () => {
              if (!alive()) return dropStale();
              try {
                // Nothing drives the shared renderer while a view is active.
                await queue.whenResumed();
                if (!alive()) return dropStale();
                const object = await lru.acquire(entry.path);
                if (!alive()) return dropStale();
                await queue.whenResumed();
                if (!alive()) return dropStale();
                // The index's opinion frames the render but is deliberately
                // not persisted, so an orbit still wins.
                const posed =
                  cached.camera === undefined && cached.axis === undefined
                    ? cameraForPose(pose, DEFAULT_CAMERA)
                    : null;
                const camera = cached.camera ?? posed?.camera ?? DEFAULT_CAMERA;
                const axis =
                  cached.axis ??
                  posed?.axis ??
                  defaultAxisFor(formatOfEntry(entry));
                const png = await renderThumbnail(object, camera, axis, ao);
                // Above the PUT, not only below: `suspend()` cannot stop a
                // started job, so a retired pass would overwrite the tile the
                // incoming one is settling.
                if (!alive()) return dropStale();
                const written = await api.putThumb({
                  path: entry.path,
                  mtime: entry.mtime,
                  png,
                  lighting: THUMB_LIGHTING,
                  rig: RIG_VERSION,
                  posed: posed !== null ? POSE_VERSION : undefined,
                  // So a changed opinion is detectable later (D2).
                  poseKey: posed !== null ? poseKeyOf(posed) : undefined,
                  // The lookup's reading, not a fresh one.
                  ao,
                });
                // Without the echo this pass would go on asking under the
                // number it just invalidated.
                if (written.gen !== undefined) slot.thumbGen = written.gen;
                if (!alive()) return dropStale();
                setThumb(entry.path, {
                  status: "ready",
                  url: URL.createObjectURL(png),
                  camera: cached.camera,
                  axis: cached.axis,
                  gen: slot.thumbGen,
                });
                dropStale();
              } catch {
                if (alive() && staleUrl !== undefined) {
                  // Displayed now — ownership moves to the slot, via setThumb.
                  const url = staleUrl;
                  staleUrl = undefined;
                  setThumb(entry.path, {
                    status: "ready",
                    url,
                    camera: cached.camera,
                    axis: cached.axis,
                    gen: slot.thumbGen,
                  });
                } else if (alive()) {
                  // The lookup catch's rule: a render failing after a miss must
                  // not blank an image a previous pass put here.
                  setThumb(entry.path, {
                    status: "error",
                    url: slot.url,
                    gen: slot.thumbGen,
                  });
                } else {
                  dropStale();
                }
              }
            }, entry.path);
            slot.cancels.push(cancelRender);
          } catch {
            // Carrying the slot's URL, not a bare error: bare, it revokes, and
            // a toggle whose lookups 500 would blank every tile it touched.
            if (alive())
              setThumb(entry.path, {
                status: "error",
                url: slot.url,
                gen: slot.thumbGen,
              });
          }
        }, entry.path),
      );
      return undefined;
    }
    // Published every run, so late callers reach the live closure.
    startRef.current = start;

    // A new mtime is a different cache key, so a different entry.
    for (const [path, slot] of slots) {
      const entry = wanted.get(path);
      if (entry !== undefined && entry.mtime === slot.entry.mtime) continue;
      retire(slot);
      if (slot.url !== undefined) release(slot.url);
      slots.delete(path);
      removed.push(path);
    }

    // Entries that arrived, and survivors whose recipe moved under them.
    for (const entry of models) {
      const slot = slots.get(entry.path);
      const pose = poses[entry.path];
      if (slot === undefined) {
        const fresh: EntrySlot = {
          entry,
          generation: 0,
          ao,
          pose,
          cancels: [],
          url: undefined,
          thumbGen: undefined,
          refusedGen: undefined,
          refusedAo: undefined,
          urlGen: undefined,
          urlAo: undefined,
        };
        slots.set(entry.path, fresh);
        added.push(entry.path);
        const seeded = start(entry, fresh);
        if (seeded !== undefined) answered.set(entry.path, seeded);
        continue;
      }
      // A generation this slot has not seen is another writer's work, and a
      // tile pinned `immutable` at the old number would show wrong pixels with
      // no request that could discover it. *No* annotation is not a new fact.
      const newGen =
        entry.thumb !== undefined &&
        entry.thumb.gen !== slot.thumbGen &&
        entry.thumb.gen !== slot.entry.thumb?.gen;
      slot.entry = entry;
      // A survivor with unchanged inputs keeps its work in flight: a peek
      // landing beside it must not restart it.
      if (slot.ao === ao && samePose(slot.pose, pose) && !newGen) continue;
      // Retirement, not a reset: the tile keeps the image and state it is
      // showing until the replacement lands (D3).
      retire(slot);
      slot.ao = ao;
      slot.pose = pose;
      const seeded = start(entry, slot);
      if (seeded !== undefined) answered.set(entry.path, seeded);
    }

    if (removed.length > 0 || added.length > 0 || answered.size > 0) {
      setThumbs((prev) => {
        const next = new Map(prev);
        // Removals first: on one key, the addition has to win.
        for (const path of removed) next.delete(path);
        for (const path of added) next.set(path, { status: "loading" });
        // After the placeholders, so nothing seeds `loading` over a tile the
        // listing has already drawn (D3).
        for (const [path, state] of answered) next.set(path, state);
        return next;
      });
    }
    // `poses` is a dependency because a listing's second wave (D3) changes that
    // map and nothing else; it is safe as one only because App keeps the map
    // reference-stable per render. `RIG_VERSION` is deliberately absent (D2).
  }, [
    entries,
    api,
    lru,
    queue,
    setThumb,
    ao,
    poses,
    applyRanking,
    features,
    libraryId,
  ]);

  // Its own effect: the sweep must have no cleanup at all, or React tears every
  // entry down before each re-run and leaves nothing to reconcile against.
  useEffect(() => {
    return () => {
      const slots = slotsRef.current;
      for (const slot of slots.values()) {
        slot.generation++;
        for (const cancel of slot.cancels) cancel();
        if (slot.url !== undefined) release(slot.url);
      }
      // <StrictMode> remounts with refs preserved, so a populated map makes the
      // remount's reconciler see every entry as present and start nothing.
      slots.clear();
    };
  }, []);

  return {
    thumbs,
    setThumb,
    refetch,
    setPlaceholder,
    discardThumbFraming,
    applyLocalFramings,
    setBands,
    reportImageError,
  };
}
