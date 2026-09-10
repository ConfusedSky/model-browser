import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CameraState, OrbitAxis } from '../../shared/types'
import { MARKER_FILE, USAGE, migrateFrames, parseArgs } from '../../scripts/migrate-frames'
import { FRAME_CONVENTION } from '../src/cache'

/**
 * The migration's core, exercised as a function over a temp cache directory
 * built the way `cache.test.ts`'s `tempCache()` builds one (file-frame-spindle
 * D5). The script keys nothing on the sidecar's hash — it walks `*.json` —
 * so the fixture keys here are plain names.
 */
const cleanups: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mb-migrate-'))
  cleanups.push(dir)
  return dir
}

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

const CAM: CameraState = { az: Math.PI / 4, el: 0.3, distR: 2.5, target: [0, 0, 0] }
const RENDER = Buffer.from('webp-bytes-never-touched')

interface Fixture {
  path: string
  camera?: CameraState
  axis?: OrbitAxis
  frame?: number
}

/** Writes `<key>.json` with the given fields (plus the labels a real sidecar carries) and a dummy `<key>.webp`. */
function sidecar(dir: string, key: string, f: Fixture): string {
  const meta: Record<string, unknown> = { path: f.path, mtime: 1234, lighting: 'studio', rig: 7, gen: 3 }
  if (f.camera !== undefined) meta.camera = f.camera
  if (f.axis !== undefined) meta.axis = f.axis
  if (f.frame !== undefined) meta.frame = f.frame
  const file = join(dir, `${key}.json`)
  writeFileSync(file, JSON.stringify(meta))
  writeFileSync(join(dir, `${key}.webp`), RENDER)
  return file
}

function readSidecar(dir: string, key: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')) as Record<string, unknown>
}

function readMarker(dir: string): { convention: number; at: string; counts: Record<string, number> } {
  return JSON.parse(readFileSync(join(dir, MARKER_FILE), 'utf8')) as { convention: number; at: string; counts: Record<string, number> }
}

const quiet = () => undefined

const ZERO = { relabelled: 0, reExpressed: 0, labelOnly: 0, alreadyLabelled: 0, unclassifiable: 0, skipped: 0 }

