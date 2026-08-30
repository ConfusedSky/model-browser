import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A pass-through mock that only counts: `vi.spyOn(fsp, 'readdir')` throws
// "Cannot spy on export … Module namespace is not configurable in ESM", so the
// count comes from a mock that still does the real work — the same shape, and
// for the same reason, as the one `semantic.test.ts` documents. Only the cells
// that read `probeReads` arm it; everything else in this file runs against the
// real filesystem exactly as before.
const probeReads = vi.hoisted(() => ({ n: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: ((...args: Parameters<typeof actual.readdir>) => {
      probeReads.n++
      return actual.readdir(...args)
    }) as typeof actual.readdir,
  }
})
import { LibraryError, createLibrary, findMarker } from '../src/library'

// Reset per cell rather than per read, so a reordering cannot carry a count
// from one test into another's assertion.
beforeEach(() => {
  probeReads.n = 0
})

const cleanups: string[] = []

function tempTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mb-lib-'))
  cleanups.push(dir)
  // Every assertion compares against real paths (macOS puts the temp dir behind
  // /private, and this machine's /tmp could be a symlink tomorrow), so the tree
  // is named by its real path from the start.
  return realpathSync(dir)
}

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop()!
    // A test that made a directory unwritable has to hand it back before rm.
    try {
      chmodSync(dir, 0o755)
    } catch {
      /* already gone or never touched */
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

function markerAt(dir: string, id: string): void {
  mkdirSync(join(dir, '.model-browser'), { recursive: true })
  writeFileSync(join(dir, '.model-browser', 'library.json'), JSON.stringify({ id, version: 1 }))
}

/** A library whose root is `root` and whose config file is elsewhere (unset). */
function libraryAt(root: string, extra: NodeJS.ProcessEnv = {}) {
  return createLibrary({ MODEL_BROWSER_ROOT: root, MODEL_BROWSER_CONFIG: join(tempTree(), 'absent.json'), ...extra })
}

describe('library discovery', () => {
  it('picks the marked tree above a root that is a subfolder of it', async () => {
    const tmp = tempTree()
    const top = join(tmp, 'lib')
    const root = join(top, 'kits', 'a')
    mkdirSync(root, { recursive: true })
    markerAt(top, 'id-from-the-top')

    const state = await libraryAt(root).state()
    expect(state).toEqual({ state: 'ready', id: 'id-from-the-top', top, root: '/kits/a' })
  })

  it('writes a marker at a root with none above it, and reads it back next time', async () => {
    const tmp = tempTree()
    const root = join(tmp, 'fresh')
    mkdirSync(root)

    const first = await libraryAt(root).state()
    expect(first.state).toBe('ready')
    if (first.state !== 'ready') return
    expect(first.top).toBe(root)
    expect(first.root).toBe('/')
    expect(first.unmarked).toBeUndefined()
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(JSON.parse(readFileSync(join(root, '.model-browser', 'library.json'), 'utf8'))).toEqual({
      id: first.id,
      version: 1,
    })

    // Idempotent: the second library finds the first one's marker, it does not
    // mint a second identity for the same tree.
    expect(await libraryAt(root).state()).toEqual(first)
  })

  it('keeps walking past a malformed marker and past one whose id is not a string', async () => {
    const tmp = tempTree()
    const top = join(tmp, 'lib')
    const broken = join(top, 'broken')
    const idless = join(broken, 'idless')
    const root = join(idless, 'kit')
    mkdirSync(root, { recursive: true })
    markerAt(top, 'the-real-one')
    mkdirSync(join(idless, '.model-browser'))
    writeFileSync(join(idless, '.model-browser', 'library.json'), '{ not json at all')
    mkdirSync(join(broken, '.model-browser'))
    writeFileSync(join(broken, '.model-browser', 'library.json'), JSON.stringify({ id: 7, version: 1 }))

    const state = await libraryAt(root).state()
    expect(state).toEqual({ state: 'ready', id: 'the-real-one', top, root: '/broken/idless/kit' })
  })

  it('serves an unwritable top under a hashed id and says it is unmarked', async () => {
    const tmp = tempTree()
    const root = join(tmp, 'readonly')
    mkdirSync(root)
    chmodSync(root, 0o555)
    // Root ignores mode bits, so this can only be asserted as an unprivileged
    // user; skip rather than pass vacuously.
    if (process.getuid?.() === 0) {
      chmodSync(root, 0o755)
      console.warn('skipped: running as root, which may write into a 0555 directory')
      return
    }

    const state = await libraryAt(root).state()
    expect(state).toEqual({
      state: 'ready',
      id: createHashOf(root),
      top: root,
      root: '/',
      unmarked: true,
    })
  })
})

function createHashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

describe('library configuration', () => {
  it('takes the root from the environment over the config file', async () => {
    const tmp = tempTree()
    const chosen = join(tmp, 'chosen')
    const ignored = join(tmp, 'ignored')
    mkdirSync(chosen)
    mkdirSync(ignored)
    const config = join(tmp, 'config.json')
    writeFileSync(config, JSON.stringify({ root: ignored }))

    const state = await createLibrary({ MODEL_BROWSER_ROOT: chosen, MODEL_BROWSER_CONFIG: config }).state()
    expect(state.state === 'ready' && state.top).toBe(chosen)
  })

  it('takes the root from the config file when the environment has none', async () => {
    const tmp = tempTree()
    const root = join(tmp, 'from-config')
    mkdirSync(root)
    const config = join(tmp, 'config.json')
    writeFileSync(config, JSON.stringify({ root }))

    const state = await createLibrary({ MODEL_BROWSER_CONFIG: config }).state()
    expect(state.state === 'ready' && state.top).toBe(root)
  })

  it('is unconfigured with neither, and with a config file that is absent or malformed', async () => {
    const tmp = tempTree()
    expect(await createLibrary({ MODEL_BROWSER_CONFIG: join(tmp, 'absent.json') }).state()).toEqual({
      state: 'unconfigured',
    })
    const malformed = join(tmp, 'malformed.json')
    writeFileSync(malformed, '{ "root": ')
    expect(await createLibrary({ MODEL_BROWSER_CONFIG: malformed }).state()).toEqual({ state: 'unconfigured' })
  })

  it('reports a root that is not there as missing, verbatim, and re-checks it every time', async () => {
    const tmp = tempTree()
    const root = join(tmp, 'not', 'mounted', 'yet')
    const library = libraryAt(root)

    expect(await library.state()).toEqual({ state: 'missing', root })
    expect(() => library.realTop()).toThrow()

    // The volume arrives: no restart, no refresh() — the next question is
    // answered against the filesystem as it is now.
    mkdirSync(root, { recursive: true })
    const state = await library.state()
    expect(state).toEqual({ state: 'ready', id: expect.any(String), top: root, root: '/' })
  })

  it('reports a root that is a file rather than a directory as missing', async () => {
    const tmp = tempTree()
    const root = join(tmp, 'a-file')
    writeFileSync(root, 'not a directory')
    expect(await libraryAt(root).state()).toEqual({ state: 'missing', root })
  })

  it('refresh re-evaluates a ready library', async () => {
    const tmp = tempTree()
    const first = join(tmp, 'first')
    const second = join(tmp, 'second')
    mkdirSync(first)
    mkdirSync(second)
    markerAt(first, 'first-id')
    markerAt(second, 'second-id')
    const env: NodeJS.ProcessEnv = { MODEL_BROWSER_ROOT: first, MODEL_BROWSER_CONFIG: join(tmp, 'absent.json') }
    const library = createLibrary(env)

    expect((await library.state()).state === 'ready' && library.id()).toBe('first-id')
    env.MODEL_BROWSER_ROOT = second
    // Still cached until asked to look again.
    expect(library.id()).toBe('first-id')
    expect(await library.refresh()).toEqual({ state: 'ready', id: 'second-id', top: second, root: '/' })
  })

  it('reports a ready library whose top went away mid-session as missing, and takes it back unchanged', async () => {
    const tmp = tempTree()
    const top = join(tmp, 'vol')
    mkdirSync(top)
    markerAt(top, 'unplugged-id')
    // Configured with a spelling of its own, to pin that `missing` names the
    // root the *user* wrote rather than the resolved top the server found.
    const configured = `${top}${sep}`
    const library = libraryAt(configured)
    expect(await library.state()).toEqual({ state: 'ready', id: 'unplugged-id', top, root: '/' })

    // The volume is unplugged under a running server. Without the per-request
    // stat this still reads `ready` and every path route 404s instead.
    rmSync(top, { recursive: true, force: true })
    expect(await library.state()).toEqual({ state: 'missing', root: configured })
    // The cached `ready` is kept: `ThumbCache.maintain`'s guard reads both of
    // these to decide the sweep must not run against an absent volume.
    expect(library.realTop()).toBe(top)
    expect(library.id()).toBe('unplugged-id')

    // The same marker at the same place is the same library: the cached
    // identity is kept and nothing is re-evaluated.
    //
    // The fixture used to recreate the top *empty* — the `rmSync` above took
    // the marker with it — and assert the id survived that. That was the
    // pre-F7 behaviour it was asserting: a bare directory arriving at the mount
    // point inheriting the identity of the tree that left. A remount brings the
    // tree back marker and all, which is what this now writes; the empty case
    // is a different library, asserted in the test below.
    mkdirSync(top)
    markerAt(top, 'unplugged-id')
    expect(await library.state()).toEqual({ state: 'ready', id: 'unplugged-id', top, root: '/' })
    expect(library.id()).toBe('unplugged-id')
  })

  it('takes a different tree at the same mount point as a different library', async () => {
    const tmp = tempTree()
    const top = join(tmp, 'vol')
    mkdirSync(top)
    markerAt(top, 'first-drive')
    const library = libraryAt(top)
    expect(await library.state()).toEqual({ state: 'ready', id: 'first-drive', top, root: '/' })

    // One drive is unplugged and a second automounts at the same path — the
    // same session, the same mount point, a different library. Keeping the
    // cached identity would serve the second drive out of the first's cache
    // directory, and `ThumbCache.maintain` would then sweep every path the
    // second does not have, cameras included (F7).
    rmSync(top, { recursive: true, force: true })
    expect(await library.state()).toEqual({ state: 'missing', root: top })
    mkdirSync(top)
    markerAt(top, 'second-drive')
    expect(await library.state()).toEqual({ state: 'ready', id: 'second-drive', top, root: '/' })
    expect(library.id()).toBe('second-drive')
  })

  it('takes a bare directory at the mount point as a new library rather than the one that left', async () => {
    const tmp = tempTree()
    const top = join(tmp, 'vol')
    mkdirSync(top)
    markerAt(top, 'the-drive')
    const library = libraryAt(top)
    await library.state()

    rmSync(top, { recursive: true, force: true })
    expect(await library.state()).toEqual({ state: 'missing', root: top })
    // No marker: an unmarked directory that happens to sit where the library
    // used to is not that library. It becomes one of its own, with its own id.
    mkdirSync(top)
    const state = await library.state()
    expect(state).toEqual({ state: 'ready', id: expect.any(String), top, root: '/' })
    expect(state.state === 'ready' && state.id).not.toBe('the-drive')
    expect(JSON.parse(readFileSync(join(top, '.model-browser', 'library.json'), 'utf8')).id).toBe(
      state.state === 'ready' ? state.id : undefined,
    )
  })

  it('takes a marked tree arriving where an unmarked library was as a different library', async () => {
    const tmp = tempTree()
    const root = join(tmp, 'readonly')
    mkdirSync(root)
    chmodSync(root, 0o555)
    // Root ignores mode bits, so this can only be set up as an unprivileged
    // user; skip rather than pass vacuously (the fixture the `unmarked` test
    // above uses).
    if (process.getuid?.() === 0) {
      chmodSync(root, 0o755)
      console.warn('skipped: running as root, which may write into a 0555 directory')
      return
    }
    const library = libraryAt(root)
    expect(await library.state()).toEqual({
      state: 'ready',
      id: createHashOf(root),
      top: root,
      root: '/',
      unmarked: true,
    })

    // A read-only volume leaves and a *marked* one automounts in its place.
    // The transition check used to skip the marker read entirely for an
    // `unmarked` library — its id being path-derived, so the path looked like
    // the whole test — and the second drive was then served under the first's
    // hash, out of the first's cache directory.
    chmodSync(root, 0o755)
    rmSync(root, { recursive: true, force: true })
    expect(await library.state()).toEqual({ state: 'missing', root })
    mkdirSync(root)
    markerAt(root, 'the-marked-drive')
    const back = await library.state()
    expect(back).toEqual({ state: 'ready', id: 'the-marked-drive', top: root, root: '/' })
    expect(back.state === 'ready' && back.unmarked).toBeUndefined()
    expect(library.id()).toBe('the-marked-drive')
  })

  it('answers a burst of first calls with one evaluation, and writes one marker', async () => {
    const root = join(tempTree(), 'fresh')
    mkdirSync(root)
    const library = libraryAt(root)

    // A burst is the ordinary case, not a contrived one: `index.ts` fires
    // `state()` without awaiting it and the client's boot hits the gate with a
    // dozen requests at once. Unserialised, each of these ran the probe and
    // each wrote a marker — four identities minted for one tree, and the three
    // whose write lost the race handed out an id the file does not carry.
    const states = await Promise.all([library.state(), library.state(), library.state(), library.state()])
    const ids = [...new Set(states.map((s) => (s.state === 'ready' ? s.id : s.state)))]
    expect(ids).toHaveLength(1)
    const onDisk = JSON.parse(readFileSync(join(root, '.model-browser', 'library.json'), 'utf8')).id
    expect(ids[0]).toBe(onDisk)
    expect(library.id()).toBe(onDisk)
  })

  it('answers a burst across a return transition with the tree that arrived', async () => {
    const tmp = tempTree()
    const top = join(tmp, 'vol')
    mkdirSync(top)
    markerAt(top, 'first-drive')
    const library = libraryAt(top)
    expect(await library.state()).toEqual({ state: 'ready', id: 'first-drive', top, root: '/' })
    rmSync(top, { recursive: true, force: true })
    expect(await library.state()).toEqual({ state: 'missing', root: top })
    mkdirSync(top)
    markerAt(top, 'second-drive')

    // Before the fix, `state()` was not serialised *and* the flag was cleared
    // before the marker read, so the first call of a burst consumed the
    // transition and the other three answered from the cached `ready`: the
    // first drive's identity for the second drive's tree, which is exactly
    // what the transition check exists to prevent. Either fix alone closes it,
    // so this cell only reddens when both are reverted — the late clear is
    // defence in depth behind the single flight, and this is what says so.
    const states = await Promise.all([library.state(), library.state(), library.state(), library.state()])
    expect(states).toEqual(Array(4).fill({ state: 'ready', id: 'second-drive', top, root: '/' }))
  })

  it('refresh clears a pending return transition, so the marker is not re-read after it', async () => {
    const tmp = tempTree()
    const top = join(tmp, 'vol')
    mkdirSync(top)
    markerAt(top, 'drive-id')
    const library = libraryAt(top)
    await library.state()
    rmSync(top, { recursive: true, force: true })
    // Arms the transition: the next present-again call would re-read the marker.
    expect(await library.state()).toEqual({ state: 'missing', root: top })
    mkdirSync(top)
    markerAt(top, 'drive-id')
    expect(await library.refresh()).toEqual({ state: 'ready', id: 'drive-id', top, root: '/' })

    // Refreshed from scratch, so there is no absence left to return from. The
    // marker is deleted to make the difference visible: a transition still
    // pending here would re-read it, find nothing where `drive-id` was, and
    // evaluate the tree into a new library with a fresh id.
    rmSync(join(top, '.model-browser'), { recursive: true, force: true })
    expect(await library.state()).toEqual({ state: 'ready', id: 'drive-id', top, root: '/' })
  })
})

describe('the marker walk stops at a mount boundary', () => {
  it('does not adopt a marker across a device change, and still takes one below it', async () => {
    const tmp = tempTree()
    const boundary = join(tmp, 'vol')
    const start = join(boundary, 'kits', 'a')
    mkdirSync(start, { recursive: true })
    // `<tmp>/vol` and everything under it stands for the removable volume;
    // `<tmp>` and above for the filesystem it is mounted on. Injected rather
    // than mounted, because a test cannot mount anything.
    const devOf = async (dir: string): Promise<number> =>
      dir === boundary || dir.startsWith(boundary + sep) ? 1 : 2

    // The `$HOME` case: a marker left above the mount by an earlier root
    // choice. Unbounded, this became the top and widened confinement to it.
    markerAt(tmp, 'across-the-mount')
    expect(await findMarker(start, devOf)).toBeUndefined()

    // One on the volume itself is still the library, from the same start.
    markerAt(boundary, 'this-side')
    expect(await findMarker(start, devOf)).toEqual({ top: boundary, id: 'this-side' })
  })

  it('throws rather than reporting no marker when it cannot see its own start', async () => {
    const start = join(tempTree(), 'vol')
    mkdirSync(start)
    markerAt(start, 'still-there')
    // The volume goes away between `evaluate`'s stat of the root and this walk
    // — the window the two calls do not share. Answered as "no marker", the
    // caller settles: nothing is written, the id becomes a hash of the path,
    // and it is kept for the process's life, so the volume returning with
    // `still-there` is served under the hash instead (F6).
    const devOf = async (dir: string): Promise<number> => {
      if (dir === start) throw new Error('ENOENT')
      return 1
    }
    await expect(findMarker(start, devOf)).rejects.toThrow()
  })
})

describe('a root above an existing library', () => {
  it('is refused, naming the library it would have enclosed, and writes nothing', async () => {
    const tmp = tempTree()
    const root = join(tmp, 'drive')
    const inner = join(root, 'STL Library')
    mkdirSync(join(inner, 'kits'), { recursive: true })
    markerAt(inner, 'the-inner-library')
    const library = libraryAt(root)

    expect(await library.state()).toEqual({ state: 'nested', root, library: inner })
    // Nothing written: the inner library's marker — and so its cache and its
    // cameras — is what the root would have orphaned.
    expect(existsSync(join(root, '.model-browser'))).toBe(false)
    // And nothing serves: the routes answer the state instead.
    expect(() => library.realTop()).toThrow()

    // The remedy the message names: point the root at the library itself.
    expect(await libraryAt(inner).state()).toEqual({
      state: 'ready',
      id: 'the-inner-library',
      top: inner,
      root: '/',
    })
  })

  it('names the shallowest library below the root', async () => {
    const tmp = tempTree()
    const root = join(tmp, 'drive')
    const shallow = join(root, 'near')
    const deep = join(root, 'far', 'a', 'b')
    mkdirSync(shallow, { recursive: true })
    mkdirSync(deep, { recursive: true })
    markerAt(shallow, 'near-id')
    markerAt(deep, 'far-id')

    // Breadth-first: depth decides, not the order the filesystem lists in.
    expect(await libraryAt(root).state()).toEqual({ state: 'nested', root, library: shallow })
  })

  it('reaches four levels down but not five', async () => {
    const four = join(tempTree(), 'drive')
    const atFour = join(four, 'a', 'b', 'c', 'd')
    mkdirSync(atFour, { recursive: true })
    markerAt(atFour, 'just-in-reach')
    expect(await libraryAt(four).state()).toEqual({ state: 'nested', root: four, library: atFour })

    const five = join(tempTree(), 'drive')
    const atFive = join(five, 'a', 'b', 'c', 'd', 'e')
    mkdirSync(atFive, { recursive: true })
    markerAt(atFive, 'out-of-reach')
    // Best-effort by design (R1): out of the probe's reach is not found, and
    // the root becomes a library of its own, exactly as before the probe.
    expect(await libraryAt(five).state()).toEqual({
      state: 'ready',
      id: expect.any(String),
      top: five,
      root: '/',
    })
    expect(existsSync(join(five, '.model-browser', 'library.json'))).toBe(true)
  })

  it('gives up on a tree too wide to reach the depth the library sits at', async () => {
    // 2100 siblings, each holding the library one level further down. The
    // queue is capped at the same 2000 the visit count is, so the root's own
    // `readdir` fills it with depth-1 entries and no depth-2 entry is ever
    // pushed — whatever order the filesystem listed the siblings in, and
    // whichever of them the cap left out. This is the property the earlier
    // 600-sibling fixture only *appeared* to have: it depended on `kit-599`
    // landing past the 500th read, which is true of Node's sorted `readdir`
    // and not of Bun's raw one, so the same tree answered `ready` under vitest
    // and `nested` under the server.
    const wide = join(tempTree(), 'drive')
    for (let i = 0; i < 2100; i++) markerAt(join(wide, `kit-${i}`, 'inner'), `past-the-cap-${i}`)
    expect(await libraryAt(wide).state()).toEqual({
      state: 'ready',
      id: expect.any(String),
      top: wide,
      root: '/',
    })

    // The control, and what makes the first half about the *cap* rather than
    // about depth: the same shape, in a tree the cap leaves room in, is found.
    //
    // *Which* of the three is named is the filesystem's listing order to
    // decide, so only "one of them" is asserted. Naming `kit-0` passed under
    // vitest and failed under Bun, which lists these in creation order on
    // tmpfs and answered `kit-2` — the same trap the old wide fixture fell
    // into, in the cell written to replace it.
    const narrow = join(tempTree(), 'drive')
    for (let i = 0; i < 3; i++) markerAt(join(narrow, `kit-${i}`, 'inner'), `within-the-cap-${i}`)
    const control = await libraryAt(narrow).state()
    expect(control.state).toBe('nested')
    expect(control.state === 'nested' && control.root).toBe(narrow)
    expect([0, 1, 2].map((i) => join(narrow, `kit-${i}`, 'inner'))).toContain(
      control.state === 'nested' ? control.library : undefined,
    )
  })

  it('checks every direct child of the root, wherever it was listed', async () => {
    // The guarantee the cap buys: a root with fewer than 2000 direct children
    // has every one of them visited, so a library one folder down is found in
    // any listing order. Both ends of the listing are asserted so no order can
    // make this pass by luck — on this machine's /tmp under vitest `kit-599`
    // lists at index 555, and under Bun's raw `readdir` on tmpfs it came back
    // first.
    for (const marked of ['kit-599', 'kit-0']) {
      const wide = join(tempTree(), 'drive')
      for (let i = 0; i < 600; i++) mkdirSync(join(wide, `kit-${i}`), { recursive: true })
      const enclosed = join(wide, marked)
      markerAt(enclosed, `marked-at-${marked}`)
      expect(await libraryAt(wide).state()).toEqual({
        state: 'nested',
        root: wide,
        library: enclosed,
      })
      expect(existsSync(join(wide, '.model-browser'))).toBe(false)
    }
  })

  it('walks the tree once per recheck window however often the state is asked for', async () => {
    // `nested` is the one not-ready answer that costs a walk rather than a
    // stat, and the gate asks for the state on every request. Unmemoised, a
    // wide tree paid for the whole probe per request: over 600 directories of
    // 300 entries the old read budget marker-opened 150,300 of them at ~2.9 s
    // an evaluation, and the visit bound still costs ~138 ms (the numbers and
    // the way to re-run them are beside `PROBE_MAX_VISITS`).
    const root = join(tempTree(), 'drive')
    const inner = join(root, 'kits', 'STL Library')
    mkdirSync(inner, { recursive: true })
    for (let i = 0; i < 20; i++) mkdirSync(join(root, `other-${i}`))
    markerAt(inner, 'the-inner-library')
    const library = libraryAt(root)

    const nested = { state: 'nested', root, library: inner }
    expect(await library.state()).toEqual(nested)
    const afterFirst = probeReads.n
    expect(afterFirst).toBeGreaterThan(1)
    expect(await library.state()).toEqual(nested)
    // The second answer is the first one, not a second walk.
    expect(probeReads.n).toBe(afterFirst)

    // Still self-correcting, because the memo is a cost memo and not an
    // identity: `refresh()` drops it, and the enclosed library going away is
    // seen at once.
    rmSync(join(inner, '.model-browser'), { recursive: true, force: true })
    expect(await library.refresh()).toEqual({
      state: 'ready',
      id: expect.any(String),
      top: root,
      root: '/',
    })
    expect(probeReads.n).toBeGreaterThan(afterFirst)
  })

  it('leaves nothing settled after nested, and re-probes when refreshed', async () => {
    const root = join(tempTree(), 'drive')
    const inner = join(root, 'STL Library')
    mkdirSync(inner, { recursive: true })
    markerAt(inner, 'the-inner-library')
    const library = libraryAt(root)

    expect(await library.state()).toEqual({ state: 'nested', root, library: inner })
    expect(() => library.realTop()).toThrow()
    expect(() => library.id()).toThrow()
    // `refresh()` is the seam a later repoint-without-restart uses (D4), so it
    // has to answer from the filesystem rather than from anything held: still
    // `nested`, and still nothing to serve from.
    expect(await library.refresh()).toEqual({ state: 'nested', root, library: inner })
    expect(() => library.realTop()).toThrow()
  })
})

/** A ready library over `<tmp>/lib` holding `kits/a`, plus the tmp root. */
async function readyLibrary(): Promise<{ tmp: string; top: string; library: ReturnType<typeof libraryAt> }> {
  const tmp = tempTree()
  const top = join(tmp, 'lib')
  mkdirSync(join(top, 'kits', 'a'), { recursive: true })
  markerAt(top, 'resolve-id')
  const library = libraryAt(top)
  await library.state()
  return { tmp, top, library }
}

describe('library resolve', () => {
  it('folds `..` against the top instead of escaping through it', async () => {
    const { top, library } = await readyLibrary()
    // `posix.normalize` drops leading `..` on a rooted path, so this is a path
    // under the library that does not exist — the route's ordinary 404, not a
    // refusal, and nothing outside the library is read (D3).
    expect(await library.resolve('/a/../../etc')).toEqual({ fsPath: join(top, 'etc'), entry: undefined })
    expect(await library.resolve('/kits/../kits/a')).toEqual({ fsPath: join(top, 'kits', 'a'), entry: undefined })
  })

  it('reads a filesystem-looking path as the library path it is', async () => {
    const { top, library } = await readyLibrary()
    expect(await library.resolve('/etc/passwd')).toEqual({ fsPath: join(top, 'etc', 'passwd'), entry: undefined })
  })

  it('refuses a path that does not begin with a slash', async () => {
    const { library } = await readyLibrary()
    await expect(library.resolve('a/b')).rejects.toThrow(LibraryError)
    await expect(library.resolve('a/b')).rejects.toMatchObject({ status: 400 })
  })

  it('resolves a path that does not exist without stat-ing or throwing', async () => {
    const { top, library } = await readyLibrary()
    expect(await library.resolve('/does/not/exist')).toEqual({
      fsPath: join(top, 'does', 'not', 'exist'),
      entry: undefined,
    })
    expect(await library.resolve('/')).toEqual({ fsPath: top, entry: undefined })
  })

  it('refuses a symlink whose target is outside and follows one whose target is inside', async () => {
    const { tmp, top, library } = await readyLibrary()
    const outside = join(tmp, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.stl'), 'x')
    symlinkSync(outside, join(top, 'escape'))
    symlinkSync(join(top, 'kits'), join(top, 'alias'))

    await expect(library.resolve('/escape')).rejects.toMatchObject({ status: 400 })
    await expect(library.resolve('/escape/secret.stl')).rejects.toMatchObject({ status: 400 })
    // Inside: allowed, and what comes back is the target's real path.
    expect(await library.resolve('/alias/a')).toEqual({ fsPath: join(top, 'kits', 'a'), entry: undefined })
  })

  it('decides a nonexistent path on its nearest existing ancestor', async () => {
    const { tmp, top, library } = await readyLibrary()
    const outside = join(tmp, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(top, 'escape'))

    // Absent under the top: not a refusal.
    expect(await library.resolve('/kits/a/gone.stl')).toEqual({
      fsPath: join(top, 'kits', 'a', 'gone.stl'),
      entry: undefined,
    })
    // Absent, but its nearest existing ancestor leaves the library: refused.
    await expect(library.resolve('/escape/gone.stl')).rejects.toMatchObject({ status: 400 })
  })

  it('confines a virtual path by its archive half and leaves the entry half untouched', async () => {
    const { top, library } = await readyLibrary()
    const zip = join(top, 'kits', 'a', 'parts.zip')
    writeFileSync(zip, 'PK')
    expect(await library.resolve('/kits/a/parts.zip!/x//y.stl')).toEqual({ fsPath: zip, entry: 'x//y.stl' })
    // The entry is opaque: a `..` in it is a name, not a traversal, and is
    // handed on exactly as it arrived (normalising it would rewrite a cache key).
    expect((await library.resolve('/kits/a/parts.zip!/../x.stl')).entry).toBe('../x.stl')
  })

  it('refuses a virtual path whose archive is outside the library', async () => {
    const { tmp, top, library } = await readyLibrary()
    const outside = join(tmp, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'parts.zip'), 'PK')
    symlinkSync(join(outside, 'parts.zip'), join(top, 'parts.zip'))
    await expect(library.resolve('/parts.zip!/x.stl')).rejects.toMatchObject({ status: 400 })
  })

  it('names no filesystem detail in any refusal', async () => {
    const { tmp, top, library } = await readyLibrary()
    symlinkSync(tmp, join(top, 'escape'))
    const messages: string[] = []
    for (const path of ['a/b', '/escape', '/escape/gone.stl']) {
      messages.push(await library.resolve(path).then(() => '', (e: Error) => e.message))
    }
    expect(messages).toEqual(['path must be a library path', 'path outside the library', 'path outside the library'])
    for (const message of messages) {
      expect(message).not.toContain(tmp)
      expect(message).not.toContain('/')
    }
  })
})

describe('library libPathOf', () => {
  it('maps the top to the root and a real path under it to its library path', async () => {
    const { top, library } = await readyLibrary()
    expect(library.libPathOf(top)).toBe('/')
    expect(library.libPathOf(join(top, 'kits', 'a'))).toBe('/kits/a')
  })

  it('refuses a real path outside the top, including a sibling with the same prefix', async () => {
    const { tmp, top, library } = await readyLibrary()
    expect(() => library.libPathOf(join(tmp, 'elsewhere'))).toThrow(LibraryError)
    try {
      library.libPathOf(`${top}-next-door`)
      expect.unreachable('a sibling directory sharing the prefix is not inside the library')
    } catch (err) {
      expect((err as LibraryError).status).toBe(400)
      expect((err as Error).message).toBe('path outside the library')
    }
  })
})
