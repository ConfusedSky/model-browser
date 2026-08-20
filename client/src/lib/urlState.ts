import type { SearchKinds, SearchMode } from './searchOptions'

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
  /** Folder matching, default on — carried only when off. */
  folderMatching?: boolean
  /** Which kinds the results present, default 'both'. */
  kinds?: SearchKinds
  /** Which corpus the query ran against, default 'name' — carried only when not. */
  mode?: SearchMode
  model?: string
}

export function parseUrl(search: string = window.location.search): UrlView {
  const p = new URLSearchParams(search)
  const raw = p.get('q')
  const q = raw === null || raw === '' ? undefined : raw
  const kinds = p.get('kinds')
  const mode = p.get('mode')
  return {
    path: p.get('path') ?? undefined,
    // A query implies the flat shape: deep-search results are flat whatever
    // the toggle reads, and the API rejects `q` without `flat` (app.ts) — so a
    // hand-trimmed link that kept `q` but lost `flat` must not land on a 400.
    flat: p.has('flat') || q !== undefined,
    q,
    // Defaults are absent from the URL, so their absence is what selects them
    // — and an unrecognised `kinds` reads as the default rather than as an
    // error, since a hand-edited link should degrade to the ordinary view.
    folderMatching: p.has('nofolders') ? false : undefined,
    kinds: kinds === 'folders' || kinds === 'models' ? kinds : undefined,
    mode: mode === 'meaning' ? 'meaning' : mode === 'name' ? 'name' : undefined,
    model: p.get('model') ?? undefined,
  }
}

/** Omit-empty: absent params rather than blank ones; `flat` only when on. */
export function serializeView(view: UrlView): string {
  const p = new URLSearchParams()
  if (view.path !== undefined && view.path !== '') p.set('path', view.path)
  if (view.flat) p.set('flat', '1')
  if (view.q !== undefined && view.q !== '') p.set('q', view.q)
  // Omitted at their defaults (D4): an ordinary search URL stays byte-identical
  // to what it was before options existed, so making a default explicit never
  // mints a history entry.
  if (view.folderMatching === false) p.set('nofolders', '1')
  if (view.kinds === 'folders' || view.kinds === 'models') p.set('kinds', view.kinds)
  // Written whenever a query is committed, including the default. The other
  // options are omitted at their defaults so an ordinary search URL stays what
  // it was — but which *corpus* answered is not a preference among results, it
  // is what the query means. Leaving it implicit makes the link depend on the
  // reader's default: change that default later, or hand the link to a profile
  // that reads absence differently, and the same URL asks a different question.
  if (view.q !== undefined && view.q !== '') p.set('mode', view.mode ?? 'name')
  if (view.model !== undefined && view.model !== '') p.set('model', view.model)
  const s = p.toString()
  return s === '' ? '' : `?${s}`
}

function sameView(a: UrlView, b: UrlView): boolean {
  return (
    a.path === b.path &&
    a.flat === b.flat &&
    a.q === b.q &&
    a.folderMatching === b.folderMatching &&
    a.kinds === b.kinds &&
    a.mode === b.mode &&
    a.model === b.model
  )
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
