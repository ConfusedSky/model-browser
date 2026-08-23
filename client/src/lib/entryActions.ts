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
 * invoked. The lightbox's spindle flip and the picker's animated rotation are
 * controls — bound to a live camera, meaningless without a rendered model — and
 * stay where they are.
 *
 * **Revised 2026-08-22 (follow-up 6.7).** This doc used to say "the lightbox's
 * orbit-axis picker and spindle flip are controls", and read that as putting
 * the axis itself out of a menu's reach. That was two claims in one coat.
 * Rotating a live view to a new spindle is a control; *which spindle this model
 * is stored about* is a fact about the model, and setting it is one-shot,
 * completes on its own and leaves no mode behind — a command by D1's own test.
 * So a model **tile's** menu offers the six axes (`ORBIT_AXIS_CHOICES`,
 * `setOrbitAxis`) and the picker goes on being the control for a view that is
 * open. The two never appear together: the lightbox withholds the group
 * (`'orbitAxis'` in the exclusion lists below), and the orbit overlay — which
 * carries no picker — offers it as the tile does (6.8). Recorded in design.md
 * D7, under the heading that carried the old rule.
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
 * What a surface can withhold: every command, plus the menu's orbit-axis group
 * (6.7), which is not a command — it is six of them wearing one heading, and it
 * has no row in the table below.
 *
 * It is in *this* union rather than in `CommandId` so that "one id per command"
 * stays true, and in the union at all so that the per-surface filter has one
 * vocabulary: `LIGHTBOX_MENU_EXCLUDES` says what the lightbox does not offer,
 * in one list, whether or not the thing it names has a body.
 */
export type MenuItemId = CommandId | 'orbitAxis'

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
  /** The same map's framing-only discard, for the one command that gives an
   *  orientation up without drawing anything (`resetFramingLive`). */
  discardThumbFraming: (path: string, dropAxis: boolean) => void
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
 * What a model resolves to once its own stored orientation is given up — the
 * one reading of D7's rule, for every surface that gives one up.
 *
 * A discarded orientation resolves the way an untouched model resolves, as far
 * as the view can know it: the index's pose where the view's landed answer
 * carries a usable one, the default otherwise. "Usable" is `cameraForPose`'s
 * answer and nothing else — a malformed pose (off-axis `up`, a non-perpendicular
 * `azimuth_zero`) is not usable, and a pose with no cached front view
 * deliberately *is*, since the thumbnail sweep applies that one too.
 *
 * `posed` carries both halves of what a caller does with the answer: it is the
 * label these pixels get, and it is exactly when the stored **axis** goes as
 * well. Half a pose is not a pose (`useThumbnails` offers one only when neither
 * a camera nor an axis is stored), and with no pose to replace it the axis
 * stays — framing the model by default about its own spindle rather than laying
 * a Z-up model on its side for a spindle nobody asked for.
 */
export function framingAfterDiscard(
  pose: IndexPose | undefined,
  keptAxis: OrbitAxis,
): { camera: CameraState; axis: OrbitAxis; posed: boolean } {
  const resolved = cameraForPose(pose, DEFAULT_CAMERA)
  return {
    camera: resolved?.camera ?? DEFAULT_CAMERA,
    axis: resolved?.axis ?? keptAxis,
    posed: resolved !== null,
  }
}

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

      // The index's orientation for this model, for the re-render branch — the
      // discard branch reads it through `framingAfterDiscard`, which is where
      // "usable" is decided (D7/4b.3a).
      const pose = cameraForPose(host.poses[entry.path], DEFAULT_CAMERA)
      let camera: CameraState
      let axis: OrbitAxis
      let posed: boolean
      if (discardFraming) {
        // What the model resolves to once its own orientation is gone —
        // resolved by the shared rule, which the lightbox panel's live reset
        // reads too, so the two surfaces cannot disagree about the same model.
        ;({ camera, axis, posed } = framingAfterDiscard(
          host.poses[entry.path],
          cached.axis ?? 'y',
        ))
      } else {
        // Exactly the sweep's resolution (useThumbnails.ts:194-199): the stored
        // camera/axis, else the pose when *both* are absent, else the default.
        const fromPose = cached.camera === undefined && cached.axis === undefined ? pose : null
        posed = fromPose !== null
        camera = cached.camera ?? fromPose?.camera ?? DEFAULT_CAMERA
        axis = cached.axis ?? fromPose?.axis ?? 'y'
      }
      // `posed` says a usable pose replaced the orientation, which is exactly
      // when the stored axis goes with it.
      const dropAxis = discardFraming && posed

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

