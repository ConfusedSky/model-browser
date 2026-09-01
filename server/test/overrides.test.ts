import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing } from '../../shared/types'

/**
 * A pass-through mock of `rename` that can be armed to fail. `vi.spyOn` on an
 * ESM namespace throws ("Module namespace is not configurable"), so the shape
 * is the counting/reversing mock `library.test.ts` and `peek.test.ts` both
 * document. Only the torn-write cell arms it; everything else in this file runs
 * against the real filesystem.
 *
 * Renaming is where an atomic write commits, so failing it is the one
 * simulation that asks the question the requirement asks: does a failure
 * between "the new bytes exist" and "they are the store" leave a torn file?
 */
const renames = vi.hoisted(() => ({ fail: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: (async (...args: Parameters<typeof actual.rename>) => {
      if (renames.fail) throw new Error('simulated rename failure')
      return actual.rename(...args)
    }) as typeof actual.rename,
  }
})

import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { MARKER_DIR, createLibrary } from '../src/library'
import {
  type OverrideStore,
  createOverrideHolder,
  loadOverrides,
  resolveOverrides,
  writeOverrides,
} from '../src/overrides'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

afterEach(() => {
  renames.fail = false
})

/** Write a store at `top` verbatim — spellings included, since they are the subject. */
function storeAt(top: string, file: unknown): string {
  mkdirSync(join(top, MARKER_DIR), { recursive: true })
  const path = join(top, MARKER_DIR, 'overrides.json')
  writeFileSync(path, typeof file === 'string' ? file : JSON.stringify(file))
  return path
}

/** A version-1 store around the given entries. */
function v1(entries: Record<string, unknown>): { version: number; entries: Record<string, unknown> } {
  return { version: 1, entries }
}

/** Load a store written for one cell, collecting whatever the loader complained about. */
async function loadWith(
  file: unknown,
): Promise<{ store: OverrideStore; problems: string[]; top: string }> {
  const top = realTempDir('mb-ovr-')
  storeAt(top, file)
  const problems: string[] = []
  const store = await loadOverrides(top, (m) => problems.push(m))
  return { store, problems, top }
}

const CREDITS = {
  author: 'Valandar',
  authorUrl: 'https://www.thingiverse.com/Valandar',
  license: 'Creative Commons - Attribution',
  sourceUrl: 'https://www.thingiverse.com/thing:3750572',
}

