/**
 * `<library>/.model-browser/overrides.json` (D1): display names, credits and
 * poses, keyed by canonical library path. Directory keys cover their subtree by
 * longest prefix, merged **per field**, and `name` alone does not inherit (D2).
 * Every writer goes through `writeOverrides` here, so there is one atomic
 * write (D5).
 */

import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { renderableCredits } from "../../shared/credits";
import type {
  CreditedKit,
  DirEntry,
  OverrideEntry,
  ResolvedOverrides,
} from "../../shared/types";
import { MARKER_DIR, type Library, canonicalLibPath } from "./library";
import { joinVPath, parseVPath } from "./vpath";

/** The store's file name, inside `MARKER_DIR` beside `library.json`. */
export const STORE_FILE = "overrides.json";

/**
 * Additive evolution happens *within* a version — unknown fields are preserved
 * and ignored — so a bump is a deliberate break, reported rather than guessed at.
 */
const VERSION = 1;

/** The loaded store: canonical library path → the fields stored at that key. */
export type OverrideStore = ReadonlyMap<string, OverrideEntry>;

/** An absent, unreadable or unusable store — the answer is "no overrides". */
const EMPTY: OverrideStore = new Map();

/** The store file as it sits on disk, unknown fields and all. */
export interface OverridesFile {
  version: number;
  entries: Record<string, OverrideEntry>;
  [field: string]: unknown;
}

/** Injected so a test can collect them; the default prints beside the startup lines. */
export type Report = (message: string) => void;

const defaultReport: Report = (message) => {
  console.warn(message);
};

/**
 * `canonicalLibPath` normalises the filesystem half only, so the archive side is
 * handled here: a trailing slash is stripped, `parts/` being how a zip spells a
 * directory, and an empty entry half is refused — that key is the archive's path.
 */
function storeKey(raw: string): { key: string } | { error: string } {
  let canonical: string;
  try {
    canonical = canonicalLibPath(raw);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "not a library path" };
  }
  const { fsPath, entry } = parseVPath(canonical);
  if (entry === undefined) return { key: canonical };
  const trimmed = entry.endsWith("/") ? entry.slice(0, -1) : entry;
  if (trimmed === "") {
    return {
      error:
        "an empty archive-entry half (`…!/`) is not a key; use the archive's own path",
    };
  }
  return { key: joinVPath(fsPath, trimmed) };
}

/**
 * Absent is empty and **silent**; broken is empty and *reported* (D1) — it must
 * not take the library down, but credits quietly absent hide forever.
 */
export async function loadOverrides(
  top: string,
  report: Report = defaultReport,
): Promise<OverrideStore> {
  const file = join(top, MARKER_DIR, STORE_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return EMPTY;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    report(`overrides: ${file} is not valid JSON — ignored`);
    return EMPTY;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    report(`overrides: ${file} is not an object — ignored`);
    return EMPTY;
  }
  const { version, entries } = parsed as Record<string, unknown>;
  if (version !== VERSION) {
    report(
      `overrides: ${file} has unknown version ${JSON.stringify(version)} — ignored`,
    );
    return EMPTY;
  }
  if (
    typeof entries !== "object" ||
    entries === null ||
    Array.isArray(entries)
  ) {
    report(`overrides: ${file} has no entries object — ignored`);
    return EMPTY;
  }
  const store = new Map<string, OverrideEntry>();
  for (const [raw, value] of Object.entries(
    entries as Record<string, unknown>,
  )) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      report(
        `overrides: ${file}: ignoring key ${JSON.stringify(raw)} — its value is not an object`,
      );
      continue;
    }
    const spelled = storeKey(raw);
    if ("error" in spelled) {
      report(
        `overrides: ${file}: ignoring key ${JSON.stringify(raw)} — ${spelled.error}`,
      );
      continue;
    }
    // Hand-written files are expected (D6), and an object where a string belongs
    // would ride onto the wire and unmount the grid as a React child. The bad
    // *field* is dropped and reported, never the entry.
    const entry = { ...(value as OverrideEntry) };
    if (entry.name !== undefined && typeof entry.name !== "string") {
      report(
        `overrides: ${file}: key ${JSON.stringify(raw)} — dropping non-string name`,
      );
      delete entry.name;
    }
    if (entry.credits !== undefined) {
      if (
        typeof entry.credits !== "object" ||
        entry.credits === null ||
        Array.isArray(entry.credits)
      ) {
        report(
          `overrides: ${file}: key ${JSON.stringify(raw)} — dropping non-object credits`,
        );
        delete entry.credits;
      } else {
        // An allow-list: nothing unknown rides the wire, while unknown fields stay
        // on DISK untouched, which is what lets a newer store ship under an older
        // build (`credits-completion` D1/D6).
        const held = entry.credits as Record<string, unknown>;
        const clean: Record<string, string> = {};
        for (const field of [
          "author",
          "authorUrl",
          "license",
          "licenseUrl",
          "modified",
          "sourceUrl",
        ] as const) {
          const value = held[field];
          if (typeof value === "string") clean[field] = value;
          else if (value !== undefined) {
            report(
              `overrides: ${file}: key ${JSON.stringify(raw)} — dropping non-string credits.${field}`,
            );
          }
        }
        entry.credits = clean;
      }
    }
    // Two spellings of one key: last read wins, unreported.
    store.set(spelled.key, entry);
  }
  return store;
}

