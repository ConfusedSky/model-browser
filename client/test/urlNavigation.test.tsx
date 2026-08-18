// @vitest-environment happy-dom
import { act } from 'react'
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
  pressEnter,
  searchInput,
  settle,
  type,
  unmountApp,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), model('widget.stl')],
}
const AT_ALPHA: DirListing = { path: '/models/Alpha', entries: [dir('Alpha/sub')] }
const FLAT: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), model('Alpha/deep.stl')],
}
const SEARCH: DirListing = { path: '/models', entries: [model('Alpha/found.stl')] }

const search = () => window.location.search
const pop = () => act(async () => window.dispatchEvent(new PopStateEvent('popstate')))

function mockRoutes(): void {
  listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) => {
    if (opts?.q === 'found') return Promise.resolve(SEARCH)
    if (target === '/models/Alpha') return Promise.resolve(AT_ALPHA)
    if (opts?.flat === true) return Promise.resolve(FLAT)
    return Promise.resolve(NESTED)
  })
}

beforeEach(async () => {
  await mountApp('/models', NESTED)
  mockRoutes()
})
afterEach(async () => {
  await unmountApp()
})

describe('url navigation', () => {
  it('committed navigation, flat, and search each push one entry; re-commits do not stack', async () => {
    expect(search()).toContain('path=%2Fmodels') // boot seeded via replace
    const len0 = window.history.length

    await click(container.querySelector<HTMLButtonElement>('main button')!) // → Alpha
    await settle()
    expect(search()).toContain('path=%2Fmodels%2FAlpha')
    expect(window.history.length).toBe(len0 + 1)

    await click(flatButton())
    await settle()
    expect(search()).toContain('flat=1')
    expect(window.history.length).toBe(len0 + 2)
  })

  it('popstate restores a search view — query, label, results — via replace, not push', async () => {
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    expect(search()).toContain('q=found')
    const len = window.history.length

    // Simulate back: the browser rewinds the URL, then fires popstate.
    window.history.replaceState(null, '', '/?path=%2Fmodels')
    await pop()
    await settle()
    expect(labels()).toEqual(['Alpha', 'widget.stl'])
    expect(container.textContent).not.toContain('Search results for')
    expect(window.history.length).toBe(len) // restoration replaced, never pushed

    // Simulate forward to the search view.
    window.history.replaceState(null, '', '/?path=%2Fmodels&flat=1&q=found')
    await pop()
    await settle()
    expect(container.textContent).toContain('Search results for "found".')
    expect(labels()).toEqual(['found.stl'])
    expect((searchInput() as HTMLInputElement).value).toBe('found')
    expect(window.history.length).toBe(len)
  })

  it('a commit landing while a restoration is in flight still pushes its entry', async () => {
    // The request-id guard (D2): a boolean would classify this commit as part
    // of the restoration and replace away the entry it owes the user.
    let resolveRestore!: (v: DirListing) => void
    listDir.mockImplementation((target: string, opts?: { flat?: boolean; q?: string }) => {
      if (opts?.q === 'slow') return new Promise<DirListing>((r) => (resolveRestore = r))
      if (target === '/models/Alpha') return Promise.resolve(AT_ALPHA)
      return Promise.resolve(NESTED)
    })

    // Back into a search view whose walk is slow — the restoration hangs.
    window.history.replaceState(null, '', '/?path=%2Fmodels&flat=1&q=slow')
    await pop() // restoration begins, left pending
    const len = window.history.length

    await act(async () => {
      const el = document.querySelector('input[placeholder="Type a directory path…"]') as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, '/models/Alpha')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    await settle()
    expect(search()).toContain('path=%2Fmodels%2FAlpha')
    expect(window.history.length).toBe(len + 1) // pushed, not replaced

    resolveRestore(SEARCH) // the superseded restoration lands — discarded
    await settle()
    expect(search()).toContain('path=%2Fmodels%2FAlpha')
  })

  it('a failed history replay surfaces the error without new entries', async () => {
    listDir.mockImplementation(() => Promise.reject(new Error('replay boom')))
    window.history.replaceState(null, '', '/?path=%2Fmodels%2FAlpha')
    const len = window.history.length
    await pop()
    await settle()
    expect(container.textContent).toContain('replay boom')
    expect(window.history.length).toBe(len)
  })

  it('re-searching the identical committed view stacks no duplicate entry', async () => {
    await type(searchInput(), 'found')
    await pressEnter(searchInput())
    await settle()
    const len = window.history.length
    await pressEnter(searchInput()) // same query, same view
    await settle()
    expect(window.history.length).toBe(len)
  })
})

describe('url deep links', () => {
  it('boot with path+flat+q skips last-path and lands in the search view', async () => {
    await unmountApp()
    localStorage.setItem('model-browser:last-path', '/somewhere/else')
    const { mountAppAtCurrentUrl } = await import('./appHarness')
    await mountAppAtCurrentUrl('/?path=%2Fmodels&flat=1&q=found', SEARCH)

    expect(listDir).toHaveBeenCalledWith('/models', { flat: true, q: 'found' })
    expect(container.textContent).toContain('Search results for "found".')
    expect(labels()).toEqual(['found.stl'])
  })

  it('a stale model param drops silently after a successful listing that lacks it', async () => {
    await unmountApp()
    const { mountAppAtCurrentUrl } = await import('./appHarness')
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2Fgone.stl', NESTED)

    expect(labels()).toEqual(['Alpha', 'widget.stl'])
    expect(search()).not.toContain('model=')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