describe('loading the store', () => {
  it('treats an absent store as empty, and says nothing about it', async () => {
    const top = realTempDir('mb-ovr-')
    const problems: string[] = []
    const store = await loadOverrides(top, (m) => problems.push(m))
    expect(store.size).toBe(0)
    expect(problems).toEqual([])
  })

  it('reports a malformed store and treats it as empty', async () => {
    const { store, problems } = await loadWith('{ this is not json')
    expect(store.size).toBe(0)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('not valid JSON')
  })

  it('reports an unknown version and treats it as empty', async () => {
    const { store, problems } = await loadWith({ version: 2, entries: { '/kit': { name: 'Kit' } } })
    expect(store.size).toBe(0)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('unknown version 2')
  })

  it('reports a store with no entries object and treats it as empty', async () => {
    const { store, problems } = await loadWith({ version: 1, entries: [] })
    expect(store.size).toBe(0)
    expect(problems[0]).toContain('no entries object')
  })

  it('reports an entry whose value is not an object', async () => {
    const { store, problems } = await loadWith(v1({ '/kit': 'The Kit' }))
    expect(store.size).toBe(0)
    expect(problems[0]).toContain('not an object')
  })

  it('drops a wrong-typed field, reports it, and keeps the rest of the entry', async () => {
    // A hand or third-party writer (D6) putting an object where a string
    // belongs must not ride `displayName` onto the wire and be handed to React
    // as a child — that unmounts the grid, which is "taking the library down"
    // one layer up (found by the post-merge review). The field drops, the
    // entry's other fields survive.
    const { store, problems } = await loadWith(
      v1({ '/kit': { name: { a: 1 }, credits: CREDITS } }),
    )
    expect(resolveOverrides(store, '/kit')).toEqual({ credits: CREDITS })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('non-string name')
  })

  it('drops a wrong-typed credits field, keeping the string ones', async () => {
    const { store, problems } = await loadWith(
      v1({ '/kit': { credits: { author: 'Valandar', sourceUrl: 42 } } }),
    )
    expect(resolveOverrides(store, '/kit')).toEqual({ credits: { author: 'Valandar' } })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('non-string credits.sourceUrl')
  })

  it('serves only the four credit fields — an unknown one never rides the wire', async () => {
    // Allow-list, not deny-list (review round two): a store's extra field — an
    // object, say — would otherwise reach /api/overrides and wait for the
    // first renderer that iterates credits to hand it to React as a child.
    // Dropped SILENTLY, unlike a wrong-typed known field: an unknown field is
    // additive evolution (a newer writer's legitimate field on an older
    // reader), not an error — it lives on disk untouched and simply does not
    // resolve.
    const { store, problems } = await loadWith(
      v1({ '/kit': { credits: { author: 'Valandar', note: { deep: [1, 2] } } } }),
    )
    expect(resolveOverrides(store, '/kit')).toEqual({ credits: { author: 'Valandar' } })
    expect(problems).toEqual([])
  })

  it('drops credits that are not an object at all', async () => {
    const { store, problems } = await loadWith(v1({ '/kit': { name: 'Kit', credits: 'CC-BY' } }))
    expect(resolveOverrides(store, '/kit')).toEqual({ name: 'Kit' })
    expect(problems[0]).toContain('non-object credits')
  })

  it('canonicalises a key spelled with a trailing slash, and lookups match it', async () => {
    // `/kit/` is the natural hand-edit spelling for a directory and would match
    // nothing at all unless the loader canonicalises it.
    const { store } = await loadWith(v1({ '/kit/': { credits: CREDITS } }))
    expect([...store.keys()]).toEqual(['/kit'])
    expect(resolveOverrides(store, '/kit/x.stl')).toEqual({ credits: CREDITS })
  })

  it('reports a key that is not a library path at all', async () => {
    const { store, problems } = await loadWith(v1({ 'kit/x.stl': { name: 'x' } }))
    expect(store.size).toBe(0)
    expect(problems[0]).toContain('"kit/x.stl"')
  })

  it('strips a trailing slash from a key’s archive-entry half, and lookups match it', async () => {
    // `canonicalLibPath` normalises only the filesystem half, and zip listings
    // commonly spell a directory entry `parts/`.
    const { store } = await loadWith(v1({ '/kit/a.zip!/parts/': { credits: CREDITS } }))
    expect([...store.keys()]).toEqual(['/kit/a.zip!/parts'])
    expect(resolveOverrides(store, '/kit/a.zip!/parts/x.stl')).toEqual({ credits: CREDITS })
  })

  it('rejects and reports a key whose archive-entry half is empty', async () => {
    const { store, problems } = await loadWith(v1({ '/kit/a.zip!/': { credits: CREDITS } }))
    expect(store.size).toBe(0)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('empty archive-entry half')
  })

  it('rejects a key that is only slashes after the separator', async () => {
    const { store, problems } = await loadWith(v1({ '/kit/a.zip!//': { credits: CREDITS } }))
    expect(store.size).toBe(0)
    expect(problems[0]).toContain('empty archive-entry half')
  })
})

