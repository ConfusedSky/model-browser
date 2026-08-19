// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import { SKELETON_DELAY_MS } from '../src/hooks/useDelayedFlag'
import {
  click,
  container,
  dir,
  listDir,
  model,
  mountApp,
  settle,
  skeleton,
  tiles,
  unmountApp,
  wait,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('a')] }
const CHILD: DirListing = { path: '/models/a', entries: [dir('a/b')] }
const FLAT: DirListing = {
  path: '/models',
  entries: [dir('a'), model('a/deep.stl')],
  truncated: true,
}

const pastDelay = () => wait(SKELETON_DELAY_MS + 50)

beforeEach(() => mountApp('/models', NESTED))
afterEach(() => unmountApp())

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
    // Container tiles are labeled by their own name now that a deep search can
    // return one named by a relative path; the full name stays in the title.
    expect(tiles().map((b) => b.textContent)).toEqual(['📁b'])
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
