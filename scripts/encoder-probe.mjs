/**
 * What the browser's own encoder does to a thumbnail's alpha, and what it
 * costs — the check behind `model-viewer`'s transparency scenarios and
 * `webp-thumbnails` D1/D6, which no cell in this repo can make: the client
 * suite runs on happy-dom, and `composer.test.ts` mocks `WebGLRenderer` away,
 * so nothing there has ever produced a real pixel.
 *
 *   node scripts/encoder-probe.mjs                     # the encoder alone
 *   node scripts/encoder-probe.mjs --url http://localhost:8080
 *                                                      # …and a stored render
 *
 * Two checks. The **encoder** one needs nothing running: it paints an alpha
 * ramp and an anti-aliased disc on a canvas, puts it through
 * `canvas.toBlob('image/webp', 0.8)` — the call `renderThumbnail` makes — and
 * decodes the result back, so a browser that silently answers PNG (the HTML
 * spec's fallback, which WebKit ships) or lossy alpha fails here rather than
 * in a user's cache. The **stored** one, given a running app, fetches a
 * thumbnail from the image route and censuses the pixels the pipeline actually
 * produced end to end.
 *
 * Recorded run (2026-09-07, this repo's dev machine, bundled Chromium 1228
 * headless, against the demo box through an SSH tunnel):
 *
 *   encoder  image/webp, 2,396 B for 256² — every one of the 256 alpha levels
 *            came back unchanged (max Δ0) and no transparent pixel turned opaque
 *   stored   image/webp, 7,248 B, 256² — 54,061 transparent · 6,858 opaque ·
 *            4,617 partial · 4/4 corners transparent
 *
 * Re-run it when the encoder, its quality, `THUMB_SIZE` or `RIG_VERSION`
 * change; it gates nothing, so nothing runs it for you.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Playwright is deliberately not a dependency of this repo — that it is not is
 * half of what 3.1b decided — so both halves of it are found rather than
 * installed: the library from whatever copy `npx` has already downloaded, and
 * the browser from Playwright's own cache, newest first.
 */
function findModule() {
  const npx = join(homedir(), '.npm/_npx')
  if (!existsSync(npx)) return null
  for (const dir of readdirSync(npx)) {
    const entry = join(npx, dir, 'node_modules/playwright-core/index.mjs')
    if (existsSync(entry)) return entry
  }
  return null
}

function findChrome() {
  const cache = join(homedir(), '.cache/ms-playwright')
  if (!existsSync(cache)) return null
  const builds = readdirSync(cache)
    .filter((d) => d.startsWith('chromium-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const build of builds) {
    for (const layout of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const bin = join(cache, build, layout)
      if (existsSync(bin)) return bin
    }
  }
  return null
}

const url = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : undefined

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

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()
// A page is needed even for the encoder check: `toBlob` and `createImageBitmap`
// are the browser's, and about:blank is enough of a document to hold a canvas.
await page.goto(url ?? 'about:blank')

const encoder = await page.evaluate(async () => {
  const SIZE = 256
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const ctx = c.getContext('2d')
  // An alpha ramp — every one of the 256 levels, one per column — plus an
  // anti-aliased disc, so both the exact levels and a real soft edge are under
  // test. Colour is deliberately saturated: chroma subsampling is worst there.
  for (let x = 0; x < SIZE; x++) {
    ctx.fillStyle = `rgba(220, 30, 30, ${x / (SIZE - 1)})`
    ctx.fillRect(x, 0, 1, SIZE / 2)
  }
  ctx.beginPath()
  ctx.arc(SIZE / 2, (SIZE * 3) / 4, SIZE / 5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgb(40, 90, 200)'
  ctx.fill()
  const before = ctx.getImageData(0, 0, SIZE, SIZE).data

  const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.8))
  const bmp = await createImageBitmap(blob)
  const back = document.createElement('canvas')
  back.width = back.height = SIZE
  const bctx = back.getContext('2d')
  bctx.drawImage(bmp, 0, 0)
  const after = bctx.getImageData(0, 0, SIZE, SIZE).data

  let alphaMismatch = 0, maxAlphaDelta = 0, transparentTurnedOpaque = 0
  for (let i = 3; i < before.length; i += 4) {
    const d = Math.abs(before[i] - after[i])
    if (d !== 0) { alphaMismatch++; maxAlphaDelta = Math.max(maxAlphaDelta, d) }
    if (before[i] === 0 && after[i] !== 0) transparentTurnedOpaque++
  }
  return {
    type: blob.type, bytes: blob.size, size: [bmp.width, bmp.height],
    alphaMismatch, maxAlphaDelta, transparentTurnedOpaque,
  }
})

const verdicts = []
verdicts.push(['encoder answers the format asked for', encoder.type === 'image/webp', encoder.type])
verdicts.push(['alpha survives the encoder unchanged', encoder.alphaMismatch === 0,
  `${encoder.alphaMismatch} pixels differ, max Δ${encoder.maxAlphaDelta}`])
verdicts.push(['transparent stays transparent', encoder.transparentTurnedOpaque === 0,
  `${encoder.transparentTurnedOpaque} turned opaque`])
console.log(`encoder  ${encoder.type}  ${encoder.bytes} B for ${encoder.size.join('×')}`)

if (url !== undefined) {
  const stored = await page.evaluate(async () => {
    // Whatever the app is drawing: the tile's own image URL is the render the
    // pipeline stored, which is the artifact the scenarios are about.
    const deadline = Date.now() + 20000
    let src
    while (Date.now() < deadline) {
      src = [...document.querySelectorAll('img')].map((i) => i.src)
        .find((s) => s.includes('/api/thumb/image'))
      if (src !== undefined) break
      await new Promise((r) => setTimeout(r, 500))
    }
    if (src === undefined) return { error: 'no cached thumbnail on this page' }
    const blob = await (await fetch(src, { cache: 'reload' })).blob()
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let transparent = 0, opaque = 0, partial = 0, corners = 0
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i]
      if (a === 0) transparent++
      else if (a === 255) opaque++
      else partial++
    }
    for (const [x, y] of [[0, 0], [bmp.width - 1, 0], [0, bmp.height - 1], [bmp.width - 1, bmp.height - 1]]) {
      if (d[(y * bmp.width + x) * 4 + 3] === 0) corners++
    }
    return { type: blob.type, bytes: blob.size, size: [bmp.width, bmp.height], transparent, opaque, partial, corners }
  })
  if (stored.error !== undefined) {
    console.log(`stored   ${stored.error}`)
  } else {
    console.log(`stored   ${stored.type}  ${stored.bytes} B  ${stored.size.join('×')}  ` +
      `${stored.transparent} transparent · ${stored.opaque} opaque · ${stored.partial} partial`)
    verdicts.push(['stored render is the format the route claims', stored.type === 'image/webp', stored.type])
    verdicts.push(['background is fully transparent at every corner', stored.corners === 4, `${stored.corners}/4`])
    verdicts.push(['silhouette keeps its anti-aliased edge', stored.partial > 0, `${stored.partial} partial-alpha pixels`])
  }
}

await browser.close()
let failed = 0
for (const [claim, ok, detail] of verdicts) {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${claim} — ${detail}`)
}
process.exit(failed === 0 ? 0 : 1)