describe('field-wise longest-prefix resolution', () => {
  it('carries a kit’s credits down to a file beneath it', async () => {
    const { store } = await loadWith(v1({ '/kit': { credits: CREDITS } }))
    expect(resolveOverrides(store, '/kit/sub/x.stl')).toEqual({ credits: CREDITS })
  })

  it('merges per field: a file key holding only a pose keeps the kit’s credits', async () => {
    const pose = { az: 1, el: 2 }
    const { store } = await loadWith(
      v1({ '/kit': { credits: CREDITS }, '/kit/x.stl': { pose } }),
    )
    expect(resolveOverrides(store, '/kit/x.stl')).toEqual({ credits: CREDITS, pose })
  })

  it('does not inherit a name — it labels the kit alone', async () => {
    const { store } = await loadWith(v1({ '/kit': { name: 'Player Character Pack 03', credits: CREDITS } }))
    expect(resolveOverrides(store, '/kit')).toEqual({
      name: 'Player Character Pack 03',
      credits: CREDITS,
    })
    // The credits reach the model; the name stops at the key that holds it.
    expect(resolveOverrides(store, '/kit/x.stl')).toEqual({ credits: CREDITS })
  })

  it('resolves a name from the entry’s own key', async () => {
    const { store } = await loadWith(v1({ '/kit': { name: 'Kit' }, '/kit/x.stl': { name: 'Hero' } }))
    expect(resolveOverrides(store, '/kit/x.stl')).toEqual({ name: 'Hero' })
  })

  it('respects segment boundaries: /kit does not cover /kit2', async () => {
    const { store } = await loadWith(v1({ '/kit': { credits: CREDITS } }))
    expect(resolveOverrides(store, '/kit2/y.stl')).toEqual({})
  })

  it('reaches an archive entry through the archive’s own path', async () => {
    // The trap: '/kit/a.zip!/parts/x.stl'.split('/') yields the segment 'a.zip!'
    // and never produces the key '/kit/a.zip'.
    const { store } = await loadWith(v1({ '/kit/a.zip': { credits: CREDITS } }))
    expect(resolveOverrides(store, '/kit/a.zip!/parts/x.stl')).toEqual({ credits: CREDITS })
  })

  it('lets an interior key win over the archive’s, per field', async () => {
    const inner = { ...CREDITS, author: 'Someone Else' }
    const pose = { az: 3 }
    const { store } = await loadWith(
      v1({
        '/kit/a.zip': { credits: CREDITS, pose },
        '/kit/a.zip!/parts': { credits: inner },
      }),
    )
    // Nearer key wins `credits`; `pose` still comes from the archive's key.
    expect(resolveOverrides(store, '/kit/a.zip!/parts/x.stl')).toEqual({ credits: inner, pose })
  })

  it('resolves a zip-root lookup exactly as the archive file’s own path does', async () => {
    const { store } = await loadWith(v1({ '/kit/a.zip': { name: 'The Archive', credits: CREDITS } }))
    const asFile = resolveOverrides(store, '/kit/a.zip')
    expect(asFile).toEqual({ name: 'The Archive', credits: CREDITS })
    // Including the name: '…!/' is a key spelling the loader forbids, so an
    // exact-key lookup on the literal request string could never match one.
    expect(resolveOverrides(store, '/kit/a.zip!/')).toEqual(asFile)
  })

  it('lets the root key cover everything, name excepted', async () => {
    const { store } = await loadWith(v1({ '/': { name: 'Library', credits: CREDITS } }))
    expect(resolveOverrides(store, '/')).toEqual({ name: 'Library', credits: CREDITS })
    expect(resolveOverrides(store, '/kit/x.stl')).toEqual({ credits: CREDITS })
  })

  it('resolves nothing for a path no key covers', async () => {
    const { store } = await loadWith(v1({ '/kit': { credits: CREDITS } }))
    expect(resolveOverrides(store, '/other/x.stl')).toEqual({})
  })
})

