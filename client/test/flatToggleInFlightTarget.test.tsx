// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  container,
  dirEntry,
  flatButton,
  labels,
  listDir,
  modelEntry,
  mountApp,
  pathInput,
  settle,
  unmountApp,
  upButton,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const AT_A_NESTED: DirListing = { path: '/models/a', entries: [dirEntry('/models/a/sub')] }
const AT_A_FLAT: DirListing = {
  path: '/models/a',
  entries: [dirEntry('/models/a/sub'), modelEntry('/models/a/deep.stl')],
  truncated: true,
}
const AT_ROOT_NESTED: DirListing = { path: '/models', entries: [dirEntry('/models/a')] }
const AT_ROOT_FLAT: DirListing = {
  path: '/models',
  entries: [dirEntry('/models/a'), modelEntry('/models/a/deep.stl')],
  truncated: true,
}
const AT_FS_ROOT: DirListing = { path: '/', entries: [dirEntry('/models')] }

beforeEach(() => mountApp('/models/a', AT_A_NESTED))
afterEach(() => unmountApp())

describe('flat toggle follows the in-flight navigation target', () => {
  it('untoggling flat while an ↑ navigation is in flight requests the destination and lands there nested', async () => {
    let resolveUp!: (v: DirListing) => void
    const pendingUp = new Promise<DirListing>((resolve) => {
      resolveUp = resolve
    })
    listDir.mockImplementation((target: string, opts?: { flat?: boolean }) => {
      const isFlat = opts?.flat === true
      if (target === '/models/a' && isFlat) return Promise.resolve(AT_A_FLAT)
      if (target === '/models' && isFlat) return pendingUp
      if (target === '/models' && !isFlat) return Promise.resolve(AT_ROOT_NESTED)
      // The buggy untoggle requests the committed origin instead of the ↑
      // destination. Answering it (rather than rejecting) lets the labels()
      // assertion below fail as ['sub'] vs ['a'] — the user-visible symptom —
      // instead of tripping earlier on an error-revert of aria-pressed.
      if (target === '/models/a' && !isFlat) return Promise.resolve(AT_A_NESTED)
      return Promise.reject(new Error(`unexpected listDir(${target}, flat=${isFlat})`))
    })

    await click(flatButton()) // flat on at /models/a
    await settle()
    expect(flatButton().getAttribute('aria-pressed')).toBe('true')

    await click(upButton()) // ↑ requests /models flat — left pending
    await click(flatButton()) // untoggle mid-flight — should re-request the ↑ destination
    await settle()

    expect(flatButton().getAttribute('aria-pressed')).toBe('false')
    expect(labels()).toEqual(['a'])
    expect(container.textContent).not.toContain('omitted')

    resolveUp(AT_ROOT_FLAT) // the abandoned, superseded ↑ request finally lands
    await settle()

    expect(flatButton().getAttribute('aria-pressed')).toBe('false')
    expect(labels()).toEqual(['a'])
    expect(container.textContent).not.toContain('omitted')
  })

  it('pressing ↑ twice during a slow listing requests the grandparent', async () => {
    let resolveUp!: (v: DirListing) => void
    const pendingUp = new Promise<DirListing>((resolve) => {
      resolveUp = resolve
    })
    listDir.mockImplementation((target: string) => {
      if (target === '/models') return pendingUp
      if (target === '/') return Promise.resolve(AT_FS_ROOT)
      return Promise.reject(new Error(`unexpected listDir(${target})`))
    })

    await click(upButton()) // → /models, left pending
    // The path bar shows the requested target immediately (D4) — without it,
    // the second ↑'s grandparent hop would be invisible until the walk lands.
    expect(pathInput().value).toBe('/models')
    await click(upButton()) // must ascend from the in-flight target: → /
    expect(pathInput().value).toBe('/')
    expect(upButton().disabled).toBe(true) // at the root the control disables — no dead clicks
    await settle()

    expect(labels()).toEqual(['models'])

    resolveUp(AT_ROOT_NESTED) // the abandoned first ↑ finally lands — superseded
    await settle()
    expect(labels()).toEqual(['models'])
  })

  it('the path bar shows the requested target immediately and reverts on failure', async () => {
    let failSub!: (err: Error) => void
    listDir.mockImplementation((target: string) => {
      if (target === '/models/a/sub')
        return new Promise<DirListing>((_res, reject) => {
          failSub = reject
        })
      return Promise.reject(new Error(`unexpected listDir(${target})`))
    })

    await click(container.querySelector<HTMLButtonElement>('main button')!) // into 'sub'
    expect(pathInput().value).toBe('/models/a/sub') // optimistic, before any response

    failSub(new Error('boom'))
    await settle()

    expect(pathInput().value).toBe('/models/a') // reverted to the committed path
    expect(container.textContent).toContain('boom')
  })

  it('toggling after the newest navigation failed re-requests the committed path', async () => {
    listDir.mockImplementation((target: string, opts?: { flat?: boolean }) => {
      if (target === '/models/a/sub') return Promise.reject(new Error('boom'))
      if (target === '/models/a' && opts?.flat === true) return Promise.resolve(AT_A_FLAT)
      return Promise.reject(new Error(`unexpected listDir(${target}, ${JSON.stringify(opts)})`))
    })

    await click(container.querySelector<HTMLButtonElement>('main button')!) // navigate into 'sub' — fails
    await settle()
    expect(container.textContent).toContain('boom')

    listDir.mockClear()
    await click(flatButton())
    await settle()

    expect(listDir).toHaveBeenCalledWith('/models/a', { flat: true })
    expect(flatButton().getAttribute('aria-pressed')).toBe('true')
  })

  it('a quiet toggle (nothing in flight) still requests the committed path', async () => {
    listDir.mockImplementation((target: string, opts?: { flat?: boolean }) => {
      if (target === '/models/a' && opts?.flat === true) return Promise.resolve(AT_A_FLAT)
      return Promise.reject(new Error(`unexpected listDir(${target}, ${JSON.stringify(opts)})`))
    })

    listDir.mockClear()
    await click(flatButton())
    await settle()

    expect(listDir).toHaveBeenCalledWith('/models/a', { flat: true })
    expect(flatButton().getAttribute('aria-pressed')).toBe('true')
  })
})
