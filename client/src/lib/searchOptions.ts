/**
 * Search options: which entries a search returns, persisted per browser
 * profile like the lighting mode and the AO toggle (`viewer/aoToggle.ts` is
 * the pattern this follows, and `lib/stored.ts` is the storage itself).
 *
 * These differ from those two in one way that matters, and it is why they are
 * also carried in the URL (`lib/urlState.ts`): lighting and AO change how a
 * model is *drawn*, so two people opening one link see the same models. These
 * change *which models exist* in the view, so a shared link that omitted them
 * would reproduce a different result set for the recipient than the sender saw
 * (D1). Storage is the default for the next search; the URL governs the view
 * it names, and opening someone's link never writes to storage (D2).
 */
import type { SemanticTuning } from '../../../shared/types'
import { stored } from './stored'

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

/** The one reader of a `kinds` string, wherever it comes from — storage or URL. */
export function isKinds(v: string | null): v is SearchKinds {
  return v !== null && (KINDS as readonly string[]).includes(v)
}

const modeStore = stored<SearchMode>(
  MODE_KEY,
  (raw) => (raw === 'meaning' ? 'meaning' : 'name'),
  (v) => v,
)
let mode: SearchMode = modeStore.read()

const matchStore = stored(
  MATCH_KEY,
  (raw) => raw !== 'off',
  (on) => (on ? 'on' : 'off'),
)
let folderMatching: boolean = matchStore.read()

const kindsStore = stored<SearchKinds>(
  KINDS_KEY,
  (raw) => (isKinds(raw) ? raw : 'both'),
  (v) => v,
)
let kinds: SearchKinds = kindsStore.read()

export function searchMode(): SearchMode {
  return mode
}

export function setSearchMode(next: SearchMode): void {
  mode = next
  modeStore.write(next)
}

/**
 * How a meaning query is shaped. Sticky like every other option that decides
 * which entries a view contains — and carried in the URL for the same reason:
 * the first thing anyone does after finding a setting that works is send
 * someone the results (tuning D3).
 *
 * The all-present resolution of the wire's `SemanticTuning`, whose fields are
 * each optional: this is what the UI reads and what a query is built from, so
 * every field a user can set has a value here.
 */
export interface Tuning {
  raw: boolean
  pool: 'mean' | 'max' | 'softmax'
  /** Result count. Ignored when `minScore` is set — they are one choice (D1). */
  top: number
  minScore?: number
}

export const TUNING_DEFAULTS: Tuning = {
  raw: false,
  pool: 'softmax',
  top: 60,
} satisfies SemanticTuning

export const POOLS = ['mean', 'max', 'softmax'] as const

/** The one reader of a `pool` value, wherever it comes from — storage or URL. */
export function isPool(v: unknown): v is Tuning['pool'] {
  return typeof v === 'string' && (POOLS as readonly string[]).includes(v)
}

const tuningStore = stored<Tuning>(
  TUNING_KEY,
  (raw) => {
    if (raw === null) return { ...TUNING_DEFAULTS }
    const v = JSON.parse(raw) as Partial<Tuning>
    // Each field validated on its own: a malformed one falls back rather than
    // discarding a whole stored set that is otherwise usable.
    return {
      raw: v.raw === true,
      pool: isPool(v.pool) ? v.pool : TUNING_DEFAULTS.pool,
      top:
        Number.isFinite(v.top) && (v.top as number) > 0
          ? Math.floor(v.top as number)
          : TUNING_DEFAULTS.top,
      minScore: Number.isFinite(v.minScore) ? (v.minScore as number) : undefined,
    }
  },
  (v) => JSON.stringify(v),
)
let tuning: Tuning = tuningStore.read()

export function searchTuning(): Tuning {
  return tuning
}

export function setSearchTuning(next: Tuning): void {
  tuning = next
  tuningStore.write(next)
}

export function folderMatchingEnabled(): boolean {
  return folderMatching
}

export function setFolderMatchingEnabled(on: boolean): void {
  folderMatching = on
  matchStore.write(on)
}

export function searchKinds(): SearchKinds {
  return kinds
}

export function setSearchKinds(value: SearchKinds): void {
  kinds = value
  kindsStore.write(value)
}
