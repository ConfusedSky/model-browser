// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  flatButton,
  labels,
  listDir,
  model,
  mountApp,
  settle,
  unmountApp,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('a')] }
const FLAT: DirListing = {
  path: '/models',
  entries: [dir('a'), model('a/deep.stl')],
  truncated: true,
}

beforeEach(() => mountApp('/models', NESTED))
afterEach(() => unmountApp())

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
    await click(container.querySelector<HTMLButtonElement>('main .grid button')!)
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
    expect(container.textContent).toContain('Showing 1 models; some entries were omitted.')
  })
})
