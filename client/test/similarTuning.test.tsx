// @vitest-environment happy-dom
//
// The similarity view's parameters, through the whole app (task 6.2): the panel
// block that sets them, the debounce that keeps a typed count from becoming
// four questions, and the URL that carries them.
//
// Entered by link, like `findSimilar.test.tsx` — the view is reachable and
// reproducible by URL by design (D4), and what these are about is what happens
// once it is on screen.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  indexAvailability,
  labels,
  listDir,
  model,
  mountAppAtCurrentUrl,
  pressEnter,
  searchInput,
  settle,
  similar,
  type,
  unmountApp,
  wait,
} from './appHarness'
import {
  setSearchKinds,
  setSearchMode,
  setSearchTuning,
  TUNING_DEFAULTS,
} from '../src/lib/searchOptions'
import { SIMILAR_K } from '../src/state/view'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('widget.stl')] }
const HERO = '/models/Kits/Baal/hero.stl'
const LINK = `/?path=/models&similar=${encodeURIComponent(HERO)}`
const NEIGHBOURS = {
  path: '/models',
  entries: [model('Kits/Baal/base.stl'), model('Kits/Other/wing.stl')],
  poses: {},
}
const READY = { state: 'ready', collectionRoot: '/models', covers: ['stl'] }

/** The neighbour-count field, absent unless the view is about a model. */
function countInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[aria-label="Number of neighbours"]')
}
/** The similarity block's pooling trio — named apart from the meaning tuning's
 *  identical one, which can be on screen at the same time. */
function poolButtons(): HTMLButtonElement[] {
  const group = container.querySelector('[aria-label="Pool neighbour views by"]')
  return group === null ? [] : Array.from(group.querySelectorAll('button'))
}
function poolButton(name: string): HTMLButtonElement {
  return poolButtons().find((b) => b.textContent === name)!
}
/** The panel starts collapsed for a fresh profile; open it and select its
 *  search tab, which is where every option in this app lives. */
async function openPanel(): Promise<void> {
  const expand = container.querySelector<HTMLButtonElement>(
    'aside button[aria-label="Expand side panel"]',
  )
  if (expand !== null) await click(expand)
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('aside [role="tab"]')).find(
    (b) => b.textContent?.startsWith('search'),
  )
  if (tab !== undefined) await click(tab)
}

beforeEach(() => {
  localStorage.clear()
  setSearchMode('name')
  setSearchKinds('both')
  setSearchTuning({ ...TUNING_DEFAULTS })
})
afterEach(() => unmountApp())

describe('the similarity view’s parameters', () => {
  it('the block is offered under a similarity view and nowhere else', async () => {
    // The applicability idiom the panel already uses for the name options: an
    // option that cannot apply is absent, not present and inert.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await openPanel()

    expect(countInput()).not.toBeNull()
    expect(countInput()!.value).toBe(String(SIMILAR_K))
    expect(poolButtons().map((b) => b.textContent)).toEqual(['mean', 'max', 'softmax'])
    // Nothing pressed: absence is the index's own pooling, which is not any of
    // the three, so the panel says so rather than picking one.
    expect(poolButtons().every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(container.textContent).toContain('Pooled however the index is configured to')
    // Named by base name, like the results label: the full vpath is in the URL,
    // which is where an identity belongs.
    expect(container.textContent).toContain('Neighbours')
    expect(container.textContent).toContain('Similar to “hero.stl”')

    // Leave the view and the block goes with it — the parameters belong to the
    // subject that reads them, not to the profile.
    listDir.mockResolvedValue({ path: '/models', entries: [model('widget.stl')] })
    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()
    expect(countInput()).toBeNull()
    expect(poolButtons()).toEqual([])
  })

  it('a typed count becomes one question, not one per keystroke', async () => {
    // The debounce lives in the panel here rather than in App (there is no
    // record-only reducer phase to pair it with), so this is where it is
    // pinned: "40" typed digit by digit is one re-ask for 40, never one for 4.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await openPanel()
    expect(similar).toHaveBeenCalledTimes(1)

    await type(countInput()!, '4')
    await type(countInput()!, '40')
    // Nothing yet — the field is still being typed in.
    expect(similar).toHaveBeenCalledTimes(1)
    await wait(400)
    await settle()

    expect(similar).toHaveBeenCalledTimes(2)
    expect(similar).toHaveBeenLastCalledWith(HERO, 40, undefined, expect.any(AbortSignal))
    // The whole view is re-serialized by the one writer, so the count is in the
    // URL and the model is still what the view is about.
    expect(location.search).toContain('k=40')
    expect(location.search).toContain('similar=')
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
  })

  it('a pooling choice runs at once, carries the count in force, and is dropped from the URL when unset', async () => {
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(`${LINK}&k=40`, NESTED)
    await settle()
    await openPanel()
    expect(similar).toHaveBeenLastCalledWith(HERO, 40, undefined, expect.any(AbortSignal))
    // No pool in, no pool out: 4.2's rule survives the parameter becoming
    // settable — a view that made no choice sends none.
    expect(location.search).not.toContain('pool=')

    await click(poolButton('max'))
    await settle()
    expect(similar).toHaveBeenLastCalledWith(HERO, 40, 'max', expect.any(AbortSignal))
    expect(location.search).toContain('pool=max')
    expect(location.search).toContain('k=40')
    expect(poolButton('max').getAttribute('aria-pressed')).toBe('true')
  })

  it('a link’s parameters are the view’s, and a bad one reads as the default', async () => {
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(`${LINK}&k=40&pool=mean`, NESTED)
    await settle()
    await openPanel()

    expect(similar).toHaveBeenCalledWith(HERO, 40, 'mean', expect.any(AbortSignal))
    expect(countInput()!.value).toBe('40')
    expect(poolButton('mean').getAttribute('aria-pressed')).toBe('true')

    // A count the index would refuse degrades to the default rather than to a
    // 404-shaped surprise over a link that names a good view.
    await unmountApp()
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(`${LINK}&k=99999`, NESTED)
    await settle()
    expect(similar).toHaveBeenCalledWith(HERO, SIMILAR_K, undefined, expect.any(AbortSignal))
  })

  it('a count field mid-edit is not a value', async () => {
    // The `topText`/`scoreText` rule, in the third field to need it: `Number('')`
    // is 0, and committing that would ask the index for no neighbours at all.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    await openPanel()

    await type(countInput()!, '')
    await wait(400)
    await settle()
    expect(similar).toHaveBeenCalledTimes(1)
    // The draft is the user's until they leave the field. (`focusout`, not
    // `blur`: React delegates at the root and `blur` does not bubble.)
    expect(countInput()!.value).toBe('')
    await act(async () =>
      countInput()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    )
    expect(countInput()!.value).toBe(String(SIMILAR_K))
  })
})
