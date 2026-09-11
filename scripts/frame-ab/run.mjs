#!/usr/bin/env node
/**
 * frame-ab: the pixel A/B behind `file-frame-spindle`, re-runnable (design D6,
 * README.md beside this file).
 *
 * Renders every sample with the code the app imports today, through the page
 * at client/spike/ab.html in a headless Chromium, and compares it with the
 * pre-change rendering (C0) of the same sample under the same framing.
 *
 *   node scripts/frame-ab/run.mjs                      # baseline mode: today's render vs baseline/<name>_C0.png
 *   node scripts/frame-ab/run.mjs --mode in-process    # TEMPORARY: C0 rendered in the same page through the pill's flag
 *   node scripts/frame-ab/run.mjs --obj-only           # the OBJ fixture alone: no library, no server (either mode)
 *
 * Baseline mode gates only the AO-off rows: the AO pass is not deterministic
 * across browser processes (5–23 % of pixels on a real STL), so an AO-on row
 * is rendered, diffed and printed for reference and never fails the run.
 * In-process mode has no such floor — both sides render in one process — so
 * every row is gated, and it writes the AO-off legacy render of each STL
 * sample as `baseline/<name>-noao_C0.png` where none is stored yet, so that
 * baseline mode can gate all nine STLs exactly once the pill is gone
 * (`file-frame-spindle` task 5.2 deletes the flag, and with it this mode).
 *
 * Reads config.json (gitignored) over config.example.json. Starts its own Vite
 * on `vitePort` from client/ and stops it on exit. The dev server is only ever
 * read (`/api/library`, `/api/dir`, `/api/file`).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = resolve(HERE, '..', '..', 'client')
const BASELINE = join(HERE, 'baseline')
const OUT = join(HERE, 'out')

/**
 * D6: the bake residual — the shadow map's texel grid landing sub-texel
 * differently in the rotated world — is ≤ 1.8 % of pixels / ≤ 60 per channel
 * within one process. 2 % bounds it; 96 bounds "a shadow edge moved a texel"
 * plus the AO noise of one process, far under the 255 a rotated model
 * produces. The AO pass adds nothing *within* a process (the spike's noise
 * floor was 0/0), so in-process mode gates every row at this bound; across
 * processes it adds an unseeded-noise floor of 5–23 % of pixels on a real STL
 * (README, the plumbing run), which no useful bound absorbs, so baseline mode
 * gates only the AO-off rows and prints the AO-on ones as reference.
 */
const BOUND = { frac: 0.02, max: 96 }
const MODES = ['baseline', 'in-process']

function parseArgs(argv) {
  const objOnly = argv.includes('--obj-only')
  const at = argv.indexOf('--mode')
  const mode = at === -1 ? 'baseline' : argv[at + 1]
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join('|')}, got ${mode}`)
  return { objOnly, mode }
}

function loadConfig() {
  const example = JSON.parse(readFileSync(join(HERE, 'config.example.json'), 'utf8'))
  const local = join(HERE, 'config.json')
  const overrides = existsSync(local) ? JSON.parse(readFileSync(local, 'utf8')) : {}
  const unknown = Object.keys(overrides).filter((k) => !(k in example))
  if (unknown.length > 0) throw new Error(`config.json: unknown key(s) ${unknown.join(', ')}`)
  return {
    ...example,
    ...overrides,
    source: existsSync(local) ? 'config.json over config.example.json' : 'config.example.json',
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function startVite(port) {
  // Its own process group, so stopping it also stops the vite that bunx spawned.
  const child = spawn('bunx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: CLIENT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        /* already gone */
      }
    }
  }
  process.on('exit', stop)
  process.on('SIGINT', () => {
    stop()
    process.exit(130)
  })
  return { child, stop, log: () => log }
}

/** Vite binds IPv6-only on this machine; try each spelling until one answers. */
async function waitForVite(vite, port, ms) {
  const urls = [`http://localhost:${port}`, `http://[::1]:${port}`, `http://127.0.0.1:${port}`]
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (vite.child.exitCode !== null) throw new Error(`vite exited early:\n${vite.log()}`)
    for (const base of urls) {
      try {
        const res = await fetch(`${base}/spike/ab.html`)
        if (res.ok) return base
      } catch {
        /* not up yet */
      }
    }
    await sleep(250)
  }
  throw new Error(`vite did not answer on ${port} within ${ms} ms:\n${vite.log()}`)
}

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

async function launch(chromium, executablePath) {
  try {
    return await chromium.launch({ executablePath, headless: true })
  } catch (err) {
    console.log(`default launch failed (${err.message}); retrying with swiftshader`)
    return chromium.launch({
      executablePath,
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
    })
  }
}

