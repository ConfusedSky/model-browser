import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  type ExecFn,
  type SpawnOptions,
  type SpawnResult,
  HANDLED_MIMES,
  createLauncher,
  loadLaunchConfig,
  mimeFor,
} from '../src/launch'

// ---------------------------------------------------------------------------
// A whole fake XDG world, shaped like the development machine (design L2):
// XDG_DATA_HOME and XDG_CONFIG_HOME unset, and ~/.local/share deliberately
// absent from XDG_DATA_DIRS — so only the applied defaults can find the
// directory holding every entry that matters.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'mb-xdg-'))
const userApps = join(root, 'home', '.local', 'share', 'applications')
const sysApps = join(root, 'usr', 'share', 'applications')
const external = join(root, 'external')

afterAll(() => rmSync(root, { recursive: true, force: true }))

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

mkdirSync(userApps, { recursive: true })
mkdirSync(sysApps, { recursive: true })
mkdirSync(join(external, 'subdir'), { recursive: true })

// A *file* symlink — the dotfiles-deployed shape. `dirent.isFile()` is false
// for this, so only a stat-through-symlinks traversal sees it.
write(
  join(external, 'lychee.desktop'),
  `[Desktop Entry]
Type=Application
Name=LycheeSlicer
# a comment line, which is not a key
Name[de]=LycheeSchneider
Exec=lycheeslicer %U
MimeType=x-scheme-handler/lycheeslicer;model/stl;model/3mf;
`,
)
symlinkSync(join(external, 'lychee.desktop'), join(userApps, 'lycheeslicer.desktop'))

// A symlinked *directory*, descended the same way.
write(
  join(external, 'subdir', 'vialink.desktop'),
  `[Desktop Entry]
Type=Application
Name=Via Link
MimeType=model/3mf;
`,
)
symlinkSync(join(external, 'subdir'), join(userApps, 'linked'))

// A symlink loop back to the scan root: the cycle guard must not hang on it.
symlinkSync(userApps, join(userApps, 'loop'))

// A plain file whose id contains a dash that is NOT a path separator.
write(
  join(userApps, 'photon-workshop.desktop'),
  `[Desktop Entry]
Type=Application
Name=Photon Workshop
Exec=wine start /ProgIDOpen PhotonWorkShop %f
MimeType=model/stl;
`,
)

// A malformed entry: the key is present but the value is empty. It must not
// count as having been named, or the pill it produces has no label at all.
write(
  join(userApps, 'blank-name.desktop'),
  `[Desktop Entry]
Type=Application
Name=
MimeType=model/obj;
`,
)

// NoDisplay, and named the same as the default — the duplicate pill the filter
// exists to kill.
write(
  join(userApps, 'hidden-plugin.desktop'),
  `[Desktop Entry]
Type=Application
Name=F3D
NoDisplay=true
MimeType=model/stl;
`,
)

// A stale build artifact. It is never consulted: it lists only f3d for
// model/stl, yet the entries that declare the type still associate.
write(
  join(userApps, 'mimeinfo.cache'),
  `[MIME Cache]
model/stl=f3d.desktop;
`,
)

// The wine/Programs shape — a subdirectoried entry, three levels down.
write(
  join(userApps, 'wine', 'Programs', 'Anycubic', 'Anycubic.desktop'),
  `[Desktop Entry]
Type=Application
Name=Anycubic Photon Workshop
MimeType=model/stl;
`,
)

// Past the depth cap, so the scan never reaches it: only the id→file probe
// with cumulative dash→slash substitution can resolve its name.
write(
  join(userApps, 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'deep.desktop'),
  `[Desktop Entry]
Type=Application
Name=Very Deep
MimeType=model/stl;
`,
)

write(
  join(sysApps, 'f3d.desktop'),
  `[Desktop Entry]
Type=Application
Name=F3D
Exec=f3d %F
`,
)

// Declares model/stl, and the user removed it — it must not get a pill.
write(
  join(sysApps, 'banished.desktop'),
  `[Desktop Entry]
Type=Application
Name=Banished
MimeType=model/stl;
`,
)

