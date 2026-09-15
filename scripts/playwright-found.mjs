/**
 * Where a Playwright lives on this machine — found, never installed.
 *
 * Playwright is deliberately not a dependency of this repo — that it is not is
 * half of what `webp-thumbnails` 3.1b decided — so both halves of it are found
 * rather than installed: the library from whatever copy `npx` has already
 * downloaded (`~/.npm/_npx`), and the browser from Playwright's own cache
 * (`~/.cache/ms-playwright`), newest build first. Each answers `null` when
 * nothing is there; what to say about that is the caller's (`encoder-probe.mjs`
 * exits 2 naming `npx playwright install chromium`, which downloads both).
 *
 * Shared by `encoder-probe.mjs` and `bake-demo.ts` (corpus-bake D1).
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The `playwright-core` ESM entry of the first npx cache entry that holds one. */
export function findModule() {
  const npx = join(homedir(), '.npm/_npx')
  if (!existsSync(npx)) return null
  for (const dir of readdirSync(npx)) {
    const entry = join(npx, dir, 'node_modules/playwright-core/index.mjs')
    if (existsSync(entry)) return entry
  }
  return null
}

/** The newest Chromium build's binary under Playwright's browser cache. */
export function findChrome() {
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
