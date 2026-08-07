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
  if (entry.includes(SEP) || /\.zip$/i.test(entry)) {
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
