// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  container,
  dir,
  library,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  pathInput,
  pressEnter,
  settle,
  tiles,
  type,
  unmountApp,
  upButton,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const AT_ROOT: DirListing = { path: '/', entries: [dir('Alpha'), model('widget.stl')] }

/** The header's one transient line — the slot the library states render into. */
const headerLine = (): string | null =>
  container.querySelector('header p')?.textContent ?? null
const grid = (): Element | null => container.querySelector('main .grid')
const skeleton = (): Element | null => container.querySelector('.animate-pulse')

/** The mocked HttpError, so a rejection carries a `state` the way a 503 does. */
async function libraryError(state: string): Promise<Error> {
  const { HttpError } = (await import('../src/api/client')) as unknown as {
    HttpError: new (status: number, message: string, state?: string) => Error
  }
  return new HttpError(503, 'the library is not available', state)
}

afterEach(() => unmountApp())

describe('the library states render instead of a grid', () => {
  // These two mount with the harness's LANDING listing, deliberately: in life
  // the routes all 503 and there would be no result to draw anyway, so a test
  // that also withheld the entries could not tell the state gate from an empty
  // answer. Here the entries are present and the state alone is what keeps them
  // off the screen — remove the gate in App's `<main>` and both fail on
  // `grid()`. The 503 path has its own case below.
  it('missing names the configured root and shows nothing below', async () => {
    library.mockResolvedValue({ state: 'missing', root: '/run/media/masa/STL Library' })
    await mountApp('/', AT_ROOT)
    await settle()

    // The root is named because mounting it is the remedy and takes seconds.
    expect(headerLine()).toBe('The library at /run/media/masa/STL Library is not present')
    // No grid, no skeleton, no "empty folder": there is nothing to browse, and
    // a spinner would promise a listing that is not coming.
    expect(grid()).toBeNull()
    expect(tiles()).toEqual([])
    expect(skeleton()).toBeNull()
  })

  it('unconfigured names where a root is set, and shows nothing below', async () => {
    library.mockResolvedValue({ state: 'unconfigured' })
    await mountApp('/', AT_ROOT)
    await settle()

    expect(headerLine()).toBe(
      'No library configured — set MODEL_BROWSER_ROOT or root in config.json',
    )
    expect(grid()).toBeNull()
    expect(tiles()).toEqual([])
    expect(skeleton()).toBeNull()
  })

  it('a ready library renders the grid and no library line', async () => {
    // The control: the same mount with the default `ready` state is the app as
    // every other test sees it, which is what makes the two above about the
    // state rather than about the mount.
    await mountApp('/', AT_ROOT)
    await settle()

    expect(grid()).not.toBeNull()
    expect(tiles().length).toBe(2)
    expect(headerLine()).toBeNull()
  })

  it('a 503 naming a library state replaces the route’s own sentence', async () => {
    // The library came up ready and the volume went away under it: the listing
    // fails with a state envelope, which is the trigger to re-read the state.
    // The sentence and the root come from that read, not from the error — the
    // error carries the state and nothing else.
    library.mockResolvedValue({ state: 'ready', id: 'test', top: '/lib', root: '/' })
    await mountApp('/', AT_ROOT)
    await settle()
    expect(headerLine()).toBeNull()

    library.mockResolvedValue({ state: 'missing', root: '/mnt/gone' })
    listDir.mockRejectedValue(await libraryError('missing'))
    await type(pathInput(), '/Alpha')
    await pressEnter(pathInput())
    await settle()

    expect(headerLine()).toBe('The library at /mnt/gone is not present')
    expect(headerLine()).not.toContain('the library is not available')
    expect(grid()).toBeNull()
  })

  it('an ordinary failure keeps the route’s own sentence', async () => {
    // The other half of the rule: a failure with no state is not the library's,
    // so the header says what the route said and the grid is only absent
    // because the listing did not land.
    await mountApp('/', AT_ROOT)
    await settle()
    listDir.mockRejectedValue(new Error('no such path: /Nope'))
    await type(pathInput(), '/Nope')
    await pressEnter(pathInput())
    await settle()

    expect(headerLine()).toBe('no such path: /Nope')
  })

  it('re-reads the state on every navigation while it is not ready', async () => {
    // A volume mounted after the server started is picked up by the next
    // navigation, without a reload.
    library.mockResolvedValue({ state: 'missing', root: '/mnt/gone' })
    await mountApp('/', AT_ROOT)
    await settle()
    const afterBoot = library.mock.calls.length
    expect(afterBoot).toBeGreaterThan(0)
    expect(headerLine()).toBe('The library at /mnt/gone is not present')

    // The drive appears; pressing ↑ is enough to notice.
    library.mockResolvedValue({ state: 'ready', id: 'test', top: '/lib', root: '/' })
    await type(pathInput(), '/Alpha')
    await pressEnter(pathInput())
    await settle()

    expect(library.mock.calls.length).toBeGreaterThan(afterBoot)
    expect(headerLine()).toBeNull()
    expect(grid()).not.toBeNull()
  })

  it('does not re-read the state on a navigation while it is ready', async () => {
    await mountApp('/', AT_ROOT)
    await settle()
    const afterBoot = library.mock.calls.length
    await type(pathInput(), '/Alpha')
    await pressEnter(pathInput())
    await settle()

    expect(library.mock.calls.length).toBe(afterBoot)
  })
})

describe('the boot view is the library’s top', () => {
  it('a URL with no path opens `/`, reading no pre-library key', async () => {
    // The gate on 5.2: these are the keys `recents.ts` re-keyed away from, and
    // `resolveView` no longer consults a last path at all. Restore either read
    // and this lands at `/somewhere/else` instead.
    localStorage.setItem('model-browser:last-path', '/somewhere/else')
    localStorage.setItem('model-browser:recents', JSON.stringify(['/somewhere/else']))
    await mountAppAtCurrentUrl('/', AT_ROOT)
    await settle()

    expect(listDir).toHaveBeenCalledWith('/', expect.anything(), expect.any(AbortSignal))
    expect(listDir).not.toHaveBeenCalledWith(
      '/somewhere/else',
      expect.anything(),
      expect.any(AbortSignal),
    )
    expect(pathInput().value).toBe('/')
    // The top is the default view, so it is named by carrying no parameter.
    expect(window.location.search).toBe('')
    // And it is the top: there is nowhere above it to go.
    expect(upButton().disabled).toBe(true)
  })

  it('the path bar shows a library path verbatim, `/` included', async () => {
    await mountApp('/Kit', AT_ROOT)
    await settle()
    expect(pathInput().value).toBe('/Kit')

    listDir.mockResolvedValue({ path: '/', entries: AT_ROOT.entries })
    await type(pathInput(), '/')
    await pressEnter(pathInput())
    await settle()
    expect(pathInput().value).toBe('/')
    expect(listDir).toHaveBeenCalledWith('/', expect.anything(), expect.any(AbortSignal))
  })
})
