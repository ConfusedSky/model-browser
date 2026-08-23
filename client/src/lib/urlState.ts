import type { SearchKinds, SearchMode, Tuning } from './searchOptions'
import { isKinds, isPool, TUNING_DEFAULTS } from './searchOptions'

/**
 * The URL as a record of the committed view (url-navigation D1): query
 * parameters on the app's single route — `path` (directory or zip vpath),
 * `flat` (present only when on), `q` (committed deep-search query), the search
 * options that query ran under (`nofolders`, `kinds`, each present only when
 * not the default), `model` (open lightbox's vpath). Ephemeral state (live
 * filter, in-flight targets, the orbit overlay) never appears here, nor do
 * preferences that change only how a model is *drawn* (lighting, AO).
 *
 * Search options are the exception, and the line is stated so it cannot be
 * stretched: a preference belongs here when it determines *which entries the
 * view contains*, not how they are drawn (D1). Without them a shared search
 * link reproduces different models for the recipient than the sender saw.
 *
 * `URLSearchParams` is the only encoder — it percent-encodes spaces and the
 * zip `!/` separator on its own, and an `encodeURIComponent` pass on top
 * would double-encode and read back wrong.
 */
export interface UrlView {
  path?: string
  flat: boolean
  q?: string
  /**
   * The model a similarity view's neighbours were drawn from. Two optional
   * slots here rather than one union is deliberate and is not the shape `View`
   * has: this type is the *parser's report*, and reporting both is what lets
   * `resolveView` implement the rule that `similar` beats a stray `q`.
   * `toUrlView` never emits both, and `serializeView` never writes both.
   */
  similar?: string
  /**
   * How many neighbours a similarity view asked for, carried only when it is
   * not the default. The default lives with the subject (`SIMILAR_K`,
   * `state/view.ts`) and is elided by `toUrlView`, because this module cannot
   * import it back without a cycle — so this field is already
   * "non-default or absent" by the time the serializer sees it.
   */
  k?: number
  /**
   * How a *similarity* view pools the subject's per-view scores. One `pool`
   * param in the URL, two possible readers: a meaning view reads it as tuning
   * (`tuning.pool`), a similarity view as its own. `parseUrl` reports it both
   * ways — reporting is its whole job — and the subject decides which reading
   * is in force, so the two can never both be written.
   */
  pool?: Tuning['pool']
  /** Folder matching, default on — carried only when off. */
  folderMatching?: boolean
  /** Which kinds the results present, default 'both'. */
  kinds?: SearchKinds
  /** Which corpus the query ran against, default 'name' — carried only when not. */
  mode?: SearchMode
  /** How a meaning query was shaped; each field carried only when not default. */
  tuning?: Partial<Tuning>
  model?: string
}

/**
 * Deliberately more permissive than `serializeView`: it reads every param it
 * knows, including ones the serializer would now omit for this view's subject —
 * a `pool` beside `mode=name`, a `kinds` beside `mode=meaning`, a `q` beside a
 * `similar`. Those come from links written before the gate existed, and from
 * hands. Refusing them here would turn tolerance into a 404-shaped surprise
 * over a link that names a perfectly good view; instead the value rides along
 * harmlessly, because the subject or mode that would read it is not in force.
 * `resolveView` is where the precedence is decided: the parameter naming a
 * subject is the more specific one, so `similar` wins over a `q` beside it.
 *
 * A stray param rides in the address bar *unread*, and it stays there — this
 * does not scrub it. `commitUrl` declines a write whose serialization already
 * matches the address bar's, and a param both sides drop cannot make them
 * differ, so nothing rewrites the URL until the view genuinely advances and
 * the whole URL is written afresh. Nothing reads the stray meanwhile, which is
 * why that is tolerable rather than a bug to fix here.
 */
