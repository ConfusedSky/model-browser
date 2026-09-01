// @vitest-environment happy-dom
//
// Folder tiles preview their contents (folder-contact-sheets §2): when a peek
// is asked for, what a sheet draws, and what one listing's map is allowed to
// carry into the next.
//
// The no-reset family ("a peek landing resets nothing") was deferred until
// `ao-refreshes-thumbnails`' reconciler existed — asserting it against the old
// resetting sweep would have pinned behaviour this change did not own. The
// reconciler landed 2026-08-31; the last describe block below is that family.
import { act } from 'react'
import { zipSync } from 'fflate'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  flatButton,
  fetchModel,
  getThumb,
  listDir,
  model,
  mountApp,
  peek,
  putThumb,
  renderThumbnail,
  semanticPosesFor,
  settle,
  tiles,
  unmountApp,
} from './appHarness'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)
// Spread and override exactly one function: the embedded-3MF test hands the LRU
// loader a zip that carries a thumbnail and nothing else, which is enough for
// the real `embedded3mfThumbnail` to find a preview but not enough for three's
// ThreeMFLoader to build a mesh. Everything else — `formatOf`,
// `embedded3mfThumbnail`, `geometryBytes`, `disposeModel` — stays real, so the
// placeholder still travels App's own `placeholderRef` path.
vi.mock('../src/three/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/models')>()),
  parseModel: vi.fn(() => new THREE.Group()),
}))

/**
 * happy-dom ships an `IntersectionObserver` whose `observe` and `disconnect`
 * are literally `// TODO: Implement`, so a real one would never report anything
 * and every test here would pass by never running. This is the smallest thing
 * that can: it records what the grid observes and lets a test say "this tile is
 * now on screen".
 */
