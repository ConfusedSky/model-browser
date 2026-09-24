/**
 * Which entries a search returns, persisted per browser profile like the
 * lighting mode. Unlike that one these decide *which models exist* in the view,
 * so they are carried in the URL too (D1). Storage is the default for the next
 * search; the URL governs the view it names, and opening a link never writes to
 * storage (D2).
 */
import { MAX_RESULT_COUNT, type SemanticTuning } from "../../../shared/types";
import { stored } from "./stored";

const MODE_KEY = "model-browser:search-mode";
const MATCH_KEY = "model-browser:search-folder-matching";
const KINDS_KEY = "model-browser:search-kinds";
const TUNING_KEY = "model-browser:search-tuning";

/** A mode rather than a second button, so the choice stays visible on screen —
 *  and inherits stickiness, URL carriage and re-issue-on-change (D2). */
export type SearchMode = "name" | "meaning";

/** Which kinds a search presents. Applied client-side over `kind` (D3). */
export type SearchKinds = "both" | "folders" | "models";

const KINDS: readonly SearchKinds[] = ["both", "folders", "models"];

/** The one reader of a `kinds` string, from storage or URL alike. */
export function isKinds(v: string | null): v is SearchKinds {
  return v !== null && (KINDS as readonly string[]).includes(v);
}

const modeStore = stored<SearchMode>(
  MODE_KEY,
  (raw) => (raw === "meaning" ? "meaning" : "name"),
  (v) => v,
);
let mode: SearchMode = modeStore.read();

const matchStore = stored(
  MATCH_KEY,
  (raw) => raw !== "off",
  (on) => (on ? "on" : "off"),
);
let folderMatching: boolean = matchStore.read();

const kindsStore = stored<SearchKinds>(
  KINDS_KEY,
  (raw) => (isKinds(raw) ? raw : "both"),
  (v) => v,
);
let kinds: SearchKinds = kindsStore.read();

export function searchMode(): SearchMode {
  return mode;
}

export function setSearchMode(next: SearchMode): void {
  mode = next;
  modeStore.write(next);
}

/**
 * `modeStore.read()` cannot answer this — an unset key and a stored `name` both
 * read as `'name'` — so the raw key is asked instead. "Never chose" is the only
 * state a deployment's own default may fill (`landing-page` D5).
 */
export function hasStoredSearchMode(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * In force for this page **without** being recorded as a choice. The closure and
 * not the view, since `ownPrefs()` reads it on every `navigate` and a view-only
 * mode would revert on the first folder click. No write, so a later click is
 * still the browser's first real choice (`landing-page` D5).
 */
export function applySessionSearchMode(next: SearchMode): void {
  mode = next;
}

/**
 * The resolved form of the wire's `SemanticTuning`. The two *bounds* stay
 * optional even after resolution, because absence is meaningful: it says the
 * bound is not in force (D4). `resolveTuning` is where a partial becomes one.
 */
export interface Tuning {
  raw: boolean;
  pool: "mean" | "max" | "softmax";
  /** Caps whatever the floor let through; absent is uncapped. */
  top?: number;
  /** Applied before the count; absent is no floor. */
  minScore?: number;
}

export const TUNING_DEFAULTS: Tuning = {
  raw: false,
  pool: "softmax",
  // Both in force by default (D3): the floor keeps the grid relevant, the count
  // keeps it a grid.
  top: 60,
  // At the level the index's text-query cosines occupy, not a round number: a
  // floor answers "everything at least this similar", which is what a phrase asks.
  minScore: 0.1,
} satisfies SemanticTuning;

/** Held to what the index will return. */
export function clampCount(n: number): number {
  return Math.min(Math.max(Math.floor(n), 1), MAX_RESULT_COUNT);
}

/**
 * The single implementation of the record rule (D4): **a bound named is in
 * force, a bound absent is not**, except that a record naming *neither* reads as
 * both at their defaults. One function rather than a spread at each call site,
 * because `{ ...TUNING_DEFAULTS, ...partial }` silently re-adds the very bound a
 * count-only link left out.
 */
export function resolveTuning(partial: Partial<Tuning> | undefined): Tuning {
  const base = {
    raw: partial?.raw ?? TUNING_DEFAULTS.raw,
    pool: partial?.pool ?? TUNING_DEFAULTS.pool,
  };
  const top = partial?.top;
  const minScore = partial?.minScore;
  if (top === undefined && minScore === undefined) {
    return {
      ...base,
      top: TUNING_DEFAULTS.top,
      minScore: TUNING_DEFAULTS.minScore,
    };
  }
  return {
    ...base,
    ...(top !== undefined ? { top: clampCount(top) } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
  };
}

export const POOLS = ["mean", "max", "softmax"] as const;

/** The one reader of a `pool` value, from storage or URL alike. */
export function isPool(v: unknown): v is Tuning["pool"] {
  return typeof v === "string" && (POOLS as readonly string[]).includes(v);
}

/** Absence means the bound is not in force, on disk as in a URL. `minScore:
 *  null` is accepted on read: an older sentinel spelling meaning the same. */
type StoredTuning = Omit<Partial<Tuning>, "minScore"> & {
  minScore?: number | null;
};

const tuningStore = stored<Tuning>(
  TUNING_KEY,
  (raw) => {
    if (raw === null) return { ...TUNING_DEFAULTS };
    const v = JSON.parse(raw) as StoredTuning;
    // A malformed bound reads as *absent*, not as its default: a value that
    // cannot be parsed cannot testify that its bound was in force.
    return resolveTuning({
      raw: v.raw === true,
      pool: isPool(v.pool) ? v.pool : TUNING_DEFAULTS.pool,
      ...(Number.isFinite(v.top) && (v.top as number) > 0
        ? { top: clampCount(v.top as number) }
        : {}),
      // A profile carrying a real floor and a count it never chose reads as
      // both bounds (D4's third row); the bytes cannot say otherwise.
      ...(v.minScore !== null && Number.isFinite(v.minScore)
        ? { minScore: v.minScore as number }
        : {}),
    });
  },
  // Presence, on disk as everywhere else.
  (v) =>
    JSON.stringify({
      raw: v.raw,
      pool: v.pool,
      ...(v.top !== undefined ? { top: v.top } : {}),
      ...(v.minScore !== undefined ? { minScore: v.minScore } : {}),
    } satisfies StoredTuning),
);
let tuning: Tuning = tuningStore.read();

export function searchTuning(): Tuning {
  return tuning;
}

export function setSearchTuning(next: Tuning): void {
  tuning = next;
  tuningStore.write(next);
}

export function folderMatchingEnabled(): boolean {
  return folderMatching;
}

export function setFolderMatchingEnabled(on: boolean): void {
  folderMatching = on;
  matchStore.write(on);
}

export function searchKinds(): SearchKinds {
  return kinds;
}

export function setSearchKinds(value: SearchKinds): void {
  kinds = value;
  kindsStore.write(value);
}

/** One token with a file name's marks — a `_`, `-` or `.`, or a digit — and no
 *  spaces: typed into meaning search it matches nothing it names. */
export function looksLikeFileName(text: string): boolean {
  const t = text.trim();
  return t.length >= 3 && !/\s/.test(t) && /[_\-.0-9]/.test(t);
}
