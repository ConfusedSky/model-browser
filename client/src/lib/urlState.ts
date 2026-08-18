/**
 * The URL as a record of the committed view (url-navigation D1): query
 * parameters on the app's single route — `path` (directory or zip vpath),
 * `flat` (present only when on), `q` (committed deep-search query), `model`
 * (open lightbox's vpath). Ephemeral state (live filter, in-flight targets,
 * the orbit overlay) and preferences (lighting, AO) never appear here.
 *
 * `URLSearchParams` is the only encoder — it percent-encodes spaces and the
 * zip `!/` separator on its own, and an `encodeURIComponent` pass on top
 * would double-encode and read back wrong.
 */
export interface UrlView {
  path?: string
  flat: boolean
  q?: string
  model?: string
}

export function parseUrl(search: string = window.location.search): UrlView {
  const p = new URLSearchParams(search)
  const raw = p.get('q')
  const q = raw === null || raw === '' ? undefined : raw
  return {
    path: p.get('path') ?? undefined,
    // A query implies the flat shape: deep-search results are flat whatever
    // the toggle reads, and the API rejects `q` without `flat` (app.ts) — so a
    // hand-trimmed link that kept `q` but lost `flat` must not land on a 400.
    flat: p.has('flat') || q !== undefined,
    q,
    model: p.get('model') ?? undefined,
  }
}

/** Omit-empty: absent params rather than blank ones; `flat` only when on. */
export function serializeView(view: UrlView): string {
  const p = new URLSearchParams()
  if (view.path !== undefined && view.path !== '') p.set('path', view.path)
  if (view.flat) p.set('flat', '1')
  if (view.q !== undefined && view.q !== '') p.set('q', view.q)
  if (view.model !== undefined && view.model !== '') p.set('model', view.model)
  const s = p.toString()
  return s === '' ? '' : `?${s}`
}

function sameView(a: UrlView, b: UrlView): boolean {
  return a.path === b.path && a.flat === b.flat && a.q === b.q && a.model === b.model
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
