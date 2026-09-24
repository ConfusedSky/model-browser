/**
 * The entry actions, defined once (entry-actions R1): one-shot commands (D1)
 * every surface invokes, with only presentation left per-surface. A control
 * bound to a live camera stays with its surface instead — which the *stored*
 * spindle is not, so a tile's menu offers that one (D7).
 */
import type * as THREE from "three";
import type {
  AppRef,
  AppsReport,
  CameraState,
  DirEntry,
  FeatureReport,
  IndexAvailability,
  IndexPose,
  ModelFormat,
  OrbitAxis,
} from "../../../shared/types";
import type { ApiClient, ThumbSave } from "../api/client";
import { HttpError } from "../api/client";
import { isCurrentRender, type ThumbState } from "../hooks/useThumbnails";
// Type-only, and it must stay that way: `bulkJobs` imports `ActionHost` and
// `renderEntryThumbnail` from here, so a value import back would close the cycle.
import type { JobOperation, JobScope } from "../jobs/bulkJobs";
import { expandLibraryPath } from "./libraryPath";
import type { Action } from "../state/reducer";
import { indexCovers } from "../state/selectors";
import { DEFAULT_CAMERA, defaultAxisFor } from "../three/camera";
import type { MeshLru } from "../three/lru";
import { formatOfEntry } from "../three/models";
import { cameraForPose, POSE_VERSION, poseKeyOf } from "../three/pose";
import type { RenderQueue } from "../three/queue";
import {
  RIG_VERSION,
  renderThumbnail,
  THUMB_LIGHTING,
} from "../three/renderer";
import { aoEnabled } from "../viewer/aoToggle";

export type CommandId =
  | "open"
  | "reveal"
  | "copyPath"
  | "findSimilar"
  | "generateBeneath"
  | "resetBeneath"
  | "reRenderThumbnail"
  | "resetFraming"
  | "openWith";

/** The inline *groups* are here, not in `CommandId`, so the filter has one
 *  vocabulary without calling a group a command. */
export type MenuItemId = CommandId | "orbitAxis" | "openIn";

/** A failure's *sentence* is not per-surface; it comes from here. */
export interface Feedback {
  confirm: () => void;
  report: (message: string) => void;
}

/** Null until the library is `ready` (R4). A string, not the client, so no
 *  command grows a second reader of that route. */
export interface LibraryTop {
  libraryTop: string | null;
}

/** One object, so no command grows its own DOM node, URL builder or fetch, and
 *  none touches `window.history` (D8). */
export interface ActionHost extends Feedback, LibraryTop {
  navigate: (path: string) => void;
  dispatch: (action: Action) => void;
  /** Call **after** `navigate`, which clears the mark on its way past. */
  markOnArrival: (path: string) => void;
  /** Not `api.open`, which opens the file in another application. */
  open: (entry: DirEntry, el: HTMLElement | null) => void;
  /** **Only what is on screen**, which is why `renderEntryThumbnail` takes a
   *  pose parameter for scopes that are not (D7). */
  poses: Record<string, IndexPose | null>;
  api: Pick<ApiClient, "getThumb" | "putThumb" | "open" | "openWith">;
  /** Called when the chooser completes, since that is where a default is set
   *  (L4). */
  refreshApps: () => void;
  lru: Pick<MeshLru<THREE.Object3D>, "acquire">;
  queue: Pick<RenderQueue, "push" | "whenResumed">;
  /** The map the tile draws and the lightbox opens at, so a cache-only write is
   *  invisible until the next load. */
  setThumb: (path: string, state: ThumbState) => void;
  discardThumbFraming: (path: string) => void;
  /** A refusal is App's to say (D2); the commands only ask. */
  launchJob: (operation: JobOperation, scope: JobScope) => void;
  /** Spelled as the write spelled it: a value sets, `null` discards, absence
   *  keeps. Call it after the write resolves and **before** the tile's map is
   *  updated — App falls back to that ready state without `before` (D5). */
  framingChanged: (
    path: string,
    write: FramingWrite,
    before?: StoredFraming,
  ) => void;
}