write(
  join(root, 'home', '.config', 'mimeapps.list'),
  `[Default Applications]
model/stl=f3d.desktop

[Added Associations]
model/stl=added-only.desktop;d1-d2-d3-d4-d5-d6-d7-d8-d9-deep.desktop;

[Removed Associations]
model/stl=banished.desktop;
`,
)

// A less-precedent location that re-adds what the config file removed: the
// removal must still win.
write(
  join(sysApps, 'mimeapps.list'),
  `[Added Associations]
model/stl=banished.desktop;
`,
)

/** XDG_DATA_HOME and XDG_CONFIG_HOME unset on purpose; see the header note. */
const ENV: NodeJS.ProcessEnv = {
  HOME: join(root, 'home'),
  XDG_DATA_DIRS: join(root, 'usr', 'share'),
}

interface Call {
  file: string
  args: string[]
  opts: SpawnOptions
}

function recorder(
  reply: (file: string, args: string[]) => SpawnResult = () => ({ code: 0, stdout: '', stderr: '' }),
): { calls: Call[]; exec: ExecFn } {
  const calls: Call[] = []
  const exec: ExecFn = async (file, args, opts) => {
    calls.push({ file, args, opts })
    return reply(file, args)
  }
  return { calls, exec }
}

/** The builtin default query, answered without touching the real machine. */
const xdgMime = (_file: string, args: string[]): SpawnResult =>
  args[2] === 'model/stl'
    ? { code: 0, stdout: 'f3d.desktop\n', stderr: '' }
    : { code: 0, stdout: '', stderr: '' }

function reportWith(config = {}): ReturnType<ReturnType<typeof createLauncher>['report']> {
  const { exec } = recorder(xdgMime)
  return createLauncher({ env: ENV, exec, config }).report()
}

describe('mime mapping', () => {
  it('maps the listing format detector and nothing else', () => {
    expect(mimeFor('a.stl')).toBe('model/stl')
    expect(mimeFor('A.STL')).toBe('model/stl')
    expect(mimeFor('a.3mf')).toBe('model/3mf')
    expect(mimeFor('a.obj')).toBe('model/obj')
    expect(mimeFor('a.gcode')).toBeUndefined()
    expect(mimeFor('notes.txt')).toBeUndefined()
  })
})

