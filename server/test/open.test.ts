import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import {
  type ExecFn,
  type LaunchConfig,
  type SpawnOptions,
  type SpawnResult,
  createLauncher,
  ZipTempStore,
} from '../src/launch'
import { LOOPBACK, libraryFor, realTempDir, stlBytes } from './helpers'

// `dir` is the library's top, so requests name `/loose.stl` while the launcher
// still receives the filesystem path it has to hand an application (L5/L7).
const dir = realTempDir('mb-open-')
const cacheDir = realTempDir('mb-open-cache-')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

const looseStl = stlBytes(3)
const aPart = stlBytes(1)
const bPart = stlBytes(2)

writeFileSync(join(dir, 'loose.stl'), looseStl)
writeFileSync(join(dir, 'a.zip'), zipSync({ 'part.stl': new Uint8Array(aPart) }))
writeFileSync(join(dir, 'b.zip'), zipSync({ 'part.stl': new Uint8Array(bPart) }))
writeFileSync(
  join(dir, 'nest.zip'),
  zipSync({ 'inner.zip': [zipSync({ 'deep.stl': new Uint8Array(stlBytes(7)) }), { level: 0 }] }),
)

interface Call {
  file: string
  args: string[]
  opts: SpawnOptions
}

/**
 * A whole app wired to a recording exec: the endpoints run the real launcher,
 * the real path pipeline, and the real temp store — only the spawn is faked.
 * The config is always injected, never read from the machine. The zip temp
 * store's root defaults to this file's own swept `dir`, never the bare system
 * tmpdir (4.5) — a test wanting to check the injected-root plumbing itself
 * passes its own store.
 */
function harness(
  config: LaunchConfig = {},
  reply: (file: string, args: string[]) => SpawnResult | Promise<SpawnResult> = () => ({
    code: 0,
    stdout: '',
    stderr: '',
  }),
  zipTemp: ZipTempStore = new ZipTempStore(dir),
): { calls: Call[]; app: ReturnType<typeof createApp> } {
  const calls: Call[] = []
  const exec: ExecFn = async (file, args, opts) => {
    calls.push({ file, args, opts })
    return reply(file, args)
  }
  const env: NodeJS.ProcessEnv = { HOME: join(dir, 'no-such-home'), XDG_DATA_DIRS: join(dir, 'no-such-share') }
  const app = createApp(
    new ThumbCache(cacheDir),
    createLauncher({ env, exec, config }),
    zipTemp,
    libraryFor(dir),
  )
  return { calls, app }
}

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { ...LOOPBACK, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/apps', () => {
  it('reports every handled type, and whether a chooser is configured', async () => {
    const { app } = harness({ chooser: ['open-with', '{file}'] })
    const res = await app.request('/api/apps', { headers: LOOPBACK })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { chooser: boolean; types: Record<string, unknown> }
    expect(body.chooser).toBe(true)
    expect(Object.keys(body.types).sort()).toEqual(['model/3mf', 'model/obj', 'model/stl'])
  })

  it('says no chooser when none is configured', async () => {
    const { app } = harness()
    const res = await app.request('/api/apps', { headers: LOOPBACK })
    expect(((await res.json()) as { chooser: boolean }).chooser).toBe(false)
  })
})

