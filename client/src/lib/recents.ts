/** Library paths (D2/D7). The `:v2` suffix abandons the pre-library keys rather
 *  than migrate them: their filesystem paths read here as library paths that
 *  are almost certainly not there. */
const KEY = "model-browser:recents:v2";
const LAST_KEY = "model-browser:last-path:v2";
const MAX = 10;

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw !== null ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** The last path is written and **nothing reads it**: the boot view is the
 *  library's top (D2). Kept because a gap in the record cannot be filled in. */
export function pushRecent(path: string): void {
  const list = [path, ...getRecents().filter((p) => p !== path)].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(list));
  localStorage.setItem(LAST_KEY, path);
}
