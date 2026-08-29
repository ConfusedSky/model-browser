// @vitest-environment happy-dom
/**
 * The header row's layer and its alignment — the two properties of that row
 * that nothing else asserts.
 *
 * happy-dom lays nothing out, so neither paint order nor a box's position is
 * observable here. What is observable is the class the row carries, the number
 * that class stands for in index.css, and the DOM shape each of those depends
 * on to mean anything — which is where both of these bugs actually lived: the
 * suggestion list is only lifted if it renders *inside* the element carrying
 * the layer, and the controls can only be centred while nothing that grows —
 * the failure line — shares their row.
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
// The stylesheet as text, through Vite's `?raw` rather than `fs`: this file
// runs in happy-dom, where `import.meta.url` is not a file: URL.
import CSS from '../src/index.css?raw'
import {
  container,
  dir,
  listDir,
  mountApp,
  pathInput,
  pressEnter,
  settle,
  type as typeInto,
  unmountApp,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('a')] }

/** What a named layer is worth. Throws rather than returning NaN, so renaming a
 *  utility in index.css without its call sites fails here by name. */
function layer(name: string): number {
  const found = new RegExp(`@utility\\s+${name}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(CSS)
  if (found === null) throw new Error(`index.css defines no @utility ${name}`)
  return Number(found[1])
}

const header = (): HTMLElement => container.querySelector('header')!
/** The controls' own flex row — the header's first child, message excluded. */
const row = (): HTMLElement => header().firstElementChild as HTMLElement

beforeEach(() => mountApp('/models', NESTED))
afterEach(() => unmountApp())

describe('the chrome layer', () => {
  it('orders the named layers lowest first', () => {
    const stack = ['z-orbit-overlay', 'z-tile-badge', 'z-chrome', 'z-lightbox', 'z-menu']
    expect(stack.map(layer)).toEqual([...stack.map(layer)].sort((a, b) => a - b))
    expect(new Set(stack.map(layer)).size).toBe(stack.length)
  })

  it('puts the header above a tile’s badges and below the lightbox', () => {
    // Above the badges is the fix: they are drawn by tiles the suggestion list
    // hangs over, and at the list's own z they painted straight through it.
    // Below the lightbox is the constraint that fix must not break — the
    // lightbox covers this bar deliberately (`viewerError`, App.tsx).
    expect(header().className).toContain('z-chrome')
    expect(layer('z-chrome')).toBeGreaterThan(layer('z-tile-badge'))
    expect(layer('z-lightbox')).toBeGreaterThan(layer('z-chrome'))
  })

  it('renders the path suggestions inside the element that carries the layer', () => {
    // A stacking context lifts its descendants and nothing else: portal this
    // list out of the header, or lift the list alone, and the badges are back
    // over it.
    localStorage.setItem('model-browser:recents', JSON.stringify(['/models/elsewhere']))
    act(() => pathInput().focus())

    expect(header().querySelector('ul')).not.toBeNull()
  })
})

describe('the toolbar row', () => {
  it('centres its controls, the message being no part of the row', () => {
    // The row is a flex container of its own inside a block header. When the
    // message shared this row (PathBar drew it), that item stood taller than
    // the controls beside it and centring slid all of them down by half of it.
    expect(header().className).not.toContain('flex')
    expect(row().className).toContain('items-center')
    expect(row().contains(pathInput())).toBe(true)
  })

  it('draws a failure under the row, where it cannot change the row’s height', async () => {
    listDir.mockRejectedValue(new Error('no such path: /models/nope'))
    await typeInto(pathInput(), '/models/nope')
    await pressEnter(pathInput())
    await settle()

    const failure = header().querySelector('p.text-red-400')
    expect(failure).not.toBeNull()
    expect(row().contains(failure)).toBe(false)
    expect(failure!.parentElement).toBe(header())
  })
})
