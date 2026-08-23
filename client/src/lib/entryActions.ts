/**
 * The entry actions, defined once (entry-actions R1).
 *
 * Every surface that offers an action on a listing entry — the grid's context
 * menu, the lightbox's info panel — invokes the definition here rather than
 * carrying its own. What stays per-surface is presentation only: the word
 * "copied", where a failure sentence is rendered. The behavior, including the
 * failure sentence itself, is one thing.
 *
 * These are **commands** (design D1): one-shot, stateless, identical wherever
 * invoked. The lightbox's orbit-axis picker and spindle flip are controls —
 * bound to a live camera, meaningless without a rendered model — and stay where
 * they are.
 */
import type * as THREE from 'three'
import type {
  CameraState,
  DirEntry,
  IndexAvailability,
  IndexPose,
  OrbitAxis,
} from '../../../shared/types'
import type { ApiClient } from '../api/client'
import type { ThumbState } from '../hooks/useThumbnails'
import type { Action } from '../state/reducer'
import { indexCovers } from '../state/selectors'
import { DEFAULT_CAMERA } from '../three/camera'
import type { MeshLru } from '../three/lru'
import { cameraForPose, POSE_VERSION } from '../three/pose'
import type { RenderQueue } from '../three/queue'
import { RIG_VERSION, renderThumbnail } from '../three/renderer'
import { getLightingMode } from '../viewer/lighting'

/** One id per command. The closed list is the menu's budget (D6). */
export type CommandId =
  | 'open'
  | 'reveal'
  | 'copyPath'
  | 'findSimilar'
  | 'reRenderThumbnail'
  | 'resetFraming'

/**
 * The per-surface half of a host: brief feedback, rendered however the surface
 * renders it — a button that says "copied", a line under the path bar. The
 * *sentence* a failure reports is not per-surface; it comes from here.
 */
export interface Feedback {
  /** Brief success feedback. */
  confirm: () => void
  /** Brief failure text. */
  report: (message: string) => void
}

/**
 * What a command needs from the app. One object, passed by every surface — a
 * command that took a DOM node, a URL builder or a fetch would be a second
 * implementation wearing the module's name.
 *
 * The two view-changing commands take the dispatch side of this and nothing
 * else (D8): `reveal` goes through `navigate`, which is App's one
 * `commit({ type: 'navigate', path, prefs: ownPrefs() })`, and `findSimilar`
 * dispatches `{ type: 'similar' }`. Neither builds a URL, calls `pushState`, or
 * touches `window.history`.
 */
export interface ActionHost extends Feedback {
  /** App's `navigate`: one `commit({ type: 'navigate', … })`, plus the ephemeral
   *  resets every navigation owes (find text, the reveal mark). */
  navigate: (path: string) => void
  /** The reducer's dispatch, for the transitions that are not a navigation. */
  dispatch: (action: Action) => void
  /**
   * Arm the locate-on-arrival mark for `path` — component-local state in App,
   * never a view field (D8): the reducer never reads a highlight, the same rule
   * that keeps `findText` out of it.
   *
   * Called **after** `navigate`, deliberately: the mark reset lives inside
   * `navigate` beside the find-text reset, so arming first would clear the mark
   * this very command is setting.
   */
  markOnArrival: (path: string) => void
  /** Activate the entry exactly as its tile does — a container is browsed into,
   *  a model is presented in the expanded viewer. `el` anchors the lightbox's
   *  opening rect; surfaces without one pass null. */
  open: (entry: DirEntry, el: HTMLElement | null) => void
  /**
   * The index's poses, from `state.result.poses` — the landed answer's own
   * field, plumbed rather than read anywhere new (task 1.0). Populated by a
   * meaning *or* a similarity landing (both ride `hitsToEntries`), so outside
   * such a grid every model takes the no-pose branch. Read by both thumbnail
   * commands, which resolve an orientation against it.
   */
  poses: Record<string, IndexPose>
  /**
   * The cache, through the one ApiClient (architecture D1). The thumbnail
   * commands need both halves: the stored orientation to render from, and
   * somewhere to put the pixels.
   */
  api: Pick<ApiClient, 'getThumb' | 'putThumb'>
  /** Meshes come from the LRU the grid already loads through, so a re-render
   *  reuses bytes a thumbnail or an orbit has already paid for. */
  lru: Pick<MeshLru<THREE.Object3D>, 'acquire'>
  /** The single shared renderer's queue (architecture D2/D3). */
  queue: Pick<RenderQueue, 'push' | 'whenResumed'>
  /** `useThumbnails`' own setter. The map is not a mirror of the server, it is
   *  what the tile draws and what the lightbox opens at, so a command that
   *  wrote only to the cache would not take effect until the next load (4b.4). */
  setThumb: (path: string, state: ThumbState) => void
}

