/**
 * Recently visited directories, as **library paths** (design D2/D7).
 *
 * The keys carry a `:v2` suffix and the pre-library keys are never read. That
 * is the whole migration: every stored value was an absolute filesystem path,
 * which under the new grammar reads as a library path that almost certainly is
 * not there, so a recents list restored from them would offer nothing but
 * not-founds and a boot seeded from one would land on an error. Re-keying
 * abandons them where they stand — a `localStorage` entry costs nothing and
 * being unable to read it is the point.
 */
const KEY = 'model-browser:recents:v2'
const LAST_KEY = 'model-browser:last-path:v2'
const MAX = 10

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw !== null ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/**
 * Record a landing. The last path is still written, and nothing reads it: the
 * boot view is the library's top (D2), not wherever the last session ended, so
 * `getLastPath` is gone along with `resolveView`'s call to it. The write stays
 * because the value is the one thing a later "reopen where I was" would need
 * and it costs a key, whereas a gap in the record cannot be filled in
 * afterwards.
 */
export function pushRecent(path: string): void {
  const list = [path, ...getRecents().filter((p) => p !== path)].slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(list))
  localStorage.setItem(LAST_KEY, path)
}
