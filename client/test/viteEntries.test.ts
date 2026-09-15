// The About page is a second document of the *build*, not a route
// (`landing-page` D2), so its existence rests on one object in
// `client/vite.config.ts`. Dropping that entry breaks nothing locally — Vite's
// dev server happily serves any `.html` under `client/` — and fails only on a
// deployment, where `/about.html` misses and `createStaticHandler`'s fallback
// answers the app's own document with a 200. That is an invisible failure, so
// it is asserted here instead.
//
// The config is read as text rather than imported: importing it would evaluate
// `fileURLToPath`, and this cell is about what the file *says*, which is the
// thing a future edit can quietly change. `?raw` comes through Vite for the
// reason chromeLayers.test.tsx reads index.css that way — this workspace has no
// @types/node and happy-dom replaces the global `URL`.
import { describe, expect, it } from 'vitest'
import CONFIG from '../vite.config.ts?raw'

/** The body of `rollupOptions.input`, or null if the config has no such key. */
function inputBlock(): string | null {
  const found = /rollupOptions:\s*\{[\s\S]*?input:\s*\{([\s\S]*?)\}/.exec(CONFIG)
  return found?.[1] ?? null
}

describe('the client build has two entries', () => {
  it('reads the config as text at all', () => {
    // Guards the mechanism before the assertions that rest on it: were `?raw`
    // stubbed to an empty string, every `toContain` below would fail for a
    // reason that has nothing to do with the entries.
    expect(CONFIG).toContain('defineConfig')
  })

  it('names both index.html and about.html under rollupOptions.input', () => {
    const block = inputBlock()
    expect(block).not.toBeNull()
    expect(block).toContain('index.html')
    expect(block).toContain('about.html')
  })
})
