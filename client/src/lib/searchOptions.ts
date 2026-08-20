/**
 * Search options: which entries a search returns, persisted per browser
 * profile like the lighting mode and the AO toggle (`viewer/aoToggle.ts` is
 * the pattern this follows).
 *
 * These differ from those two in one way that matters, and it is why they are
 * also carried in the URL (`lib/urlState.ts`): lighting and AO change how a
 * model is *drawn*, so two people opening one link see the same models. These
 * change *which models exist* in the view, so a shared link that omitted them
 * would reproduce a different result set for the recipient than the sender saw
 * (D1). Storage is the default for the next search; the URL governs the view
 * it names, and opening someone's link never writes to storage (D2).
 */
const MODE_KEY = 'model-browser:search-mode'
const MATCH_KEY = 'model-browser:search-folder-matching'
const KINDS_KEY = 'model-browser:search-kinds'

/**
 * Which corpus a submit consults. A mode rather than a second action: two
 * buttons leave nothing on screen recording which was pressed, while a mode is
 * persistent visible state, and it inherits this module's stickiness, the URL
 * carriage, and re-issue-on-change for free (D2).
 */
export type SearchMode = 'name' | 'meaning'

/** Which kinds a search presents. Applied client-side over `kind` (D3). */
export type SearchKinds = 'both' | 'folders' | 'models'

const KINDS: readonly SearchKinds[] = ['both', 'folders', 'models']

function isKinds(v: string | null): v is SearchKinds {
  return v !== null && (KINDS as readonly string[]).includes(v)
}

let mode: SearchMode = (() => {
  try {
    return localStorage.getItem(MODE_KEY) === 'meaning' ? 'meaning' : 'name'
  } catch {
    return 'name'
  }
})()

let folderMatching: boolean = (() => {
  try {
    return localStorage.getItem(MATCH_KEY) !== 'off'
  } catch {
    return true
  }
})()

// A malformed stored value defaults rather than propagating: this is read at
// module init, so throwing here would take the app down before it rendered.
let kinds: SearchKinds = (() => {
  try {
    const raw = localStorage.getItem(KINDS_KEY)
    return isKinds(raw) ? raw : 'both'
  } catch {
    return 'both'
  }
})()

export function searchMode(): SearchMode {
  return mode
}

export function setSearchMode(next: SearchMode): void {
  mode = next
  try {
    localStorage.setItem(MODE_KEY, next)
  } catch {
    // no localStorage (tests) — in-memory only
  }
}

export function folderMatchingEnabled(): boolean {
  return folderMatching
}

export function setFolderMatchingEnabled(on: boolean): void {
  folderMatching = on
  try {
    localStorage.setItem(MATCH_KEY, on ? 'on' : 'off')
  } catch {
    // no localStorage (tests) — in-memory only
  }
}

export function searchKinds(): SearchKinds {
  return kinds
}

export function setSearchKinds(value: SearchKinds): void {
  kinds = value
  try {
    localStorage.setItem(KINDS_KEY, value)
  } catch {
    // no localStorage (tests) — in-memory only
  }
}
