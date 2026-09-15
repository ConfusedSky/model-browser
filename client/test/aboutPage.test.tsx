// @vitest-environment happy-dom
//
// The About page as a document (`visitor-intro`: "The About page carries what
// the banner cannot", "The credits list is every kit the store credits"):
// which sections it has and in what order, the way back, the two things its
// copy must never say, and the four states of the one dynamic section.
//
// Driven against the component with plain react-dom rather than through App,
// because the page is not a view of the app at all — it has its own Vite entry
// and its own root, and there is no App state that reaches it. The only input
// it takes is an `ApiClient`.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CreditedKit } from '../../shared/types'
import type { ApiClient } from '../src/api/client'
import AboutPage from '../src/components/AboutPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The sections the requirement lists, in the order it lists them, paired with
 * the `id` each one is addressed by. The `id`s are part of the contract, not
 * styling: the banner's credits link is `/about.html#credits`.
 */
const SECTIONS: readonly (readonly [string, string])[] = [
  ['what', 'What this is'],
  ['licence', 'Licence and provenance'],
  ['corpus', 'How the corpus was altered'],
  ['differences', 'What differs from the desktop app'],
  ['how-to', 'How to use it'],
  ['links', 'Links'],
  ['privacy', 'Privacy'],
  ['webgl', 'WebGL and the desktop build'],
  ['technical', 'Under the hood'],
  ['limitations', 'What the search does badly'],
  ['credits', 'Credits'],
]

/**
 * Three kits covering the three ways a line varies: one complete and modified,
 * one with no stored display name, one whose author and licence have no URLs.
 */
const KITS: CreditedKit[] = [
  {
    path: '/Player_Character_Pack_03_3750572',
    name: 'Player Character Pack 03',
    credits: {
      author: 'Valandar',
      authorUrl: 'https://www.thingiverse.com/Valandar',
      license: 'Creative Commons - Attribution',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://www.thingiverse.com/thing:3750572',
      modified: 're-exported as STL and decimated for display',
    },
  },
  {
    path: '/Zombie_Collection_2847691',
    credits: {
      author: 'mz4250',
      authorUrl: 'https://www.thingiverse.com/mz4250',
      license: 'Creative Commons - Attribution',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://www.myminifactory.com/object/1',
    },
  },
  {
    path: '/Tomb_3784036',
    name: 'Tomb',
    credits: {
      author: 'Anonymous',
      license: 'Creative Commons - Attribution - NonCommercial',
      sourceUrl: 'https://cults3d.com/en/3d-model/game/tomb',
    },
  },
]

/** An API client that answers `credits()` and nothing else — the only method
 *  this page calls. */
function fakeApi(credits: () => Promise<CreditedKit[]>): ApiClient {
  return { credits } as unknown as ApiClient
}

let host: HTMLDivElement
let root: Root

async function mount(api: ApiClient): Promise<void> {
  await act(async () => {
    root.render(<AboutPage api={api} />)
  })
}

const sections = (): HTMLElement[] => Array.from(host.querySelectorAll('section'))
const lines = (): HTMLElement[] => Array.from(host.querySelectorAll('#credits li'))
/** A credit field's span inside one line, as ViewerLayer addresses its rows. */
const field = (li: HTMLElement, name: string): HTMLElement | null =>
  li.querySelector<HTMLElement>(`[data-credit="${name}"]`)

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('the page as a document', () => {
  it('carries every section, in order, with its id and heading', async () => {
    await mount(fakeApi(() => Promise.resolve([])))
    expect(sections().map((s) => s.id)).toEqual(SECTIONS.map(([id]) => id))
    expect(sections().map((s) => s.querySelector('h2')?.textContent)).toEqual(
      SECTIONS.map(([, title]) => title),
    )
  })

  it('leads with a way back to the models', async () => {
    await mount(fakeApi(() => Promise.resolve([])))
    const back = host.querySelector('a')
    expect(back?.getAttribute('href')).toBe('/')
    expect(back?.textContent).toContain('Back to the models')
  })

  it('states no figure and names nothing on the host', async () => {
    await mount(fakeApi(() => Promise.resolve([])))
    const text = document.body.textContent ?? ''
    // No accuracy figure for posing or for search — the write-ups' tuned
    // numbers are marked not to publish, and a percentage would have to be
    // re-run before it could be true again.
    expect(text).not.toContain('%')
    // No location on the machine the deployment runs on: not a filesystem
    // path, not a cache directory (`feature-report`'s host-details rule).
    for (const prefix of ['/run/', '/srv/', '/home/', '/opt/']) {
      expect(text).not.toContain(prefix)
    }
    expect(text).not.toMatch(/cache/i)
    // The privacy line does talk about storage — the browser's own, which is
    // not a location on the host and is exactly what the requirement asks the
    // page to say.
    // Whitespace collapsed before matching: JSX wraps the sentence across
    // source lines, so the rendered text carries the indentation.
    const privacy = (host.querySelector('#privacy')?.textContent ?? '').replace(/\s+/g, ' ')
    expect(privacy).toContain('browser’s own storage')
  })
})

