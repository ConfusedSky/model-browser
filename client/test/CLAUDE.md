# client tests

- Component tests: `// @vitest-environment happy-dom` pragma, render with plain react-dom
  (no testing-library), vi.mock `three/renderer` (no WebGL in tests) — see orbitHandoff.test.tsx
- App-mount tests (flatToggle, listingSkeleton, flatToggleInFlightTarget) share
  `appHarness.tsx`: `mountApp`/`unmountApp`, one `listDir` mock, and query helpers. `vi.mock`
  is hoisted so each file still declares the two mocks, resolving their factories through the
  harness (`(await import('./appHarness')).apiClientModule()`); the harness must not statically
  import App or the factories would cycle
- Import `./appHarness` **before** any `../src/...` module in an app-mount test (the
  existing files do; bakePill.test.tsx did not, 2026-09-11). With `../src/three/renderer`
  imported first, its mock factory is what loads the harness, and the app's own importers
  (`entryActions`' `renderThumbnail`) then get the *real* renderer — the harness spy counts
  nothing while "Error creating WebGL context" prints — even though the test's own
  `renderer` import is the spy. Probed with the harness moved to the top: the spy counts
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
- The thumbnail lookup queue is module-level and ranked (`useThumbnails`'
  `lookupQueue`), and the render queue's far gate reads it: a lookup whose per-cell mock
  never resolves stays pending for the life of the module and closes the gate in every
  later cell of that file. Call `resetLookupQueueForTests()` in `beforeEach` of any
  file that mounts App or the hook and asserts render order or far-gate behaviour
  (`thumbnailQueue.test.tsx`, `folderSheets.test.tsx` do)
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
- The harness stubs `URL` for object URLs **as a subclass with two statics overridden**,
  never as a spread copy: happy-dom parses every `<img src>` with the global `URL`, and a
  stub that is not a constructor makes that parse throw, which happy-dom answers by firing
  the image's `error` synchronously on mount — every listing-drawn tile demoted itself to
  the lookup before the cell could look (`thumbnail-image-serving` 5.3). The spread copy
  also made `history.back()` throw "URL is not a constructor"; the existing tests still
  play the browser instead — `replaceState` then dispatch `PopStateEvent`
  (urlLightbox.test.tsx) — and should keep to that. happy-dom fires `load` for no image
  URL (`enableImageFileLoading` is off), so a cell about a lazily loaded picture arriving
  has to synthesize the event
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
