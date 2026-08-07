import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'

/** Minimal binary STL: 80-byte header, triangle count, one triangle. */
export function stlBytes(seed = 1): Buffer {
  const buf = Buffer.alloc(84 + 50)
  buf.writeUInt32LE(1, 80)
  for (let i = 0; i < 12; i++) buf.writeFloatLE(seed + i, 84 + i * 4)
  return buf
}

export function makeFixtures(): {
  dir: string
  zipPath: string
  lidStl: Buffer
  boxStl: Buffer
} {
  const dir = mkdtempSync(join(tmpdir(), 'mb-test-'))
  const lidStl = stlBytes(1)
  const boxStl = stlBytes(2)

  writeFileSync(join(dir, 'loose.stl'), stlBytes(3))
  writeFileSync(join(dir, 'notes.txt'), 'not a model')
  writeFileSync(join(dir, '.hidden.stl'), stlBytes(4))
  mkdirSync(join(dir, 'sub'), { recursive: true })

  const zip = zipSync({
    'box.stl': new Uint8Array(boxStl),
    'parts/lid.stl': new Uint8Array(lidStl),
    'parts/readme.txt': new TextEncoder().encode('skip me'),
    'inner.zip': [new Uint8Array(zipSync({ 'deep.stl': new Uint8Array(stlBytes(5)) })), { level: 0 }],
  })
  const zipPath = join(dir, 'models.zip')
  writeFileSync(zipPath, zip)

  return { dir, zipPath, lidStl, boxStl }
}

export const LOOPBACK = { host: '127.0.0.1:3177' }