describe('the store’s lifetime', () => {
  /** A library rooted at `dir`, whose env object the caller can repoint. */
  function libraryOn(env: NodeJS.ProcessEnv) {
    return createLibrary(env)
  }

  function markerAt(dir: string, id: string): void {
    mkdirSync(join(dir, MARKER_DIR), { recursive: true })
    writeFileSync(join(dir, MARKER_DIR, 'library.json'), JSON.stringify({ id, version: 1 }))
  }

  it('reads the file once while the library stays resolved', async () => {
    const top = realTempDir('mb-ovr-life-')
    markerAt(top, 'one-id')
    storeAt(top, v1({ '/kit': { credits: CREDITS } }))
    const holder = createOverrideHolder(
      libraryOn({ MODEL_BROWSER_ROOT: top, HOME: top, XDG_CONFIG_HOME: join(top, 'cfg') }),
    )
    expect(resolveOverrides(await holder.store(), '/kit')).toEqual({ credits: CREDITS })
    // Edited under a standing resolution: the answer is the store as loaded,
    // until the server restarts or the library re-resolves.
    storeAt(top, v1({ '/kit': { credits: { author: 'Rewritten' } } }))
    expect(resolveOverrides(await holder.store(), '/kit')).toEqual({ credits: CREDITS })
  })

  it('answers from the newly resolved library’s store, never the previous one', async () => {
    const tmp = realTempDir('mb-ovr-swap-')
    const first = join(tmp, 'first')
    const second = join(tmp, 'second')
    mkdirSync(first)
    mkdirSync(second)
    markerAt(first, 'first-id')
    markerAt(second, 'second-id')
    storeAt(first, v1({ '/kit': { credits: CREDITS } }))
    // The second library has a store of its own, naming the same key differently.
    storeAt(second, v1({ '/kit': { credits: { author: 'Second Library' } } }))

    const env: NodeJS.ProcessEnv = {
      MODEL_BROWSER_ROOT: first,
      MODEL_BROWSER_CONFIG: join(tmp, 'absent.json'),
    }
    const library = libraryOn(env)
    const holder = createOverrideHolder(library)
    expect(resolveOverrides(await holder.store(), '/kit')).toEqual({ credits: CREDITS })

    // `refresh()` is the seam a repoint-without-restart works through; it has no
    // production caller today, and `library.test.ts` drives it the same way.
    env.MODEL_BROWSER_ROOT = second
    await library.refresh()
    expect(resolveOverrides(await holder.store(), '/kit')).toEqual({
      credits: { author: 'Second Library' },
    })
  })

  it('resolves nothing while the library is not ready, and loads once it is', async () => {
    const top = realTempDir('mb-ovr-late-')
    markerAt(top, 'late-id')
    storeAt(top, v1({ '/kit': { credits: CREDITS } }))
    const env: NodeJS.ProcessEnv = { MODEL_BROWSER_CONFIG: join(top, 'absent.json') }
    const library = libraryOn(env)
    const holder = createOverrideHolder(library)
    expect((await holder.store()).size).toBe(0)
    env.MODEL_BROWSER_ROOT = top
    expect(resolveOverrides(await holder.store(), '/kit')).toEqual({ credits: CREDITS })
  })
})

describe('writing the store', () => {
  it('round-trips through the loader', async () => {
    const top = realTempDir('mb-ovr-write-')
    await writeOverrides(top, { version: 1, entries: { '/kit': { credits: CREDITS } } })
    const store = await loadOverrides(top, () => undefined)
    expect(resolveOverrides(store, '/kit/x.stl')).toEqual({ credits: CREDITS })
  })

  it('leaves the old store intact behind a failed write, never a torn one', async () => {
    const top = realTempDir('mb-ovr-torn-')
    const path = storeAt(top, v1({ '/kit': { credits: CREDITS } }))
    renames.fail = true
    await expect(
      writeOverrides(top, { version: 1, entries: { '/kit': { name: 'Half-written' } } }),
    ).rejects.toThrow('simulated rename failure')
    // The file on disk is still the old store, whole and parseable.
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(v1({ '/kit': { credits: CREDITS } }))
    // And no temp file was left where a later reader could find it.
    const store = await loadOverrides(top, () => undefined)
    expect(resolveOverrides(store, '/kit')).toEqual({ credits: CREDITS })
  })
})

/**
 * One library holding the fixtures every route cell below asks about.
 *
 * libTop/
 *   kit/       x.stl  sub/y.stl  a.zip { box.stl, parts/lid.stl }
 *   kit2/      y.stl
 */
function fixtureLibrary(): string {
  const libTop = realTempDir('mb-ovr-lib-')
  mkdirSync(join(libTop, 'kit', 'sub'), { recursive: true })
  mkdirSync(join(libTop, 'kit2'))
  writeFileSync(join(libTop, 'kit', 'x.stl'), stlBytes(1))
  writeFileSync(join(libTop, 'kit', 'sub', 'y.stl'), stlBytes(2))
  writeFileSync(join(libTop, 'kit2', 'y.stl'), stlBytes(3))
  writeFileSync(
    join(libTop, 'kit', 'a.zip'),
    zipSync({
      'box.stl': new Uint8Array(stlBytes(4)),
      'parts/lid.stl': new Uint8Array(stlBytes(5)),
    }),
  )
  return libTop
}