/** What availability is decided from. `index` is the reducer's own cell — never
 *  a probe issued when a menu opens (D6/2.5). */
export interface AvailabilityContext {
  index: IndexAvailability | null
}

/** The failure sentence for a clipboard write that did not land. One string, so
 *  the menu and the info panel report the same thing (R1). */
export const COPY_FAILED = 'Could not copy the path — the clipboard refused.'

/**
 * Copy an entry's virtual path. **The** copy implementation — the menu reaches
 * it through the command table below, the lightbox's info panel calls it
 * directly, because that panel has a path and somewhere to put a sentence but
 * no dispatch and no tile. Two entry points, one body: the same text on the
 * clipboard, the same sentence when the write fails (R1).
 *
 * `entry.path` is the virtual path, `foo.zip!/parts/lid.stl` for archive
 * entries, unchanged (D2). It is what the info panel shows, what the path bar
 * accepts, and what a shared link uses.
 *
 * The old panel-only fallback — select the rendered text for a manual copy —
 * does not come along. It ranged over a `<p>` a context menu does not have, and
 * it defended a non-secure context this app does not target: `guard.ts` refuses
 * any Host but loopback, so the app cannot be reached over plain HTTP in the
 * first place. A failure is reported instead.
 *
 * The `try` stays even so: outside a secure context `navigator.clipboard` is
 * undefined and the call throws *synchronously*, which a bare `.catch()` misses.
 */
export function copyEntryPath(entry: DirEntry, feedback: Feedback): void {
  try {
    if (navigator.clipboard === undefined) throw new Error('clipboard unavailable')
    void navigator.clipboard.writeText(entry.path).then(
      () => feedback.confirm(),
      () => feedback.report(COPY_FAILED),
    )
  } catch {
    feedback.report(COPY_FAILED)
  }
}

/**
 * The containing folder of a virtual path.
 *
 * For an archive entry the containing folder is the directory *inside* the
 * archive (`foo.zip!/parts/lid.stl` → `foo.zip!/parts`), and an entry at the
 * archive's root reveals to the archive itself (`foo.zip!/lid.stl` →
 * `foo.zip`), which is the listing that holds it. The vpath grammar already
 * addresses both — one `!/`, never nested (architecture D6).
 */
export function containingFolder(path: string): string {
  const zipSep = path.lastIndexOf('!/')
  if (zipSep !== -1) {
    const entry = path.slice(zipSep + 2)
    return entry.includes('/')
      ? path.slice(0, zipSep + 2) + entry.slice(0, entry.lastIndexOf('/'))
      : path.slice(0, zipSep)
  }
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : '/'
}

/**
 * Whether a model could plausibly be a similarity subject.
 *
 * Optimistic by construction (D4): the conditions knowable client-side — it is
 * a model, and it lies inside the collection the index covers, outside an
 * archive — plus the index answering at all. Whether *this* model has been
 * embedded is not asked; the menu offers the action and the view explains the
 * failure when it comes. Asking the index about every tile in a 500-tile grid
 * to grey out an item nobody opened is not a trade worth making.
 *
 * "Inside the indexed collection" is `indexCovers` and nothing else — the same
 * predicate the side panel reads, which also answers the archive half (a vpath
 * is never covered). A second copy of the rule here is how the two would come
 * to disagree about the same model.
 */
function similarApplies(entry: DirEntry, ctx: AvailabilityContext): boolean {
  return entry.kind === 'model' && ctx.index?.state === 'ready' && indexCovers(ctx.index, entry.path)
}

/** The failure sentence for a thumbnail the app could not draw again. One
 *  string for both commands and every surface, like `COPY_FAILED`: they differ
 *  in what they give up, not in how a render that never happened is reported. */
export const RENDER_FAILED = 'Could not re-render the thumbnail.'

/**
 * The body behind both thumbnail commands (D7, §4b). They ask two different
 * questions — *re-render* keeps the model's orientation, *reset framing* gives
 * it up — and everything after that answer is identical, so they are one
 * function with one flag rather than two bodies that drift apart.
 *
 * Not `async`: a command returns nothing and the work belongs to the render
 * queue, which is where the job is put.
 */
