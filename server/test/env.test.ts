/**
 * The one validated environment knob (`env.ts`), through each of the three
 * bounds that read one.
 *
 * There were three copies of this parser and they drifted: the
 * floor-before-positivity rule was written into `listing.ts`'s and
 * `snapshot.ts`'s and missed in `cache.ts`'s, which went on turning
 * `MODEL_BROWSER_CACHE_CAP=0.5` into a cap of **zero** — a knob that swept the
 * whole pixel store on every write, doing the exact opposite of what it spells
 * (`listing-tree-cache` round-2 finding 9). One parser now, and one cell per
 * knob so a fourth caller cannot quietly grow a fourth copy without something
 * here to point at.
 *
 * `0.5` is the case that separates the two orderings and nothing else does:
 * it is finite and greater than zero, so a positivity test passes it, and
 * `Math.floor` afterwards yields 0. Every other malformed spelling
 * (`'2GB'`, `'-1'`, `'0'`) falls back under either ordering.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ThumbCache } from '../src/cache'
import { listFlat } from '../src/listing'
import { SnapshotStore } from '../src/snapshot'
import { libraryFor, realTempDir, stlBytes } from './helpers'

const KNOBS = [
  'MODEL_BROWSER_CACHE_CAP',
  'MODEL_BROWSER_SNAPSHOT_CAP',
  'MODEL_BROWSER_FLAT_CAP',
] as const

afterEach(() => {
  for (const knob of KNOBS) delete process.env[knob]
})

/** The two defaults, read where they are declared rather than re-typed here. */
const DEFAULT_THUMB_CAP = new ThumbCache('/nowhere').sizeCap
const DEFAULT_SNAPSHOT_CAP = new SnapshotStore('/nowhere').sizeCap

describe("a fractional knob is malformed, and malformed falls back", () => {
  it('the thumbnail cap — the copy that had the bug', () => {
    process.env.MODEL_BROWSER_CACHE_CAP = '0.5'
    // Not 0. A cap of 0 makes `total <= this.sizeCap` false for any non-empty
    // store, so every `maintain()` evicts every PNG in the library.
    expect(new ThumbCache('/nowhere').sizeCap).toBe(DEFAULT_THUMB_CAP)
    expect(DEFAULT_THUMB_CAP).toBeGreaterThan(0)
  })

  it('the snapshot-store cap', () => {
    process.env.MODEL_BROWSER_SNAPSHOT_CAP = '0.5'
    expect(new SnapshotStore('/nowhere').sizeCap).toBe(DEFAULT_SNAPSHOT_CAP)
    expect(DEFAULT_SNAPSHOT_CAP).toBeGreaterThan(0)
  })

  it('the listing cap, which is a knob about an answer rather than a store', async () => {
    const top = join(realTempDir('mb-env-'), 'top')
    mkdirSync(join(top, '.model-browser'), { recursive: true })
    writeFileSync(join(top, '.model-browser', 'library.json'), JSON.stringify({ id: 'env', version: 1 }))
    mkdirSync(join(top, 'kit'))
    for (let i = 0; i < 3; i++) writeFileSync(join(top, 'kit', `m${i}.stl`), stlBytes(i + 1))
    const library = libraryFor(top)
    await library.state()

    process.env.MODEL_BROWSER_FLAT_CAP = '0.5'
    const listing = await listFlat(library, '/kit')
    // A cap of 0 would return an empty, `truncated` listing for a folder that
    // was walked end to end — every search on the machine answering nothing.
    expect(listing.entries.map((e) => e.name)).toEqual(['m0.stl', 'm1.stl', 'm2.stl'])
    expect(listing.truncated).toBeUndefined()
  })

  it('and every other malformed spelling falls back too, under any ordering', () => {
    for (const raw of ['2GB', '-1', '0', 'NaN', '']) {
      process.env.MODEL_BROWSER_SNAPSHOT_CAP = raw
      expect(new SnapshotStore('/nowhere').sizeCap, `for ${JSON.stringify(raw)}`).toBe(
        DEFAULT_SNAPSHOT_CAP,
      )
    }
  })
})
