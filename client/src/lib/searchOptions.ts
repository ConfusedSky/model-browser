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
import { MAX_RESULT_COUNT, type SemanticTuning } from '../../../shared/types'
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
 * The resolved form of the wire's `SemanticTuning`: `raw` and `pool` always
 * have a value here, because every view reads them. The two *bounds* stay
 * optional even after resolution, because absence is meaningful — it says the
 * bound is not in force — and that is the one rule this change is built on
 * (design D4). `resolveTuning` is where a partial becomes one of these.
 */
export interface Tuning {
  raw: boolean
  pool: 'mean' | 'max' | 'softmax'
  /** Result count, capping whatever the floor let through. Absent = uncapped. */
  top?: number
  /** Score floor, applied before the count. Absent = no floor. */
  minScore?: number
}

export const TUNING_DEFAULTS: Tuning = {
  raw: false,
  pool: 'softmax',
  // Both bounds are in force by default (design D3): the floor keeps the grid
  // relevant, the count keeps it a grid. The resting state of the controls and
  // the meaning of an unadorned link are the same thing.
  top: 60,
  // The index's own measurement: text-query cosines run around 0.1, so this is
  // the floor at the distribution's own level rather than a number picked to be
  // round. A count answers "the best N of whatever there is"; a floor answers
  // "everything at least this similar", which is the question a phrase asks.
  minScore: 0.1,
} satisfies SemanticTuning

/** A count a user or a link supplied, held to what the index will return. */
export function clampCount(n: number): number {
  return Math.min(Math.max(Math.floor(n), 1), MAX_RESULT_COUNT)
}

/**
 * A partial tuning resolved into a whole one, and the single implementation of
 * the record rule (design D4): **a bound named is in force, a bound absent is
 * not** — with the one stated exception that a record naming *neither* bound
 * reads as both at their defaults, since that is the resting state and an
 * unadorned link has to mean something.
 *
 * `raw` and `pool` are not bounds and take the ordinary treatment: absent means
 * this app's default, so a tuned link that omitted one does not pick up the
 * reader's setting for it.
 *
 * One function rather than a spread at each call site, because a spread over
 * the defaults cannot express the rule: `{ ...TUNING_DEFAULTS, ...partial }`
 * silently re-adds the very bound a count-only link left out, which is what the
 * `minScore: null` sentinel existed to work around.
 */
export function resolveTuning(partial: Partial<Tuning> | undefined): Tuning {
  const base = {
    raw: partial?.raw ?? TUNING_DEFAULTS.raw,
    pool: partial?.pool ?? TUNING_DEFAULTS.pool,
  }
  const top = partial?.top
  const minScore = partial?.minScore
  if (top === undefined && minScore === undefined) {
    return { ...base, top: TUNING_DEFAULTS.top, minScore: TUNING_DEFAULTS.minScore }
  }
  return {
    ...base,
    ...(top !== undefined ? { top: clampCount(top) } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
  }
}

export const POOLS = ['mean', 'max', 'softmax'] as const

/** The one reader of a `pool` value, wherever it comes from — storage or URL. */
export function isPool(v: unknown): v is Tuning['pool'] {
  return typeof v === 'string' && (POOLS as readonly string[]).includes(v)
}

/**
 * What a profile holds on disk. Both bounds are plain optionals now: absence
 * means the bound is not in force, on disk exactly as in a URL and in live
 * state. The old `minScore: null` sentinel is gone — its whole job was telling
 * "count chosen" apart from "profile older than the floor", a distinction that
 * existed only while absence had to mean *floor in force*. With absence meaning
 * *not in force*, the two collapse into the same true reading: count-only.
 *
 * `null` is still accepted on read, because profiles written under the sentinel
 * are on disk and must keep meaning what they meant (design D4's table).
 */
type StoredTuning = Omit<Partial<Tuning>, 'minScore'> & { minScore?: number | null }

const tuningStore = stored<Tuning>(
  TUNING_KEY,
  (raw) => {
    if (raw === null) return { ...TUNING_DEFAULTS }
    const v = JSON.parse(raw) as StoredTuning
    // Each bound validated on its own, and a malformed one reads as *absent*
    // rather than as its default: a value that cannot be parsed cannot testify
    // that its bound was in force. If that leaves no bound at all, the rule
    // for a record naming none applies and both defaults come back — which is
    // `resolveTuning`'s job, not this reader's, so it is passed a partial.
    return resolveTuning({
      raw: v.raw === true,
      pool: isPool(v.pool) ? v.pool : TUNING_DEFAULTS.pool,
      ...(Number.isFinite(v.top) && (v.top as number) > 0
        ? { top: clampCount(v.top as number) }
        : {}),
      // `null` was the old sentinel for "count chosen", so it reads as absence
      // — which is now the same statement. A profile carrying a real floor and
      // an inert count reads as both bounds (D4's third row): the old writer
      // emitted `top` on every write, so that count may be a number its owner
      // never chose, and the bytes cannot say otherwise.
      ...(v.minScore !== null && Number.isFinite(v.minScore)
        ? { minScore: v.minScore as number }
        : {}),
    })
  },
  // Presence, on disk as everywhere else: a bound not in force is not written.
  (v) =>
    JSON.stringify({
      raw: v.raw,
      pool: v.pool,
      ...(v.top !== undefined ? { top: v.top } : {}),
      ...(v.minScore !== undefined ? { minScore: v.minScore } : {}),
    } satisfies StoredTuning),
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
