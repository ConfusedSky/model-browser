/**
 * The view: the question the app asserts, and the one comparison over it.
 *
 * A `View` is the resolved form of what `lib/urlState.ts` parses — every
 * option present, no absences to interpret. The URL is its projection
 * (design R3), so it carries exactly the fields a URL can name: where, what
 * shape, what the view is *about*, which corpus a phrase reads under, under
 * which options, with which model open. Nothing ephemeral (a filter, an
 * in-flight target, an overlay) belongs here, for the same reason it does not
 * belong in a URL.
 */
import type { SearchKinds, SearchMode, Tuning } from '../lib/searchOptions'
import { serializeView, type UrlView } from '../lib/urlState'

/**
 * What the view is *about* (design D4). Three kinds, one slot: a second
 * nullable field beside a query would re-mint the reset list R1 exists to
 * abolish — eight transitions each having to remember to clear the other slot —
 * and would make "text and model both set" a representable state with no
 * meaning. Assigning a union member replaces it; there is no second field to
 * forget.
 *
 * Distinct from `View.mode`, which is the corpus a typed *phrase* goes to: the
 * subject says what the view is about, the mode says how a phrase is read.
 */
export type Subject =
  | { kind: 'none' }
  | { kind: 'query'; text: string }
  | { kind: 'similar'; model: string }

export interface View {
  path: string
  /**
   * The flat *toggle* — not the shape a request runs in (design R4). A search
   * runs flat-shaped whatever this says (see `requestOf`), so the toggle
   * survives the search and still governs the listing left behind when the
   * query is cleared.
   */
  flat: boolean
  /** What this view is about: nothing, a committed query, or a model whose
   *  neighbours it shows. */
  subject: Subject
  mode: SearchMode
  kinds: SearchKinds
  folderMatching: boolean
  tuning: Tuning
  /** The model the URL names — never "what is mounted", which is the viewer's own truth (R7). */
  model: string | null
}

/** The four sticky search options, as they enter the reducer: on an action, never read from
 *  the `searchOptions` module inside it (design R2 — module state is impure under StrictMode). */
export interface Prefs {
  mode: SearchMode
  kinds: SearchKinds
  folderMatching: boolean
  tuning: Tuning
}

/** The resolved view as `urlState` writes it: absences are its business, not ours. */
export function toUrlView(view: View): UrlView {
  return {
    path: view.path === '' ? undefined : view.path,
    flat: view.flat,
    q: view.subject.kind === 'query' ? view.subject.text : undefined,
    similar: view.subject.kind === 'similar' ? view.subject.model : undefined,
    folderMatching: view.folderMatching,
    kinds: view.kinds,
    mode: view.mode,
    tuning: view.tuning,
    model: view.model ?? undefined,
  }
}

/**
 * The ONE View comparison (design R1): two views are the same view exactly
 * when they name the same URL. Never reference equality — every transition
 * mints a fresh object, so the first fetchless patch would misfire — and never
 * field-wise, which is the hand-maintained list this whole change exists to
 * abolish. `serializeView`'s own doc comment justifies the rule — and holds the
 * gate (an option is written only when the view's subject reads it) that makes
 * views differing only in an option neither of them reads the same view.
 */
export function sameView(a: View, b: View): boolean {
  return serializeView(toUrlView(a)) === serializeView(toUrlView(b))
}

/**
 * The same comparison, asked of the question minus the model. `view.model` is
 * a second truth living in the same object (R7): which model is open says
 * nothing about which entries the view contains, so a history entry that
 * differs only there is not a different listing and must not re-ask for one.
 */
export function sameListing(a: View, b: View): boolean {
  return sameView({ ...a, model: null }, { ...b, model: null })
}

/**
 * How many neighbours a similarity view asks the index for. A module constant,
 * not a view field and not a URL param (D4): nothing on screen sets it, so a
 * URL field would name a distinction no view makes. If it ever becomes
 * user-settable it becomes a view field then, and the URL gate carries it the
 * way it carries tuning.
 *
 * Chosen rather than inherited from either end. The index's own default is 10
 * and this app's text-query bound is 60: above the index's, because a grid of
 * ten leaves most of a row empty; well under the text bound, because neighbour
 * quality falls off faster than text-match quality does — a phrase's 40th hit
 * can still be the one you meant, while a model's 40th neighbour is noise.
 */
export const SIMILAR_K = 16

