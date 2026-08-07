import { open } from 'node:fs/promises'
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

async function fileSize(path: string): Promise<number> {
  const fh = await open(path, 'r')
  try {
    return (await fh.stat()).size
  } finally {
    await fh.close()
  }
}

/**
 * List a zip's entries by reading only the central directory — nothing is
 * decompressed and nothing is written to disk.
 */
export async function listZipEntries(zipPath: string): Promise<ZipEntry[]> {
  const size = await fileSize(zipPath)
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