/** Never a probe issued when a menu opens (D6): `EntryMenu` measures and
 *  focus-seeds from `commands.length` at mount, so a late item would move the
 *  menu and jump focus. `null` reads as "not there". */
export interface AvailabilityContext {
  index: IndexAvailability | null;
  apps: AppsReport | null;
  /** `null` is **not known** — in flight or failed — and an offer is withheld
   *  either way (feature-report D3). */
  features: FeatureReport | null;
}

/** One string for every surface (R1). */
export const COPY_FAILED = "Could not copy the path — the clipboard refused.";

/** No status branching: the client cannot tell a missing launcher from a
 *  nonzero exit (L10). */
export const LAUNCH_FAILED = "Could not open the file in that application.";

/** A different failure: no application was chosen. Split by the action
 *  invoked, never by a status code. */
export const CHOOSER_FAILED =
  "Could not open the chooser to pick an application.";

/**
 * The one copy implementation (R1); the clipboard gets the **filesystem** path
 * (library R2). The `try` is not redundant: `navigator.clipboard` is undefined
 * outside a secure context and the call throws *synchronously*.
 */
export function copyEntryPath(
  entry: DirEntry,
  host: Feedback & LibraryTop,
): void {
  try {
    if (navigator.clipboard === undefined)
      throw new Error("clipboard unavailable");
    void navigator.clipboard
      .writeText(expandLibraryPath(host.libraryTop, entry.path))
      .then(
        () => host.confirm(),
        () => host.report(COPY_FAILED),
      );
  } catch {
    host.report(COPY_FAILED);
  }
}

/** The client's one ascent; inside the archive for an entry, to the archive
 *  for its root (D6). The library's top answers itself. */
export function containingFolder(path: string): string {
  const zipSep = path.lastIndexOf("!/");
  if (zipSep !== -1) {
    const entry = path.slice(zipSep + 2);
    return entry.includes("/")
      ? path.slice(0, zipSep + 2) + entry.slice(0, entry.lastIndexOf("/"))
      : path.slice(0, zipSep);
  }
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "/";
}

/** Optimistic (D4): whether *this* model was embedded is not asked, and the
 *  view explains the failure when it comes. */
function similarApplies(entry: DirEntry, ctx: AvailabilityContext): boolean {
  return (
    entry.kind === "model" &&
    ctx.index?.state === "ready" &&
    indexCovers(ctx.index, entry.path)
  );
}

export const RENDER_FAILED = "Could not re-render the thumbnail.";

/** In this module, not App, because a failure sentence is not per-surface. */
export const JOB_BUSY =
  "A job is already running — cancel it to start another.";

export type FramingWrite = Pick<ThumbSave, "camera" | "axis">;

/** Asked by the bulk derivation, the tab's count and the hand-change delta
 *  alike. A camera **or** an axis: an axis left behind would withhold the pose
 *  that replaces it (`pose-rerender` D7). */
export function resettable(
  camera: CameraState | undefined,
  axis: OrbitAxis | undefined,
): boolean {
  return camera !== undefined || axis !== undefined;
}

export type StoredFraming = {
  camera: CameraState | undefined;
  axis: OrbitAxis | undefined;
};

/** One reading for every surface that gives an orientation up: the axis goes
 *  with the camera, and "usable" is `cameraForPose`'s answer (`pose-rerender` D7). */
export function framingAfterDiscard(
  pose: IndexPose | null | undefined,
  format: ModelFormat,
): { camera: CameraState; axis: OrbitAxis; posed: boolean } {
  const resolved = cameraForPose(pose, DEFAULT_CAMERA);
  return {
    camera: resolved?.camera ?? DEFAULT_CAMERA,
    axis: resolved?.axis ?? defaultAxisFor(format),
    posed: resolved !== null,
  };
}

/** Narrower than `ActionHost`, which the generate job would have had to
 *  invent; `ActionHost` satisfies this structurally. */