/** The failure sentence for a discard the store did not accept. */
export const RESET_FAILED = 'Could not reset the framing.'

/**
 * The open view a live *reset framing* re-frames — the lightbox's session,
 * described by the two things this command needs of it and nothing else.
 */
export interface LiveFramingView {
  /** The spindle the view is on: what the model keeps when there is no usable
   *  pose to replace it. */
  readonly axis: OrbitAxis
  /**
   * Move the live view to `camera` about `axis`, giving up the session's claim
   * on the orientation so the closing persist does not write it back. `posed`
   * says the orientation came from the index, which is what the close labels
   * its pixels with.
   */
  reframe: (camera: CameraState, axis: OrbitAxis, posed: boolean) => void
}

/**
 * *Reset framing* pressed on the surface that is **showing** the model — the
 * lightbox's info panel (D6's margin, follow-up 6.6).
 *
 * The right-click menu withholds this command on a viewer surface and this
 * function is why the panel may still offer it: it is a different body, not the
 * same one on a second surface. `refreshThumbnail` would queue a render behind
 * the suspension the viewer itself holds, sit there until the lightbox closed,
 * and then lose a coin-flip against the closing persist. Here the two halves
 * are done where they can actually happen:
 *
 * - **the store half**, now: discard the stored camera, and the axis with it
 *   exactly when a usable pose replaces it. A png-less PUT, deliberately —
 *   `cache.put` keeps the mtime and every label a PNG-less write omits, so the
 *   tile keeps the pixels it has until something redraws them.
 * - **the live half**, now: re-frame the open session to what the model
 *   resolves to, which is also what redraws those pixels — the lightbox's
 *   closing persist snapshots the live view, so the panel needs no *re-render*
 *   item of its own.
 *
 * With no session (the panel is up while the mesh loads, or after it failed)
 * there is nothing to re-frame and the store half still runs: the discard is
 * about what is stored, not about what is on screen.
 */
export function resetFramingLive(
  entry: DirEntry,
  host: ActionHost,
  view: LiveFramingView | null,
): void {
  // The kept axis only ever describes a live view; with no session there is
  // none to keep, and the resolved axis this produces goes unread.
  const framing = framingAfterDiscard(host.poses[entry.path], view?.axis ?? 'y')
  void host.api
    .putThumb({
      path: entry.path,
      mtime: entry.mtime,
      // `null` is the discard the store gained for this (4b.2); `undefined`
      // still means keep. No png and no labels: the labels describe pixels,
      // and this write does not touch them.
      camera: null,
      axis: framing.posed ? null : undefined,
    })
    .then(
      // The tile's own copy, not only the server's: App opens the lightbox at
      // what this map holds, so a cache-only discard would re-open the model
      // at the orientation just given up (4b.4).
      () => host.discardThumbFraming(entry.path, framing.posed),
      () => host.report(RESET_FAILED),
    )
  view?.reframe(framing.camera, framing.axis, framing.posed)
}

/**
 * The six spindles, in the lightbox picker's own order and vocabulary
 * (`ViewerLayer.tsx:637-673`): the three letters it lists, then those three
 * negated, which is exactly what its *flip* toggle produces. Reusing its words
 * is the point — someone who has flipped a spindle in the viewer should
 * recognise `−Z` in the menu rather than translate it.
 */
export const ORBIT_AXIS_CHOICES: readonly { readonly axis: OrbitAxis; readonly label: string }[] = [
  { axis: 'x', label: 'X' },
  { axis: 'y', label: 'Y' },
  { axis: 'z', label: 'Z' },
  { axis: '-x', label: '−X' },
  { axis: '-y', label: '−Y' },
  { axis: '-z', label: '−Z' },
]

/** The spindle a model with none stored is framed about — the `'y'` the sweep
 *  (`useThumbnails.ts:223`) and the viewer already fall back to, named here so
 *  the menu can mark a model that has never been given one. */
export const DEFAULT_ORBIT_AXIS: OrbitAxis = 'y'

/**
 * Whether the menu raised on this entry, on this surface, offers the axis group.
 *
 * Model-only for the thumbnail commands' structural reason: a container tile is
 * a glyph, not a render, and has no spindle to be framed about. Withheld on the
 * lightbox by the same per-surface filter the commands use — see
 * `LIGHTBOX_MENU_EXCLUDES`; the orbit overlay offers it, exactly as the tile
 * beneath it does (6.8).
 */
