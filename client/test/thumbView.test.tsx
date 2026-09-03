// @vitest-environment happy-dom
//
// The tile image's placeholder (`thumbnail-image-serving` D3, review F13 and
// R12): an image drawn from the listing is fetched lazily, so the spinner
// stays up over the declared box until the image's `load` — and only until the
// *first* picture this view has shown, so a later URL never hides pixels that
// are already on screen. Asserted against `Grid` directly: the rule is a
// function of the thumb state and the browser's `load` event, which happy-dom
// never fires for an image URL, so the cells dispatch it.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry } from '../../shared/types'
import Grid from '../src/components/Grid'
import type { ThumbState } from '../src/hooks/useThumbnails'
import { dir, model } from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

let host: HTMLElement
let root: Root | null = null
const ENTRY: DirEntry = model('one.stl')
const IMAGE_URL = '/api/thumb/image?path=%2Fmodels%2Fone.stl&mtime=1&gen=5'
const IMAGE_URL_6 = '/api/thumb/image?path=%2Fmodels%2Fone.stl&mtime=1&gen=6'

async function renderTile(thumb: ThumbState, entry: DirEntry = ENTRY): Promise<void> {
  if (root === null) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  await act(async () => {
    root!.render(
      <Grid
        entries={[entry]}
        thumbs={new Map([[ENTRY.path, thumb]])}
        onEnter={() => {}}
        onModelPointerDown={() => {}}
        onModelOpen={() => {}}
        onModelHover={() => {}}
        onEntryMenu={() => {}}
        onImageError={() => {}}
        markedPath={null}
        scoreFor={() => undefined}
        scoreScale={null}
        previews={new Map()}
        onPeek={() => {}}
        onBands={() => {}}
        scrollRoot={{ current: document.body }}
      />,
    )
  })
}
const img = (): HTMLImageElement => host.querySelector('img')!
const hidden = (): boolean => img().classList.contains('opacity-0')
const spinner = (): boolean => host.querySelector('.animate-spin') !== null
const load = (): Promise<void> =>
  act(async () => {
    img().dispatchEvent(new Event('load'))
  })

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  host?.remove()
  root = null
})

describe('the tile image’s placeholder', () => {
  it('keeps the spinner over the box until a listing-drawn image loads, then drops it', async () => {
    await renderTile({ status: 'ready', url: IMAGE_URL, gen: 5 })
    expect(img().getAttribute('loading')).toBe('lazy')
    expect(hidden()).toBe(true)
    expect(spinner()).toBe(true)
    await load()
    expect(hidden()).toBe(false)
    expect(spinner()).toBe(false)
  })

  it('never hides a picture the client already holds', async () => {
    await renderTile({ status: 'ready', url: 'blob:mint0' })
    expect(hidden()).toBe(false)
    expect(spinner()).toBe(false)
  })

  it('a view that has shown a picture does not re-hide it for a later image URL', async () => {
    // Review R12: a survivor re-vouched at a new generation moves from one
    // image URL to another; the browser keeps the old pixels up until the new
    // ones arrive, and a spinner over them would discard a picture on screen.
    await renderTile({ status: 'ready', url: IMAGE_URL, gen: 5 })
    await load()
    await renderTile({ status: 'ready', url: IMAGE_URL_6, gen: 6 })
    expect(img().getAttribute('src')).toBe(IMAGE_URL_6)
    expect(hidden()).toBe(false)
    expect(spinner()).toBe(false)
  })

  it('a folder sheet’s cell follows the same rule, keyed on its own entry', async () => {
    // Fourth review, R6: `ContactSheet` carries its own copy of the key and
    // the placeholder, pinned on the tile only until here.
    const folder = dir('a')
    const cell = model('a/m0.stl')
    const cellUrl = '/api/thumb/image?path=%2Fmodels%2Fa%2Fm0.stl&mtime=1&gen=5'
    const renderSheet = async (thumb: ThumbState, entry: DirEntry = cell): Promise<void> => {
      if (root === null) {
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
      }
      await act(async () => {
        root!.render(
          <Grid
            entries={[folder]}
            thumbs={new Map([[entry.path, thumb]])}
            onEnter={() => {}}
            onModelPointerDown={() => {}}
            onModelOpen={() => {}}
            onModelHover={() => {}}
            onEntryMenu={() => {}}
            onImageError={() => {}}
            markedPath={null}
            scoreFor={() => undefined}
            scoreScale={null}
            previews={new Map([[folder.path, [entry]]])}
            onPeek={() => {}}
            onBands={() => {}}
            scrollRoot={{ current: document.body }}
          />,
        )
      })
    }
    await renderSheet({ status: 'ready', url: cellUrl, gen: 5 })
    const cellImg = (): HTMLImageElement => host.querySelector('[data-preview-cell] img')!
    expect(cellImg().classList.contains('opacity-0')).toBe(true)
    await act(async () => {
      cellImg().dispatchEvent(new Event('load'))
    })
    expect(cellImg().classList.contains('opacity-0')).toBe(false)
    // A new mtime is a different render: the cell starts over.
    await renderSheet(
      { status: 'ready', url: '/api/thumb/image?path=%2Fmodels%2Fa%2Fm0.stl&mtime=2&gen=7', gen: 7 },
      { ...cell, mtime: 2 },
    )
    expect(cellImg().classList.contains('opacity-0')).toBe(true)
  })

  it('starts over for a same-path entry at a new mtime — a different render, not a later URL', async () => {
    // Third review, R7: the tile is keyed by path, so the instance survived a
    // same-path new-mtime entry (a removal then an addition on one key, by
    // the hook's own rule) and drew its unloaded image at full opacity.
    await renderTile({ status: 'ready', url: IMAGE_URL, gen: 5 })
    await load()
    expect(hidden()).toBe(false)
    await renderTile(
      { status: 'ready', url: '/api/thumb/image?path=%2Fmodels%2Fone.stl&mtime=2&gen=7', gen: 7 },
      { ...ENTRY, mtime: 2 },
    )
    expect(hidden()).toBe(true)
    expect(spinner()).toBe(true)
  })
})
