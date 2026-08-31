import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DirEntry } from '../../shared/types'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { createLibrary } from '../src/library'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

/**
 * A pass-through mock of `readdir` that can hand back the real answer
 * **reversed**. Node sorts what it returns, so a fixture built in shuffled
 * creation order still arrives in code-point order under vitest and asserts
 * nothing about the sort the peek's bound depends on — the production runtime
 * is Bun, which returns raw directory order. Reversing is the one order this
 * suite can produce that is definitely not the filesystem's.
 *
 * The same shape, and for the same reason, as `library.test.ts`'s counting
 * mock: `vi.spyOn` on an ESM namespace throws. Only the cells that arm
 * `rd.reverse` see anything different; everything else runs on the real
 * filesystem.
 */
const rd = vi.hoisted(() => ({ reverse: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (async (...args: Parameters<typeof actual.readdir>) => {
      const out = await actual.readdir(...args)
      return rd.reverse ? [...out].reverse() : out
    }) as typeof actual.readdir,
  }
})

/**
 * One library holding every fixture, so each request below names a library path
 * and the filesystem locations stay the test's own business (library-root D2).
 *
 * libTop/
 *   kit/      a.stl b.stl  asub/q.stl  sub/{y.stl,z.stl}  .hidden/h.stl
 *   folders/  aa/{1..5}.stl  bb/x.stl
 *   wide/     m00.stl … m79.stl                      (80 models, over budget)
 *   cut/      00.txt … 62.txt  B.stl  a.stl          (65 entries, over budget)
 *   budget/   00.stl  01.txt … 80.txt                (81 entries, over budget)
 *   links/    in -> folders/bb   out -> outsideFs    (outsideFs is not in the library)
 *   cyc/      a/{z.stl, back -> cyc}
 *   onlyzip/  kit.zip { box.stl, parts/lid.stl }
 *   empty/
 */
const libTop = realTempDir('mb-peek-')
const outsideFs = realTempDir('mb-peek-outside-')
writeFileSync(join(outsideFs, 'secret.stl'), stlBytes(90))

mkdirSync(join(libTop, 'kit', 'asub'), { recursive: true })
mkdirSync(join(libTop, 'kit', 'sub'))
mkdirSync(join(libTop, 'kit', '.hidden'))
writeFileSync(join(libTop, 'kit', 'b.stl'), stlBytes(1))
writeFileSync(join(libTop, 'kit', 'a.stl'), stlBytes(2))
writeFileSync(join(libTop, 'kit', 'notes.txt'), 'not a model')
writeFileSync(join(libTop, 'kit', 'asub', 'q.stl'), stlBytes(3))
writeFileSync(join(libTop, 'kit', 'sub', 'z.stl'), stlBytes(4))
writeFileSync(join(libTop, 'kit', 'sub', 'y.stl'), stlBytes(5))
writeFileSync(join(libTop, 'kit', '.hidden', 'h.stl'), stlBytes(6))

mkdirSync(join(libTop, 'folders', 'aa'), { recursive: true })
mkdirSync(join(libTop, 'folders', 'bb'))
for (let i = 1; i <= 5; i++) writeFileSync(join(libTop, 'folders', 'aa', `${i}.stl`), stlBytes(i))
writeFileSync(join(libTop, 'folders', 'bb', 'x.stl'), stlBytes(7))

// 80 models: more than PEEK_BUDGET (64), so the bound cuts inside one level.
mkdirSync(join(libTop, 'wide'))
const WIDE = Array.from({ length: 80 }, (_, i) => `m${String(i).padStart(2, '0')}.stl`)
for (const name of WIDE) writeFileSync(join(libTop, 'wide', name), stlBytes(8))

/**
 * The cut fixture. 63 non-model files sort first under every collation, so the
 * bound (64 entries) falls on exactly one of the two models that follow:
 *
 *   code-point:  … 62.txt, **B.stl**, a.stl   → `B.stl` is charged, `a.stl` is not
 *   ICU locale:  … 62.txt, **a.stl**, B.stl   → the other way round
 *   raw readdir: whatever the volume says     → both, or neither
 *
 * so the single previewed model names which order the charge loop ran in.
 */