describe('desktop-entry reader', () => {
  it('applies the XDG defaults when the env vars are unset', async () => {
    // ~/.local/share is absent from XDG_DATA_DIRS here, exactly as on the
    // machine: reading the variables literally would find none of these.
    const report = await reportWith()
    const ids = report.types['model/stl']?.associated.map((a) => a.id) ?? []
    expect(ids).toContain('lycheeslicer.desktop')
    expect(ids).toContain('photon-workshop.desktop')
  })

  it('reads a symlinked file entry and resolves its Name', async () => {
    const report = await reportWith()
    const lychee = report.types['model/stl']?.associated.find(
      (a) => a.id === 'lycheeslicer.desktop',
    )
    // `dirent.isFile()` is false for this entry; only statting through the
    // symlink finds it.
    expect(lychee).toEqual({ id: 'lycheeslicer.desktop', name: 'LycheeSlicer' })
  })

  it('descends a symlinked directory', async () => {
    const report = await reportWith()
    expect(report.types['model/3mf']?.associated).toContainEqual({
      id: 'linked-vialink.desktop',
      name: 'Via Link',
    })
  })

  it('resolves a subdirectory id in the wine/Programs shape', async () => {
    const report = await reportWith()
    expect(report.types['model/stl']?.associated).toContainEqual({
      id: 'wine-Programs-Anycubic-Anycubic.desktop',
      name: 'Anycubic Photon Workshop',
    })
  })

  it('resolves a name by cumulative dash substitution when the scan missed the entry', async () => {
    const report = await reportWith()
    // Past the depth cap, so it is only here because mimeapps named it — and
    // its name only resolves if every dash was tried as a separator.
    expect(report.types['model/stl']?.associated).toContainEqual({
      id: 'd1-d2-d3-d4-d5-d6-d7-d8-d9-deep.desktop',
      name: 'Very Deep',
    })
  })

  it('associates an entry the cached index missed', async () => {
    // mimeinfo.cache lists only f3d for model/stl. The cache is never consulted.
    const report = await reportWith()
    expect(report.types['model/stl']?.associated.map((a) => a.id)).toContain(
      'photon-workshop.desktop',
    )
  })

  it('honors a [Removed Associations] exclusion over a less-precedent addition', async () => {
    const report = await reportWith()
    const ids = report.types['model/stl']?.associated.map((a) => a.id) ?? []
    expect(ids).not.toContain('banished.desktop')
  })

  it('filters NoDisplay entries', async () => {
    const report = await reportWith()
    const stl = report.types['model/stl']
    expect(stl?.associated.map((a) => a.id)).not.toContain('hidden-plugin.desktop')
    // The duplicate-name pill the filter exists to prevent.
    expect(stl?.associated.filter((a) => a.name === 'F3D')).toHaveLength(0)
  })

  it('keeps an id it cannot resolve, naming it after itself', async () => {
    const report = await reportWith()
    expect(report.types['model/stl']?.associated).toContainEqual({
      id: 'added-only.desktop',
      name: 'added-only.desktop',
    })
  })

  it('names an entry after itself when its Name is present but empty', async () => {
    // The guard is `!named`, so a blank value used to latch: it overwrote the
    // id fallback with '' *and* shut the key, leaving an unlabelled pill.
    const report = await reportWith()
    expect(report.types['model/obj']?.associated).toContainEqual({
      id: 'blank-name.desktop',
      name: 'blank-name.desktop',
    })
  })

  it('reports the default separately and drops it from the associations', async () => {
    const report = await reportWith()
    const stl = report.types['model/stl']
    expect(stl?.default).toEqual({ id: 'f3d.desktop', name: 'F3D' })
    expect(stl?.associated.map((a) => a.id)).not.toContain('f3d.desktop')
  })

  it('orders mimeapps additions before the entries that declare the type', async () => {
    const report = await reportWith()
    const ids = report.types['model/stl']?.associated.map((a) => a.id) ?? []
    expect(ids).toEqual([
      // mimeapps additions, in file order (f3d dropped as the default)
      'added-only.desktop',
      'd1-d2-d3-d4-d5-d6-d7-d8-d9-deep.desktop',
      // then the MimeType-declaring entries, by name
      'wine-Programs-Anycubic-Anycubic.desktop',
      'lycheeslicer.desktop',
      'photon-workshop.desktop',
    ])
  })

  it('reads the registry fresh on every report', async () => {
    const launcher = createLauncher({ env: ENV, exec: recorder(xdgMime).exec, config: {} })
    const before = (await launcher.report()).types['model/obj']?.associated ?? []
    expect(before.map((a) => a.id)).not.toContain('latecomer.desktop')
    write(
      join(userApps, 'latecomer.desktop'),
      `[Desktop Entry]
Type=Application
Name=Latecomer
MimeType=model/obj;
`,
    )
    try {
      const after = (await launcher.report()).types['model/obj']?.associated ?? []
      expect(after.map((a) => a.id)).toContain('latecomer.desktop')
    } finally {
      rmSync(join(userApps, 'latecomer.desktop'))
    }
  })
})

