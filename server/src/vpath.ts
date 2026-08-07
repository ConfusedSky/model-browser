/**
 * Virtual paths address zip entries as `<zip-path>!/<entry-path>`, e.g.
 * `models/foo.zip!/parts/lid.stl`. At most one `!/` level: nested zips are
 * listed but not enterable.
 */

const SEP = '!/'

export interface ParsedVPath {
  /** Filesystem path — the file or the containing zip. */
  fsPath: string
  /** Entry path inside the zip, undefined for plain fs paths. May be '' for the zip root. */
  entry?: string
}

export class VPathError extends Error {}

export function parseVPath(vpath: string): ParsedVPath {
  const idx = vpath.indexOf(SEP)
  if (idx === -1) return { fsPath: vpath }
  const fsPath = vpath.slice(0, idx)
  const entry = vpath.slice(idx + SEP.length)
  // Only the path grammar is checked here. Whether an entry ending in .zip is
  // a nested zip (rejected) or a directory that happens to be named *.zip
  // (navigable) is decided against the central directory by the listing/file
  // layers — a name alone cannot tell them apart.
  if (entry.includes(SEP)) {
    throw new VPathError('nested zips are unsupported')
  }
  return { fsPath, entry }
}

export function joinVPath(zipPath: string, entry: string): string {
  return `${zipPath}${SEP}${entry}`
}

export function isVPath(vpath: string): boolean {
  return vpath.includes(SEP)
}
