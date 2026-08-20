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
const TUNING_KEY = 'model-browser:search-tuning'

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

/**
 * How a meaning query is shaped. Sticky like every other option that decides
 * which entries a view contains — and carried in the URL for the same reason:
 * the first thing anyone does after finding a setting that works is send
 * someone the results (tuning D3).
 */
export interface Tuning {
  raw: boolean
  pool: 'mean' | 'max' | 'softmax'
  /** Result count. Ignored when `minScore` is set — they are one choice (D1). */
  top: number
  minScore?: number
}

export const TUNING_DEFAULTS: Tuning = { raw: false, pool: 'softmax', top: 60 }

const POOLS = ['mean', 'max', 'softmax']

function readTuning(): Tuning {
  try {
    const raw = localStorage.getItem(TUNING_KEY)
    if (raw === null) return { ...TUNING_DEFAULTS }
    const v = JSON.parse(raw) as Partial<Tuning>
    // Each field validated on its own: a malformed one falls back rather than
    // discarding a whole stored set that is otherwise usable.
    return {
      raw: v.raw === true,
      pool: POOLS.includes(v.pool as string) ? (v.pool as Tuning['pool']) : TUNING_DEFAULTS.pool,
      top: Number.isFinite(v.top) && (v.top as number) > 0 ? Math.floor(v.top as number) : TUNING_DEFAULTS.top,
      minScore: Number.isFinite(v.minScore) ? (v.minScore as number) : undefined,
    }
  } catch {
    return { ...TUNING_DEFAULTS }
  }
}

let tuning: Tuning = readTuning()

export function searchTuning(): Tuning {
  return tuning
}

export function setSearchTuning(next: Tuning): void {
  tuning = next
  try {
    localStorage.setItem(TUNING_KEY, JSON.stringify(next))
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
