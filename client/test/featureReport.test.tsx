// @vitest-environment happy-dom
// The feature report through App (feature-report D3): read once through the
// ApiClient, held as `FeatureReport | null` where `null` means *not known*, and
// re-asked on each navigation until it resolves — the index-availability
// effect's trigger, for its reason.
//
// No surface gates on it yet: consumers gate in their own changes, and the
// byte-identity requirement is asserted by every other App-mount file passing
// unchanged against the harness's all-on default. What is asserted here is the
// state machine those consumers will depend on — that the report resolves, that
// it stops asking once it has, that a failure leaves it unknown and retries, and
// that nothing renders behind it in the meantime.
//
// The trigger is a path change, not any re-list: a flat toggle or a find filter
// at the same path is not a navigation and must ask nothing.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  dir,
  features,
  labels,
  listDir,
  mountApp,
  settle,
  tiles,
  unmountApp,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const TOP: DirListing = { path: '/models', entries: [dir('a')] }
const CHILD: DirListing = { path: '/models/a', entries: [dir('a/b')] }
const GRANDCHILD: DirListing = { path: '/models/a/b', entries: [dir('a/b/c')] }

/**
 * Answer whichever folder is asked for, so a click really lands somewhere new.
 * Called **after** `mountApp`, which resets `listDir` to the boot listing.
 */
function tree(): void {
  listDir.mockImplementation((p: string) =>
    Promise.resolve(p === '/models/a' ? CHILD : p === '/models/a/b' ? GRANDCHILD : TOP),
  )
}

afterEach(() => unmountApp())

describe('the feature report', () => {
  it('is read through the ApiClient, never around it', async () => {
    // D1: all client I/O goes through `ApiClient`. A raw `fetch('/api/features')`
    // would pass every other cell in this file — the request would still be made
    // and the report would still resolve — while being unreachable to the
    // injected client every App test drives. So the network is watched directly.
    const seen: string[] = []
    vi.stubGlobal('fetch', (input: unknown) => {
      seen.push(String(input))
      return Promise.reject(new Error('no client in this suite may reach the network'))
    })
    await mountApp('/models', TOP)
    tree()
    await settle()

    // Asserted before the call count, so this is what a reach-around reports:
    // the count would fail too, and its message names neither the route nor why.
    expect(seen.filter((u) => u.includes('/api/features'))).toEqual([])
    expect(features).toHaveBeenCalledTimes(1)
  })

  it('resolves once and then stops asking, however far the user navigates', async () => {
    await mountApp('/models', TOP)
    tree()
    await settle()
    expect(features).toHaveBeenCalledTimes(1)

    // Two navigations. A known report is known: re-asking would be a request
    // per navigation for a per-process answer that cannot have changed.
    await click(tiles()[0]!)
    await settle()
    expect(labels()).toEqual(['b'])
    await click(tiles()[0]!)
    await settle()
    expect(labels()).toEqual(['c'])

    expect(features).toHaveBeenCalledTimes(1)
  })

  it('stays unknown when the read fails, and the next navigation asks again', async () => {
    // Configured before the mount, because the report is read during it.
    features.mockRejectedValueOnce(new Error('server refused'))

    await mountApp('/models', TOP)
    tree()
    await settle()
    // The failure is not retained as an answer, and nothing retries on a timer:
    // the app is idle at one attempt until an interaction it already makes.
    expect(features).toHaveBeenCalledTimes(1)

    await click(tiles()[0]!)
    await settle()
    expect(labels()).toEqual(['b'])
    expect(features).toHaveBeenCalledTimes(2)

    // And that second answer resolved it — a third navigation asks nothing,
    // which tells "retried until it resolves" apart from "retried always".
    await click(tiles()[0]!)
    await settle()
    expect(labels()).toEqual(['c'])
    expect(features).toHaveBeenCalledTimes(2)
  })

  it('renders the listing without waiting for the report', async () => {
    // The report gates *offers*, one day; it has never gated the grid. A hanging
    // read must therefore be invisible — the app that a consumer withholds a
    // menu entry from is otherwise the whole app, drawn on time.
    features.mockImplementation(() => new Promise(() => {}))

    await mountApp('/models', TOP)
    tree()
    await settle()

    expect(labels()).toEqual(['a'])
    expect(features).toHaveBeenCalledTimes(1)
  })
})