describe('templates', () => {
  it('runs the builtin launch when no config is present', async () => {
    const { calls, exec } = recorder()
    await createLauncher({ env: ENV, exec, config: {} }).launch('lycheeslicer.desktop', '/m/a.stl')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.file).toBe('gtk-launch')
    expect(calls[0]?.args).toEqual(['lycheeslicer', '/m/a.stl'])
  })

  it('runs the configured argv verbatim when one is present', async () => {
    const { calls, exec } = recorder()
    const config = { launch: ['my-opener', '--id={appId}', '--', '{file}'] }
    await createLauncher({ env: ENV, exec, config }).launch('x.desktop', '/m/a.stl')
    expect(calls[0]?.file).toBe('my-opener')
    expect(calls[0]?.args).toEqual(['--id=x.desktop', '--', '/m/a.stl'])
  })

  it('substitutes per element, so shell metacharacters stay inert', async () => {
    const { calls, exec } = recorder()
    const nasty = '/models/a; rm -rf ~ && $(whoami) `id` | tee "x".stl'
    const config = { launch: ['opener', '{file}'] }
    await createLauncher({ env: ENV, exec, config }).launch('x.desktop', nasty)
    // One element, byte for byte — never split on the spaces, never quoted.
    expect(calls[0]?.args).toEqual([nasty])
    expect(calls[0]?.args).toHaveLength(1)
  })

  it('substitutes into the builtin default and association queries', async () => {
    const { calls, exec } = recorder(() => ({ code: 0, stdout: '', stderr: '' }))
    await createLauncher({ env: ENV, exec, config: {} }).report()
    expect(calls.map((c) => [c.file, ...c.args])).toEqual([
      ['xdg-mime', 'query', 'default', 'model/stl'],
      ['xdg-mime', 'query', 'default', 'model/3mf'],
      ['xdg-mime', 'query', 'default', 'model/obj'],
    ])
  })

  it('parses an overridden query as id<TAB>name lines', async () => {
    const { exec } = recorder((file) =>
      file === 'my-default'
        ? { code: 0, stdout: 'chosen.desktop\tThe Chosen\n', stderr: '' }
        : { code: 0, stdout: 'one.desktop\tOne\ntwo.desktop\tTwo\n\n', stderr: '' },
    )
    const config = { default: ['my-default', '{mime}'], associations: ['my-assoc', '{mime}'] }
    const report = await createLauncher({ env: ENV, exec, config }).report()
    expect(report.types['model/stl']).toEqual({
      default: { id: 'chosen.desktop', name: 'The Chosen' },
      associated: [
        { id: 'one.desktop', name: 'One' },
        { id: 'two.desktop', name: 'Two' },
      ],
    })
  })

  it('formats a failed command as actor, code and reason', async () => {
    // The formatting, at the seam: a fabricated `SpawnResult` proves how `run`
    // renders one, and nothing about what a real launch can produce. The test
    // below is the one that answers that, and it exists because this one used
    // to be read as if it did.
    const { exec } = recorder(() => ({ code: 3, stdout: '', stderr: 'no such application\n' }))
    await expect(
      createLauncher({ env: ENV, exec, config: {} }).launch('x.desktop', '/m/a.stl'),
    ).rejects.toThrow(/exited 3: no such application/)
  })

  it('carries the real command’s reason out of a real launch', async () => {
    // No recorder: `nodeExec` itself, because the question is whether the
    // *production* path can deliver a reason at all. It could not — the
    // non-capture stdio was `ignore` on all three fds, so `run`'s detail was
    // built from a string that was always empty for launch and chooser, the two
    // operations where the reason matters most. The seam test above passed
    // throughout, on a stderr the seam invented.
    const launcher = createLauncher({
      env: ENV,
      config: { launch: ['sh', '-c', 'echo "no such application" >&2; exit 3'] },
    })
    await expect(launcher.launch('x.desktop', '/m/a.stl')).rejects.toThrow(
      /the launch command exited 3: no such application/,
    )
  })

  it('keeps the tail of a chattering command’s stderr, which is where the reason is', async () => {
    // The cap is a guard against an unbounded read, not a budget on the child.
    // Read from the front it would defeat itself: a command that logs its way
    // through startup and then fails hands back the startup and drops the
    // failure, which is the one line the sink exists to carry.
    const launcher = createLauncher({
      env: ENV,
      config: {
        launch: [
          'sh',
          '-c',
          'i=0; while [ $i -lt 400 ]; do echo "chatter chatter chatter chatter chatter" >&2; i=$((i+1)); done; echo "no such application" >&2; exit 3',
        ],
      },
    })
    await expect(launcher.launch('x.desktop', '/m/a.stl')).rejects.toThrow(
      /exited 3: ….*no such application/s,
    )
  })

  it('does not leave mojibake where the cap cut a character in half', async () => {
    // Cosmetic, and deterministic: 10 ASCII bytes, a 3-byte `€`, then 8190 more
    // makes 8203, so the tail begins one byte inside the euro and its orphaned
    // bytes decode to a U+FFFD each — right after the ellipsis, where the
    // reason is supposed to start.
    const launcher = createLauncher({
      env: ENV,
      config: {
        launch: [
          'sh',
          '-c',
          'printf "aaaaaaaaaa€" >&2; yes b | head -8171 | tr -d "[:space:]" >&2; printf "no such application" >&2; exit 3',
        ],
      },
    })
    let err: Error | null = null
    try {
      await launcher.launch('x.desktop', '/m/a.stl')
    } catch (e) {
      err = e as Error
    }
    expect(err?.message).toMatch(/exited 3: …bb+no such application/)
    expect(err?.message).not.toContain('\uFFFD')
  })

  it('gets the reason from a command whose child outlives it, and does not kill that child', async () => {
    // Both hazards of the obvious fix, in one command. Piping stderr would hang
    // the request here — the backgrounded child inherits the write-end and
    // `close` waits for EOF — and destroying the read end at `exit` to dodge
    // that kills the child the moment it writes (measured: SIGPIPE, and for a
    // launcher that means killing the application it just started). A file has
    // neither problem.
    // Under `root`, which `afterAll` removes either way — a cleanup line at the
    // end of the test only runs when the test passes, and the runs that matter
    // most for this one are the runs where it fails.
    const marker = join(root, 'survived')
    const launcher = createLauncher({
      env: ENV,
      config: {
        launch: [
          'sh',
          '-c',
          `(sleep 1; echo late >&2; echo yes > ${marker}) & echo "no such application" >&2; exit 3`,
        ],
      },
    })
    const started = Date.now()
    await expect(launcher.launch('x.desktop', '/m/a.stl')).rejects.toThrow(
      /exited 3: no such application/,
    )
    // Prompt: the request ended with the command, not with its descendant.
    expect(Date.now() - started).toBeLessThan(1000)
    // And the descendant is still alive to write after we let go of the sink.
    await new Promise((r) => setTimeout(r, 1500))
    expect(existsSync(marker)).toBe(true)
  })

  it('reports an unspawnable launch command with its reason', async () => {
    const exec: ExecFn = () => Promise.reject(new Error('spawn gtk-launch ENOENT'))
    await expect(
      createLauncher({ env: ENV, exec, config: {} }).launch('x.desktop', '/m/a.stl'),
    ).rejects.toThrow(/ENOENT/)
  })

  it('pipes output for the queries and nothing else, so a launch cannot outlive its request', async () => {
    // A piped write-end is inherited by every descendant, and `close` waits for
    // EOF on the pipes rather than for the child — so a captured launch keeps
    // the request open until the *launched application* quits, which the spec
    // forbids ("the request SHALL complete when the chooser command does").
    // Only the two query operations read output, so only they may ask for it.
    // Both query branches, builtin and configured: the configured ones read
    // stdout too, so they need capture for the same reason.
    for (const config of [{}, { default: ['q-def', '{mime}'], associations: ['q-assoc', '{mime}'] }]) {
      const { calls, exec } = recorder(xdgMime)
      await createLauncher({ env: ENV, exec, config }).report()
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.every((c) => c.opts.capture === true)).toBe(true)
    }

    const { calls, exec } = recorder(xdgMime)
    const launcher = createLauncher({
      env: ENV,
      exec,
      config: { chooser: ['open-with', '{file}'] },
    })

    calls.length = 0
    await launcher.launch('x.desktop', '/m/a.stl')
    await launcher.chooser('/m/a.stl')
    expect(calls.map((c) => c.opts.capture)).toEqual([undefined, undefined])
  })

  it('resolves a launch when the command exits, not when its children do', async () => {
    // The real `nodeExec`, not a recorder — the wiring under test *is* the
    // stdio wiring. `sh` exits at once and leaves a child holding whatever fds
    // it inherited; with the launch piped, `close` waits for that child.
    const launcher = createLauncher({
      env: ENV,
      config: { launch: ['sh', '-c', 'sleep 5 & exit 0'] },
    })
    const started = Date.now()
    await launcher.launch('x.desktop', '/m/a.stl')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('treats a failing configured query as absence rather than a failed report', async () => {
    // The builtin branch already says this is the policy; the override branch
    // used to throw, and one bad template took every type's pills down with it.
    const exec: ExecFn = async (file) =>
      file === 'bad-default'
        ? { code: 2, stdout: '', stderr: 'boom\n' }
        : { code: 0, stdout: '', stderr: '' }
    const report = await createLauncher({
      env: ENV,
      exec,
      config: { default: ['bad-default', '{mime}'], associations: ['bad-assoc', '{mime}'] },
    }).report()
    expect(report.types['model/stl']?.default).toBeNull()
    expect(Object.keys(report.types)).toEqual([...HANDLED_MIMES])
  })

  it('treats an unspawnable configured query as absence too', async () => {
    const exec: ExecFn = () => Promise.reject(new Error('spawn bad-default ENOENT'))
    const report = await createLauncher({
      env: ENV,
      exec,
      config: { default: ['bad-default', '{mime}'], associations: ['bad-assoc', '{mime}'] },
    }).report()
    expect(report.types['model/stl']).toEqual({ default: null, associated: [] })
  })

  it('treats a missing xdg-mime as no default rather than a failed report', async () => {
    const exec: ExecFn = () => Promise.reject(new Error('spawn xdg-mime ENOENT'))
    const report = await createLauncher({ env: ENV, exec, config: {} }).report()
    expect(report.types['model/stl']?.default).toBeNull()
    expect(report.types['model/stl']?.associated.length).toBeGreaterThan(0)
  })
})