export type RenderDeps = {
  /** Optional: the generate job never discards, so it passes none. */
  framingChanged?: ActionHost["framingChanged"];
  api: Pick<ApiClient, "getThumb" | "putThumb">;
  lru: Pick<MeshLru<THREE.Object3D>, "acquire">;
  queue: Pick<RenderQueue, "whenResumed">;
  setThumb: ActionHost["setThumb"];
};

/**
 * One body for both commands and the bulk job (D7), which is why the **pose is a
 * parameter**: a job's scope is not on screen. `'skipped'` is a refused write or
 * a dropped encode, `'current'` a render already stored; anything else throws.
 */
export async function renderEntryThumbnail(
  entry: DirEntry,
  deps: RenderDeps,
  opts: {
    discardFraming: boolean;
    /** A settled `null` means drawn at the default (`pose-rerender` D5). */
    pose: IndexPose | null | undefined;
    /** Makes the write conditional (D4); absent for a user's press. */
    ifGen?: number;
    /** Pin the write to this body's *own* lookup, so a write made in between
     *  wins and this one is refused. Beats `ifGen`. */
    pinToLookup?: boolean;
    /** The job asks for it; a command never does. */
    skipIfCurrent?: boolean;
  },
): Promise<"done" | "skipped" | "current"> {
  const { discardFraming } = opts;
  // `push` alone cannot stop a started job, and there is one renderer (D2/D3).
  await deps.queue.whenResumed();
  // One reading for the lookup, the pixels and the PUT (D4).
  const ao = aoEnabled();
  // From the cache, not the thumbs map, which holds no camera for the failed
  // tiles both commands are offered on.
  const cached = await deps.api.getThumb(
    entry.path,
    entry.mtime,
    ao,
    undefined,
    false,
  );

  // Never assumed: a press means it whatever the cache says, and "current" says
  // nothing about the orientation a discard is about.
  if (
    opts.skipIfCurrent === true &&
    !discardFraming &&
    isCurrentRender(
      {
        state: cached.status,
        lighting: cached.lighting,
        rig: cached.rig,
        posed: cached.posed,
        poseKey: cached.poseKey,
      },
      cached.camera,
      cached.axis,
      opts.pose,
    )
  ) {
    return "current";
  }

  const pose = cameraForPose(opts.pose, DEFAULT_CAMERA);
  let camera: CameraState;
  let axis: OrbitAxis;
  let posed: boolean;
  if (discardFraming) {
    // The rule the lightbox panel's live reset reads too.
    ({ camera, axis, posed } = framingAfterDiscard(
      opts.pose,
      formatOfEntry(entry),
    ));
  } else {
    // The sweep's own resolution.
    const fromPose =
      cached.camera === undefined && cached.axis === undefined ? pose : null;
    posed = fromPose !== null;
    camera = cached.camera ?? fromPose?.camera ?? DEFAULT_CAMERA;
    axis =
      cached.axis ?? fromPose?.axis ?? defaultAxisFor(formatOfEntry(entry));
  }

  const object = await deps.lru.acquire(entry.path, entry.mtime);
  await deps.queue.whenResumed();
  const png = await renderThumbnail(object, camera, axis, ao);
  const written = await deps.api
    .putThumb({
      path: entry.path,
      mtime: entry.mtime,
      png,
      ao,
      // Never a viewpoint on re-render: a pose frames without becoming the
      // camera. The labels are not optional — `ThumbCache.put` clears every one
      // a PNG-bearing PUT omits.
      camera: discardFraming ? null : undefined,
      axis: discardFraming ? null : undefined,
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
      posed: posed ? POSE_VERSION : undefined,
      poseKey: posed ? poseKeyOf({ camera, axis }) : undefined,
      ifGen: opts.pinToLookup === true ? cached.gen : opts.ifGen,
    })
    .catch((err: unknown) => {
      // Not a failure but D4's outcome: somebody else's write stands.
      if (err instanceof HttpError && err.status === 412) return null;
      throw err;
    });
  if (written === null) return "skipped";
  if (discardFraming) {
    deps.framingChanged?.(
      entry.path,
      { camera: null, axis: null },
      { camera: cached.camera, axis: cached.axis },
    );
  }
  deps.setThumb(entry.path, {
    status: "ready",
    url: URL.createObjectURL(png),
    camera: discardFraming ? undefined : cached.camera,
    axis: discardFraming ? undefined : cached.axis,
    gen: written.gen,
  });
  // Pixels the encoder dropped never reached the store (`webp-thumbnails` D6),
  // so no work was done — but the tile shows them, hence the late test.
  return written.dropped === true ? "skipped" : "done";
}