/**
 * What identifies the question a view asks. Mostly that is also what the
 * server is told, and the request *shape* is derived rather than stored (R4):
 * a committed query is always flat-shaped — the API rejects `q` without it —
 * while the toggle keeps its own meaning in `View.flat`.
 *
 * The one stated exception is a similarity request's `path`. No scope is sent
 * to the index: neighbours are drawn from the whole collection (D4), so the
 * anchor reaches no server. It is carried because without it two similarity
 * views of one model at different folders compare equal under `sameQuestion`
 * and take `restore`'s patch branch, which by `patch`'s own rule cannot patch
 * `path` — leaving the path bar, and the listing a dismissal returns to,
 * naming the folder the user just left.
 *
 * So: this type is the closed list of what *identifies* the question, which is
 * why `sameQuestion` may enumerate it — unlike a View's options, it cannot grow
 * a field without this declaration growing with it.
 */
export type Request =
  | { kind: 'listing'; path: string; flat: boolean; q: string | null; folderMatching: boolean }
  | { kind: 'meaning'; path: string; text: string; tuning: Tuning }
  | { kind: 'similar'; path: string; model: string; k: number }

export function requestOf(view: View): Request {
  const subject = view.subject
  if (subject.kind === 'similar') {
    return { kind: 'similar', path: view.path, model: subject.model, k: SIMILAR_K }
  }
  if (subject.kind === 'query' && view.mode === 'meaning') {
    return { kind: 'meaning', path: view.path, text: subject.text, tuning: view.tuning }
  }
  return {
    kind: 'listing',
    path: view.path,
    flat: subject.kind === 'query' ? true : view.flat,
    q: subject.kind === 'query' ? subject.text : null,
    folderMatching: view.folderMatching,
  }
}

/**
 * Whether two views ask the same question — equality of `requestOf`, which is
 * the question the server answers. Distinct from `sameView`, which is the URL
 * the view names: a view carries options no request sees — `kinds`, `model`,
 * the `flat` toggle under a committed query, `tuning` under a name search — so
 * two entries can name different URLs and still be one question. When they
 * are, the answer already on screen is the answer, and the difference between
 * them is a patch rather than a re-ask.
 */
export function sameQuestion(a: View, b: View): boolean {
  const x = requestOf(a)
  const y = requestOf(b)
  if (x.kind === 'similar') {
    // `path` is compared here and nowhere else: `sameQuestion` is not widened
    // to compare it generally, because for every other request kind it is
    // already inside the compare below.
    return y.kind === 'similar' && x.path === y.path && x.model === y.model && x.k === y.k
  }
  if (x.kind === 'meaning') {
    return (
      y.kind === 'meaning' &&
      x.path === y.path &&
      x.text === y.text &&
      x.tuning.raw === y.tuning.raw &&
      x.tuning.pool === y.tuning.pool &&
      x.tuning.top === y.tuning.top &&
      x.tuning.minScore === y.tuning.minScore
    )
  }
  return (
    y.kind === 'listing' &&
    x.path === y.path &&
    x.flat === y.flat &&
    x.q === y.q &&
    x.folderMatching === y.folderMatching
  )
}

/**
 * Which corpus answers this view — one function of `(view, index)`, shared by
 * submit, the mode flip, and restore (design R6). Being one function is the
 * fix for the mode flip silently substituting a name search: there is nowhere
 * left for a second opinion to live.
 *
 * - `listing` — no subject; the ordinary directory listing.
 * - `name`    — the name corpus answers it.
 * - `meaning` — the index answers it, and is ready to.
 * - `similar` — the index answers it too, for a model rather than a phrase.
 * - `defer`   — the index was asked for and cannot answer *yet*: hold the
 *               question, stand in with the location's own contents.
 * - `wait`    — the availability probe has not answered at all. Distinct from
 *               `defer`: nothing is fetched in this window, not even a stand-in,
 *               because a meaning link's `flat` would walk the whole volume for
 *               tiles the results are about to replace.
 *
 * A similarity subject shares `defer`/`wait` with meaning rather than getting a
 * waiting rule of its own: one function, one new case, and the whole deferral
 * behavior comes with it.
 */
export type Corpus = 'listing' | 'name' | 'meaning' | 'similar' | 'defer' | 'wait'

export function corpusOf(view: View, index: { state: string } | null): Corpus {
  const subject = view.subject
  if (subject.kind === 'none') return 'listing'
  if (subject.kind === 'similar') {
    if (index === null) return 'wait'
    return index.state === 'ready' ? 'similar' : 'defer'
  }
  if (view.mode !== 'meaning') return 'name'
  if (index === null) return 'wait'
  return index.state === 'ready' ? 'meaning' : 'defer'
}

/**
 * The listing shown in a deferred question's place — a held phrase's or a held
 * model's alike. Nested, always: the URL's `flat` belongs to the search being
 * deferred, and flattening a volume to fill time is the opposite of standing in
 * (R6).
 */
export function standInOf(view: View): View {
  return { ...view, subject: { kind: 'none' }, flat: false }
}
