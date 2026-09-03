// @vitest-environment happy-dom
//
// Tiles render the name the library's override store holds (`library-overrides`
// 2.4 / D7): where it is drawn, what keeps the real name, and what a library
// with no store looks like — which must be exactly what it looked like before
// this capability existed.
//
// The label half is asserted against `Grid` directly: `displayName` rides the
// listing entry, so the whole rule is a function of props and a mounted App
// would only add a server to mock. The matching half needs App, because the
// find filter is App's.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing } from '../../shared/types'
import Grid from '../src/components/Grid'
import type { ThumbState } from '../src/hooks/useThumbnails'
import {
  dir,
  findInput,
  labels,
  listDir,
  model,
  mountApp,
  openFind,
  settle,
  tiles,
  type as typeInto,
  unmountApp,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

/** The demo corpus's own shape: a stem on disk, a title in the store. */
const STEM = 'Player_Character_Pack_03_3750572'
const TITLE = 'Player Character Pack 03'

function named(entry: DirEntry, displayName: string): DirEntry {
  return { ...entry, displayName }
}

// ---------------------------------------------------------------- Grid alone

let host: HTMLElement
let gridRoot: Root | null = null

/** Render `Grid` over these entries, with the folder previews it should draw. */
async function renderGrid(
  entries: DirEntry[],
  previews: ReadonlyMap<string, DirEntry[]> = new Map(),
): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  gridRoot = createRoot(host)
  await act(async () => {
    gridRoot!.render(
      <Grid
        entries={entries}
        thumbs={new Map<string, ThumbState>()}
        onEnter={() => {}}
        onModelPointerDown={() => {}}
        onModelOpen={() => {}}
        onModelHover={() => {}}
        onEntryMenu={() => {}}
        onImageError={() => {}}
        markedPath={null}
        scoreFor={() => undefined}
        scoreScale={null}
        previews={previews}
        onPeek={() => {}}
        onBands={() => {}}
        scrollRoot={{ current: document.body }}
      />,
    )
  })
}

const gridTiles = (): HTMLButtonElement[] =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
const tileFor = (path: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(`[data-entry-tile="${path}"]`)!
/** A tile's label — the last child of its button, as the harness reads them. */
const labelOf = (el: HTMLElement): string => el.lastElementChild?.textContent ?? ''
const cellTitles = (path: string): (string | null)[] =>
  Array.from(tileFor(path).querySelectorAll<HTMLElement>('[data-preview-cell]')).map((c) =>
    c.getAttribute('title'),
  )

describe('a tile labels itself with the stored name', () => {
  afterEach(async () => {
    await act(async () => gridRoot?.unmount())
    host.remove()
    gridRoot = null
  })

  it('shows a kit’s title while its own title and accessible name stay the real name', async () => {
    await renderGrid([named(dir(STEM), TITLE), model('hero.stl')])
    const kit = tileFor(`/models/${STEM}`)

    expect(labelOf(kit)).toBe(TITLE)
    // Two same-named kits are told apart by the folder on disk, and the disk is
    // what the user greps — so the real name stays reachable in both places a
    // reader or a screen reader would look.
    expect(kit.getAttribute('title')).toBe(STEM)
    // "folder " keeps the type signal the button-level label would drop; the
    // real name remains in the accessible name, as the delta requires.
    expect(kit.getAttribute('aria-label')).toBe(`folder ${STEM}`)
  })

  it('names a zip without calling it a folder', async () => {
    // The non-model branch serves zips too, and the server keys any entry the
    // store names — a hand-written store can name an archive. The stored name
    // renders, the real name keeps the accessible name, and no "folder" prefix
    // appears: a zip is not a folder (review round five — before the kind
    // split, a named zip announced "folder pack.zip").
    await renderGrid([
      named(
        { name: 'pack.zip', path: '/models/pack.zip', kind: 'zip' as const, size: 5, mtime: 1 },
        'The Pack',
      ),
    ])
    const zip = tileFor('/models/pack.zip')
    expect(labelOf(zip)).toBe('The Pack')
    expect(zip.getAttribute('title')).toBe('pack.zip')
    expect(zip.getAttribute('aria-label')).toBe('pack.zip')
  })

  it('leaves an unnamed model beneath it labelled from its file name', async () => {
    // `name` never inherits (D2/D7): the store names the kit, and thirty models
    // inside it are not thirty copies of the kit.
    await renderGrid([named(dir(STEM), TITLE), model(`${STEM}/hero.stl`)])

    expect(labelOf(tileFor(`/models/${STEM}/hero.stl`))).toBe('hero.stl')
    expect(tileFor(`/models/${STEM}/hero.stl`).getAttribute('title')).toBe(`${STEM}/hero.stl`)
  })

  it('labels a named model tile too, without touching what it announces', async () => {
    const hero = named(model('hero.stl'), 'The Hero')
    await renderGrid([hero])
    const el = tileFor('/models/hero.stl')

    expect(labelOf(el)).toBe('The Hero')
    expect(el.getAttribute('title')).toBe('hero.stl')
    // This button already states the real name in its own `aria-label`, so the
    // display name changes nothing about what is announced.
    expect(el.getAttribute('aria-label')).toBe('hero.stl')
  })

  it('gives a sheet cell the stored name, which is the only name a cell shows', async () => {
    // A preview cell has no visible label — its `title` is its label, and takes
    // the stored name for the same reason a tile's span does. The folder tile's
    // own title, on the button, still carries the real name.
    const kit = dir(STEM)
    await renderGrid(
      [kit],
      new Map([[kit.path, [named(model('a/hero.stl'), 'The Hero'), model('a/plain.stl')]]]),
    )

    expect(cellTitles(kit.path)).toEqual(['The Hero', 'a/plain.stl'])
    expect(tileFor(kit.path).getAttribute('title')).toBe(STEM)
  })

  it('is byte-identical on a library with no store', async () => {
    // The whole migration promise in one cell: nothing carries a display name,
    // so every label is what it was and no tile grew an attribute.
    await renderGrid([dir('Alpha'), dir('kit.zip'), model('Alpha/hero.stl')])

    expect(gridTiles().map(labelOf)).toEqual(['Alpha', 'kit.zip', 'hero.stl'])
    expect(tileFor('/models/Alpha').hasAttribute('aria-label')).toBe(false)
    expect(tileFor('/models/kit.zip').hasAttribute('aria-label')).toBe(false)
    expect(tileFor('/models/Alpha/hero.stl').getAttribute('aria-label')).toBe('Alpha/hero.stl')
  })
})

// ------------------------------------------------------------- through App

const LISTING: DirListing = {
  path: '/models',
  entries: [named(dir(STEM), TITLE), model('hero.stl')],
}

describe('matching still reads the real name', () => {
  beforeEach(async () => {
    await mountApp('/models', LISTING)
    listDir.mockResolvedValue(LISTING)
  })
  afterEach(async () => {
    await unmountApp()
  })

  it('finds the kit by its stem and not by its stored title', async () => {
    // Display only — the deciding question of `web-demo-backlog` 2.3. The
    // fragments are chosen so neither name can answer for the other: `3750572`
    // appears in the stem alone, and `character pack` (spaced) in the title
    // alone, since the stem spells it with underscores.
    expect(labels()).toEqual([TITLE, 'hero.stl'])

    await openFind()
    await typeInto(findInput()!, '3750572')
    await settle()
    expect(labels()).toEqual([TITLE])

    await typeInto(findInput()!, 'character pack')
    await settle()
    expect(tiles()).toHaveLength(0)
  })
})
