// Shared harness for App-mount component tests (flatToggle, listingSkeleton,
// flatToggleInFlightTarget): the api/renderer module mocks, the mount/unmount
// lifecycle, and the query helpers those files would otherwise repeat.
//
// vi.mock is hoisted per test file, so each file still declares the two mocks —
// but resolves their factories through this module, sharing one `listDir`:
//   vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
//   vi.mock('../src/three/renderer', async (importOriginal) =>
//     (await import('./appHarness')).rendererModule(importOriginal))
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { DirEntry, DirListing } from '../../shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export const listDir = vi.fn()
// Shared (not per-instance) so tests can assert thumbnails are untouched —
// e.g. typing a filter keystroke must not re-trigger useThumbnails' lookups.
// mountApp clears it, so counts are still test-scoped.
export const getThumb = vi.fn().mockResolvedValue({ status: 'miss' })
// Shared so lightbox tests can assert the close path persisted (settle →
// snapshot → putThumb); cleared per mount like getThumb.
export const putThumb = vi.fn().mockResolvedValue(undefined)
// The semantic index is a separate service; the default is the state most
// machines are in — not running — so a test opts *into* it existing.
export const indexAvailability = vi.fn().mockResolvedValue({ state: 'absent' })
// The library's state (library R4). The default is `ready`, unlike the two
// stubs above: an absent index and an empty launch registry are ordinary states
// a machine sits in, whereas a library that is not there is the state in which
// *nothing* renders — so it is the one a test opts into, and every test written
// before the library existed goes on seeing the grid it was written against.
// `top` is `/lib` so an expanded path is visibly different from the library path
// it came from; `root` is `/`, the app opening at the library's top.
export const library = vi
  .fn()
  .mockResolvedValue({ state: 'ready', id: 'test', top: '/lib', root: '/' })
// Shared (like listDir) so a test can assert *how* a thumbnail was rendered —
// the camera and axis a pose produced, not just that pixels appeared.
export const renderThumbnail = vi.fn(() => Promise.resolve(new Blob()))
export const semanticSearch = vi.fn()
// The platform's launch registry. The default is the state a machine with no
// slicers and no configured chooser is in — no applications, no chooser — so a
// test opts *into* the row and the item existing, and every test written before
// this feature sees the menu it was written against.
export const apps = vi.fn().mockResolvedValue({ chooser: false, types: {} })
// Named `openApp` rather than `open`: `open` is a global in a DOM environment,
// and the shadowing reads as a mistake at every call site.
export const openApp = vi.fn().mockResolvedValue(undefined)
export const openWith = vi.fn().mockResolvedValue(undefined)
// A model's neighbours. Shared like `semanticSearch`, and left unconfigured by
// default so a test that does not opt in fails loudly rather than silently
// resolving `undefined`.
export const similar = vi.fn()

/** A minimal valid binary STL (one facet) — enough for parseModel to build a real mesh. */
export function tinyStl(): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50)
  const dv = new DataView(buf)
  dv.setUint32(80, 1, true)
  const f = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
  f.forEach((v, i) => dv.setFloat32(84 + i * 4, v, true))
  return buf
}

// App constructs HttpApiClient itself (D1 keeps all I/O behind it), so the
// module is the seam — there is no prop to inject a fake through.
export function apiClientModule(): Record<string, unknown> {
  return {
    // Carries `status`, because it is the contract for at least one failure: a
    // 404 from the similar call means "this model is not embedded", and the app
    // chooses its sentence from the code rather than from the index's words. A
    // statusless stub would let that dispatch pass by accident.
    // Carries `state` beside `status` for the same reason: a 503 from a path
    // route names the library's state, and App reads that field to decide
    // whether to re-probe. A stateless stub would let that branch pass by
    // accident.
    HttpError: class extends Error {
      constructor(
        readonly status: number,
        message: string,
        readonly state?: string,
      ) {
        super(message)
      }
    },
    HttpApiClient: class {
      listDir = listDir
      complete = vi.fn().mockResolvedValue([])
      fetchModel = vi.fn().mockImplementation(() => Promise.resolve(tinyStl()))
      getThumb = getThumb
      putThumb = putThumb
      indexAvailability = indexAvailability
      library = library
      semanticSearch = semanticSearch
      similar = similar
      apps = apps
      open = openApp
      openWith = openWith
    },
  }
}

// Spread the real module and override only what needs WebGL: everything else
// (staging, RIG_VERSION) stays real, so a future test here can open a viewer.
export async function rendererModule(
  importOriginal: () => Promise<typeof import('../src/three/renderer')>,
): Promise<typeof import('../src/three/renderer')> {
  return {
    ...(await importOriginal()),
    renderThumbnail,
    getRenderer: () =>
      ({
        setSize: () => {},
        render: () => {},
        domElement: document.createElement('canvas'),
      }) as unknown as ReturnType<typeof import('../src/three/renderer').getRenderer>,
    // ViewerSession.render() reaches the live post-process chain through this
    // export; a real one would build an EffectComposer on a real GL context.
    getLiveChain: () =>
      ({ render: () => {} }) as unknown as ReturnType<
        typeof import('../src/three/renderer').getLiveChain
      >,
  }
}

