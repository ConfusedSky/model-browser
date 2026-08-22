/**
 * The view: the question the app asserts, and the one comparison over it.
 *
 * A `View` is the resolved form of what `lib/urlState.ts` parses — every
 * option present, no absences to interpret. The URL is its projection
 * (design R3), so it carries exactly the fields a URL can name: where, what
 * shape, which query, which corpus, under which options, with which model
 * open. Nothing ephemeral (a filter, an in-flight target, an overlay) belongs
 * here, for the same reason it does not belong in a URL.
 */
import type { SearchKinds, SearchMode, Tuning } from '../lib/searchOptions'
import { serializeView, type UrlView } from '../lib/urlState'

export interface View {
  path: string
  /**
   * The flat *toggle* — not the shape a request runs in (design R4). A search
   * runs flat-shaped whatever this says (see `requestOf`), so the toggle
   * survives the search and still governs the listing left behind when the
   * query is cleared.
   */
  flat: boolean
  /** The committed query, `null` when none is committed. */
  q: string | null
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
    q: view.q ?? undefined,
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
 * abolish. `serializeView` already justifies the rule at urlState.ts:106-113.
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
 * What a view asks the server for. The request *shape* is derived, never
 * stored (R4): a committed query is always flat-shaped — the API rejects `q`
 * without it — while the toggle keeps its own meaning in `View.flat`.
 *
 * This type is the closed list of what the server is told, which is why
 * `sameQuestion` may enumerate it: unlike a View's options, it cannot grow a
 * field without this declaration growing with it.
 */
export type Request =
  | { kind: 'listing'; path: string; flat: boolean; q: string | null; folderMatching: boolean }
  | { kind: 'meaning'; path: string; text: string; tuning: Tuning }

export function requestOf(view: View): Request {
  if (view.q !== null && view.mode === 'meaning') {
    return { kind: 'meaning', path: view.path, text: view.q, tuning: view.tuning }
  }
  return {
    kind: 'listing',
    path: view.path,
    flat: view.q !== null ? true : view.flat,
    q: view.q,
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
 * - `listing` — no committed query; the ordinary directory listing.
 * - `name`    — the name corpus answers it.
 * - `meaning` — the index answers it, and is ready to.
 * - `defer`   — meaning was asked for and the index cannot answer *yet*: hold
 *               the question, stand in with the location's own contents.
 * - `wait`    — the availability probe has not answered at all. Distinct from
 *               `defer`: nothing is fetched in this window, not even a stand-in,
 *               because a meaning link's `flat` would walk the whole volume for
 *               tiles the meaning results are about to replace.
 */
export type Corpus = 'listing' | 'name' | 'meaning' | 'defer' | 'wait'

export function corpusOf(view: View, index: { state: string } | null): Corpus {
  if (view.q === null) return 'listing'
  if (view.mode !== 'meaning') return 'name'
  if (index === null) return 'wait'
  return index.state === 'ready' ? 'meaning' : 'defer'
}

/**
 * The listing shown in a deferred query's place. Nested, always: the URL's
 * `flat` belongs to the search being deferred, and flattening a volume to fill
 * time is the opposite of standing in (R6).
 */
export function standInOf(view: View): View {
  return { ...view, q: null, flat: false }
}
