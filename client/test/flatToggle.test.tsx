// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing } from '../../shared/types'

const listDir = vi.fn()

// App constructs HttpApiClient itself (D1 keeps all I/O behind it), so the
// module is the seam — there is no prop to inject a fake through.
vi.mock('../src/api/client', () => ({
  HttpError: class extends Error {},
  HttpApiClient: class {
    listDir = listDir
    complete = vi.fn().mockResolvedValue([])
    fetchModel = vi.fn()
    getThumb = vi.fn().mockResolvedValue({ status: 'miss' })
    putThumb = vi.fn().mockResolvedValue(undefined)
  },
}))
// Spread the real module and override only what needs WebGL: everything else
// (staging, RIG_VERSION) stays real, so a future test here can open a viewer.
vi.mock('../src/three/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  renderThumbnail: vi.fn(() => Promise.resolve(new Blob())),
  getRenderer: () => ({
    setSize: () => {},
    render: () => {},
    domElement: document.createElement('canvas'),
  }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: App } = await import('../src/App')

function dir(name: string): DirEntry {
  return { name, path: `/models/${name}`, kind: 'dir', size: 0, mtime: 1 }
}
function model(name: string): DirEntry {
  return { name, path: `/models/${name}`, kind: 'model', format: 'stl', size: 1, mtime: 1 }
}

const NESTED: DirListing = { path: '/models', entries: [dir('a')] }
const FLAT: DirListing = {
  path: '/models',
  entries: [dir('a'), model('a/deep.stl')],
  truncated: true,
}

let root: Root | null = null
let container: HTMLElement

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)))

function flatButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[aria-pressed]')!
}
/** Each tile's label is the last child of its button. */
function labels(): string[] {
  return Array.from(container.querySelectorAll('main button')).map(
    (b) => b.lastElementChild?.textContent ?? '',
  )
}
const click = (el: HTMLElement) => act(async () => el.click())

beforeEach(async () => {
  localStorage.setItem('model-browser:last-path', '/models')
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:m', revokeObjectURL: () => {} })
  listDir.mockReset()
  listDir.mockResolvedValue(NESTED)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<App />)
  })
  await settle()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container.remove()
  root = null
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('flat toggle', () => {
  it('a slow flat walk cannot clobber the nested listing that superseded it', async () => {
    let landFlat!: () => void
    const slowFlat = new Promise<DirListing>((resolve) => {
      landFlat = () => resolve(FLAT)
    })
    listDir.mockImplementation((_p: string, opts?: { flat?: boolean }) =>
      opts?.flat === true ? slowFlat : Promise.resolve(NESTED),
    )

    await click(flatButton()) // flat requested — walk is still running
    await click(flatButton()) // user gives up; nested returns immediately
    await settle()
    expect(flatButton().getAttribute('aria-pressed')).toBe('false')

    landFlat() // the abandoned walk finally lands
    await settle()

    expect(labels()).toEqual(['a'])
    expect(flatButton().getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toContain('omitted')
  })

  it('a failed flat request leaves the toggle off rather than lit over a nested grid', async () => {
    listDir.mockImplementation((_p: string, opts?: { flat?: boolean }) =>
      opts?.flat === true ? Promise.reject(new Error('walk failed')) : Promise.resolve(NESTED),
    )

    await click(flatButton())
    await settle()

    expect(flatButton().getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).toContain('walk failed')
    // and the next navigation must not silently ask for a flat listing
    listDir.mockClear()
    await click(container.querySelector<HTMLButtonElement>('main button')!)
    expect(listDir).toHaveBeenCalledWith('/models/a', { flat: false })
  })

  it('a successful flat listing renders its models and the truncation notice', async () => {
    listDir.mockImplementation((_p: string, opts?: { flat?: boolean }) =>
      Promise.resolve(opts?.flat === true ? FLAT : NESTED),
    )

    await click(flatButton())
    await settle()

    expect(flatButton().getAttribute('aria-pressed')).toBe('true')
    // Tile labels show only the file name; the relative path survives on the tile
    // itself, as the tooltip and the accessible name.
    expect(labels()).toEqual(['a', 'deep.stl'])
    const tile = container.querySelector('main button[data-model-tile]')!
    expect(tile.getAttribute('title')).toBe('a/deep.stl')
    // The accessible name may carry a thumbnail-state suffix; the path is the point.
    expect(tile.getAttribute('aria-label')).toContain('a/deep.stl')
    expect(container.textContent).toContain('Showing 1 models; some were omitted.')
  })
})