function appOn(libTop: string) {
  return createApp(new ThumbCache(realTempDir('mb-ovr-cache-')), undefined, undefined, libraryFor(libTop))
}

describe('GET /api/overrides', () => {
  it('400s without a path', async () => {
    const app = appOn(fixtureLibrary())
    const res = await app.request('/api/overrides', { headers: LOOPBACK })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'path is required' })
  })

  it('answers the resolved credits for an entry beneath a kit key', async () => {
    const libTop = fixtureLibrary()
    storeAt(libTop, v1({ '/kit': { name: 'The Kit', credits: CREDITS } }))
    const res = await appOn(libTop).request('/api/overrides?path=/kit/sub/y.stl', {
      headers: LOOPBACK,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ credits: CREDITS })
  })

  it('answers an empty object where nothing resolves', async () => {
    const libTop = fixtureLibrary()
    storeAt(libTop, v1({ '/kit': { credits: CREDITS } }))
    const res = await appOn(libTop).request('/api/overrides?path=/kit2/y.stl', { headers: LOOPBACK })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it('canonicalises the requested path like its sibling path routes', async () => {
    const libTop = fixtureLibrary()
    storeAt(libTop, v1({ '/kit': { name: 'The Kit' } }))
    const res = await appOn(libTop).request('/api/overrides?path=/kit/../kit/', { headers: LOOPBACK })
    expect(await res.json()).toEqual({ name: 'The Kit' })
  })

  it('refuses what the library refuses', async () => {
    const res = await appOn(fixtureLibrary()).request(
      `/api/overrides?path=/${MARKER_DIR}/overrides.json`,
      { headers: LOOPBACK },
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'path outside the library' })
  })

  it('answers the not-ready envelope while the library is unconfigured', async () => {
    const home = realTempDir('mb-ovr-home-')
    const app = createApp(
      new ThumbCache(realTempDir('mb-ovr-cache-')),
      undefined,
      undefined,
      createLibrary({ HOME: home, XDG_CONFIG_HOME: join(home, 'config') }),
    )
    const res = await app.request('/api/overrides?path=/kit', { headers: LOOPBACK })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'no library root is configured',
      state: 'unconfigured',
    })
  })
})

