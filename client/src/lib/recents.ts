const KEY = 'model-browser:recents'
const LAST_KEY = 'model-browser:last-path'
const MAX = 10

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw !== null ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function pushRecent(path: string): void {
  const list = [path, ...getRecents().filter((p) => p !== path)].slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(list))
  localStorage.setItem(LAST_KEY, path)
}

export function getLastPath(): string {
  return localStorage.getItem(LAST_KEY) ?? ''
}
