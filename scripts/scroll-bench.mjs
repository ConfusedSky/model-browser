/**
 * How the tile grid scrolls on a phone-sized, CPU-throttled browser — the
 * bench behind `grid-virtualization` D14. Point it at a production build
 * (`bun run preview:remote-demo`, or the demo itself); 5173 is Vite's dev
 * build and says nothing about speed.
 *
 *   node scripts/scroll-bench.mjs <url> [--runs N] [--cpu R] [--swipes N] [--json]
 *
 * Always headless: CDP touch events scroll a headless page and do nothing to
 * a headed one.
 */
import { findChrome, findModule } from './playwright-found.mjs'

const USAGE = 'usage: node scripts/scroll-bench.mjs <url> [--runs N] [--cpu R] [--swipes N] [--json]'
const args = process.argv.slice(2)
const url = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(runs|cpu|swipes)$/))
const num = (flag, fallback) => {
  const i = args.indexOf(flag)
  if (i === -1) return fallback
  const n = Number(args[i + 1])
  if (!(n > 0)) {
    console.error(`${flag} needs a positive number\n${USAGE}`)
    process.exit(1)
  }
  return n
}
const runs = num('--runs', 1)
const cpu = num('--cpu', 4)
const swipes = num('--swipes', 12)
const json = args.includes('--json')
if (!url) {
  console.error(USAGE)
  process.exit(1)
}

const modulePath = findModule()
const CHROME = findChrome()
if (modulePath === null || CHROME === null) {
  console.error(
    'needs a Playwright install this repo does not carry:\n' +
      '  npx playwright install chromium   (downloads both the library and the browser)',
  )
  process.exit(2)
}
const { chromium } = await import(modulePath)

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

async function run() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelectorAll('main [data-entry-tile]').length > 0)
  await page.waitForTimeout(2000)

  const events = []
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value))
  // RunTask is only emitted under the disabled-by-default category; without it
  // the trace holds the page's own events and no task boundaries.
  await cdp.send('Tracing.start', {
    traceConfig: {
      includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'],
    },
    transferMode: 'ReportEvents',
  })
  await page.evaluate(() => {
    window.__frames = []
    let last = performance.now()
    const tick = (t) => {
      window.__frames.push(t - last)
      last = t
      if (!window.__stopFrames) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  // Drag in the scroller's left padding, never on a tile: a press on a
  // model's orbit zone orbits instead of scrolling.
  const x = 5
  const y0 = 700
  const dy = 450
  for (let s = 0; s < swipes; s++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y0 - (dy * i) / 8 }],
      })
      await page.waitForTimeout(12)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(1000)

  const { frames, scrolled, tiles } = await page.evaluate(() => {
    window.__stopFrames = true
    return {
      // The first delta runs from the recorder's install, not from a frame.
      frames: window.__frames.slice(1),
      scrolled: document.querySelector('main').scrollTop,
      tiles: document.querySelectorAll('main [data-entry-tile]').length,
    }
  })
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.end')
  await done
  await ctx.close()

  const sorted = [...frames].sort((a, b) => a - b)
  const q = (f) => +sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))].toFixed(1)
  return {
    frames: frames.length,
    p50: q(0.5),
    p95: q(0.95),
    over33: frames.filter((d) => d > 33).length,
    over100: frames.filter((d) => d > 100).length,
    mainMs: Math.round(mainThreadBusy(events)),
    scrolled: Math.round(scrolled),
    tiles,
  }
}

// The trace spans every process, so count only the renderer main thread of the
// process that hosts the page's top frame; a nested RunTask is already inside
// its parent's duration.
function mainThreadBusy(events) {
  const started = events.find((e) => e.name === 'TracingStartedInBrowser')
  const top = started?.args?.data?.frames?.find((f) => !f.parent)
  const threads = events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
  const main = threads.find((e) => e.pid === top?.processId) ?? threads[0]
  if (!main) return NaN
  const tasks = events
    .filter((e) => e.ph === 'X' && e.name === 'RunTask' && e.pid === main.pid && e.tid === main.tid)
    .sort((a, b) => a.ts - b.ts)
  let total = 0
  let end = -Infinity
  for (const t of tasks) {
    if (t.ts >= end) {
      total += t.dur
      end = t.ts + t.dur
    }
  }
  return total / 1000
}

const results = []
for (let i = 0; i < runs; i++) results.push({ run: i + 1, ...(await run()) })
await browser.close()

if (json) {
  console.log(JSON.stringify({ url, cpu, swipes, results }, null, 1))
} else {
  const cols = [
    ['run', 'run'],
    ['frames', 'frames'],
    ['p50', 'p50 ms'],
    ['p95', 'p95 ms'],
    ['over33', '>33 ms'],
    ['over100', '>100 ms'],
    ['mainMs', 'main ms'],
    ['scrolled', 'scrolled px'],
    ['tiles', 'tiles'],
  ]
  const rows = [cols.map(([, h]) => h), ...results.map((r) => cols.map(([k]) => String(r[k])))]
  const widths = cols.map((_, c) => Math.max(...rows.map((r) => r[c].length)))
  console.log(`${url}  cpu ${cpu}x  ${swipes} swipes`)
  for (const r of rows) console.log(r.map((v, c) => v.padStart(widths[c])).join('  '))
}