export function orbitAxisApplies(entry: DirEntry, exclude: readonly MenuItemId[] = []): boolean {
  return entry.kind === 'model' && !exclude.includes('orbitAxis')
}

/**
 * Set the spindle a model is stored about, from its tile (6.7).
 *
 * Three things happen, and the middle one is the design:
 *
 * - **the axis is written**, so the tile, the next sweep and the lightbox all
 *   frame this model about it;
 * - **the stored camera is discarded** — `camera: null`, the store's own word
 *   for it (4b.2), never a written default (that is 4b.3's whole argument).
 *   Angles measured about one axis do not describe a view about another: it is
 *   why `cameraForPose` derives camera and axis together, and why the azimuth
 *   offset comes out of `frameFor(axis)`. A camera recorded about the old
 *   spindle is not a worse view of the model about the new one, it is a
 *   meaningless one, so it goes and the model is framed by default about the
 *   axis just chosen;
 * - **the thumbnail is redrawn about it**, through the same queue-gated body the
 *   other thumbnail commands use (4b.6), so the answer appears on the tile
 *   rather than only inside the next lightbox.
 *
 * Nothing is read from the cache first, unlike the two commands above: neither
 * half of the stored orientation survives this write, so there is nothing to
 * resolve from and no reason to hold a render slot for a lookup.
 *
 * **No `posed` label, and that is not an omission.** The pose path requires
 * *both* a missing camera and a missing axis (`useThumbnails.ts:218-220`), so a
 * stored axis takes this model out of pose framing for good. That is what
 * choosing an axis *means*: the user has said which way up this model stands,
 * and an index that disagrees no longer reframes it. `lighting` and `rig` do
 * ride along — `cache.ts:108-110` clears every label a PNG-bearing PUT omits,
 * so an unlabelled write fails the next visit's hit test and re-renders this
 * tile on every visit, for ever.
 *
 * **Picking the axis already in force does nothing** — no PUT, no render, no
 * queue slot. A menu that re-does what is already true spends a render to
 * produce the picture already on screen.
 */