const dataUrl = (pngBytes) => `data:image/png;base64,${pngBytes.toString('base64')}`
const bytesOf = (url) => Buffer.from(url.split(',')[1], 'base64')
/** |a − b| on the circle, radians. */
const angleDiff = (a, b) => {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return Math.min(d, 2 * Math.PI - d)
}
const slug = (id) => id.replace(/[^A-Za-z0-9._-]/g, '_')
const rowName = (sample, ao) => `${slug(sample)}${ao ? '' : '-noao'}`
const baselineFile = (name) => join(BASELINE, `${name}_C0.png`)

/** A row: gated at BOUND, or — baseline mode, AO on — printed for reference only. */
function row(mode, name, ao, cmp) {
  const gated = mode === 'in-process' || !ao
  const pct = (100 * cmp.diff) / cmp.pixels
  return {
    mode,
    sample: name,
    ao,
    diff: cmp.diff,
    pct,
    max: cmp.max,
    pixels: cmp.pixels,
    bound: gated ? `≤ ${100 * BOUND.frac} % / ≤ ${BOUND.max}` : 'reference',
    pass: gated ? pct <= 100 * BOUND.frac && cmp.max <= BOUND.max : null,
  }
}

function printTable(rows) {
  const w = Math.max(6, ...rows.map((r) => r.sample.length))
  const line = (mode, s, ao, d, p, m, b, ok) =>
    `${mode.padEnd(10)} | ${s.padEnd(w)} | ${ao.padEnd(3)} | ${d.padStart(7)} | ${p.padStart(7)} | ${m.padStart(5)} | ${b.padEnd(13)} | ${ok}`
  console.log(line('mode', 'sample', 'ao', 'diff px', 'diff %', 'max Δ', 'bound', 'pass'))
  console.log(`-----------|-${'-'.repeat(w)}-|-----|---------|---------|-------|---------------|-----`)
  for (const r of rows) {
    const ok = r.pass === null ? '—' : r.pass ? 'ok' : 'FAIL'
    console.log(line(r.mode, r.sample, r.ao ? 'on' : 'off', String(r.diff), r.pct.toFixed(2), String(r.max), r.bound, ok))
  }
}

/**
 * The record's per-sample framing, once per sample: the record has a row per
 * frame the spike wrote (`fat_cat` and `xyzCalibration_cube` twice, with and
 * without AO), and the framing fields are the same across a sample's rows.
 */
function samplesOf(record) {
  const byPath = new Map()
  for (const rec of record.results) {
    const path = rec.sample.replace(/-noao$/, '')
    if (!byPath.has(path)) byPath.set(path, rec)
  }
  return [...byPath.entries()].map(([path, rec]) => ({ path, rec }))
}

