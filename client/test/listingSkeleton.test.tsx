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
vi.mock('../src/three/renderer', async (importOriginal) => ({
  renderThumbnail: vi.fn(() => Promise.resolve(new Blob())),
  getRenderer: () => ({
    setSize: () => {},
    render: () => {},
    domElement: document.createElement('canvas'),
  }),
  makeScene: () => ({ scene: { add: () => {}, remove: () => {} }, rig: { quaternion: { copy: () => {} } } }),
  RIG_VERSION: (await importOriginal<typeof import('../src/three/renderer')>()).RIG_VERSION,
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: App } = await import('../src/App')
const { SKELETON_DELAY_MS } = await import('../src/hooks/useDelayedFlag')

function dir(name: string): DirEntry {
  return { name, path: `/models/${name}`, kind: 'dir', size: 0, mtime: 1 }
}
function model(name: string): DirEntry {
  return { name, path: `/models/${name}`, kind: 'model', format: 'stl', size: 1, mtime: 1 }
}

const NESTED: DirListing = { path: '/models', entries: [dir('a')] }
const CHILD: DirListing = { path: '/models/a', entries: [dir('a/b')] }
const FLAT: DirListing = {
  path: '/models',
  entries: [dir('a'), model('a/deep.stl')],
  truncated: true,
}

let root: Root | null = null
let container: HTMLElement

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const settle = () => wait(20)
const pastDelay = () => wait(SKELETON_DELAY_MS + 50)

const skeleton = () => container.querySelector('.animate-pulse')
const tiles = () => Array.from(container.querySelectorAll<HTMLButtonElement>('main button'))
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

describe('listing skeleton', () => {
  it('a slow listing shows the skeleton after the delay, hiding the stale tiles', async () => {
    listDir.mockImplementation((p: string) =>
      p === '/models/a' ? new Promise<DirListing>(() => {}) : Promise.resolve(NESTED),
    )

    await click(tiles()[0]!)
    expect(skeleton()).toBeNull() // not yet — the reveal is delayed
    await pastDelay()

    expect(skeleton()).not.toBeNull()
    expect(tiles()).toEqual([]) // stale navigation targets are unmounted
  })

  it('a fast listing never shows the skeleton', async () => {
    listDir.mockImplementation((p: string) =>
      Promise.resolve(p === '/models/a' ? CHILD : NESTED),
    )

    await click(tiles()[0]!)
    await settle()
    expect(skeleton()).toBeNull()

    await pastDelay() // the reveal timer must have been cleaned up, not merely outrun
    expect(skeleton()).toBeNull()
    expect(tiles().map((b) => b.textContent)).toEqual(['📁a/b'])
  })

  it('a newer navigation while pending wins and clears the skeleton', async () => {
    listDir.mockImplementation((_p: string, opts?: { flat?: boolean }) =>
      opts?.flat === true ? Promise.resolve(NESTED) : new Promise<DirListing>(() => {}),
    )

    await click(tiles()[0]!) // never resolves
    await pastDelay()
    expect(skeleton()).not.toBeNull()

    // The header stays live: toggling flat issues a newer request that takes
    // over the in-flight flag, and its fast response clears the skeleton.
    await click(container.querySelector<HTMLButtonElement>('button[aria-pressed]')!)
    await settle()

    expect(skeleton()).toBeNull()
    expect(tiles().map((b) => b.textContent)).toEqual(['📁a'])
  })

  it('a superseded request landing neither dismisses nor re-triggers the skeleton', async () => {
    let landA!: () => void
    listDir.mockImplementation((p: string, opts?: { flat?: boolean }) => {
      if (opts?.flat === true) return new Promise<DirListing>(() => {})
      if (p === '/models/a')
        return new Promise<DirListing>((res) => {
          landA = () => res(CHILD)
        })
      return Promise.resolve(NESTED)
    })

    await click(tiles()[0]!)
    await pastDelay()
    expect(skeleton()).not.toBeNull()

    // Newest request is now the never-resolving flat toggle; then the
    // abandoned navigation finally lands.
    await click(container.querySelector<HTMLButtonElement>('button[aria-pressed]')!)
    landA()
    await settle()

    expect(skeleton()).not.toBeNull() // still waiting on the newest request
    expect(tiles()).toEqual([]) // and the stale entries did not render
  })

  it('a superseded rejection surfaces no stale error', async () => {
    let failA!: (err: Error) => void
    listDir.mockImplementation((p: string, opts?: { flat?: boolean }) => {
      if (opts?.flat === true) return new Promise<DirListing>(() => {})
      if (p === '/models/a')
        return new Promise<DirListing>((_res, reject) => {
          failA = reject
        })
      return Promise.resolve(NESTED)
    })

    await click(tiles()[0]!)
    await pastDelay()
    await click(container.querySelector<HTMLButtonElement>('button[aria-pressed]')!)
    failA(new Error('stale boom'))
    await settle()

    expect(skeleton()).not.toBeNull()
    expect(container.textContent).not.toContain('stale boom')
  })

  it('the skeleton replaces the truncation notice', async () => {
    listDir.mockImplementation((p: string, opts?: { flat?: boolean }) => {
      if (p === '/models/a') return new Promise<DirListing>(() => {})
      return Promise.resolve(opts?.flat === true ? FLAT : NESTED)
    })

    await click(container.querySelector<HTMLButtonElement>('button[aria-pressed]')!)
    await settle()
    expect(container.textContent).toContain('omitted')

    await click(tiles()[0]!) // into a never-resolving navigation
    await pastDelay()
    expect(skeleton()).not.toBeNull()
    expect(container.textContent).not.toContain('omitted')
  })

  it('a failed request clears the skeleton and surfaces the error over the prior grid', async () => {
    let fail!: (err: Error) => void
    listDir.mockImplementation((p: string) =>
      p === '/models/a'
        ? new Promise<DirListing>((_res, reject) => {
            fail = reject
          })
        : Promise.resolve(NESTED),
    )

    await click(tiles()[0]!)
    await pastDelay()
    expect(skeleton()).not.toBeNull()

    fail(new Error('walk failed'))
    await settle()

    expect(skeleton()).toBeNull()
    expect(container.textContent).toContain('walk failed')
    expect(tiles().map((b) => b.textContent)).toEqual(['📁a']) // prior grid restored
  })
})