describe('chooser', () => {
  it('is unavailable with no configuration, and spawns nothing', async () => {
    const { calls, exec } = recorder()
    const launcher = createLauncher({ env: ENV, exec, config: {} })
    expect(launcher.chooserConfigured).toBe(false)
    await expect(launcher.chooser('/m/a.stl')).rejects.toThrow(/no chooser is configured/)
    expect(calls).toHaveLength(0)
  })

  it('spawns the configured argv detached, with no signal wired', async () => {
    const { calls, exec } = recorder()
    const config = { chooser: ['open-with', '{file}'] }
    const launcher = createLauncher({ env: ENV, exec, config })
    expect(launcher.chooserConfigured).toBe(true)
    await launcher.chooser('/m/a.stl')
    expect(calls[0]?.file).toBe('open-with')
    expect(calls[0]?.args).toEqual(['/m/a.stl'])
    // Detached so neither a dropped request nor a hot reload reaps a chooser
    // mid-decision; no signal, so there is no abort to wire in the first place.
    expect(calls[0]?.opts.detached).toBe(true)
    expect(Object.keys(calls[0]?.opts ?? {})).not.toContain('signal')
  })
})

describe('config loading', () => {
  const cfgDir = mkdtempSync(join(tmpdir(), 'mb-cfg-'))
  afterAll(() => rmSync(cfgDir, { recursive: true, force: true }))

  it('falls back to the builtins when the file is absent', () => {
    expect(loadLaunchConfig({ MODEL_BROWSER_LAUNCH_CONFIG: join(cfgDir, 'nope.json') })).toEqual({})
  })

  it('falls back to the builtins when the file is not JSON', () => {
    const p = join(cfgDir, 'bad.json')
    writeFileSync(p, 'not json at all')
    expect(loadLaunchConfig({ MODEL_BROWSER_LAUNCH_CONFIG: p })).toEqual({})
  })

  it('reads argv arrays and ignores anything that is not one', () => {
    const p = join(cfgDir, 'ok.json')
    writeFileSync(
      p,
      JSON.stringify({
        chooser: ['rofi-open-with', '{file}'],
        // A shell string is not an argv array, and is not half-honoured.
        launch: 'gtk-launch {appId} {file}',
        associations: [],
        unknown: ['ignored'],
      }),
    )
    expect(loadLaunchConfig({ MODEL_BROWSER_LAUNCH_CONFIG: p })).toEqual({
      chooser: ['rofi-open-with', '{file}'],
    })
  })

  it('defaults the path to ~/.config/model-browser/launch.json', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'mb-home-'))
    mkdirSync(join(fakeHome, '.config', 'model-browser'), { recursive: true })
    writeFileSync(
      join(fakeHome, '.config', 'model-browser', 'launch.json'),
      JSON.stringify({ chooser: ['from-default-path'] }),
    )
    try {
      expect(loadLaunchConfig({ HOME: fakeHome })).toEqual({ chooser: ['from-default-path'] })
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })
})