mkdirSync(join(libTop, 'cut'))
for (let i = 0; i < 63; i++) {
  writeFileSync(join(libTop, 'cut', `${String(i).padStart(2, '0')}.txt`), 'x')
}
writeFileSync(join(libTop, 'cut', 'B.stl'), stlBytes(9))
writeFileSync(join(libTop, 'cut', 'a.stl'), stlBytes(10))

// One model, then more noise than the budget can pay for.
mkdirSync(join(libTop, 'budget'))
writeFileSync(join(libTop, 'budget', '00.stl'), stlBytes(11))
for (let i = 1; i <= 80; i++) {
  writeFileSync(join(libTop, 'budget', `${String(i).padStart(2, '0')}.txt`), 'x')
}

mkdirSync(join(libTop, 'links'))
symlinkSync(join(libTop, 'folders', 'bb'), join(libTop, 'links', 'in'))
symlinkSync(outsideFs, join(libTop, 'links', 'out'))

mkdirSync(join(libTop, 'cyc', 'a'), { recursive: true })
writeFileSync(join(libTop, 'cyc', 'a', 'z.stl'), stlBytes(12))
symlinkSync(join(libTop, 'cyc'), join(libTop, 'cyc', 'a', 'back'))

mkdirSync(join(libTop, 'onlyzip'))
const zipLibPath = '/onlyzip/kit.zip'
writeFileSync(
  join(libTop, 'onlyzip', 'kit.zip'),
  zipSync({
    'box.stl': new Uint8Array(stlBytes(13)),
    'parts/lid.stl': new Uint8Array(stlBytes(14)),
  }),
)

mkdirSync(join(libTop, 'empty'))

const cacheDir = realTempDir('mb-peek-cache-')
const app = createApp(new ThumbCache(cacheDir), undefined, undefined, libraryFor(libTop))

// Settle the library before any cell reverses `readdir` — its own marker walk
// reads directories too, and a cell must only ever change what the peek sees.
beforeAll(async () => {
  expect((await app.request('/api/library', { headers: LOOPBACK })).status).toBe(200)
})