export function setOrbitAxis(
  entry: DirEntry,
  host: ActionHost,
  axis: OrbitAxis,
  current: OrbitAxis,
): void {
  if (axis === current) return
  host.queue.push(async () => {
    try {
      // The suspension gate, twice, exactly where the other two put it: `push`
      // alone cannot stop a job that has already started (queue.ts:40-47), and
      // there is one WebGLRenderer app-wide (architecture D2/D3).
      await host.queue.whenResumed()
      const lighting = getLightingMode() // the mode this render uses
      const object = await host.lru.acquire(entry.path)
      await host.queue.whenResumed()
      // The default about the new spindle — which is what an ordinary visit
      // resolves to for a model that has an axis and no camera
      // (`useThumbnails.ts:222-223`), so the tile and the next sweep agree.
      // `renderThumbnail` also hands the axis to the rig, so axis-mode lighting
      // follows the new spindle rather than the old one.
      const png = await renderThumbnail(object, DEFAULT_CAMERA, axis)
      await host.api.putThumb({
        path: entry.path,
        mtime: entry.mtime,
        png,
        camera: null,
        axis,
        lighting,
        rig: RIG_VERSION,
      })
      // The session's own copy, not only the server's: App opens the lightbox at
      // what this map holds, so a cache-only write would open the model about
      // the spindle just replaced (4b.4).
      host.setThumb(entry.path, {
        status: 'ready',
        url: URL.createObjectURL(png),
        camera: undefined,
        axis,
      })
    } catch {
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
 * Orbit axis ×6        —               —
 * ```
 *
 * The last row is the group, not a command, and has no entry in the table below
 * — `orbitAxisApplies` answers for it, under the same model-only rule and the
 * same per-surface filter (6.7).
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
 * What a menu raised on the **lightbox** withholds (D6's margin).
 *
 * The table above is per-*kind* and stays one table. This is the other axis,
 * per-*surface*, and it is a filter at the call site rather than a seventh
 * column: a row that also had to know where it was being rendered is how the
 * two would come to disagree about the same model.
 *
 * *Open* goes because the model is already open — the command would re-open the
 * thing the menu was raised on. The two thumbnail commands go because from an
 * open lightbox they cannot honestly run: their renders wait on
 * `queue.whenResumed()` and the view holds the suspension (architecture
 * D2/D3), so they would sit for as long as the user leaves it open, and the
 * closing persist then races them — writing the orbited camera straight back
 * over the discard *reset framing* was pressed for.
 *
 * The **orbit-axis group** goes for a third reason, its own (6.7): this surface
 * already carries the live picker, which does the same thing and shows the
 * spindle rotating as it does it. A menu duplicate over it would be a second
 * affordance for one choice — and the worse of the two, since its write would
 * then race the closing persist that snapshots the live view.
 *
 * What is left is the three that do not care which surface asked.
 *
 * **The orbit overlay is not on this list, and was until 2026-08-22 (6.8, a
 * user-reported screenshot).** Every reason above is about a view the user has
 * *opened*: it holds the renderer indefinitely, it carries the live picker, and
 * it ends in a close that persists what is on screen. A transient overlay over
 * a tile is none of those. It carries no picker at all, it is gone within
 * `PERSIST_HOLD_MS` of the release, and the `whenResumed()` gate that made the
 * thumbnail commands dishonest under a lightbox is exactly what *sequences*
 * them here — the queue resumes when the overlay unmounts, which is after its
 * persist has been awaited, so the command reads the orientation that persist
 * just wrote and then acts on it. So a lingering overlay over a tile **is** the
 * tile as far as the menu is concerned, and the orbit surface gets the full
 * menu, group included. The bug this fixes: right-clicking a tile within a
 * second of an orbit showed the three-item lightbox menu, because the invisible
 * overlay caught the press and this filter applied to it.
 */
export const LIGHTBOX_MENU_EXCLUDES: readonly MenuItemId[] = [
  'open',
  'reRenderThumbnail',
  'resetFraming',
  'orbitAxis',
]

/**
 * What the lightbox's **info panel** withholds — the other set of affordances on
 * the same surface (follow-up 6.6), and deliberately not the same list as the
 * menu raised on that surface.
 *
 * Both lists name the lightbox and only the lightbox, which is the shape to
 * read them in: one surface, two affordance sets. The orbit overlay filters
 * nothing (6.8, above) and has no panel at all.
 *
 * The asymmetry is the point, and it is about the body rather than the surface:
 *
 * - *Reset framing* is excluded from the menu above and offered here, because
 *   the panel's press runs `resetFramingLive` — a discard that re-frames the
 *   open session and clears its claim on the orientation, so the closing
 *   persist cannot resurrect what was just given up. That is the whole reason
 *   the command is allowed on this surface: the menu's body cannot do it, this
 *   one can, and only this path carries the live semantics.
 * - *Re-render thumbnail* stays out of both. The closing persist already
 *   snapshots the live view under the lighting and rig in force now — it **is**
 *   the re-render — so an item for it would be a button asking for what closing
 *   the lightbox does anyway, and it would ask for it through the body that
 *   cannot run here.
 * - *Open* is out for the menu's reason: the model is already open.
 * - *Copy path* is out because the panel already has it, beside the path it
 *   copies, with its own "copied" confirmation. Two affordances for one command
 *   within one panel is a duplicate, not an accelerator.
 * - The **orbit-axis group** is out for the copy-path reason rather than the
 *   menu's (6.7): this very surface shows the live picker a few pixels away.
 *   The panel renders commands and never a group, so the entry is a statement
 *   of the rule rather than a filter that does work — which is why it is stated:
 *   the two lists are read side by side, and a silence here would read as an
 *   oversight.
 */
export const LIGHTBOX_PANEL_EXCLUDES: readonly MenuItemId[] = [
  'open',
  'copyPath',
  'reRenderThumbnail',
  'orbitAxis',
]

/**
 * Run a command by id — the shape a surface that renders its own affordances
 * needs, as opposed to the menu's, which is handed the table rows themselves.
 * An unbuilt or unknown id does nothing, exactly as a null body does.
 */
export function runCommand(
  id: CommandId,
  entry: DirEntry,
  host: ActionHost,
  el: HTMLElement | null = null,
): void {
  ENTRY_COMMANDS.find((c) => c.id === id)?.run?.(entry, host, el)
}

/**
 * The commands this entry offers, in menu order: applicable by D6's table,
 * built, and not withheld by the surface that asked. `exclude` is how a surface
 * declines a command it cannot honestly perform; the table never learns who is
 * asking.
 */
export function commandsFor(
  entry: DirEntry,
  ctx: AvailabilityContext,
  exclude: readonly MenuItemId[] = [],
): EntryCommand[] {
  return ENTRY_COMMANDS.filter(
    (c) => c.run !== null && !exclude.includes(c.id) && c.applies(entry, ctx),
  )
}
