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
export const semanticSearch = vi.fn()

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
    HttpError: class extends Error {},
    HttpApiClient: class {
      listDir = listDir
      complete = vi.fn().mockResolvedValue([])
      fetchModel = vi.fn().mockImplementation(() => Promise.resolve(tinyStl()))
      getThumb = getThumb
      putThumb = putThumb
      indexAvailability = indexAvailability
      semanticSearch = semanticSearch
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
    renderThumbnail: vi.fn(() => Promise.resolve(new Blob())),
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

export async function mountApp(lastPath: string, initial: DirListing): Promise<void> {
  // The app writes navigation state into the URL; happy-dom's location
  // persists across tests in a file, so every mount starts from a clean one.
  window.history.replaceState(null, '', '/')
  localStorage.setItem('model-browser:last-path', lastPath)
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
  semanticSearch.mockReset()
  await act(async () => {
    root?.unmount()
  })
  container.remove()
  root = null
  localStorage.clear()
  vi.unstubAllGlobals()
}