class StubObserver {
  static live: StubObserver[] = []
  readonly targets = new Set<Element>()
  private connected = true
  constructor(readonly callback: IntersectionObserverCallback) {
    StubObserver.live.push(this)
  }
  observe(el: Element): void {
    this.targets.add(el)
  }
  unobserve(el: Element): void {
    this.targets.delete(el)
  }
  disconnect(): void {
    this.targets.clear()
    this.connected = false
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  /** Whether this observer is still the grid's — a torn-down one must not
   *  answer, or a re-rendered grid would report each tile twice. */
  get live(): boolean {
    return this.connected
  }
}

/** Report `el` as on screen to whichever live observer is watching it. */
async function intersect(el: Element): Promise<void> {
  await act(async () => {
    for (const observer of StubObserver.live) {
      if (!observer.live || !observer.targets.has(el)) continue
      observer.callback(
        [{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      )
    }
  })
  await settle()
}

function dirTile(path: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-dir-tile="${path}"]`)
  if (el === null) throw new Error(`no folder tile for ${path}`)
  return el
}
function sheet(path: string): HTMLElement | null {
  return dirTile(path).querySelector<HTMLElement>('[data-preview-sheet]')
}
function cells(path: string): HTMLElement[] {
  return Array.from(dirTile(path).querySelectorAll<HTMLElement>('[data-preview-cell]'))
}
/**
 * The empty folder — what a tile with nothing to preview shows. The chrome is
 * unconditional for dir tiles, so the load-bearing half here is "no sheet";
 * the chrome check bites only under a regression that removes the chrome
 * itself (e.g. reverting to an emoji), which is what it is for.
 */
function hasIcon(path: string): boolean {
  const tile = dirTile(path)
  return tile.querySelector('[data-folder-chrome]') !== null && tile.querySelector('[data-preview-sheet]') === null
}

/**
 * Take every tile off screen and bring it back, inside one listing — the find
 * filter unmounts the tiles it hides, and the grid re-observes what returns.
 *
 * This is the shape "scrolled away and back" takes in a test, and it is the
 * only one that reaches App's own guard: a *second* report of a tile that was
 * never unmounted is stopped earlier, by the observer's `unobserve`.
 */
async function awayAndBack(): Promise<void> {
  const { openFind, findInput, type } = await import('./appHarness')
  await openFind()
  await type(findInput()!, 'zzzzzz')
  await settle()
  await type(findInput()!, '')
  await settle()
}

const ONE_FOLDER: DirListing = { path: '/models', entries: [dir('a')] }

/** `n` previewable models inside /models/a. */
function found(n: number): DirEntry[] {
  return Array.from({ length: n }, (_, i) => model(`a/m${i}.stl`))
}

beforeEach(() => {
  StubObserver.live = []
  vi.stubGlobal('IntersectionObserver', StubObserver)
})
afterEach(() => unmountApp())

describe('folder contact sheets', () => {
  it('asks for no preview until the tile is on screen, then asks exactly once', async () => {
    peek.mockResolvedValue(found(2))
    await mountApp('/models', ONE_FOLDER)

    // On screen is the trigger, not being listed: a grid of 297 folders must
    // not cost 297 requests on first paint (D1).
    expect(peek).not.toHaveBeenCalled()

    await intersect(dirTile('/models/a'))
    expect(peek.mock.calls).toEqual([['/models/a']])

    // A second report of the same tile. Stopped by the observer, which drops a
    // tile the moment it has asked — the map guard is a separate mechanism and
    // has its own test below.
    await intersect(dirTile('/models/a'))
    expect(peek).toHaveBeenCalledTimes(1)
  })

  it('reuses the map for a tile scrolled away and back inside one listing', async () => {
    peek.mockResolvedValue(found(2))
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))
    expect(peek).toHaveBeenCalledTimes(1)

    // Away and back inside one listing: the answer is reused and nothing is
    // asked for a second time (D1).
    await awayAndBack()
    await intersect(dirTile('/models/a'))
    expect(peek).toHaveBeenCalledTimes(1)
    // And it came back with its sheet, not with an icon.
    expect(cells('/models/a')).toHaveLength(2)
  })

  it('wears its chrome before the peek answers, and the landing fills it in place', async () => {
    // The chrome is the directory tile's icon, not a reward for having
    // previews: it stands from first paint, and a landing fills the same node
    // rather than swapping an emoji for a folder — the pop-in this rule
    // exists to stop (Masa, 2026-08-31).
    let answer!: (entries: DirEntry[]) => void
    peek.mockReturnValue(new Promise<DirEntry[]>((resolve) => (answer = resolve)))
    await mountApp('/models', ONE_FOLDER)
    const chrome = dirTile('/models/a').querySelector('[data-folder-chrome]')
    expect(chrome).not.toBeNull()
    await intersect(dirTile('/models/a'))
    await act(async () => answer(found(2)))
    await settle()
    expect(dirTile('/models/a').querySelector('[data-folder-chrome]')).toBe(chrome)
    expect(chrome!.querySelector('[data-preview-sheet]')).not.toBeNull()
  })

  it('keeps the archive icon on a zip tile, chrome-free', async () => {
    // Zips are never previewed and are not folders: no chrome, no observer
    // registration, the emoji stands. Unfalsified until now (review's catch —
    // emptying the emoji span passed every test in the repo).
    await mountApp('/models', {
      path: '/models',
      entries: [{ name: 'pack.zip', path: '/models/pack.zip', kind: 'zip' as const, size: 5, mtime: 1 }],
    })
    const zip = container.querySelector('[data-entry-tile="/models/pack.zip"]')!
    expect(zip.querySelector('[data-folder-chrome]')).toBeNull()
    expect(Array.from(zip.querySelectorAll('span')).some((s) => s.textContent === '🗜️')).toBe(true)
  })

  it('draws one preview full size', async () => {
    peek.mockResolvedValue(found(1))
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))

    expect(cells('/models/a')).toHaveLength(1)
    // One image, not one quadrant and three blanks (D4).
    expect(sheet('/models/a')!.className).toContain('grid-cols-1')
    expect(hasIcon('/models/a')).toBe(false)
  })

  it('draws two previews side by side', async () => {
    peek.mockResolvedValue(found(2))
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))

    const two = cells('/models/a')
    expect(two).toHaveLength(2)
    expect(sheet('/models/a')!.className).toContain('grid-cols-2')
    // One row of two — neither spans, no empty cell (D4).
    expect(two.every((c) => !c.className.includes('col-span-2'))).toBe(true)
  })

  it('draws three previews as two above one', async () => {
    peek.mockResolvedValue(found(3))
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))

    const three = cells('/models/a')
    expect(three).toHaveLength(3)
    expect(sheet('/models/a')!.className).toContain('grid-cols-2')
    // The odd one takes the whole row below the pair — no empty cell (D4).
    expect(three[0]!.className).not.toContain('col-span-2')
    expect(three[1]!.className).not.toContain('col-span-2')
    expect(three[2]!.className).toContain('col-span-2')
  })

  it('draws four previews as the 2×2 grid', async () => {
    peek.mockResolvedValue(found(4))
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))

    const four = cells('/models/a')
    expect(four).toHaveLength(4)
    expect(sheet('/models/a')!.className).toContain('grid-cols-2')
    expect(four.every((c) => !c.className.includes('col-span-2'))).toBe(true)
    // In peek order, which is the walk's order and therefore deterministic.
    expect(four.map((c) => c.dataset.previewCell)).toEqual([
      '/models/a/m0.stl',
      '/models/a/m1.stl',
      '/models/a/m2.stl',
      '/models/a/m3.stl',
    ])
  })

  it('keeps the icon for a folder that previews nothing', async () => {
    peek.mockResolvedValue([])
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))

    expect(sheet('/models/a')).toBeNull()
    expect(hasIcon('/models/a')).toBe(true)
  })

  it('keeps the icon while the peek is in flight', async () => {
    let answer!: (entries: DirEntry[]) => void
    peek.mockReturnValue(new Promise<DirEntry[]>((resolve) => (answer = resolve)))
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))

    // Asked for, unanswered: the tile shows what it always showed rather than
    // blanking or spinning (D4).
    expect(peek).toHaveBeenCalledTimes(1)
    expect(hasIcon('/models/a')).toBe(true)
    expect(sheet('/models/a')).toBeNull()

    await act(async () => answer(found(2)))
    await settle()
    expect(cells('/models/a')).toHaveLength(2)
  })

  it('keeps the icon when the peek fails, and the rest of the grid is unaffected', async () => {
    peek.mockRejectedValue(new Error('network down'))
    await mountApp('/models', {
      path: '/models',
      entries: [dir('a'), model('b.stl')],
    })
    await intersect(dirTile('/models/a'))

    expect(hasIcon('/models/a')).toBe(true)
    expect(sheet('/models/a')).toBeNull()
    // The neighbouring model tile still drew its own thumbnail.
    expect(container.querySelector('[data-model-tile="/models/b.stl"] img')).not.toBeNull()
    expect(tiles()).toHaveLength(2)

    // And it is not retried within this listing — a failure is an answer, and
    // the empty list it stores is what says so.
    await awayAndBack()
    await intersect(dirTile('/models/a'))
    expect(peek).toHaveBeenCalledTimes(1)
    expect(hasIcon('/models/a')).toBe(true)
  })

  it('keeps the icon when the library is not ready', async () => {
    const { HttpError } = (await import('./appHarness')).apiClientModule() as {
      HttpError: new (status: number, message: string, state?: string) => Error
    }
    peek.mockRejectedValue(new HttpError(503, 'library is not configured', 'unconfigured'))
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))

    expect(hasIcon('/models/a')).toBe(true)
    expect(sheet('/models/a')).toBeNull()
  })

  it('shares one thumbnail entry with the model tile showing the same model', async () => {
    // A flat listing shows both the folder and a model inside it — the same
    // path twice on screen, which must still be one entry in the pipeline.
    const shared = model('a/one.stl')
    peek.mockResolvedValue([shared])
    await mountApp('/models', { path: '/models', entries: [dir('a'), shared] })
    await intersect(dirTile('/models/a'))

    const lookups = getThumb.mock.calls.filter((c) => c[0] === '/models/a/one.stl')
    expect(lookups).toHaveLength(1)
    expect(renderThumbnail).toHaveBeenCalledTimes(1)

    // One render, two images — the cell and the tile draw the same thumbnail.
    const cell = cells('/models/a')[0]!.querySelector('img')
    const tile = container.querySelector<HTMLImageElement>('[data-model-tile="/models/a/one.stl"] img')
    expect(cell).not.toBeNull()
    expect(tile).not.toBeNull()
    expect(cell!.getAttribute('src')).toBe(tile!.getAttribute('src'))
  })

  it('shows an embedded 3MF placeholder in a sheet cell as it would on a tile', async () => {
    const preview = model('a/p.3mf')
    preview.format = '3mf'
    peek.mockResolvedValue([preview])
    // A 3MF carrying only its preview image: enough for the embedded thumbnail
    // to be found on the way past, which is where `setPlaceholder` is called.
    const zip = zipSync({ 'Metadata/thumbnail.png': new Uint8Array([1, 2, 3, 4]) })
    const bytes = new ArrayBuffer(zip.byteLength)
    new Uint8Array(bytes).set(zip)
    fetchModel.mockImplementation((path: string) =>
      Promise.resolve(path === '/models/a/p.3mf' ? bytes : new ArrayBuffer(0)),
    )
    // Held open, so the cell stays on the placeholder rather than racing to the
    // real render — the placeholder is what this test is about.
    renderThumbnail.mockImplementation(() => new Promise<Blob>(() => {}))

    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))

    const img = cells('/models/a')[0]!.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('blob:m')
  })

  it('clears the map on navigation, and the new listing peeks for itself', async () => {
    peek.mockResolvedValue(found(2))
    await mountApp('/models', ONE_FOLDER)
    // After the mount, never before: `mountApp` resets `listDir` and points it
    // at the initial listing, so an implementation installed earlier is thrown
    // away — and every landing would then answer with the *same* listing
    // object, which is legitimately not a listing change at all.
    listDir.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/models' ? ONE_FOLDER : { path: '/models/a', entries: [dir('a/inner')] },
      ),
    )
    await intersect(dirTile('/models/a'))
    expect(cells('/models/a')).toHaveLength(2)

    await click(dirTile('/models/a'))
    await settle()

    // A different listing: nothing carried over, and its own folder starts from
    // the icon.
    expect(container.querySelector('[data-preview-sheet]')).toBeNull()
    expect(hasIcon('/models/a/inner')).toBe(true)

    await intersect(dirTile('/models/a/inner'))
    expect(peek.mock.calls).toEqual([['/models/a'], ['/models/a/inner']])
    expect(cells('/models/a/inner')).toHaveLength(2)
  })

  it('drops a peek that answers after the listing changed', async () => {
    let answer!: (entries: DirEntry[]) => void
    peek.mockReturnValueOnce(new Promise<DirEntry[]>((resolve) => (answer = resolve)))
    // The flat toggle lands a genuinely new listing that still contains
    // /models/a — the only shape in which a stale write would be visible at
    // all, and a listing change that is not a navigation.
    const FLAT: DirListing = {
      path: '/models',
      entries: [dir('a'), model('a/deep.stl')],
      truncated: true,
    }
    await mountApp('/models', ONE_FOLDER)
    // Installed after the mount, for the reason the navigation test gives.
    listDir.mockImplementation((_p: string, opts?: { flat?: boolean }) =>
      Promise.resolve(opts?.flat === true ? FLAT : ONE_FOLDER),
    )
    await intersect(dirTile('/models/a'))
    expect(peek).toHaveBeenCalledTimes(1)

    await click(flatButton())
    await settle()
    expect(hasIcon('/models/a')).toBe(true)

    // The abandoned listing's answer arrives now. It is about a folder the new
    // listing also shows, so nothing but the generation check keeps it out.
    peek.mockResolvedValue(found(3))
    await act(async () => answer(found(2)))
    await settle()
    expect(sheet('/models/a')).toBeNull()
    expect(hasIcon('/models/a')).toBe(true)

    // And the folder is peekable again in the listing now on screen.
    await intersect(dirTile('/models/a'))
    expect(peek).toHaveBeenCalledTimes(2)
    expect(cells('/models/a')).toHaveLength(3)
  })

  it("a superseded peek cannot clear its successor's in-flight marker", async () => {
    // The marker set is keyed by path alone, so an old listing's answer
    // arriving while the new listing's request for the same folder is in
    // flight must not delete the marker that guards it — the generation check
    // runs before the delete. Found in review; the failure is a duplicate
    // request on the next re-report, not wrong data.
    let answer1!: (entries: DirEntry[]) => void
    let answer2!: (entries: DirEntry[]) => void
    peek
      .mockReturnValueOnce(new Promise<DirEntry[]>((resolve) => (answer1 = resolve)))
      .mockReturnValueOnce(new Promise<DirEntry[]>((resolve) => (answer2 = resolve)))
    const FLAT: DirListing = {
      path: '/models',
      entries: [dir('a'), model('a/deep.stl')],
      truncated: true,
    }
    await mountApp('/models', ONE_FOLDER)
    listDir.mockImplementation((_p: string, opts?: { flat?: boolean }) =>
      Promise.resolve(opts?.flat === true ? FLAT : ONE_FOLDER),
    )
    await intersect(dirTile('/models/a')) // peek #1, listing L1, held open
    await click(flatButton()) // L2 lands; the clearing effect wipes the marker set
    await settle()
    await intersect(dirTile('/models/a')) // peek #2, listing L2, held open
    expect(peek).toHaveBeenCalledTimes(2)

    // L1's answer arrives while #2 is still in flight.
    await act(async () => answer1([model('a/stale.stl')]))
    await settle()

    // A re-report of the tile (the find filter rebuilds the observer) must be
    // stopped by #2's marker — a third request means the stale landing
    // stripped it.
    await awayAndBack()
    await intersect(dirTile('/models/a'))
    expect(peek).toHaveBeenCalledTimes(2)

    // #2 answers normally and the sheet appears.
    await act(async () => answer2(found(2)))
    await settle()
    expect(cells('/models/a')).toHaveLength(2)
  })
})

describe('a sheet cell follows the index', () => {
  // getThumb's IMPLEMENTATION survives mount's mockClear — restore the
  // miss-everything default so later cells count renders, not this cell's hits.
  afterEach(() => getThumb.mockResolvedValue({ status: 'miss' }))

  it('re-renders a preview whose cached thumbnail predates its pose', async () => {
    // The listing wave asks about what LANDED, and preview models never land —
    // so a stale-posed sheet cell kept its old angle until the user walked
    // into the folder (Masa's report, 2026-09-01). The previews' own wave
    // closes the gap: the pose arrives, the sweep's by-value comparison sees
    // it, and the cell re-renders posed.
    const POSE = {
      up: [0, 1, 0],
      azimuth_zero: [1, 0, 0],
      source: 'siglip',
      confidence: 0.9,
      front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
    }
    peek.mockResolvedValue(found(1))
    semanticPosesFor.mockImplementation((paths: string[]) =>
      Promise.resolve(
        paths.includes('/models/a/m0.stl') ? { poses: { '/models/a/m0.stl': POSE } } : { poses: {} },
      ),
    )
    // A cache hit with current recipe labels but no stored framing and no pose
    // stamp — exactly the entry that is stale the moment the index speaks.
    getThumb.mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:stale',
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
    })
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))
    await settle()

    // The previews' wave asked about the preview path...
    expect(semanticPosesFor.mock.calls.some((c) => (c[0] as string[]).includes('/models/a/m0.stl'))).toBe(true)
    // ...and the landing pose re-rendered the cell: the PUT carries the pose
    // stamp, which only the posed re-render writes.
    const posedPut = putThumb.mock.calls.find(
      (c) => c[0].path === '/models/a/m0.stl' && c[0].posed !== undefined,
    )
    expect(posedPut).toBeDefined()
  })
})

// The deferred D3 family (folder-contact-sheets 2.4), written once
// `ao-refreshes-thumbnails`' reconciler landed: a peek landing grows
// `thumbEntries`, and the reconciler must start work for the added paths only,
// leaving every pre-existing tile and sheet cell untouched. DOM *node*
// identity is the sharp assertion — a reset unmounts the `<img>` and mints a
// new one even if the same picture comes back, so a preserved node is proof
// the state was never torn down.
describe('a peek landing resets nothing (D3)', () => {
  const TWO_FOLDERS: DirListing = {
    path: '/models',
    entries: [dir('a'), dir('c'), model('b.stl')],
  }
  const peekByPath = () =>
    peek.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/models/a'
          ? [model('a/one.stl')]
          : path === '/models/c'
            ? [model('c/two.stl')]
            : [],
      ),
    )

  it('keeps every shown tile and sheet cell, and looks up only the added paths', async () => {
    peekByPath()
    await mountApp('/models', TWO_FOLDERS)
    await intersect(dirTile('/models/a'))
    await settle()

    // Everything on screen has landed: the model tile and a's sheet cell.
    const bImg = container.querySelector('[data-model-tile="/models/b.stl"] img')
    const aCellImg = cells('/models/a')[0]!.querySelector('img')
    expect(bImg).not.toBeNull()
    expect(aCellImg).not.toBeNull()
    const lookupsBefore = getThumb.mock.calls.length
    const rendersBefore = renderThumbnail.mock.calls.length

    // The second folder's peek lands and grows thumbEntries.
    await intersect(dirTile('/models/c'))
    await settle()

    // Only the added path issued a lookup and a render — nothing pre-existing
    // was re-evaluated.
    expect(getThumb.mock.calls.slice(lookupsBefore).map((c) => c[0])).toEqual([
      '/models/c/two.stl',
    ])
    expect(renderThumbnail.mock.calls.length).toBe(rendersBefore + 1)

    // And nothing pre-existing was torn down: the same DOM nodes stand.
    expect(container.querySelector('[data-model-tile="/models/b.stl"] img')).toBe(bImg)
    expect(cells('/models/a')[0]!.querySelector('img')).toBe(aCellImg)
    expect(cells('/models/c')[0]!.querySelector('img')).not.toBeNull()
  })

  it('leaves an in-flight render running rather than restarting it', async () => {
    peekByPath()
    // b.stl's render never resolves inside this cell: the tile is mid-flight
    // when the peek lands, which is exactly the state a reset would tear down
    // and restart.
    const releases: ((png: Blob) => void)[] = []
    renderThumbnail.mockImplementation(
      () => new Promise<Blob>((resolve) => releases.push(resolve)),
    )
    await mountApp('/models', TWO_FOLDERS)
    await settle()
    const bLookups = () => getThumb.mock.calls.filter((c) => c[0] === '/models/b.stl').length
    expect(bLookups()).toBe(1)

    await intersect(dirTile('/models/a'))
    await settle()

    // The peek landed and b.stl is still the one in-flight job it was — not
    // cancelled, not re-looked-up, not restarted.
    expect(bLookups()).toBe(1)

    // Release every held render; the mid-flight tile completes normally.
    await act(async () => {
      for (const r of releases) r(new Blob())
    })
    await settle()
    expect(container.querySelector('[data-model-tile="/models/b.stl"] img')).not.toBeNull()
  })
})