/** The command half of both thumbnail commands (D7). */
function refreshThumbnail(
  entry: DirEntry,
  host: ActionHost,
  opts: { discardFraming: boolean; pinToLookup?: boolean },
): void {
  const { discardFraming, pinToLookup } = opts;
  host.queue.push(async () => {
    try {
      await renderEntryThumbnail(entry, host, {
        discardFraming,
        pinToLookup,
        pose: host.poses[entry.path],
      });
    } catch {
      // The tile keeps what it was showing, but a press is told.
      host.report(RENDER_FAILED);
    }
  });
}

export interface LiveFramingView {
  /** Moves the view *and* drops the session's claim on the orientation, so the
   *  close that follows writes nothing. */
  reframe: (camera: CameraState, axis: OrbitAxis) => void;
}

export const RESET_FAILED = "Could not reset the framing.";

/**
 * *Reset framing* from the surface **showing** the model: discard and re-frame
 * now, pixels later. The re-render is queued because the open view holds the
 * queue suspended, so it reads the stored orientation after the close — pinned
 * to its own lookup, so an orbit landing in between wins (`pose-rerender` D4).
 */
export function resetFramingLive(
  entry: DirEntry,
  host: ActionHost,
  view: LiveFramingView | null,
): void {
  // Nothing stored survives a reset, so none is read.
  const framing = framingAfterDiscard(
    host.poses[entry.path],
    formatOfEntry(entry),
  );
  void host.api
    .putThumb({
      path: entry.path,
      mtime: entry.mtime,
      // No png and no labels, which describe pixels this does not touch. `ao`
      // decides nothing: a pixel-less change invalidates both renders (D2).
      camera: null,
      axis: null,
      ao: aoEnabled(),
    })
    .then(
      // The tile's own copy, not only the server's: App opens the lightbox at
      // what this map holds, and reads the tile for the before-state.
      () => {
        host.framingChanged(entry.path, { camera: null, axis: null });
        host.discardThumbFraming(entry.path);
      },
      () => host.report(RESET_FAILED),
    );
  view?.reframe(framing.camera, framing.axis);
  refreshThumbnail(entry, host, { discardFraming: false, pinToLookup: true });
}

/*
 * ── The axis picker's vocabulary ─────────────────────────────────────────────
 *
 * A spindle reads as `letter × sign` on both surfaces, so the rules and the
 * class strings live here. Not in `ViewerLayer`, which already imports
 * `EntryMenu` — an export the other way would close a module cycle.
 */

export const AXIS_LETTERS = ["x", "y", "z"] as const;
export type AxisLetter = (typeof AXIS_LETTERS)[number];

export function isAxisNegated(axis: OrbitAxis): boolean {
  return axis.startsWith("-");
}

export function axisLetter(axis: OrbitAxis): AxisLetter {
  return (isAxisNegated(axis) ? axis.slice(1) : axis) as AxisLetter;
}

/** That letter **at the sign in force**: `−Z` + `X` is `−X`, since the sign is
 *  the flip pill's to say. */
export function axisWithLetter(
  current: OrbitAxis,
  letter: AxisLetter,
): OrbitAxis {
  return (isAxisNegated(current) ? `-${letter}` : letter) as OrbitAxis;
}

export function negatedAxis(current: OrbitAxis): OrbitAxis {
  return (
    isAxisNegated(current) ? current.slice(1) : `-${current}`
  ) as OrbitAxis;
}