function refreshThumbnail(
  entry: DirEntry,
  host: ActionHost,
  opts: { discardFraming: boolean },
): void {
  const { discardFraming } = opts
  host.queue.push(async () => {
    try {
      // Every renderer-touching stage waits out a suspension first: `push`
      // alone is not enough, because `suspend()` cannot stop a job that has
      // already started (queue.ts:40-47), and there is exactly one
      // WebGLRenderer app-wide (architecture D2/D3).
      await host.queue.whenResumed()
      // The stored orientation, read from the cache rather than from the
      // thumbs map: a tile whose lookup or render failed carries no camera at
      // all, and both commands are offered exactly there (4b.7) — resolving
      // from a blank would redraw a user's own orbit at the default. Read
      // after the gate, so a lightbox that persisted a new camera on its way
      // out is already in it. One lookup holding a render slot is not the 500
      // the sweep's own limiter exists to keep out of them.
      const cached = await host.api.getThumb(entry.path, entry.mtime)
      // A hit mints an object URL; this read wanted the orientation, not the
      // old pixels.
      if (cached.pngUrl !== undefined) URL.revokeObjectURL(cached.pngUrl)

      // "Usable" is `cameraForPose`'s answer and nothing else (D7/4b.3a): a
      // malformed pose — off-axis `up`, non-perpendicular `azimuth_zero` —
      // returns null, and a pose with no cached front view is deliberately
      // *not* an exception, since the sweep applies that one too.
      const pose = cameraForPose(host.poses[entry.path], DEFAULT_CAMERA)
      let camera: CameraState
      let axis: OrbitAxis
      let posed: boolean
      if (discardFraming) {
        // What the model resolves to once its own orientation is gone, which
        // is what an untouched model resolves to: the index's where there is a
        // usable one, the default otherwise.
        posed = pose !== null
        camera = pose?.camera ?? DEFAULT_CAMERA
        // The axis goes with the camera only when a pose is there to replace
        // it — half a pose is not a pose. With nothing to replace it the axis
        // stays and frames the model by default about itself, rather than
        // laying a Z-up model on its side for a spindle nobody asked for.
        axis = pose?.axis ?? cached.axis ?? 'y'
      } else {
        // Exactly the sweep's resolution (useThumbnails.ts:194-199): the stored
        // camera/axis, else the pose when *both* are absent, else the default.
        const fromPose = cached.camera === undefined && cached.axis === undefined ? pose : null
        posed = fromPose !== null
        camera = cached.camera ?? fromPose?.camera ?? DEFAULT_CAMERA
        axis = cached.axis ?? fromPose?.axis ?? 'y'
      }
      const dropAxis = discardFraming && pose !== null

      const lighting = getLightingMode() // the mode this render uses
      const object = await host.lru.acquire(entry.path)
      await host.queue.whenResumed()
      const png = await renderThumbnail(object, camera, axis)
      await host.api.putThumb({
        path: entry.path,
        mtime: entry.mtime,
        png,
        // Pixels and the labels that say what drew them — never a viewpoint on
        // re-render: a pose orients the model without becoming its stored
        // camera (semantic-search), so a re-classification still governs it.
        //
        // `null` is the discard the store gained for this (4b.2); `undefined`
        // still means keep. And the labels are not optional: `cache.ts:108-110`
        // clears every label a PNG-bearing PUT omits, so an unlabelled write
        // fails the hit test forever and re-renders the tile on every visit.
        camera: discardFraming ? null : undefined,
        axis: dropAxis ? null : undefined,
        lighting,
        rig: RIG_VERSION,
        posed: posed ? POSE_VERSION : undefined,
      })
      // The session's own copy, not only the server's: App sources the
      // lightbox's camera and axis from this map, so a cache-only write would
      // leave the viewer opening at the orientation just given up (4b.4).
      host.setThumb(entry.path, {
        status: 'ready',
        url: URL.createObjectURL(png),
        camera: discardFraming ? undefined : cached.camera,
        axis: dropAxis ? undefined : cached.axis,
      })
    } catch {
      // The tile keeps whatever it was showing — a render that did not happen
      // is not a reason to degrade a picture that did. Said out loud, though:
      // this one is a user's press, not a background sweep.
      host.report(RENDER_FAILED)
    }
  })
}

export interface EntryCommand {
  readonly id: CommandId
  readonly label: string
  /** D6's table read for one entry, plus the conditions a table cannot show. */
  readonly applies: (entry: DirEntry, ctx: AvailabilityContext) => boolean
  /**
   * `null` while the body is not built yet — a null-bodied command is not
   * rendered, since an inapplicable action is absent rather than present and
   * inert, and so is an unbuilt one. Every command in the table has a body
   * now; the field stays because that is the shape a seventh would arrive in.
   */
  readonly run: ((entry: DirEntry, host: ActionHost, el: HTMLElement | null) => void) | null
}

