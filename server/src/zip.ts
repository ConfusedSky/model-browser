import { open, stat } from 'node:fs/promises'
import { inflateSync } from 'fflate'

export class ZipError extends Error {}

export interface ZipEntry {
  /** Entry path inside the zip, forward-slash separated. */
  name: string
  size: number
  compressedSize: number
  /** 0 = stored, 8 = deflate. */
  method: number
  /** Offset of the local file header. */
  localOffset: number
}

/**
 * What identifies an archive for caching purposes (`listing-tree-cache` D3):
 * its modification time and its size. A zip's central directory is immutable
 * while those are — rewriting an archive necessarily rewrites its tail.
 */
export interface ArchiveId {
  /** `mtimeMs` of the archive file. */
  mtime: number
  /** The archive's size in bytes. */
  size: number
}

/**
 * The archive-directory cache `listZipEntries` consults, declared **here** as a
 * structural interface rather than imported from the module that implements it.
 * That direction is deliberate: `snapshot.ts` knows about zips, `zip.ts` knows
 * nothing about cache directories, library identity or eviction, so this file
 * stays a zip parser and the persistence story stays in one place.
 *
 * Asynchronous on both halves because the implementation backs onto a file it
 * loads lazily; an in-memory hit still costs only a microtask.
 */
export interface ZipDirCache {
  /** The archive's entries as of `id`, or undefined if it holds another version. */
  get(zipPath: string, id: ArchiveId): Promise<ZipEntry[] | undefined>
  /** Record `entries` as this archive's directory at `id`. */
  set(zipPath: string, id: ArchiveId, entries: ZipEntry[]): Promise<void>
}

const EOCD_SIG = 0x06054b50
const CDFH_SIG = 0x02014b50
const LFH_SIG = 0x04034b50
/** Max EOCD scan: 22-byte record + 64KB comment. */
const EOCD_SCAN = 22 + 0xffff

async function readAt(path: string, offset: number, length: number): Promise<Buffer> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await fh.read(buf, 0, length, offset)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/**
 * List a zip's entries by reading only the central directory — nothing is
 * decompressed and nothing is written to disk.
 *
 * With a `cache`, an archive whose `{mtime, size}` is unchanged since it was
 * last read is answered from it and **never opened** (D3) — the largest single
 * measured win in `listing-tree-cache`, ~6.7 s across 409 archives on the
 * spinning volume, because a central directory lives at the file's tail and no
 * OS-level caching keeps those seeks warm.
 *
 * The identity comes from `stat`, not from an open handle, and that is the
 * requirement rather than a tidy-up: the size used to be read by opening the
 * file and calling `fstat`, which would open every archive on the cache-hit
 * path too and make "an unchanged archive is not opened" unmeetable by
 * construction. `stat` supplies the mtime half of the key at the same time.
 */
export async function listZipEntries(zipPath: string, cache?: ZipDirCache): Promise<ZipEntry[]> {
  const info = await stat(zipPath)
  const id: ArchiveId = { mtime: info.mtimeMs, size: info.size }
  if (cache !== undefined) {
    const hit = await cache.get(zipPath, id)
    if (hit !== undefined) return hit
  }
  const entries = await readCentralDirectory(zipPath, id.size)
  if (cache !== undefined) await cache.set(zipPath, id, entries)
  return entries
}

/** The parse itself: the tail seek and the central-directory walk. */
async function readCentralDirectory(zipPath: string, size: number): Promise<ZipEntry[]> {
  const tailLen = Math.min(size, EOCD_SCAN)
  const tail = await readAt(zipPath, size - tailLen, tailLen)

  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new ZipError('not a zip file (no end-of-central-directory record)')

  const count = tail.readUInt16LE(eocd + 10)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOffset = tail.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('zip64 archives are not supported')
  }

  const cd = await readAt(zipPath, cdOffset, cdSize)
  const entries: ZipEntry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CDFH_SIG) {
      throw new ZipError('corrupt central directory')
    }
    const method = cd.readUInt16LE(p + 10)
    const compressedSize = cd.readUInt32LE(p + 20)
    const uncompressedSize = cd.readUInt32LE(p + 24)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    const localOffset = cd.readUInt32LE(p + 42)
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (!name.endsWith('/')) {
      entries.push({ name, size: uncompressedSize, compressedSize, method, localOffset })
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * Decompress a single entry on demand. Reads only the entry's local header and
 * compressed bytes; nothing is persisted.
 */
export async function extractEntry(zipPath: string, entryName: string): Promise<Buffer> {
  const entries = await listZipEntries(zipPath)
  const entry = entries.find((e) => e.name === entryName)
  if (!entry) throw new ZipError(`entry not found: ${entryName}`)

  const header = await readAt(zipPath, entry.localOffset, 30)
  if (header.length < 30 || header.readUInt32LE(0) !== LFH_SIG) {
    throw new ZipError('corrupt local file header')
  }
  const nameLen = header.readUInt16LE(26)
  const extraLen = header.readUInt16LE(28)
  const dataStart = entry.localOffset + 30 + nameLen + extraLen
  const raw = await readAt(zipPath, dataStart, entry.compressedSize)

  if (entry.method === 0) return raw
  if (entry.method === 8) {
    try {
      return Buffer.from(inflateSync(raw))
    } catch {
      throw new ZipError(`failed to decompress entry: ${entryName}`)
    }
  }
  throw new ZipError(`unsupported compression method ${entry.method}`)
}