export const AXIS_GROUP_CLASS =
  "flex items-center gap-0.5 rounded-lg bg-sunken p-0.5 text-xs ring-1 ring-line";
/** A `<span>`, so it stays out of any button index. */
export const AXIS_CAPTION_CLASS = "px-1.5 text-ink-3";
export const AXIS_DIVIDER_CLASS = "mx-0.5 h-4 w-px bg-line-strong";
/** The spindle in force is the *filled* pill. */
export const axisPillClass = (active: boolean): string =>
  `rounded-md px-2.5 py-1.5 touch:py-2.5 ${active ? "bg-accent font-medium text-accent-ink" : "text-ink-2 hover:bg-white/5 hover:text-ink"}`;
/** Neutral rather than the accent: a state, not a pick. */
export const flipPillClass = (active: boolean): string =>
  `rounded-md px-2.5 py-1.5 touch:py-2.5 ${active ? "bg-white/15 font-medium text-ink ring-1 ring-line-strong" : "text-ink-2 hover:bg-white/5 hover:text-ink"}`;
export const FLIP_TITLE = "Negate the spindle axis (+axis ↔ −axis)";

/** Model-only — a container tile is a glyph with no spindle — and withheld on
 *  the lightbox by the same filter the commands use. */
export function orbitAxisApplies(
  entry: DirEntry,
  exclude: readonly MenuItemId[] = [],
): boolean {
  return entry.kind === "model" && !exclude.includes("orbitAxis");
}

/**
 * The stored camera is **discarded**, never rewritten to a default: angles
 * measured about one axis do not describe a view about another.
 *
 * **No `posed` label, and that is not an omission**: the pose path wants both a
 * missing camera and a missing axis, so choosing an axis takes this model out of
 * pose framing for good. `lighting` and `rig` must still ride along.
 */
export function setOrbitAxis(
  entry: DirEntry,
  host: ActionHost,
  axis: OrbitAxis,
  current: OrbitAxis,
): void {
  if (axis === current) return;
  host.queue.push(async () => {
    try {
      // Gated twice: `push` alone cannot stop a started job (D2/D3).
      await host.queue.whenResumed();
      const object = await host.lru.acquire(entry.path, entry.mtime);
      await host.queue.whenResumed();
      // What an ordinary visit resolves to for an axis with no camera, so the
      // tile and the next sweep agree.
      const ao = aoEnabled();
      const png = await renderThumbnail(object, DEFAULT_CAMERA, axis, ao);
      const written = await host.api.putThumb({
        path: entry.path,
        mtime: entry.mtime,
        png,
        camera: null,
        axis,
        lighting: THUMB_LIGHTING,
        rig: RIG_VERSION,
        ao,
      });
      host.framingChanged(entry.path, { camera: null, axis });
      host.setThumb(entry.path, {
        status: "ready",
        url: URL.createObjectURL(png),
        camera: undefined,
        axis,
        gen: written.gen,
      });
    } catch {
      host.report(RENDER_FAILED);
    }
  });
}

/*
 * ── The open-in group's vocabulary ───────────────────────────────────────────
 *
 * An **inline pill row** rather than a submenu (open-in-slicer L3): focus in
 * `EntryMenu` is one flat index over buttons, and a submenu would want open
 * state, a clamp, focus handoff and a second Escape level.
 */

/** The format detector *is* the mime table (L6): one prefix, not a second map
 *  to drift. */
function entryMime(entry: DirEntry): string | null {
  if (entry.kind !== "model" || entry.format === undefined) return null;
  return `model/${entry.format}`;
}

/** The default first, then the associated (R1). **By id, never by name** — two
 *  applications sharing a `Name=` are two pills. */
export function openInApps(
  entry: DirEntry,
  ctx: AvailabilityContext,
  exclude: readonly MenuItemId[] = [],
): AppRef[] {
  if (exclude.includes("openIn")) return [];
  const mime = entryMime(entry);
  const type = mime === null ? undefined : ctx.apps?.types[mime];
  if (type === undefined) return [];
  const lead = type.default;
  if (lead === null) return type.associated;
  return [lead, ...type.associated.filter((a) => a.id !== lead.id)];
}