describe('migrate-frames', () => {
  it('relabels an STL y axis to z, the camera and the render untouched', async () => {
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.stl', camera: CAM, axis: 'y' })
    const lines: string[] = []
    const result = await migrateFrames({ cacheDir: dir, report: (m) => lines.push(m) })

    expect(result).toMatchObject({ read: 1, ...ZERO, relabelled: 1 })
    const after = readSidecar(dir, 'a')
    expect(after.axis).toBe('z')
    expect(after.camera).toEqual(CAM)
    expect(after.frame).toBe(FRAME_CONVENTION)
    // Every other field carried verbatim.
    expect(after).toMatchObject({ path: '/kit/a.stl', mtime: 1234, lighting: 'studio', rig: 7, gen: 3 })
    expect(readFileSync(join(dir, 'a.webp'))).toEqual(RENDER)
    expect(readMarker(dir)).toMatchObject({ convention: 2, counts: { relabelled: 1 } })
    expect(lines.some((l) => l.includes('1 axes relabelled'))).toBe(true)
  })

  it('relabels an STL -z axis to y', async () => {
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.stl', axis: '-z' })
    const result = await migrateFrames({ cacheDir: dir, report: quiet })
    expect(result.relabelled).toBe(1)
    expect(readSidecar(dir, 'a').axis).toBe('y')
  })

  it('labels an STL camera with no axis and writes no axis', async () => {
    // The entry drew about the old default `y` and draws about the new default
    // `z`, whose frame is the old `y` frame — and a written axis would withhold
    // an index pose the entry never suppressed (D5).
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.stl', camera: CAM })
    const result = await migrateFrames({ cacheDir: dir, report: quiet })
    expect(result).toMatchObject({ ...ZERO, labelOnly: 1 })
    const after = readSidecar(dir, 'a')
    expect('axis' in after).toBe(false)
    expect(after.camera).toEqual(CAM)
    expect(after.frame).toBe(FRAME_CONVENTION)
  })

  it('re-expresses an OBJ camera at spindle z by the swap offset, the axis untouched', async () => {
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.obj', camera: CAM, axis: 'z' })
    const result = await migrateFrames({ cacheDir: dir, report: quiet })
    expect(result).toMatchObject({ ...ZERO, reExpressed: 1 })
    const after = readSidecar(dir, 'a')
    expect(after.axis).toBe('z')
    const camera = after.camera as CameraState
    expect(camera.az).toBeCloseTo(Math.PI / 4 + Math.PI / 2, 12)
    expect(camera.el).toBe(CAM.el)
    expect(camera.distR).toBe(CAM.distR)
    expect(after.frame).toBe(FRAME_CONVENTION)
  })

  it('labels an OBJ at spindle y without moving anything', async () => {
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.obj', camera: CAM, axis: 'y' })
    // With no axis the old default was `y` too: offset 0, label only.
    sidecar(dir, 'b', { path: '/kit/b.obj', camera: CAM })
    const result = await migrateFrames({ cacheDir: dir, report: quiet })
    expect(result).toMatchObject({ ...ZERO, labelOnly: 2 })
    expect(readSidecar(dir, 'a')).toMatchObject({ axis: 'y', camera: CAM, frame: FRAME_CONVENTION })
    expect(readSidecar(dir, 'b')).toMatchObject({ camera: CAM, frame: FRAME_CONVENTION })
  })

  it('leaves a labelled entry untouched and counts it', async () => {
    const dir = tempDir()
    const file = sidecar(dir, 'a', { path: '/kit/a.stl', camera: CAM, axis: 'z', frame: FRAME_CONVENTION })
    const before = readFileSync(file, 'utf8')
    const result = await migrateFrames({ cacheDir: dir, report: quiet })
    expect(result).toMatchObject({ ...ZERO, alreadyLabelled: 1 })
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('skips a sidecar with neither camera nor axis and writes no label', async () => {
    const dir = tempDir()
    const file = sidecar(dir, 'a', { path: '/kit/a.stl' })
    const before = readFileSync(file, 'utf8')
    const result = await migrateFrames({ cacheDir: dir, report: quiet })
    expect(result).toMatchObject({ ...ZERO, skipped: 1 })
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('reports an unclassifiable path and leaves it untouched', async () => {
    const dir = tempDir()
    const file = sidecar(dir, 'a', { path: '/kit/a.txt', axis: 'y' })
    const before = readFileSync(file, 'utf8')
    const lines: string[] = []
    const result = await migrateFrames({ cacheDir: dir, report: (m) => lines.push(m) })
    expect(result).toMatchObject({ ...ZERO, unclassifiable: 1 })
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(lines.some((l) => l.includes('/kit/a.txt') && l.includes(file))).toBe(true)
  })

  it('is idempotent: a second run reports every entry already labelled and rewrites the marker', async () => {
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.stl', camera: CAM, axis: 'y' })
    sidecar(dir, 'b', { path: '/kit/b.obj', camera: CAM, axis: 'z' })
    sidecar(dir, 'c', { path: '/kit/c.stl', camera: CAM })
    const first = await migrateFrames({ cacheDir: dir, report: quiet, now: () => new Date('2026-09-10T10:00:00Z') })
    expect(first).toMatchObject({ ...ZERO, relabelled: 1, reExpressed: 1, labelOnly: 1 })
    const texts = ['a', 'b', 'c'].map((k) => readFileSync(join(dir, `${k}.json`), 'utf8'))

    const second = await migrateFrames({ cacheDir: dir, report: quiet, now: () => new Date('2026-09-10T11:00:00Z') })
    expect(second).toMatchObject({ ...ZERO, alreadyLabelled: 3 })
    expect(['a', 'b', 'c'].map((k) => readFileSync(join(dir, `${k}.json`), 'utf8'))).toEqual(texts)
    // The marker records the latest run: its `at` advances and its counts are the second run's.
    expect(readMarker(dir)).toMatchObject({ at: '2026-09-10T11:00:00.000Z', counts: { alreadyLabelled: 3, relabelled: 0 } })
  })

  it('undoes a run: axes back, azimuth back, no label, marker gone; a forward run then repeats the counts', async () => {
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.stl', camera: CAM, axis: 'y' })
    sidecar(dir, 'b', { path: '/kit/b.stl', axis: '-z' })
    sidecar(dir, 'c', { path: '/kit/c.obj', camera: CAM, axis: 'z' })
    sidecar(dir, 'd', { path: '/kit/d.stl', camera: CAM })
    sidecar(dir, 'e', { path: '/kit/e.stl' })
    const first = await migrateFrames({ cacheDir: dir, report: quiet })
    expect(first).toMatchObject({ read: 5, ...ZERO, relabelled: 2, reExpressed: 1, labelOnly: 1, skipped: 1 })

    const lines: string[] = []
    const undone = await migrateFrames({ cacheDir: dir, undo: true, report: (m) => lines.push(m) })
    expect(undone).toMatchObject({ read: 5, ...ZERO, relabelled: 2, reExpressed: 1, labelOnly: 1, skipped: 1 })
    expect(readSidecar(dir, 'a')).toMatchObject({ axis: 'y', camera: CAM })
    expect(readSidecar(dir, 'b').axis).toBe('-z')
    const c = readSidecar(dir, 'c')
    expect(c.axis).toBe('z')
    expect((c.camera as CameraState).az).toBeCloseTo(CAM.az, 12)
    for (const k of ['a', 'b', 'c', 'd']) expect('frame' in readSidecar(dir, k)).toBe(false)
    expect(existsSync(join(dir, MARKER_FILE))).toBe(false)
    expect(readFileSync(join(dir, 'a.webp'))).toEqual(RENDER)
    expect(lines.some((l) => l.includes('undid') && l.includes('2 axes put back'))).toBe(true)

    const again = await migrateFrames({ cacheDir: dir, report: quiet })
    expect(again).toMatchObject({ read: 5, ...ZERO, relabelled: 2, reExpressed: 1, labelOnly: 1, skipped: 1 })
    expect(readSidecar(dir, 'a').axis).toBe('z')
  })

  it('undo over a directory never migrated changes nothing and reports zeros', async () => {
    const dir = tempDir()
    const file = sidecar(dir, 'a', { path: '/kit/a.stl', camera: CAM, axis: 'y' })
    const before = readFileSync(file, 'utf8')
    const result = await migrateFrames({ cacheDir: dir, undo: true, report: quiet })
    expect(result).toMatchObject({ read: 1, ...ZERO, alreadyLabelled: 1 })
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(existsSync(join(dir, MARKER_FILE))).toBe(false)
  })

  it('refuses a migrated directory holding an unlabelled framed sidecar newer than the marker, writing nothing', async () => {
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.stl', camera: CAM, axis: 'y' })
    // The marker's `at` is an hour ago, so anything written from here on is
    // "after the migration".
    await migrateFrames({ cacheDir: dir, report: quiet, now: () => new Date(Date.now() - 3600_000) })
    const marker = readFileSync(join(dir, MARKER_FILE), 'utf8')
    // What a rolled-back server writes: a file axis (`z`) with no label.
    const rolled = sidecar(dir, 'b', { path: '/kit/b.stl', camera: CAM, axis: 'z' })
    const before = readFileSync(rolled, 'utf8')

    await expect(migrateFrames({ cacheDir: dir, report: quiet })).rejects.toThrow(
      /rolled-back server[\s\S]*cp -r[\s\S]*--undo/,
    )
    await expect(migrateFrames({ cacheDir: dir, report: quiet })).rejects.toThrow(rolled)
    // Nothing written: the sidecar's text and the marker are as they were, and
    // `z` was not relabelled to `-y`.
    expect(readFileSync(rolled, 'utf8')).toBe(before)
    expect(readFileSync(join(dir, MARKER_FILE), 'utf8')).toBe(marker)
    expect(readSidecar(dir, 'a')).toMatchObject({ axis: 'z', frame: FRAME_CONVENTION })
  })

  it('does not refuse for an unlabelled sidecar older than the marker — the unframed kind the run skipped', async () => {
    const dir = tempDir()
    sidecar(dir, 'a', { path: '/kit/a.stl', camera: CAM, axis: 'y' })
    sidecar(dir, 'b', { path: '/kit/b.stl' })
    await migrateFrames({ cacheDir: dir, report: quiet })
    // An hour later, by the clock the marker is compared against, nothing has
    // been written: the second run is the idempotent one.
    const second = await migrateFrames({ cacheDir: dir, report: quiet, now: () => new Date(Date.now() + 3600_000) })
    expect(second).toMatchObject({ ...ZERO, alreadyLabelled: 1, skipped: 1 })
  })

  it('refuses an unknown flag and a missing --cache-dir with the usage line', () => {
    expect(() => parseArgs(['--cache-dir', '/x', '--dry-run'])).toThrow(`unknown flag --dry-run\n${USAGE}`)
    expect(() => parseArgs(['--undo'])).toThrow(USAGE)
    expect(() => parseArgs(['--cache-dir'])).toThrow(USAGE)
    expect(() => parseArgs([])).toThrow(USAGE)
    expect(parseArgs(['--cache-dir', '/x'])).toEqual({ cacheDir: '/x', undo: false })
    expect(parseArgs(['--undo', '--cache-dir', '/x'])).toEqual({ cacheDir: '/x', undo: true })
  })
})