async function main() {
  const cfg = loadConfig()
  const { objOnly, mode } = parseArgs(process.argv)
  mkdirSync(OUT, { recursive: true })
  console.log(`config: ${cfg.source}`)
  console.log(`mode: ${mode}`)

  // The record of the run that produced the baselines: which STL samples, and
  // the framing each C0 was rendered under (a stored camera, or one derived
  // from the index's pose, or the default) in the pre-change scene convention.
  const record = JSON.parse(readFileSync(join(BASELINE, 'results.json'), 'utf8'))

  let stlReason = null
  let byPath = new Map()
  if (objOnly) {
    stlReason = '--obj-only'
  } else {
    try {
      const lib = await getJson(`${cfg.apiBase}/api/library`)
      if (lib.state !== 'ready') stlReason = `${cfg.apiBase}/api/library is ${lib.state}`
      else {
        const listing = await getJson(`${cfg.apiBase}/api/dir?path=/`)
        byPath = new Map(listing.entries.map((e) => [e.path, e]))
        console.log(`library ${lib.id} at ${lib.top}: ${listing.entries.length} entries at /`)
      }
    } catch (err) {
      stlReason = `${cfg.apiBase} unreachable (${err.message})`
    }
  }
  if (stlReason !== null) console.log(`STL rows not run: ${stlReason} — OBJ fixture only`)

  const { chromium } = await import(pathToFileURL(join(cfg.playwrightCore, 'index.mjs')).href)
  const vite = startVite(cfg.vitePort)
  let browser
  const rows = []
  const notes = []
  const skipped = []
  const written = []
  const selfChecks = []
  try {
    const base = await waitForVite(vite, cfg.vitePort, 60000)
    console.log(`vite up at ${base}`)
    browser = await launch(chromium, cfg.chromium)
    const page = await browser.newPage()
    page.setDefaultTimeout(600000)
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(`http://localhost:${cfg.vitePort}/spike/ab.html`, { waitUntil: 'load' })
    await page.waitForFunction('window.ab !== undefined', null, { timeout: 60000 })

    const render = (opts) => page.evaluate((o) => window.ab.render(o), opts)
    const compare = (a, b) => page.evaluate(([x, y]) => window.ab.compare(x, y), [a, b])
    const migrate = (axis) => page.evaluate((a) => window.ab.migrateAxis(a), axis)
    const offset = (axis) => page.evaluate((a) => window.ab.swapOffset(a), axis)
    const defaultCamera = await page.evaluate(() => window.ab.defaultCamera)
    const sheet = (cells, title) => page.evaluate(([c, t]) => window.ab.sheet(c, t), [cells, title])

    /** The framing check every render gets: what the page rendered under vs what the record says C0 used. */
    const framingOf = (result, expectedAxis, c0Camera, recordAxis) => {
      const framing = []
      if (result.axis !== expectedAxis) {
        framing.push(`axis ${result.axis}, record ${recordAxis}${recordAxis === expectedAxis ? '' : `→${expectedAxis}`}`)
      }
      if (angleDiff(result.camera.az, c0Camera.az) > 1e-6) framing.push(`az ${result.camera.az}, record ${c0Camera.az}`)
      if (Math.abs(result.camera.el - c0Camera.el) > 1e-6) framing.push(`el ${result.camera.el}, record ${c0Camera.el}`)
      if (Math.abs(result.camera.distR - c0Camera.distR) > 1e-9) framing.push(`distR ${result.camera.distR}, record ${c0Camera.distR}`)
      return framing
    }

    /**
     * One row. `current` is today's render; `legacy` (in-process mode) is the
     * page's C0 through the pill's flag, else C0 is read from `baseline/`.
     * In-process mode also holds the legacy AO-off render against the stored
     * C0 where one exists — it must be pixel-identical, or the flag is not
     * reproducing the spike and the baselines it writes would be wrong — and
     * writes the missing STL AO-off baselines.
     */
    const judge = async ({ name, ao, current, legacy, stl }) => {
      const file = baselineFile(name)
      const stored = existsSync(file) ? dataUrl(readFileSync(file)) : null
      let c0
      if (mode === 'in-process') {
        c0 = legacy.pngDataUrl
        writeFileSync(join(OUT, `${name}_C0.png`), bytesOf(c0))
        if (!ao) {
          if (stored !== null) {
            const self = await compare(stored, c0)
            selfChecks.push({ sample: name, ...self, pass: self.diff === 0 && self.max === 0 })
          } else if (stl) {
            writeFileSync(file, bytesOf(c0))
            written.push({ file, bytes: statSync(file).size })
          }
        }
      } else {
        if (stored === null) throw new Error(`no baseline for ${name}: ${file}`)
        c0 = stored
      }
      const cmp = await compare(c0, current.pngDataUrl)
      writeFileSync(join(OUT, `${name}.png`), bytesOf(current.pngDataUrl))
      const cells = []
      if (stored !== null) cells.push({ label: 'C0 baseline', pngDataUrl: stored })
      if (mode === 'in-process') cells.push({ label: 'C0 legacy, in-process', pngDataUrl: c0 })
      cells.push({ label: 'current', pngDataUrl: current.pngDataUrl })
      writeFileSync(join(OUT, `sheet_${name}.png`), bytesOf(await sheet(cells, name)))
      const r = row(mode, name, ao, cmp)
      rows.push(r)
      return r
    }

    // ---- STL samples: the framing C0 used, re-expressed in the file convention
    // for today's render. A recorded scene axis A becomes migrateAxis(A); a
    // stored camera is unchanged (its basis and the camera pass through R⁻¹
    // together, D3); a pose goes through cameraForPose exactly as the app does
    // today, and is checked against the az/el the record says C0 rendered at.
    // The in-process legacy render takes the record's framing as-is — scene
    // axis, stored camera, the pose through cameraForPose under the flag — which
    // is C0 by construction, and is checked against the record the same way.
    for (const { path, rec } of stlReason === null ? samplesOf(record) : []) {
      const entry = byPath.get(path)
      if (entry === undefined) {
        skipped.push(`${slug(path)}: ${path} is not in the listing at /`)
        continue
      }
      const expectedAxis = await migrate(rec.c0Axis)
      let current
      let legacy
      let how
      if (rec.storedCamera !== null) {
        current = { path, format: 'stl', axis: expectedAxis, camera: rec.storedCamera }
        legacy = { path, format: 'stl', axis: rec.c0Axis, camera: rec.storedCamera, legacy: true }
        how = 'stored camera'
      } else if (entry.pose != null) {
        current = { path, format: 'stl', pose: entry.pose }
        legacy = { path, format: 'stl', pose: entry.pose, legacy: true }
        how = 'pose via cameraForPose'
      } else {
        current = { path, format: 'stl', axis: expectedAxis, camera: rec.c0Camera }
        legacy = { path, format: 'stl', axis: rec.c0Axis, camera: rec.c0Camera, legacy: true }
        how = 'no pose in the listing; replayed the recorded camera'
      }
      for (const ao of [true, false]) {
        const name = rowName(path, ao)
        if (mode === 'baseline' && !existsSync(baselineFile(name))) {
          skipped.push(`${name}: no ${baselineFile(name)} (an in-process run writes it)`)
          continue
        }
        const t = Date.now()
        const cur = await render({ ...current, ao })
        const framing = framingOf(cur, expectedAxis, rec.c0Camera, rec.c0Axis)
        let leg
        if (mode === 'in-process') {
          leg = await render({ ...legacy, ao })
          for (const f of framingOf(leg, rec.c0Axis, rec.c0Camera, rec.c0Axis)) framing.push(`legacy: ${f}`)
        }
        const ms = Date.now() - t
        const r = await judge({ name, ao, current: cur, legacy: leg, stl: true })
        r.how = how
        r.ms = ms
        if (framing.length > 0) {
          r.framingMismatch = framing
          notes.push(`${name}: framing differs from the record — ${framing.join('; ')}`)
        }
      }
    }

    // ---- The OBJ fixture: never baked, so its axis keeps its name and the
    // default camera the baseline was framed with gains swapOffset(axis) —
    // what the D5 migration does to a stored OBJ camera (0 at `y`, +90° at `z`).
    // The legacy render is the default camera at the axis under the old table.
    const objText = readFileSync(join(BASELINE, 'lbracket.obj'), 'utf8')
    for (const axis of ['y', 'z']) {
      const camera = { ...defaultCamera, az: defaultCamera.az + (await offset(axis)) }
      for (const ao of [true, false]) {
        const name = `OBJ_axis_${axis}${ao ? '' : '-noao'}`
        const obj = { path: 'frame-ab:lbracket.obj', format: 'obj', text: objText, axis, ao }
        const t = Date.now()
        const cur = await render({ ...obj, camera })
        const leg = mode === 'in-process' ? await render({ ...obj, camera: defaultCamera, legacy: true }) : undefined
        const r = await judge({ name, ao, current: cur, legacy: leg, stl: false })
        r.how = `default camera + swapOffset(${axis})`
        r.ms = Date.now() - t
      }
    }

    console.log('')
    printTable(rows)
    for (const s of skipped) console.log(`skipped: ${s}`)
    for (const n of notes) console.log(`note: ${n}`)
    for (const c of selfChecks) {
      console.log(
        `self-check ${c.sample}: legacy render vs stored C0 — ${c.diff} px / max ${c.max} (must be 0/0): ${c.pass ? 'ok' : 'FAIL'}`,
      )
    }
    if (mode === 'in-process') {
      console.log(
        written.length > 0
          ? `wrote ${written.length} AO-off baseline(s) from the legacy render, for baseline mode after the pill is gone:\n${written
              .map((w) => `  ${w.file} (${w.bytes} bytes)`)
              .join('\n')}`
          : 'wrote no baselines: every STL sample already has its -noao_C0.png',
      )
    }
    if (errors.length > 0) console.log(`page errors: ${JSON.stringify(errors)}`)
    writeFileSync(
      join(OUT, 'results.json'),
      JSON.stringify(
        { when: new Date().toISOString(), mode, config: cfg, stlReason, rows, skipped, notes, selfChecks, written, errors },
        null,
        2,
      ),
    )
    const failed = rows.filter((r) => r.pass === false)
    const failedChecks = selfChecks.filter((c) => !c.pass)
    const reference = rows.filter((r) => r.pass === null).length
    console.log(
      `${rows.length} rows, ${failed.length} failed` +
        (reference > 0 ? `, ${reference} reference only` : '') +
        (failedChecks.length > 0 ? `, ${failedChecks.length} self-check(s) failed` : '') +
        (skipped.length > 0 ? `, ${skipped.length} skipped` : '') +
        `; renders in ${OUT}`,
    )
    process.exitCode = failed.length > 0 || failedChecks.length > 0 ? 1 : 0
  } finally {
    if (browser !== undefined) await browser.close()
    vite.stop()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
