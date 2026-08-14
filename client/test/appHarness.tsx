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

// App constructs HttpApiClient itself (D1 keeps all I/O behind it), so the
// module is the seam — there is no prop to inject a fake through.
export function apiClientModule(): Record<string, unknown> {
  return {
    HttpError: class extends Error {},
    HttpApiClient: class {
      listDir = listDir
      complete = vi.fn().mockResolvedValue([])
      fetchModel = vi.fn()
      getThumb = vi.fn().mockResolvedValue({ status: 'miss' })
      putThumb = vi.fn().mockResolvedValue(undefined)
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

export function flatButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[aria-pressed]')!
}
export function upButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Parent directory"]')!
}
export function tiles(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('main button'))
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

export async function mountApp(lastPath: string, initial: DirListing): Promise<void> {
  localStorage.setItem('model-browser:last-path', lastPath)
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:m', revokeObjectURL: () => {} })
  listDir.mockReset()
  listDir.mockResolvedValue(initial)
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

export async function unmountApp(): Promise<void> {
  await act(async () => {
    root?.unmount()
  })
  container.remove()
  root = null
  localStorage.clear()
  vi.unstubAllGlobals()
}
