#!/usr/bin/env node
/**
 * frame-ab: the pixel A/B behind `file-frame-spindle`, re-runnable (design D6,
 * README.md beside this file).
 *
 * Renders every sample with the code the app imports today, through the page
 * at client/spike/ab.html in a headless Chromium, and compares each render
 * against the baseline the pre-change code produced (baseline/<name>_C0.png).
 *
 *   node scripts/frame-ab/run.mjs             # STL samples via the dev server on 3177 + the OBJ fixture
 *   node scripts/frame-ab/run.mjs --obj-only  # the OBJ fixture alone: no library, no server
 *
 * Reads config.json (gitignored) over config.example.json. Starts its own Vite
 * on `vitePort` from client/ and stops it on exit. The dev server is only ever
 * read (`/api/library`, `/api/dir`, `/api/file`).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = resolve(HERE, '..', '..', 'client')
const BASELINE = join(HERE, 'baseline')
const OUT = join(HERE, 'out')

/**
 * D6: the bake residual is ≤ 1.8 % of pixels / ≤ 60 per channel; on top of it
 * the AO pass adds an unseeded-noise floor across browser processes (up to
 * ≈ 4.6 % / ≤ 27), so AO-on frames get 5 %. The `-noao` frames are the exact
 * comparisons and carry the residual alone: 2 %. 96 bounds "a shadow edge
 * moved a texel" plus AO noise, far under the 255 a rotated model produces.
 */