export function parseUrl(search: string = window.location.search): UrlView {
  const p = new URLSearchParams(search)
  const raw = p.get('q')
  const q = raw === null || raw === '' ? undefined : raw
  const rawSimilar = p.get('similar')
  const similar = rawSimilar === null || rawSimilar === '' ? undefined : rawSimilar
  const kinds = p.get('kinds')
  const mode = p.get('mode')
  const pool = p.get('pool')
  const top = Number(p.get('top'))
  const min = Number(p.get('min'))
  // Read leniently, like every other param here: a `k` that is not a whole
  // number the index would accept reads as absence, which resolves to the
  // default rather than to an error over a link that names a perfectly good
  // view. The bounds are the server's own (`app.ts`, 1..1000).
  const rawK = Number(p.get('k'))
  const k =
    p.has('k') && Number.isInteger(rawK) && rawK >= 1 && rawK <= 1000 ? rawK : undefined
  const tuning: Partial<Tuning> = {}
  if (p.get('score-raw') === '1') tuning.raw = true
  if (isPool(pool)) tuning.pool = pool
  if (Number.isFinite(top) && top > 0 && p.has('top')) tuning.top = Math.floor(top)
  if (Number.isFinite(min) && p.has('min')) tuning.minScore = min
  return {
    path: p.get('path') ?? undefined,
    // The flat *toggle*, and only that (design R4). A search runs flat-shaped
    // whatever the toggle says — that shape is derived where the request is
    // built (`requestOf`), never read back out of the URL — so inferring the
    // toggle from `q` here destroyed it: a deep-linked search whose query was
    // cleared listed the whole volume, while a typed one listed nested.
    // Links written before this change carry an explicit `flat=1`, so they
    // still parse; their `flat` now honestly means flat.
    flat: p.has('flat'),
    q,
    similar,
    k,
    // The same `pool` param the tuning report below carries, reported a second
    // way for the subject that reads it as its own rather than as tuning. The
    // parser reports; `resolveView` assigns, by subject.
    pool: isPool(pool) ? pool : undefined,
    // Defaults are absent from the URL, so their absence is what selects them
    // — and an unrecognised `kinds` reads as the default rather than as an
    // error, since a hand-edited link should degrade to the ordinary view. An
    // explicit `kinds=both` is one of those: the default is carried by absence,
    // so naming it reads as absence too.
    folderMatching: p.has('nofolders') ? false : undefined,
    kinds: isKinds(kinds) && kinds !== 'both' ? kinds : undefined,
    mode: mode === 'meaning' ? 'meaning' : mode === 'name' ? 'name' : undefined,
    tuning: Object.keys(tuning).length > 0 ? tuning : undefined,
    model: p.get('model') ?? undefined,
  }
}

/**
 * Omit-empty: absent params rather than blank ones; `flat` only when on.
 *
 * The one writer of every history entry (design R3), which is why the gate
 * below lives here rather than at the call sites. The gate is one sentence:
 * **an option is written only when the view's subject actually reads it.**
 * Options describe which entries a view contains, and over a plain listing they
 * select nothing — a `?kinds=folders` on a bare directory names a distinction
 * that view does not make. Under a committed query the subject reads a phrase,
 * so the reading mode decides the rest: a name search has no tuning to spell
 * out, and a meaning search cannot restrict by kind, since the index answers
 * with models and nothing else. Under a `similar` subject none of the *phrase*
 * options are read (D4) — there is no phrase to tune or restrict — so the URL
 * names the model, the location, the flat toggle, and the two parameters that
 * subject does read: how many neighbours it asked for and how the index pooled
 * them. Those are in the URL by the same rule that keeps the others out: they
 * select which entries the view contains, and something on screen sets them.
 *
 * The panel already hides each option outside its mode; the URL says the same
 * thing, so two views that differ only in an option neither of them reads
 * serialize alike and stop minting history entries that go nowhere. That
 * property is what makes naming a similarity view by its model alone honest.
 *
 * Enforced here, one projection of the whole view cannot leak an option onto a
 * listing; enforced at four hand-built literals, three of them dropped a field
 * instead.
 */