/** One-shot in D1's full sense: no viewer, no mesh, no queue, no mode, and
 *  silent on success. */
export function openEntryIn(
  entry: DirEntry,
  host: ActionHost,
  appId: string,
): void {
  void host.api
    .open(entry.path, appId)
    .then(undefined, () => host.report(LAUNCH_FAILED));
}

/** The refetch runs on **both** outcomes: a failure can be a second chooser
 *  refusing after the first already set a default (L9). */
export function openEntryWith(entry: DirEntry, host: ActionHost): void {
  void host.api.openWith(entry.path).then(
    () => host.refreshApps(),
    () => {
      host.report(CHOOSER_FAILED);
      host.refreshApps();
    },
  );
}

export interface EntryCommand {
  readonly id: CommandId;
  readonly label: string;
  /** Resolved by `commandsFor`, so no surface learns entry kinds. */
  readonly labelFor?: (entry: DirEntry) => string;
  readonly applies: (entry: DirEntry, ctx: AvailabilityContext) => boolean;
  /** `null` is an unbuilt body: not rendered, like an inapplicable command. */
  readonly run:
    | ((entry: DirEntry, host: ActionHost, el: HTMLElement | null) => void)
    | null;
}

/** The commands that tend the library's thumbnails rather than use a model:
 *  drawn after a divider, so an everyday action is never the neighbour of a
 *  destructive one. */
export const MAINTENANCE_COMMANDS: ReadonlySet<CommandId> = new Set([
  "generateBeneath",
  "resetBeneath",
  "reRenderThumbnail",
  "resetFraming",
]);

/**
 * The commands, and D6's per-kind table with them — in one place rather than
 * at each call site:
 *
 * ```
 * model tile                   dir tile                       zip tile
 * ──────────                   ────────                       ────────
 * View model                   Open folder                    Open archive
 * Show in folder               Show in folder                 Show in folder
 * Copy path                    Copy path                      Copy path
 * Find similar                 —                              —
 * —                            Generate thumbnails beneath    Generate thumbnails beneath
 * —                            Reset framings beneath         Reset framings beneath
 * Re-render thumbnail          —                              —
 * Reset framing                —                              —
 * Open with…                   —                              —
 * Orbit axis ×6                —                              —
 * open in <app> …              —                              —
 * ```
 *
 * The last two rows are groups, not commands: `orbitAxisApplies` and
 * `openInApps` answer for them. Five rows also wait on something outside this
 * app — a facility that has to be there, or a deployment that has to accept
 * what the row produces — named in their own `applies`, and are absent rather
 * than inert without it.
 */
