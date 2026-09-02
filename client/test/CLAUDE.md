# client tests

- Component tests: `// @vitest-environment happy-dom` pragma, render with plain react-dom
  (no testing-library), vi.mock `three/renderer` (no WebGL in tests) — see orbitHandoff.test.tsx
- App-mount tests (flatToggle, listingSkeleton, flatToggleInFlightTarget) share
  `appHarness.tsx`: `mountApp`/`unmountApp`, one `listDir` mock, and query helpers. `vi.mock`
  is hoisted so each file still declares the two mocks, resolving their factories through the
  harness (`(await import('./appHarness')).apiClientModule()`); the harness must not statically
  import App or the factories would cycle
- Renderer mocks: spread `...(await importOriginal<typeof import('../src/three/renderer')>())`
  and override only what the test drives — hand-listed factories go stale on new exports, and a
  stubbed `stageModel` fails as `Cannot destructure property 'pivot' of undefined`
- Never re-declare RIG_VERSION's value in a mock — a literal silently masks a bump (rig.test.ts
  pins the expected value; everywhere else tracks it via the spread)
- `main button` is not "a tile" — the results header carries controls too. Use the harness's
  `tiles()` (`main .grid button`); a looser selector reports affordances as entries
- Preference modules (`aoToggle.ts`, `lib/searchOptions.ts`) hold state in a
  module closure: `localStorage.clear()` does not reset them and tests inherit each other's
  settings. Reset via their setters in `beforeEach`, or re-import after `vi.resetModules()`
- Lighting is no longer a preference: the rig is fixed in camera space and
  `THUMB_LIGHTING` (three/renderer.ts, beside `RIG_VERSION`) is the one value a client can
  write into a thumbnail's `lighting` label. Assert it through the constant, never a
  literal — and never mock a cache hit as `lighting: 'axis'` to mean "the current mode":
  `'axis'` is the retired label and now reads as *stale*, which silently inverts a test
  that asserts a hit with no render into one that asserts a re-render loop it wanted absent
- Reading a source file as text: the client workspace has no `@types/node`, so `node:fs`
  does not typecheck, and happy-dom replaces global `URL` (so `fileURLToPath(new URL(...))`
  fails "must be of scheme file"). Import it through Vite instead — `import CSS from
  '../src/index.css?raw'` — which needs `test: { css: true }` in vite.config.ts, since
  vitest otherwise stubs every CSS import, `?raw` included, to an empty string
- The harness stubs `URL` for object URLs, so `history.back()` throws "URL is not a
  constructor" — play the browser instead: `replaceState` then dispatch `PopStateEvent`
  (urlLightbox.test.tsx)
- `mountApp(bootPath, listing)` does not clear the URL — it *writes* one,
  `/?path=<bootPath>` via `replaceState` (the parameter was `lastPath` before library-root):
  the URL is now the only way to open anywhere but the library's top, so a test that wants
  a boot elsewhere gets it through that parameter. `mountAppAtCurrentUrl(url, listing)` is
  the deep-link entry — it replaces the whole URL, `'/'` included, which is how the boot
  with no path named is asserted
- **Render *order* is observable only while both queue slots are held.** App's
  `RenderQueue` is two wide, so with two free slots the first two pushed jobs start in push
  order whatever their rank — an app-mount cell asserting "x renders before y" over two or
  three tiles passes or fails by lookup-resolution luck (two such cells did pass, and
  falsifying against a broken variant is what caught them). `folderSheets.test.tsx` has the
  pattern: `holdSlots()` hangs two blocker renders, `gateThumbs().open([...paths])` releases
  lookups in a chosen order, and the cell stages a push order that *contradicts* the rank it
  asserts, so it can only pass if rank decided. Hook-level cells (`thumbnailQueue.test.tsx`)
  get the same guarantee more simply: `queue.suspend()` before the pushes, `resume()` after