/**
 * Every key that can speak for `libPath`, root first (D2). **Parse, then walk**:
 * splitting on `/` alone yields `a.zip!` and never `/kit/a.zip`, which is where a
 * kit's credits are written. Segment-joined, so `/kit` never encloses `/kit2`.
 */
function ancestorKeys(libPath: string): string[] {
  const { fsPath, entry } = parseVPath(libPath);
  const keys: string[] = ["/"];
  let acc = "";
  for (const segment of fsPath.split("/")) {
    if (segment === "") continue;
    acc = `${acc}/${segment}`;
    keys.push(acc);
  }
  if (entry === undefined || entry === "") return keys;
  let inner = "";
  for (const segment of entry.split("/")) {
    if (segment === "") continue;
    inner = inner === "" ? segment : `${inner}/${segment}`;
    keys.push(joinVPath(fsPath, inner));
  }
  return keys;
}

/**
 * `name` does not inherit (D2/D7), or a kit's name would label every model under
 * it, and resolves from the **last ancestor key**: `…!/` and trailing-slash
 * lookups are spellings no key can be written in.
 */
export function resolveOverrides(
  store: OverrideStore,
  libPath: string,
): ResolvedOverrides {
  const keys = ancestorKeys(libPath);
  const resolved: ResolvedOverrides = {};
  // Each field merged **whole**, nearest key winning it independently of the
  // others (D2), so a generator writing directory keys and a pose writer writing
  // file keys compose without knowing about each other.
  for (const key of keys) {
    const entry = store.get(key);
    if (entry === undefined) continue;
    if (entry.credits !== undefined) resolved.credits = entry.credits;
    if (entry.pose !== undefined) resolved.pose = entry.pose;
  }
  const exact = store.get(keys[keys.length - 1]!);
  if (exact?.name !== undefined) resolved.name = exact.name;
  return resolved;
}

/**
 * Keys holding credits of their **own** (`landing-page` D8). No inheritance, or
 * one attribution repeats per model; `renderableCredits` is the lightbox's own
 * filter, so the list and the panel agree on what counts as credited.
 */
export function listCredits(store: OverrideStore): CreditedKit[] {
  const listed: CreditedKit[] = [];
  for (const [path, entry] of store) {
    const credits = renderableCredits(entry.credits);
    if (credits === null) continue;
    // Absent rather than `undefined`, so the type says what the wire does.
    listed.push(
      entry.name === undefined
        ? { path, credits }
        : { path, name: entry.name, credits },
    );
  }
  return listed;
}

/** A Map get: no I/O and no prefix walk, so it is affordable per entry (D7). */
export function displayNameOf(
  store: OverrideStore,
  libPath: string,
): string | undefined {
  return store.get(libPath)?.name;
}

/**
 * Names attached in place, where a listing becomes wire bytes (D7) — not inside
 * `listing.ts`, since not every listing leaves it through `wire`. **Exact key,
 * never the prefix resolution**: a kit's name labels its own tile only.
 */
export function applyDisplayNames(
  entries: DirEntry[],
  store: OverrideStore,
): void {
  if (store.size === 0) return;
  for (const entry of entries) {
    const name = displayNameOf(store, entry.path);
    if (name !== undefined) entry.displayName = name;
    // An inline contact sheet (`listing-tree-cache` 6.3) holds model tiles the
    // client labels like any other (D7), and the preview layer stores them
    // pre-naming, so this pass is the only thing that names them.
    if (entry.preview !== undefined) applyDisplayNames(entry.preview, store);
  }
}

/**
 * Temp file, fsync, rename, so a reader sees the old store or the new one. The
 * directory fsync is what makes the *rename* durable, and is best-effort:
 * exFAT does not support it.
 */
export async function writeOverrides(
  top: string,
  file: OverridesFile,
): Promise<void> {
  const dir = join(top, MARKER_DIR);
  await mkdir(dir, { recursive: true });
  const target = join(dir, STORE_FILE);
  // pid + ms collide within one tick; the random suffix is what does not.
  const temp = join(
    dir,
    `.${STORE_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (err) {
    await unlink(temp).catch(() => undefined);
    throw err;
  }
  const dirHandle = await open(dir, "r").catch(() => null);
  if (dirHandle !== null) {
    await dirHandle.sync().catch(() => undefined);
    await dirHandle.close().catch(() => undefined);
  }
}

/** Holds the store for whichever library is currently resolved. */
export interface OverrideHolder {
  /** Empty while the library is not ready; loaded once per resolved library. */
  store(): Promise<OverrideStore>;
}

/**
 * Per **resolved library**, never per process (D1): identity can change
 * mid-process, and serving one library's credits for another's paths is a CC-BY
 * defect rather than staleness. A **compare, not a hook** — `Library` fires no
 * event on settling — and single-flighted, since a client's boot arrives as a
 * dozen concurrent requests. One read per resolution; restart after editing.
 */
export function createOverrideHolder(
  library: Library,
  report: Report = defaultReport,
): OverrideHolder {
  let held: { id: string; top: string; store: OverrideStore } | undefined;
  let pending: Promise<OverrideStore> | undefined;

  async function current(): Promise<OverrideStore> {
    const state = await library.state();
    if (state.state !== "ready") return EMPTY;
    // `realTop()`, not the state's `top`, which a deployment may withhold (D11).
    const top = library.realTop();
    if (held !== undefined && held.id === state.id && held.top === top)
      return held.store;
    const store = await loadOverrides(top, report);
    held = { id: state.id, top, store };
    return store;
  }

  return {
    store() {
      return (pending ??= current().finally(() => {
        pending = undefined;
      }));
    },
  };
}