describe('POST /api/open', () => {
  it('launches a plain file with an absolute path', async () => {
    const { calls, app } = harness()
    const res = await post(app, '/api/open', {
      path: '/loose.stl',
      appId: 'lycheeslicer.desktop',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(calls[0]?.file).toBe('gtk-launch')
    expect(calls[0]?.args).toEqual(['lycheeslicer', join(dir, 'loose.stl')])
  })

  it('requires a path and an appId', async () => {
    const { calls, app } = harness()
    expect((await post(app, '/api/open', { appId: 'x.desktop' })).status).toBe(400)
    expect((await post(app, '/api/open', { path: '/loose.stl' })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('errors on a missing file without launching', async () => {
    const { calls, app } = harness()
    const res = await post(app, '/api/open', {
      path: '/ghost.stl',
      appId: 'x.desktop',
    })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toMatch(/no such file/)
    expect(calls).toHaveLength(0)
  })

  it('errors on a zip that does not exist without launching', async () => {
    const { calls, app } = harness()
    const res = await post(app, '/api/open', {
      path: '/ghost.zip!/part.stl',
      appId: 'x.desktop',
    })
    expect(res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('never lets a relative path reach the launcher', async () => {
    const { calls, app } = harness()
    const res = await post(app, '/api/open', { path: 'loose.stl', appId: 'x.desktop' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('path must be a library path')
    expect(calls).toHaveLength(0)
  })

  it('rejects a nested zip entry without launching', async () => {
    const { calls, app } = harness()
    const res = await post(app, '/api/open', {
      path: '/nest.zip!/inner.zip',
      appId: 'x.desktop',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('nested zips are unsupported')
    expect(calls).toHaveLength(0)
  })

  it('gives same-named entries in different archives distinct files', async () => {
    const { calls, app } = harness()
    await post(app, '/api/open', { path: '/a.zip!/part.stl', appId: 'x.desktop' })
    await post(app, '/api/open', { path: '/b.zip!/part.stl', appId: 'x.desktop' })
    const first = calls[0]?.args[1] as string
    const second = calls[1]?.args[1] as string
    expect(first).not.toBe(second)
    // Each holds its own archive's bytes — the second launch overwrote nothing.
    expect(readFileSync(first).equals(aPart)).toBe(true)
    expect(readFileSync(second).equals(bPart)).toBe(true)
    expect(first.endsWith('.stl')).toBe(true)
  })

  it('replaces a relaunched zip entry by rename, not by truncating in place', async () => {
    const zipPath = join(dir, 'churn.zip')
    const v1 = stlBytes(1)
    const v2 = stlBytes(9)
    expect(v1.equals(v2)).toBe(false)
    expect(v1.length).toBe(v2.length)

    const { calls, app } = harness()
    writeFileSync(zipPath, zipSync({ 'part.stl': new Uint8Array(v1) }))
    await post(app, '/api/open', { path: '/churn.zip!/part.stl', appId: 'x.desktop' })
    const temp = calls[0]?.args[1] as string
    expect(readFileSync(temp).equals(v1)).toBe(true)

    // Stand in for an application still reading from the first launch.
    const held = openSync(temp, 'r')
    try {
      writeFileSync(zipPath, zipSync({ 'part.stl': new Uint8Array(v2) }))
      await post(app, '/api/open', { path: '/churn.zip!/part.stl', appId: 'x.desktop' })
      // Same name — the naming is keyed on the virtual path, not the launch.
      expect(calls[1]?.args[1]).toBe(temp)
      // New bytes under the name...
      expect(readFileSync(temp).equals(v2)).toBe(true)
      // ...and the held descriptor still sees the inode it opened.
      const buf = Buffer.alloc(v1.length)
      readSync(held, buf, 0, buf.length, 0)
      expect(buf.equals(v1)).toBe(true)
    } finally {
      closeSync(held)
    }
  })

  it('keeps a metacharacter file name as one argv element', async () => {
    const nasty = join(dir, 'a; rm -rf ~ && $(whoami) `id` | tee "x".stl')
    writeFileSync(nasty, looseStl)
    const { calls, app } = harness({ launch: ['opener', '{file}'] })
    const res = await post(app, '/api/open', { path: `/${basename(nasty)}`, appId: 'x.desktop' })
    expect(res.status).toBe(200)
    expect(calls[0]?.args).toEqual([nasty])
    expect(calls[0]?.args).toHaveLength(1)
  })

  it('runs the configured argv in place of the builtin', async () => {
    const { calls, app } = harness({ launch: ['my-opener', '--app', '{appId}', '--file', '{file}'] })
    await post(app, '/api/open', { path: '/loose.stl', appId: 'x.desktop' })
    expect(calls[0]?.file).toBe('my-opener')
    expect(calls[0]?.args).toEqual(['--app', 'x.desktop', '--file', join(dir, 'loose.stl')])
  })

  it('surfaces a failing launch command with its reason', async () => {
    const { app } = harness({}, () => ({ code: 4, stdout: '', stderr: 'no such application\n' }))
    const res = await post(app, '/api/open', {
      path: '/loose.stl',
      appId: 'ghost.desktop',
    })
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toMatch(/exited 4: no such application/)
  })

  it('surfaces an unspawnable launch command with its reason', async () => {
    const { app } = harness({}, () => {
      throw new Error('spawn gtk-launch ENOENT')
    })
    const res = await post(app, '/api/open', {
      path: '/loose.stl',
      appId: 'x.desktop',
    })
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toMatch(/ENOENT/)
  })

  it('extracts a zip-entry launch into the injected root, never the bare system tmpdir (4.5)', async () => {
    // Snapshotted rather than asserted empty: the real tmpdir can carry
    // `model-browser-open-*` dirs from unrelated runs, and that is not this
    // test's business — only whether *this* launch added one is.
    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('model-browser-open-')))
    const root = mkdtempSync(join(dir, 'regression-root-'))
    const { calls, app } = harness({}, undefined, new ZipTempStore(root))
    await post(app, '/api/open', { path: '/a.zip!/part.stl', appId: 'x.desktop' })
    const file = calls[0]?.args[1] as string
    // Positive assertion: the extracted file resolves under the store's own
    // injected root, not wherever the OS tmpdir happens to be.
    expect(file.startsWith(root + sep)).toBe(true)
    expect(readFileSync(file).equals(aPart)).toBe(true)
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith('model-browser-open-'))
    expect(after.filter((n) => !before.has(n))).toEqual([])
  })
})

describe('POST /api/open-with', () => {
  it('reports unavailable, spawning nothing, when no chooser is configured', async () => {
    const { calls, app } = harness()
    const res = await post(app, '/api/open-with', { path: '/loose.stl' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no chooser is configured', unavailable: true })
    expect(calls).toHaveLength(0)
  })

  it('spawns the configured argv with the absolute path, detached and unsignalled', async () => {
    const { calls, app } = harness({ chooser: ['open-with', '{file}'] })
    const res = await post(app, '/api/open-with', { path: '/loose.stl' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(calls[0]?.file).toBe('open-with')
    expect(calls[0]?.args).toEqual([join(dir, 'loose.stl')])
    expect(calls[0]?.opts.detached).toBe(true)
    expect(Object.keys(calls[0]?.opts ?? {})).not.toContain('signal')
  })

  it('temp-extracts a zip entry for the chooser, as launching does', async () => {
    const { calls, app } = harness({ chooser: ['open-with', '{file}'] })
    await post(app, '/api/open-with', { path: '/a.zip!/part.stl' })
    const file = calls[0]?.args[0] as string
    expect(file).not.toBe(join(dir, 'a.zip'))
    expect(file.endsWith('.stl')).toBe(true)
    expect(readFileSync(file).equals(aPart)).toBe(true)
  })

  it('rejects a nested zip entry and a relative path without spawning', async () => {
    const { calls, app } = harness({ chooser: ['open-with', '{file}'] })
    expect(
      (await post(app, '/api/open-with', { path: '/nest.zip!/inner.zip' })).status,
    ).toBe(400)
    expect((await post(app, '/api/open-with', { path: 'loose.stl' })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('completes when the chooser does, even after the request is aborted', async () => {
    const calls: Call[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let entered: () => void = () => {}
    const reached = new Promise<void>((r) => {
      entered = r
    })
    const exec: ExecFn = async (file, args, opts) => {
      calls.push({ file, args, opts })
      entered()
      await gate
      return { code: 0, stdout: '', stderr: '' }
    }
    const env: NodeJS.ProcessEnv = { HOME: join(dir, 'nope'), XDG_DATA_DIRS: join(dir, 'nope') }
    const app = createApp(
      new ThumbCache(cacheDir),
      createLauncher({ env, exec, config: { chooser: ['open-with', '{file}'] } }),
      new ZipTempStore(dir),
      libraryFor(dir),
    )
    const controller = new AbortController()
    const pending = app.request('/api/open-with', {
      method: 'POST',
      headers: { ...LOOPBACK, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/loose.stl' }),
      signal: controller.signal,
    })
    // Let the handler reach the chooser, then drop the connection under it.
    //
    // Waited on the chooser's *own* entry, never on a count of event-loop
    // turns: the route crosses two threadpool filesystem calls before it
    // spawns anything (`Library.resolve`'s `realpath` loop, then
    // `resolveEntryFile`'s `stat`), and a `setImmediate` spin does not wait for
    // those — with immediates pending the poll phase never blocks, so the old
    // 200-turn budget was really a ~2 ms deadline on work that takes longer
    // than that whenever the machine is loaded. That is what made this cell
    // fail roughly one full parallel run in six, always here and never on the
    // behaviour below.
    //
    // Raced against the response so a regression that answers *without*
    // spawning still falsifies rather than hanging to the suite timeout:
    // `pending` settles, and the assertion reports the empty `calls`.
    await Promise.race([reached, pending])
    expect(calls).toHaveLength(1)
    controller.abort()
    release()
    const res = await pending
    // The chooser was never tied to the request: it ran to completion, and a
    // dismissed chooser and a killed one still cannot read the same.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('surfaces a failing chooser command with its reason', async () => {
    const { app } = harness({ chooser: ['open-with', '{file}'] }, () => ({
      code: 1,
      stdout: '',
      stderr: 'another instance is already running\n',
    }))
    const res = await post(app, '/api/open-with', { path: '/loose.stl' })
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toMatch(/another instance/)
  })
})