describe('display names ride the listing', () => {
  /**
   * One store naming a kit, a subdirectory, a model and a directory *inside an
   * archive* — the last being the emission point `wire()` does not cover, since
   * `listDir`'s two `listZipDir` branches return their entries directly.
   *
   * `/kit/sub/y.stl` is deliberately unnamed while both keys above it are named:
   * it is the exact-key assertion.
   */
  const NAMES = v1({
    '/kit': { name: 'Player Character Pack 03' },
    '/kit/sub': { name: 'Sub Assemblies' },
    '/kit/x.stl': { name: 'Kindle Cleric' },
    '/kit/a.zip!/parts': { name: 'Loose Parts' },
  })

  function named(entries: DirEntry[], path: string): DirEntry {
    const found = entries.find((e) => e.path === path)
    expect(found, `no entry for ${path}`).toBeDefined()
    return found!
  }

  it('labels a named directory in a browse, and nothing beneath it', async () => {
    const libTop = fixtureLibrary()
    storeAt(libTop, NAMES)
    const app = appOn(libTop)

    const root = (await (await app.request('/api/dir?path=/', { headers: LOOPBACK })).json()) as DirListing
    expect(named(root.entries, '/kit').displayName).toBe('Player Character Pack 03')
    expect(named(root.entries, '/kit').name).toBe('kit')
    // Unnamed sibling: labelled exactly as before.
    expect(named(root.entries, '/kit2').displayName).toBeUndefined()

    // Exact key, never the prefix resolution: `/kit` and `/kit/sub` are both
    // named, and the model under them is still labelled from its file name.
    const sub = (await (await app.request('/api/dir?path=/kit/sub', { headers: LOOPBACK })).json()) as DirListing
    expect(named(sub.entries, '/kit/sub/y.stl').displayName).toBeUndefined()
  })

  it('labels a named entry in a flat listing', async () => {
    const libTop = fixtureLibrary()
    storeAt(libTop, NAMES)
    const res = await appOn(libTop).request('/api/dir?path=/&flat=true', { headers: LOOPBACK })
    const listing = (await res.json()) as DirListing
    expect(named(listing.entries, '/kit').displayName).toBe('Player Character Pack 03')
    expect(named(listing.entries, '/kit/x.stl').displayName).toBe('Kindle Cleric')
    // Still exact-key down here: an unqueried flat listing walks every model in
    // the tree, and the one under two named directories keeps its file name.
    expect(named(listing.entries, '/kit/sub/y.stl').displayName).toBeUndefined()
  })

  it('labels a named entry in a deep-search listing', async () => {
    const libTop = fixtureLibrary()
    storeAt(libTop, NAMES)
    // A queried walk is where directories found *below* the root become tiles,
    // which is the only listing shape that emits `/kit/sub` as an entry.
    const res = await appOn(libTop).request('/api/dir?path=/&flat=true&q=sub', { headers: LOOPBACK })
    const listing = (await res.json()) as DirListing
    expect(named(listing.entries, '/kit/sub').displayName).toBe('Sub Assemblies')
    // Matching is untouched: the query matched the real name, not the stored one.
    expect(named(listing.entries, '/kit/sub').name).toBe('kit/sub')
  })

  it('labels a named entry in a peek answer', async () => {
    const libTop = fixtureLibrary()
    storeAt(libTop, NAMES)
    const res = await appOn(libTop).request('/api/peek?path=/kit', { headers: LOOPBACK })
    const entries = (await res.json()) as DirEntry[]
    // A peek returns models, so the named model is the subject here; the
    // unnamed one beneath two named directories is the control.
    expect(named(entries, '/kit/x.stl').displayName).toBe('Kindle Cleric')
    expect(named(entries, '/kit/sub/y.stl').displayName).toBeUndefined()
  })

  it('labels an entry inside an archive', async () => {
    const libTop = fixtureLibrary()
    storeAt(libTop, NAMES)
    const res = await appOn(libTop).request('/api/dir?path=/kit/a.zip', { headers: LOOPBACK })
    const listing = (await res.json()) as DirListing
    expect(named(listing.entries, '/kit/a.zip!/parts').displayName).toBe('Loose Parts')
    expect(named(listing.entries, '/kit/a.zip!/box.stl').displayName).toBeUndefined()
  })

  it('emits identical listings for a library with no store', async () => {
    const withStore = fixtureLibrary()
    storeAt(withStore, NAMES)
    const without = fixtureLibrary()

    const keys = new Set<string>()
    for (const path of ['/', '/kit', '/kit/a.zip']) {
      const url = `/api/dir?path=${encodeURIComponent(path)}`
      const bare = (await (await appOn(without).request(url, { headers: LOOPBACK })).json()) as DirListing
      expect(bare.entries.length).toBeGreaterThan(0)
      for (const entry of bare.entries) {
        // No `displayName` key at all, not merely an undefined one — the field
        // is additive and a store-less library must not mint it.
        expect(Object.keys(entry)).not.toContain('displayName')
        for (const key of Object.keys(entry)) keys.add(key)
      }
    }
    // The union across a directory, a model-bearing directory and an archive is
    // the shape every other suite asserts against, and nothing more.
    expect([...keys].sort()).toEqual(['format', 'kind', 'mtime', 'name', 'path', 'size'])
    // Adding a store to the *same* tree changes exactly the added field and
    // nothing else — mtimes and all. Two trees would differ in their mtimes for
    // reasons that have nothing to do with this capability.
    const before = (await (await appOn(without).request('/api/dir?path=/', { headers: LOOPBACK })).json()) as DirListing
    storeAt(without, NAMES)
    const after = (await (await appOn(without).request('/api/dir?path=/', { headers: LOOPBACK })).json()) as DirListing
    expect(named(after.entries, '/kit').displayName).toBe('Player Character Pack 03')
    expect(after.entries.map(({ displayName, ...rest }) => rest)).toEqual(before.entries)
  })
})