const BOUNDS = {
  ao: { frac: 0.05, max: 96 },
  noao: { frac: 0.02, max: 96 },
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

function row(name, ao, cmp) {
  const bound = ao ? BOUNDS.ao : BOUNDS.noao
  const pct = (100 * cmp.diff) / cmp.pixels
  const pass = pct <= 100 * bound.frac && cmp.max <= bound.max
  return {
    sample: name,
    ao,
    diff: cmp.diff,
    pct,
    max: cmp.max,
    pixels: cmp.pixels,
    bound: `≤ ${100 * bound.frac} % / ≤ ${bound.max}`,
    pass,
  }
}

function printTable(rows) {
  const w = Math.max(6, ...rows.map((r) => r.sample.length))
  const line = (s, ao, d, p, m, b, ok) =>
    `${s.padEnd(w)} | ${ao.padEnd(3)} | ${d.padStart(7)} | ${p.padStart(7)} | ${m.padStart(5)} | ${b.padEnd(13)} | ${ok}`
  console.log(line('sample', 'ao', 'diff px', 'diff %', 'max Δ', 'bound', 'pass'))
  console.log(`${'-'.repeat(w)}-|-----|---------|---------|-------|---------------|-----`)
  for (const r of rows) {
    console.log(
      line(r.sample, r.ao ? 'on' : 'off', String(r.diff), r.pct.toFixed(2), String(r.max), r.bound, r.pass ? 'ok' : 'FAIL'),
    )
  }
}

async function main() {
  const cfg = loadConfig()
  const objOnly = process.argv.includes('--obj-only')
  mkdirSync(OUT, { recursive: true })
  console.log(`config: ${cfg.source}`)

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

    const judge = async (name, ao, result) => {
      const file = join(BASELINE, `${name}_C0.png`)
      if (!existsSync(file)) throw new Error(`no baseline for ${name}: ${file}`)
      const baseline = dataUrl(readFileSync(file))
      const cmp = await compare(baseline, result.pngDataUrl)
      writeFileSync(join(OUT, `${name}.png`), bytesOf(result.pngDataUrl))
      const sheet = await page.evaluate(
        ([cells, title]) => window.ab.sheet(cells, title),
        [
          [
            { label: 'C0 baseline', pngDataUrl: baseline },
            { label: 'current', pngDataUrl: result.pngDataUrl },
          ],
          name,
        ],
      )
      writeFileSync(join(OUT, `sheet_${name}.png`), bytesOf(sheet))
      const r = row(name, ao, cmp)
      rows.push(r)
      return r
    }

    // ---- STL samples: the framing C0 used, re-expressed in the file convention.
    // A recorded scene axis A becomes migrateAxis(A); a stored camera is
    // unchanged (its basis and the camera pass through R⁻¹ together, D3); a
    // pose goes through cameraForPose exactly as the app does today, and is
    // checked against the az/el the record says C0 rendered at.
    for (const rec of stlReason === null ? record.results : []) {
      const path = rec.sample.replace(/-noao$/, '')
      const name = slug(rec.sample)
      const entry = byPath.get(path)
      if (entry === undefined) {
        skipped.push(`${name}: ${path} is not in the listing at /`)
        continue
      }
      const expectedAxis = await migrate(rec.c0Axis)
      let opts
      let how
      if (rec.storedCamera !== null) {
        opts = { path, format: 'stl', axis: expectedAxis, camera: rec.storedCamera, ao: rec.ao }
        how = 'stored camera'
      } else if (entry.pose != null) {
        opts = { path, format: 'stl', pose: entry.pose, ao: rec.ao }
        how = 'pose via cameraForPose'
      } else {
        opts = { path, format: 'stl', axis: expectedAxis, camera: rec.c0Camera, ao: rec.ao }
        how = 'no pose in the listing; replayed the recorded camera'
      }
      const t = Date.now()
      const result = await render(opts)
      const ms = Date.now() - t
      const framing = []
      if (result.axis !== expectedAxis) framing.push(`axis ${result.axis}, record ${rec.c0Axis}→${expectedAxis}`)
      if (angleDiff(result.camera.az, rec.c0Camera.az) > 1e-6) framing.push(`az ${result.camera.az}, record ${rec.c0Camera.az}`)
      if (Math.abs(result.camera.el - rec.c0Camera.el) > 1e-6) framing.push(`el ${result.camera.el}, record ${rec.c0Camera.el}`)
      if (Math.abs(result.camera.distR - rec.c0Camera.distR) > 1e-9) framing.push(`distR ${result.camera.distR}, record ${rec.c0Camera.distR}`)
      const r = await judge(name, rec.ao, result)
      r.how = how
      r.ms = ms
      if (framing.length > 0) {
        r.framingMismatch = framing
        notes.push(`${name}: framing differs from the record — ${framing.join('; ')}`)
      }
    }

    // ---- The OBJ fixture: never baked, so its axis keeps its name and the
    // default camera the baseline was framed with gains swapOffset(axis) —
    // what the D5 migration does to a stored OBJ camera (0 at `y`, +90° at `z`).
    const objText = readFileSync(join(BASELINE, 'lbracket.obj'), 'utf8')
    for (const axis of ['y', 'z']) {
      const camera = { ...defaultCamera, az: defaultCamera.az + (await offset(axis)) }
      for (const ao of [true, false]) {
        const name = `OBJ_axis_${axis}${ao ? '' : '-noao'}`
        const t = Date.now()
        const result = await render({ path: 'frame-ab:lbracket.obj', format: 'obj', text: objText, axis, camera, ao })
        const r = await judge(name, ao, result)
        r.how = `default camera + swapOffset(${axis})`
        r.ms = Date.now() - t
      }
    }

    console.log('')
    printTable(rows)
    for (const s of skipped) console.log(`skipped: ${s}`)
    for (const n of notes) console.log(`note: ${n}`)
    if (errors.length > 0) console.log(`page errors: ${JSON.stringify(errors)}`)
    writeFileSync(
      join(OUT, 'results.json'),
      JSON.stringify({ when: new Date().toISOString(), config: cfg, stlReason, rows, skipped, notes, errors }, null, 2),
    )
    const failed = rows.filter((r) => !r.pass)
    console.log(
      `${rows.length} rows, ${failed.length} failed${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}; renders in ${OUT}`,
    )
    process.exitCode = failed.length > 0 ? 1 : 0
  } finally {
    if (browser !== undefined) await browser.close()
    vite.stop()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