export function dirEntry(path: string): DirEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', size: 0, mtime: 1 }
}
export function modelEntry(path: string): DirEntry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    kind: 'model',
    format: 'stl',
    size: 1,
    mtime: 1,
  }
}
/** A /models-rooted dir whose `name` is given verbatim. */
export function dir(name: string): DirEntry {
  return { name, path: `/models/${name}`, kind: 'dir', size: 0, mtime: 1 }
}
/** A /models-rooted model; flat listings name models by relative path, so `name` may contain '/'. */
export function model(name: string): DirEntry {
  return { name, path: `/models/${name}`, kind: 'model', format: 'stl', size: 1, mtime: 1 }
}

export let container: HTMLElement
let root: Root | null = null

export const wait = (ms: number): Promise<void> =>
  act(() => new Promise<void>((r) => setTimeout(r, ms)))
export const settle = (): Promise<void> => wait(20)
export const click = (el: HTMLElement): Promise<void> => act(async () => el.click())

/** Native setter + input event — a plain `el.value =` is masked by React's value tracker. */
export const type = (el: HTMLInputElement, value: string): Promise<void> =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
export const pressEnter = (el: HTMLElement): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })

export function flatButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[aria-pressed]')!
}
export function upButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Parent directory"]')!
}
export function tiles(): HTMLButtonElement[] {
  // The grid's buttons, not every button under `main` — the results header now
  // carries a control of its own, and a selector that cannot tell a tile from
  // an affordance beside it reports the affordance as an entry.
  return Array.from(container.querySelectorAll<HTMLButtonElement>('main .grid button'))
}
/** Each tile's label is the last child of its button. */
export function labels(): string[] {
  return tiles().map((b) => b.lastElementChild?.textContent ?? '')
}
export function skeleton(): Element | null {
  return container.querySelector('.animate-pulse')
}
export function pathInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[placeholder="Type a directory path…"]')!
}
export function searchInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[aria-label="Search names and folders"]')!
}
/** The summoned find control's input — absent until it is opened. */
export function findInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[aria-label="Narrow these by name"]')
}
/** Open the find control the way a user does. */
export async function openFind(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  })
}
/**
 * The corner occlusion pill. Selected by its title, not by `aria-pressed`:
 * `flatButton()` claims the first `[aria-pressed]` in the container, and this
 * one carries the attribute too.
 */
export function aoPill(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[title^="Ambient occlusion"]')!
}
export function deepButton(): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('header button')).find(
    (b) => b.textContent === 'Deep',
  )!
}

async function mount(initial: DirListing): Promise<void> {
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:m', revokeObjectURL: () => {} })
  listDir.mockReset()
  listDir.mockResolvedValue(initial)
  getThumb.mockClear()
  putThumb.mockClear()
  // Cleared before the render, so the count a test reads afterwards is the
  // session's own one reading of the registry and nothing left over — which is
  // exactly the count "raising a menu fires no fetch" is measured against.
  apps.mockClear()
  // Cleared before the render like `apps`, so a count read afterwards is this
  // session's own — one boot probe, plus whatever the test provoked.
  library.mockClear()
  openApp.mockClear()
  openWith.mockClear()
  // The persist chain decodes its PNG via createImageBitmap, which happy-dom
  // lacks — a resolving stub lets the close path run through to putThumb.
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ close() {} }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // Dynamic so this module's static graph excludes App: the mock factories
  // import this module, and a static App import would cycle through them.
  const { default: App } = await import('../src/App')
  await act(async () => {
    root!.render(<App />)
  })
  await settle()
}

/**
 * Mount with the app opening at `bootPath`.
 *
 * Seeded through the URL, because under `library-root` that is the only way to
 * open anywhere but the library's top: the boot view is `/` (design D2/D7) and
 * the last-path read `resolveView` used to start from is gone. The resulting
 * address bar and `history.length` are what a boot from the old storage seed
 * produced anyway — the seed was written with `replaceState`, not a push — so
 * this is the same starting position by a supported route.
 */
export async function mountApp(bootPath: string, initial: DirListing): Promise<void> {
  // The app writes navigation state into the URL; happy-dom's location
  // persists across tests in a file, so every mount starts from a clean one.
  window.history.replaceState(null, '', `/?path=${encodeURIComponent(bootPath)}`)
  await mount(initial)
}

/** Mount with a URL already in place — the deep-link boot path (url-navigation D4). */
export async function mountAppAtCurrentUrl(url: string, initial: DirListing): Promise<void> {
  window.history.replaceState(null, '', url)
  await mount(initial)
}

export async function unmountApp(): Promise<void> {
  // Reset on teardown, not on mount: the index's availability is read during
  // mount, so a test has to be able to configure it *before* mounting.
  indexAvailability.mockResolvedValue({ state: 'absent' })
  // Same rule again: the state is read during mount, so a test configures it
  // before mounting and the ready default is restored on the way out.
  library.mockResolvedValue({ state: 'ready', id: 'test', top: '/lib', root: '/' })
  // Same rule as the index's, and for the same reason: the report is read
  // during mount, so a test configures it *before* mounting and the default is
  // restored on the way out.
  apps.mockResolvedValue({ chooser: false, types: {} })
  openApp.mockResolvedValue(undefined)
  openWith.mockResolvedValue(undefined)
  semanticSearch.mockReset()
  similar.mockReset()
  renderThumbnail.mockClear()
  await act(async () => {
    root?.unmount()
  })
  container.remove()
  root = null
  localStorage.clear()
  vi.unstubAllGlobals()
}