describe('the credits list', () => {
  it('draws one line per kit, with the lightbox’s links', async () => {
    await mount(fakeApi(() => Promise.resolve(KITS)))
    expect(lines()).toHaveLength(3)
    const [first, second, third] = lines() as [HTMLElement, HTMLElement, HTMLElement]

    // The display name where one is stored…
    expect(first.textContent).toContain('Player Character Pack 03')
    // …and the kit's own folder name where none is.
    expect(second.textContent).toContain('Zombie_Collection_2847691')

    const author = field(first, 'author')?.querySelector('a')
    expect(author?.getAttribute('href')).toBe('https://www.thingiverse.com/Valandar')
    expect(author?.getAttribute('target')).toBe('_blank')
    expect(author?.getAttribute('rel')).toBe('noreferrer')
    expect(author?.getAttribute('title')).toBe('https://www.thingiverse.com/Valandar')
    expect(author?.textContent).toBe('Valandar')

    const license = field(first, 'license')?.querySelector('a')
    expect(license?.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(license?.textContent).toBe('Creative Commons - Attribution')

    // The source link is labelled with its host, not spelt out, and the whole
    // URL rides the `title` — `hostLabel`'s rule, shared with the panel.
    const source = field(first, 'source')?.querySelector('a')
    expect(source?.textContent).toBe('thingiverse.com')
    expect(source?.getAttribute('title')).toBe('https://www.thingiverse.com/thing:3750572')
    expect(field(second, 'source')?.querySelector('a')?.textContent).toBe('myminifactory.com')

    // A stored URL is optional per field: no link, but the label still shows.
    expect(field(third, 'author')?.querySelector('a')).toBeNull()
    expect(field(third, 'author')?.textContent).toContain('Anonymous')
    expect(field(third, 'license')?.querySelector('a')).toBeNull()
    expect(field(third, 'license')?.textContent).toContain('NonCommercial')
  })

  it('draws the modification phrase only where the store holds one', async () => {
    await mount(fakeApi(() => Promise.resolve(KITS)))
    const [first, second, third] = lines() as [HTMLElement, HTMLElement, HTMLElement]
    expect(field(first, 'modified')?.textContent).toContain(
      're-exported as STL and decimated for display',
    )
    expect(field(second, 'modified')).toBeNull()
    expect(field(third, 'modified')).toBeNull()
  })

  it('says so rather than rendering empty when the store holds no credits', async () => {
    await mount(fakeApi(() => Promise.resolve([])))
    expect(lines()).toHaveLength(0)
    expect(host.querySelector('#credits')?.textContent).toContain('The store holds no credits.')
  })

  it('says the list is missing when the read fails', async () => {
    await mount(fakeApi(() => Promise.reject(new Error('offline'))))
    expect(host.querySelector('#credits')?.textContent).toContain(
      'The credits could not be loaded.',
    )
  })

  it('shows a loading line until the answer arrives', async () => {
    let settle: (kits: CreditedKit[]) => void = () => {}
    const pending = new Promise<CreditedKit[]>((resolve) => {
      settle = resolve
    })
    await mount(fakeApi(() => pending))
    expect(host.querySelector('#credits')?.textContent).toContain('Loading')
    await act(async () => {
      settle(KITS)
    })
    expect(lines()).toHaveLength(3)
  })
})