export const ENTRY_COMMANDS: readonly EntryCommand[] = [
  {
    id: "open",
    label: "Open",
    // Beside `open in <X>` and *Open with…*, a bare "Open" is one too many.
    labelFor: (entry) =>
      entry.kind === "model"
        ? "View model"
        : entry.kind === "dir"
          ? "Open folder"
          : "Open archive",
    applies: () => true,
    run: (entry, host, el) => host.open(entry, el),
  },
  {
    id: "reveal",
    label: "Show in folder",
    applies: () => true,
    run: (entry, host) => {
      // The mark after the navigate, never before: `navigate` clears it on
      // the way past (D8).
      host.navigate(containingFolder(entry.path));
      host.markOnArrival(entry.path);
    },
  },
  {
    id: "copyPath",
    label: "Copy path",
    applies: () => true,
    run: (entry, host) => copyEntryPath(entry, host),
  },
  {
    id: "findSimilar",
    label: "Find similar",
    applies: similarApplies,
    run: (entry, host) => host.dispatch({ type: "similar", model: entry.path }),
  },
  // **Uncounted labels, deliberately** (D5): a count arriving a round trip
  // later would move the menu and jump focus. The chip states it instead.
  {
    id: "generateBeneath",
    label: "Generate thumbnails beneath",
    // **Both**: under `maintenance` without `thumbWrites` this job is a loop
    // that renders and discards (`public-deployment` D4).
    applies: (entry, ctx) =>
      entry.kind !== "model" &&
      ctx.features?.maintenance === true &&
      ctx.features.thumbWrites === true,
    // The chip names the scope as the tile named it (library-overrides D7).
    run: (entry, host) =>
      host.launchJob("generate", {
        path: entry.path,
        label: entry.displayName ?? entry.name,
      }),
  },
  {
    id: "resetBeneath",
    label: "Reset framings beneath",
    // `maintenance` alone: the route refuses these writes without being asked.
    applies: (entry, ctx) =>
      entry.kind !== "model" && ctx.features?.maintenance === true,
    // No confirmation here: the runner parks in `confirming` with a count this
    // press cannot state (D5).
    run: (entry, host) =>
      host.launchJob("reset", {
        path: entry.path,
        label: entry.displayName ?? entry.name,
      }),
  },
  {
    id: "reRenderThumbnail",
    label: "Re-render thumbnail",
    // Offered even on a current image: a failed one is what this exists to fix.
    // **Everything it produces is pixels** — the orientation is left as found —
    // so where the deployment would not store them the press does nothing at
    // all, and the row goes rather than render and discard. `resetFraming`
    // stays: giving up an orientation moves the model whoever keeps it.
    applies: (entry, ctx) =>
      entry.kind === "model" && ctx.features?.thumbWrites === true,
    run: (entry, host) =>
      refreshThumbnail(entry, host, { discardFraming: false }),
  },
  {
    id: "resetFraming",
    label: "Reset framing",
    applies: (entry) => entry.kind === "model",
    // A second command because the orientation is shared with the viewer (D7).
    run: (entry, host) =>
      refreshThumbnail(entry, host, { discardFraming: true }),
  },
  {
    id: "openWith",
    label: "Open with…",
    // Read from the session's report, never probed (L5).
    applies: (entry, ctx) =>
      entry.kind === "model" && ctx.apps?.chooser === true,
    run: (entry, host) => openEntryWith(entry, host),
  },
];

/**
 * The per-*surface* axis of the table above, as a call-site filter so no row has
 * to know where it is rendered (D6). *Re-render* goes because its render waits
 * on `queue.whenResumed()` while the open view holds the suspension (D2/D3);
 * *reset framing* is rerouted to `resetFramingLive` rather than withheld.
 *
 * **The orbit overlay must not be filtered by this list**: filtering it gives a
 * right-click within a second of an orbit the three-item lightbox menu.
 */
export const LIGHTBOX_MENU_EXCLUDES: readonly MenuItemId[] = [
  "open",
  "reRenderThumbnail",
  "orbitAxis",
];

// Neither list names the container rows: the lightbox only opens a model.

/**
 * Deliberately not the menu's list on the same surface: the panel already shows
 * the path it would copy. The launch rows are deliberately *absent* from this
 * list (L10) — a one-shot launch changes nothing in this view.
 */
export const LIGHTBOX_PANEL_EXCLUDES: readonly MenuItemId[] = [
  "open",
  "copyPath",
  "reRenderThumbnail",
  "orbitAxis",
];

/** For a surface that renders its own affordances rather than the rows. */
export function runCommand(
  id: CommandId,
  entry: DirEntry,
  host: ActionHost,
  el: HTMLElement | null = null,
): void {
  ENTRY_COMMANDS.find((c) => c.id === id)?.run?.(entry, host, el);
}

/** `exclude` is how a surface declines a command it cannot honestly perform;
 *  the table never learns who is asking. */
export function commandsFor(
  entry: DirEntry,
  ctx: AvailabilityContext,
  exclude: readonly MenuItemId[] = [],
): EntryCommand[] {
  return ENTRY_COMMANDS.filter(
    (c) => c.run !== null && !exclude.includes(c.id) && c.applies(entry, ctx),
  ).map((c) =>
    c.labelFor === undefined ? c : { ...c, label: c.labelFor(entry) },
  );
}