afterAll(() => {
  rd.reverse = false
  rmSync(libTop, { recursive: true, force: true })
  rmSync(outsideFs, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

async function ask(path: string, n?: number): Promise<Response> {
  const q = n === undefined ? '' : `&n=${encodeURIComponent(String(n))}`
  return app.request(`/api/peek?path=${encodeURIComponent(path)}${q}`, { headers: LOOPBACK })
}

async function peekOf(path: string, n?: number): Promise<DirEntry[]> {
  const res = await ask(path, n)
  expect(res.status).toBe(200)
  return (await res.json()) as DirEntry[]
}

const names = (entries: DirEntry[]) => entries.map((e) => e.name)

describe('the order a peek walks in', () => {
  it("takes a level's own models before descending, both in sorted order", async () => {
    // asub sorts before sub, and each level's models sort among themselves —
    // but no subfolder's model may precede one of the folder's own.
    expect(names(await peekOf('/kit', 4))).toEqual(['a.stl', 'b.stl', 'q.stl', 'y.stl'])
  })

  it('previews the first subfolder in order when the level holds only folders', async () => {
    expect(names(await peekOf('/folders', 4))).toEqual(['1.stl', '2.stl', '3.stl', '4.stl'])
  })

  it('returns ordinary listing entries: library paths, kinds, formats, mtimes', async () => {
    const entries = await peekOf('/kit', 1)
    expect(entries).toHaveLength(1)
    const e = entries[0]!
    expect({ name: e.name, path: e.path, kind: e.kind, format: e.format }).toEqual({
      name: 'a.stl',
      path: '/kit/a.stl',
      kind: 'model',
      format: 'stl',
    })
    expect(e.mtime).toBeGreaterThan(0)
    // fsPath never leaves the module — a preview entry is what a listing emits.
    expect(Object.keys(e).sort()).toEqual(['format', 'kind', 'mtime', 'name', 'path', 'size'])
  })

  it('previews the same models on two calls', async () => {
    expect(await peekOf('/kit', 4)).toEqual(await peekOf('/kit', 4))
    expect(await peekOf('/folders', 4)).toEqual(await peekOf('/folders', 4))
  })
})

describe('the bound', () => {
  it('cuts a wide level by code-point order, whatever order readdir gave', async () => {
    // Without the pre-charge sort the reversed level charges m79 downwards and
    // previews m16…m19; with an ICU sort it would cut somewhere else again.
    rd.reverse = true
    try {
      expect(names(await peekOf('/wide', 4))).toEqual(['m00.stl', 'm01.stl', 'm02.stl', 'm03.stl'])
    } finally {
      rd.reverse = false
    }
  })

  it('cuts where code-point order cuts, not where a locale collation would', async () => {
    // The fixture's whole point (see its comment): `B.stl` is the 64th entry in
    // code-point order and `a.stl` is the 64th in ICU order, so exactly one of
    // them is charged and which one names the comparator that ran.
    expect('B.stl' < 'a.stl').toBe(true)
    expect('B.stl'.localeCompare('a.stl')).toBeGreaterThan(0)
    rd.reverse = true
    try {
      expect(names(await peekOf('/cut', 4))).toEqual(['B.stl'])
    } finally {
      rd.reverse = false
    }
  })

  it('stops at the budget and previews what it found, fewer than asked for', async () => {
    expect(names(await peekOf('/budget', 4))).toEqual(['00.stl'])
  })

  it('an empty directory previews nothing', async () => {
    expect(await peekOf('/empty', 4)).toEqual([])
  })
})

describe('what a peek does not enter', () => {
  it('neither previews nor descends into a subfolder resolving outside the library', async () => {
    const entries = await peekOf('/links', 4)
    expect(names(entries)).toEqual(['x.stl'])
    // The control: `in` points inside the library and *is* followed, so the
    // assertion above is confinement rather than "symlinks are skipped".
    expect(entries[0]!.path).toBe('/links/in/x.stl')
    expect(names(entries)).not.toContain('secret.stl')
  })

  it("carries library-root's confinement in its own recursion, not only in listFsDir", async () => {
    // `listFsDir` drops an out-of-library symlink before the peek ever sees it,
    // so the cell above stays green even with the peek's own guard removed.
    // What actually regresses is the guard's presence, asserted the way
    // flat.test.ts asserts the walk's query-independence.
    const src = await readFile(new URL('../src/listing.ts', import.meta.url), 'utf8')
    const peekSrc = src.slice(src.indexOf('async function peekLevel'), src.indexOf('export async function peek'))
    expect(peekSrc).toMatch(/realpath\(e\.fsPath\)/)
    expect(peekSrc).toMatch(/!within\(realTop, real\)/)
    expect(peekSrc).toMatch(/walk\.visited/)
  })

  it('terminates on a symlink cycle, previewing what is really there', async () => {
    expect(names(await peekOf('/cyc', 4))).toEqual(['z.stl'])
  })

  it('skips hidden subdirectories', async () => {
    // /kit holds five models outside .hidden; asking for more than that returns
    // exactly those five and never h.stl.
    expect(names(await peekOf('/kit', 8))).toEqual(['a.stl', 'b.stl', 'q.stl', 'y.stl', 'z.stl'])
  })

  it.skipIf(process.getuid?.() === 0)(
    'skips an unreadable subdirectory without failing the request',
    async () => {
      const dir = join(libTop, 'has-locked')
      mkdirSync(dir)
      mkdirSync(join(dir, 'aa-locked'))
      writeFileSync(join(dir, 'aa-locked', 'secret.stl'), stlBytes(20))
      mkdirSync(join(dir, 'bb-open'))
      writeFileSync(join(dir, 'bb-open', 'ok.stl'), stlBytes(21))
      chmodSync(join(dir, 'aa-locked'), 0o000)
      try {
        // The locked folder sorts first, so it is reached first and skipped.
        expect(names(await peekOf('/has-locked', 4))).toEqual(['ok.stl'])
      } finally {
        chmodSync(join(dir, 'aa-locked'), 0o755)
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('does not enter an archive met on the way', async () => {
    expect(await peekOf('/onlyzip', 4)).toEqual([])
  })

  it('previews nothing for a zip root, rather than refusing', async () => {
    expect(await peekOf(zipLibPath, 4)).toEqual([])
  })

  it('previews nothing for a path inside an archive', async () => {
    expect(await peekOf(`${zipLibPath}!/parts`, 4)).toEqual([])
  })

  it('walks a directory whose name ends in .zip like any other', async () => {
    // Stat'd before the name is read, the way `listDir` does it — otherwise a
    // navigable folder called `v2.zip` would silently preview nothing.
    const dir = join(libTop, 'dirzip', 'v2.zip')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'deep.stl'), stlBytes(22))
    try {
      expect(names(await peekOf('/dirzip/v2.zip', 4))).toEqual(['deep.stl'])
    } finally {
      rmSync(join(libTop, 'dirzip'), { recursive: true, force: true })
    }
  })
})

describe('the route', () => {
  it('defaults to four previews', async () => {
    // /kit holds five models; the default takes four of them.
    expect(await peekOf('/kit')).toHaveLength(4)
  })

  it('caps n at eight rather than refusing a larger one', async () => {
    const capped = await peekOf('/wide', 20)
    expect(names(capped)).toEqual(WIDE.slice(0, 8))
    expect(await peekOf('/wide', 8)).toEqual(capped)
  })

  it('honours an n below the cap', async () => {
    expect(await peekOf('/wide', 2)).toHaveLength(2)
  })

  it('refuses an n that is not a positive integer', async () => {
    for (const n of ['abc', '0', '-1', '1.5', '', 'Infinity']) {
      const res = await app.request(`/api/peek?path=/kit&n=${encodeURIComponent(n)}`, {
        headers: LOOPBACK,
      })
      expect([n, res.status]).toEqual([n, 400])
      expect((await res.json()) as { error: string }).toEqual({ error: `invalid n: ${n}` })
    }
  })

  it('requires a path', async () => {
    for (const url of ['/api/peek', '/api/peek?path=']) {
      const res = await app.request(url, { headers: LOOPBACK })
      expect([url, res.status]).toEqual([url, 400])
      expect(await res.json()).toEqual({ error: 'path is required' })
    }
  })

  it('404s on a path that is not there', async () => {
    expect((await ask('/kit/nope', 4)).status).toBe(404)
  })

  it('400s on a file, which is there but has no inside', async () => {
    // The distinction `requireArchive` draws and `listDir` answers with: "not
    // found" and "not a directory" are different answers, and a 404 here would
    // deny a file the client can see in the listing it came from.
    const res = await ask('/kit/a.stl', 4)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'not a directory: /kit/a.stl' })
  })

  it('404s on an unreadable root — only *sub*directory failures are swallowed', async () => {
    if (process.getuid?.() === 0) return
    const dir = join(libTop, 'root-locked')
    mkdirSync(dir)
    chmodSync(dir, 0o000)
    try {
      expect((await ask('/root-locked', 4)).status).toBe(404)
    } finally {
      chmodSync(dir, 0o755)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is a path route: the not-ready state envelope, like every other', async () => {
    const home = realTempDir('mb-peek-unconfigured-')
    const cache = realTempDir('mb-peek-unconfigured-cache-')
    const bare = createApp(
      new ThumbCache(cache),
      undefined,
      undefined,
      createLibrary({ HOME: home, XDG_CONFIG_HOME: join(home, 'config') }),
    )
    const res = await bare.request('/api/peek?path=/kit', { headers: LOOPBACK })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'no library root is configured',
      state: 'unconfigured',
    })
    rmSync(home, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  })
})
