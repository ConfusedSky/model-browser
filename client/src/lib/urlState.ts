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
  return {
    path: p.get('path') ?? undefined,
    flat: p.has('flat'),
    q: p.get('q') ?? undefined,
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
export function commitUrl(view: UrlView, opts: { replace?: boolean } = {}): void {
  if (sameView(parseUrl(), view)) return
  const url = `${window.location.pathname}${serializeView(view)}`
  if (opts.replace === true) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
}
