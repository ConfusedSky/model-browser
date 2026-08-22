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
import type { DirEntry, IndexAvailability, IndexPose } from '../../../shared/types'
import type { Action } from '../state/reducer'

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
   * field, plumbed rather than read anywhere new (task 1.0). Populated only by
   * a meaning landing, so outside a meaning grid every model takes the no-pose
   * branch. Read by *reset framing* (§4b), which resolves an orientation
   * against it.
   */
  poses: Record<string, IndexPose>
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
 * Optimistic by construction (D4): the two conditions knowable client-side —
 * it is a model, and it is not inside an archive, which the index can never
 * embed — plus the index answering at all. Whether *this* model has been
 * embedded is not asked; the menu offers the action and the view explains the
 * failure when it comes. Asking the index about every tile in a 500-tile grid
 * to grey out an item nobody opened is not a trade worth making.
 */
function similarApplies(entry: DirEntry, ctx: AvailabilityContext): boolean {
  return entry.kind === 'model' && !entry.path.includes('!/') && ctx.index?.state === 'ready'
}

export interface EntryCommand {
  readonly id: CommandId
  readonly label: string
  /** D6's table read for one entry, plus the conditions a table cannot show. */
  readonly applies: (entry: DirEntry, ctx: AvailabilityContext) => boolean
  /**
   * `null` while the body is not built yet. The two thumbnail commands are
   * defined here — D6's table is one place, and their availability is part of
   * it — and implemented by **Stage C (tasks §4b)**, which owns the queue,
   * `putThumb` and the cache's new *discard*. A null-bodied command is not
   * rendered: an inapplicable action is absent rather than present and inert,
   * and so is an unbuilt one.
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
    run: null, // Stage C — tasks §4b
  },
  {
    id: 'resetFraming',
    label: 'Reset framing',
    applies: (entry) => entry.kind === 'model',
    run: null, // Stage C — tasks §4b
  },
]

/** The commands this entry offers, in menu order: applicable by D6's table and
 *  built. */
export function commandsFor(entry: DirEntry, ctx: AvailabilityContext): EntryCommand[] {
  return ENTRY_COMMANDS.filter((c) => c.run !== null && c.applies(entry, ctx))
}