/**
 * The commands, and D6's per-kind table with them — in one place rather than
 * at each call site:
 *
 * ```
 * model tile           dir tile        zip tile
 * ──────────           ────────        ────────
 * Open                 Open            Open
 * Reveal in app        Reveal in app   Reveal in app
 * Copy path            Copy path       Copy path
 * Find similar         —               —
 * Re-render thumbnail  —               —
 * Reset framing        —               —
 * ```
 *
 * Find similar carries a second condition the table cannot show: the index is a
 * separate service that may not be running, and the action is absent when it is
 * unavailable. So the honest reading is three items on a container, five on a
 * model, and a sixth on a model when the index is answering — a model tile
 * without *find similar* is the degradation `semantic-search` designs for,
 * arriving here.
 */
export const ENTRY_COMMANDS: readonly EntryCommand[] = [
  {
    id: 'open',
    label: 'Open',
    applies: () => true,
    run: (entry, host, el) => host.open(entry, el),
  },
  {
    id: 'reveal',
    label: 'Reveal in app',
    applies: () => true,
    run: (entry, host) => {
      // One navigate and nothing else (D8/3.1): the history push comes from the
      // landing's provenance, latest-wins and the skeleton come from the
      // ordinary request path, and no URL is assembled anywhere.
      //
      // Then the mark, never before — `navigate` clears it on the way past
      // (3.5), so arming first would arm nothing.
      host.navigate(containingFolder(entry.path))
      host.markOnArrival(entry.path)
    },
  },
  {
    id: 'copyPath',
    label: 'Copy path',
    applies: () => true,
    run: (entry, host) => copyEntryPath(entry, host),
  },
  {
    id: 'findSimilar',
    label: 'Find similar',
    applies: similarApplies,
    run: (entry, host) => host.dispatch({ type: 'similar', model: entry.path }),
  },
  {
    id: 'reRenderThumbnail',
    label: 'Re-render thumbnail',
    // Model-only for the same structural reason the framing reset is: container
    // tiles are drawn as glyphs, not renders, so there is no thumbnail to act
    // on. Offered whether or not the cached image is current — a failed image
    // is one of the things re-rendering exists to fix.
    applies: (entry) => entry.kind === 'model',
    // Keeps the model's orientation and replaces its pixels: the manual
    // trigger for a mode or rig change the visible grid was never rebuilt for.
    run: (entry, host) => refreshThumbnail(entry, host, { discardFraming: false }),
  },
  {
    id: 'resetFraming',
    label: 'Reset framing',
    applies: (entry) => entry.kind === 'model',
    // *Framing*, not *thumbnail*: the orientation is keyed by path and shared
    // with the viewer, so giving it up also moves where the lightbox opens
    // this model (D7). Re-rendering without giving it up would reproduce the
    // same badly framed picture, which is why this is a second command.
    run: (entry, host) => refreshThumbnail(entry, host, { discardFraming: true }),
  },
]

/**
 * What a menu raised on a viewer surface — the orbit overlay, the lightbox —
 * withholds (D6's margin).
 *
 * The table above is per-*kind* and stays one table. This is the other axis,
 * per-*surface*, and it is a filter at the call site rather than a seventh
 * column: a row that also had to know where it was being rendered is how the
 * two would come to disagree about the same model.
 *
 * *Open* goes because the model is already open — the command would re-open the
 * thing the menu was raised on. The two thumbnail commands go because from an
 * open viewer they cannot honestly run: their renders wait on
 * `queue.whenResumed()` and the viewer holds the suspension (architecture
 * D2/D3), so they would sit until it closed — and the closing persist then
 * races them, writing the orbited camera straight back over the discard *reset
 * framing* was pressed for. What is left is the three that do not care which
 * surface asked.
 */
export const VIEWER_SURFACE_EXCLUDES: readonly CommandId[] = [
  'open',
  'reRenderThumbnail',
  'resetFraming',
]

/**
 * The commands this entry offers, in menu order: applicable by D6's table,
 * built, and not withheld by the surface that asked. `exclude` is how a surface
 * declines a command it cannot honestly perform; the table never learns who is
 * asking.
 */
export function commandsFor(
  entry: DirEntry,
  ctx: AvailabilityContext,
  exclude: readonly CommandId[] = [],
): EntryCommand[] {
  return ENTRY_COMMANDS.filter(
    (c) => c.run !== null && !exclude.includes(c.id) && c.applies(entry, ctx),
  )
}