export function serializeView(view: UrlView): string {
  const p = new URLSearchParams()
  if (view.path !== undefined && view.path !== '') p.set('path', view.path)
  if (view.flat) p.set('flat', '1')
  // The subject, and only one of them can be it. `similar` wins for the same
  // reason `resolveView` resolves it first — it is the more specific parameter
  // — so a caller that somehow held both writes the similarity view, and every
  // option gate below is false, since none of them is read by that subject.
  const similar = view.similar !== undefined && view.similar !== ''
  if (similar) p.set('similar', view.similar as string)
  // The two options a similarity subject *does* read. `k` arrives already
  // elided at its default (`toUrlView`, which owns `SIMILAR_K`), so this writes
  // whatever it is handed; `pool` has no default to elide — absent means the
  // index's own, which is a different thing from any of the three values.
  if (similar && view.k !== undefined) p.set('k', String(view.k))
  if (similar && view.pool !== undefined) p.set('pool', view.pool)
  const searching = !similar && view.q !== undefined && view.q !== ''
  if (searching) p.set('q', view.q as string)
  // Absence means name (see the `mode` write below), so a mode-less committed
  // view is a name view and takes the name options.
  const naming = searching && (view.mode ?? 'name') === 'name'
  const meaning = searching && view.mode === 'meaning'
  // Omitted at their defaults (D4): an ordinary search URL stays byte-identical
  // to what it was before options existed, so making a default explicit never
  // mints a history entry.
  if (naming && view.folderMatching === false) p.set('nofolders', '1')
  if (naming && (view.kinds === 'folders' || view.kinds === 'models')) p.set('kinds', view.kinds)
  // Written whenever a query is committed, including the default. The other
  // options are omitted at their defaults so an ordinary search URL stays what
  // it was — but which *corpus* answered is not a preference among results, it
  // is what the query means. Leaving it implicit makes the link depend on the
  // reader's default: change that default later, or hand the link to a profile
  // that reads absence differently, and the same URL asks a different question.
  if (searching) p.set('mode', view.mode ?? 'name')
  // Omitted at their defaults, so an ordinary meaning link is unchanged (D3).
  // Not named `raw`: Vite's dev server 403s any URL whose query contains a
  // `raw`, `url`, or `inline` param (its special import queries, guarded since
  // CVE-2025-30208), killing deep links before the app loads.
  if (meaning && view.tuning?.raw === true) p.set('score-raw', '1')
  if (meaning && view.tuning?.pool !== undefined && view.tuning.pool !== TUNING_DEFAULTS.pool) {
    p.set('pool', view.tuning.pool)
  }
  if (meaning && view.tuning?.minScore !== undefined) p.set('min', String(view.tuning.minScore))
  else if (meaning && view.tuning?.top !== undefined && view.tuning.top !== TUNING_DEFAULTS.top) {
    p.set('top', String(view.tuning.top))
  }
  if (view.model !== undefined && view.model !== '') p.set('model', view.model)
  const s = p.toString()
  return s === '' ? '' : `?${s}`
}

/**
 * Compared by what they write, not field by field: two views name the same
 * URL exactly when they serialize alike. A field-wise comparison also has to
 * agree with `serializeView` about which values are absences, and it did not —
 * `parseUrl` leaves tuning left at its defaults `undefined` while a caller
 * passes the full defaults object, so an unchanged meaning view read as
 * different from itself and every re-submit stacked a dead history entry.
 */
function sameView(a: UrlView, b: UrlView): boolean {
  return serializeView(a) === serializeView(b)
}

/**
 * Write `view` into the URL. Reads the live URL at write time and does
 * nothing when it already names this view (a re-commit of the same view must
 * not stack history entries); otherwise pushes, or replaces when the write is
 * a history restoration or a boot seed (D2/D4).
 */
export function commitUrl(
  view: UrlView,
  opts: { replace?: boolean; state?: unknown } = {},
): void {
  if (sameView(parseUrl(), view)) return
  const url = `${window.location.pathname}${serializeView(view)}`
  const state = opts.state ?? null
  if (opts.replace === true) window.history.replaceState(state, '', url)
  else window.history.pushState(state, '', url)
}

/**
 * Stamped into the entry a lightbox push mints, and read back when it closes:
 * an entry we pushed always has a predecessor, so `history.back()` returns to
 * the listing, while one restored from a deep link is the session's first and
 * back would leave the app entirely. The browser keeps state per entry, so
 * this survives reload and forward/back — an in-memory flag does not, and a
 * forward-reopened lightbox would then close down the deep-link path.
 */
export const LIGHTBOX_ENTRY = { lightbox: true }

export function isLightboxEntry(): boolean {
  return (window.history.state as { lightbox?: boolean } | null)?.lightbox === true
}

/**
 * Stamped into the entry an **in-app** find-similar mints, and read back when
 * the view is dismissed: an entry we pushed has the view it was raised from
 * behind it, so `history.back()` restores that view whole — a query search with
 * its options, or a listing — rather than re-asking the location's listing and
 * throwing the previous answer away.
 *
 * The same channel and the same reasoning as `LIGHTBOX_ENTRY`: the browser
 * keeps state per entry, so this survives reload and forward/back, where an
 * in-memory flag would not — a forward-restored similarity view would then
 * dismiss down the deep-link path.
 *
 * A *restored* or deep-linked similarity landing must never gain it: there is
 * nothing of this app's behind such an entry, and back would leave the app. It
 * cannot: the landing that would stamp it is a `user` landing only, and a
 * restore landing onto an entry that already carries the marker writes nothing
 * at all — the browser has already rewound the URL, so `commitUrl` finds its
 * serialization redundant and declines, marker included.
 */
export const SIMILAR_ENTRY = { similar: true }

export function isSimilarEntry(): boolean {
  return (window.history.state as { similar?: boolean } | null)?.similar === true
}
