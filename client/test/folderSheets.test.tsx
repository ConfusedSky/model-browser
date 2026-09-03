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
import type { DirEntry, DirListing, IndexPose } from '../../shared/types'
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
import { resetLookupQueueForTests } from '../src/hooks/useThumbnails'
import { thumbImageUrl } from '../src/api/thumbUrl'
import { aoEnabled } from '../src/viewer/aoToggle'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose } from '../src/three/pose'

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
  /** `options` identifies which of the grid's two observers this is: the band
   *  observer carries the park `rootMargin`, the visible-splitting one none —
   *  the selector `report` addresses them by (sweep-priority 5.2). */
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
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

/**
 * Deliver one record about `el` to each of the grid's two observers — the band
 * (park-margin) observer gets `inPark`, the margin-less one `inView` — so a
 * cell can express all three bands: `{inPark: true, inView: true}` is visible,
 * `{inPark: true, inView: false}` near, `{inPark: false, inView: false}` far.
 * The old `intersect` reached every observer with `true` alike, which with two
 * observers could only ever say "visible" (sweep-priority 5.2).
 */
async function report(el: Element, at: { inPark: boolean; inView: boolean }): Promise<void> {
  await act(async () => {
    for (const observer of StubObserver.live) {
      if (!observer.live || !observer.targets.has(el)) continue
      const isIntersecting = observer.options?.rootMargin !== undefined ? at.inPark : at.inView
      observer.callback(
        [{ target: el, isIntersecting } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      )
    }
  })
  await settle()
}

/** Report `el` as fully on screen. */
async function intersect(el: Element): Promise<void> {
  await report(el, { inPark: true, inView: true })
}

/** Deliver a record to ONE of the grid's observers only — the band observer
 *  for `inPark`, the margin-less one for `inView` — leaving the other half
 *  unheard. */
async function reportHalf(el: Element, half: 'inPark' | 'inView', isIntersecting: boolean): Promise<void> {
  await act(async () => {
    for (const observer of StubObserver.live) {
      if (!observer.live || !observer.targets.has(el)) continue
      const isBand = observer.options?.rootMargin !== undefined
      if ((half === 'inPark') !== isBand) continue
      observer.callback(
        [{ target: el, isIntersecting } as unknown as IntersectionObserverEntry],
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
 * This is the shape "scrolled away and back" takes in a test. Since
 * `thumbnail-sweep-priority` dropped the observer's `unobserve` (a band
 * tracker keeps watching), every repeat report — re-observed or not — reaches
 * `App`'s `requestPeek`, whose guard is the one thing standing between a
 * scroll and a duplicate peek.
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
  resetLookupQueueForTests()
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

    // A second report of the same tile. The observer no longer unobserves —
    // a band tracker keeps watching (sweep-priority 2.2) — so this repeat
    // reaches `requestPeek`, and its guard is the only thing refusing it.
    await intersect(dirTile('/models/a'))
    expect(peek).toHaveBeenCalledTimes(1)
  })

  it('draws a listing-carried preview and asks the server for nothing', async () => {
    // The derived annotation (`listing-tree-cache` 6.3/6.8): a dir entry whose
    // listing already carries `preview` lands it through the same map and
    // once-per-listing discipline the peek path uses — the delta's "a revisit
    // is one request" scenario, made literal. The first cell above is the
    // absent control: no `preview` field, exactly one peek, unchanged.
    peek.mockResolvedValue(found(4))
    const annotated: DirListing = {
      path: '/models',
      entries: [{ ...dir('a'), preview: found(2) }],
    }
    await mountApp('/models', annotated)
    await intersect(dirTile('/models/a'))
    await settle()
    // The carried choice is drawn — two cells, the sheet's own layout rules —
    // and the peek mock's four-model answer proves no request decided this.
    expect(peek).not.toHaveBeenCalled()
    expect(cells('/models/a')).toHaveLength(2)
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

  it('announces itself as a folder: the chrome carries the type signal', async () => {
    // role="img" + aria-label so a store-less dir tile's content-derived
    // accessible name reads "folder <name>" — the signal the emoji's
    // accessible-name leak used to provide by accident. Unfalsified until now
    // (review round four): deleting both attributes passed every test.
    await mountApp('/models', ONE_FOLDER)
    const chrome = dirTile('/models/a').querySelector('[data-folder-chrome]')!
    expect(chrome.getAttribute('role')).toBe('img')
    expect(chrome.getAttribute('aria-label')).toBe('folder')
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

  const poseWith = (view: number): IndexPose => ({
    up: [0, 1, 0],
    azimuth_zero: [1, 0, 0],
    source: 'siglip',
    confidence: 0.9,
    front: { view, azimuth_deg: view * 45, elevation_deg: 20 },
  })

  it('lets a landed answer win a shared path over the preview wave', async () => {
    // A model that is both a tile and a preview is asked about twice — the
    // listing wave at mount, the preview wave after the peek lands. Landed
    // answers are authoritative for shared paths ({...preview, ...listing}),
    // so the preview's later, different answer must change nothing: two
    // renders (unposed, then posed by the landing), never a third.
    const L = poseWith(2)
    const P = poseWith(6)
    semanticPosesFor
      .mockResolvedValueOnce({ poses: { '/models/b.stl': L } }) // listing wave
      .mockResolvedValueOnce({ poses: { '/models/b.stl': P } }) // preview wave
    const shared = model('b.stl')
    peek.mockResolvedValue([shared])
    await mountApp('/models', { path: '/models', entries: [dir('a'), shared] })
    await settle()
    await intersect(dirTile('/models/a'))
    await settle()

    expect(semanticPosesFor).toHaveBeenCalledTimes(2)
    const expected = cameraForPose(L, DEFAULT_CAMERA)!
    // The harness mock declares no parameters, so its calls type as empty
    // tuples — the runtime args are (object, camera, axis, ao).
    const last = renderThumbnail.mock.calls.at(-1) as unknown as unknown[]
    expect(last[1]).toEqual(expected.camera)
    expect(renderThumbnail).toHaveBeenCalledTimes(2)
  })

  it('asks again in a new listing — poses do not bleed across the clear', async () => {
    peek.mockResolvedValue(found(1))
    const FLAT = { path: '/models', entries: [dir('a'), model('a/deep.stl')], truncated: true }
    await mountApp('/models', ONE_FOLDER)
    listDir.mockImplementation((_p: string, opts?: { flat?: boolean }) =>
      Promise.resolve(opts?.flat === true ? FLAT : ONE_FOLDER),
    )
    await intersect(dirTile('/models/a'))
    const asksFor = (path: string) =>
      semanticPosesFor.mock.calls.filter((c) => (c[0] as string[]).includes(path)).length
    expect(asksFor('/models/a/m0.stl')).toBe(1)

    await click(flatButton())
    await settle()
    await intersect(dirTile('/models/a'))
    await settle()
    // The asked-set cleared with the listing: the same preview path is asked
    // about again rather than skipped on a stale memory of the last listing.
    expect(asksFor('/models/a/m0.stl')).toBe(2)
  })

  it('keeps a surviving path\'s pose across a listing change — no flap, no re-render', async () => {
    // Walking into the previewed folder is the common case: the model survives
    // as a landed entry. A wholesale previewPoses reset would send its pose
    // P → undefined → P and the sweep would retire and restart the pipeline
    // twice; the prune keeps the pose for surviving paths, so nothing
    // re-evaluates until the listing wave confirms the same value — which
    // merges to no change (review round five, measured at 2x lookups before).
    const P = poseWith(3)
    semanticPosesFor.mockResolvedValue({ poses: { '/models/a/m0.stl': P } })
    peek.mockResolvedValue(found(1))
    const INSIDE = { path: '/models/a', entries: [model('a/m0.stl')] }
    await mountApp('/models', ONE_FOLDER)
    listDir.mockImplementation((p: string) =>
      Promise.resolve(p === '/models/a' ? INSIDE : ONE_FOLDER),
    )
    await intersect(dirTile('/models/a'))
    await settle()
    const rendersBefore = renderThumbnail.mock.calls.length
    const lookupsBefore = getThumb.mock.calls.filter((c) => c[0] === '/models/a/m0.stl').length

    await click(dirTile('/models/a'))
    await settle()
    expect(getThumb.mock.calls.filter((c) => c[0] === '/models/a/m0.stl').length).toBe(lookupsBefore)
    expect(renderThumbnail.mock.calls.length).toBe(rendersBefore)
  })

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

// ─── thumbnail-sweep-priority (5.2) ─────────────────────────────────────────
// The band pipeline end to end: Grid's two observers → App's wrapper →
// useThumbnails' parking. Only an App mount has all three, which is why these
// cells live here and not in thumbnailQueue.test.tsx.

function modelTile(path: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-model-tile="${path}"]`)
  if (el === null) throw new Error(`no model tile for ${path}`)
  return el
}

/** The paths whose renders were filed — a parked model never reaches `putThumb`. */
const rendered = (): string[] => putThumb.mock.calls.map((c) => (c[0] as { path: string }).path)

/** Hold every lookup until `open()`, so a band decision can land before any
 *  tail is pushed — the real grid's misses resolve too fast to race by hand. */
function gateThumbs(): { open: (only?: string[]) => Promise<void> } {
  let opened = false
  const waiters: { path: string; go: () => void }[] = []
  getThumb.mockImplementation((path: string) =>
    opened
      ? Promise.resolve({ status: 'miss' })
      : new Promise((resolve) => waiters.push({ path, go: () => resolve({ status: 'miss' }) })),
  )
  return {
    /** Release every held lookup, or only those for `only` (the rest stay held). */
    open: async (only?: string[]) => {
      if (only === undefined) opened = true
      // Released in registration order, so a cell that releases in two
      // calls controls push order exactly — which is what lets it stage a
      // push order that contradicts the rank it asserts.
      const due = waiters.filter((w) => only === undefined || only.includes(w.path))
      for (const w of due) waiters.splice(waiters.indexOf(w), 1)
      await act(async () => {
        for (const w of due) w.go()
      })
      await settle()
    },
  }
}

/**
 * Occupy both of App's render slots with two visible blocker tiles whose
 * renders hang, so every tail released afterwards *queues* and the queue's
 * rank decides the order they run in once the blockers finish. Without this,
 * two free slots start the first two pushed jobs in push order whatever their
 * rank, and an ordering assertion over two or three tiles passes or fails by
 * lookup-resolution luck. Call after `mountApp` (which resets the renderer
 * mock), release the blockers' lookups first, then the rest.
 */
// Named to share the `alpha` token with the folder cells below use, so one
// needle can hide a single tile while keeping the blockers on screen.
const BLOCKERS = [model('alpha-b1.stl'), model('alpha-b2.stl')]
const BLOCKER_PATHS = BLOCKERS.map((b) => b.path)
function holdSlots(): { release: () => Promise<void> } {
  const finish: ((b: Blob) => void)[] = []
  for (let i = 0; i < 2; i++) {
    renderThumbnail.mockImplementationOnce(() => new Promise<Blob>((r) => finish.push(r)))
  }
  return {
    release: async () => {
      await act(async () => {
        for (const f of finish) f(new Blob())
      })
      await settle()
    },
  }
}
/** Report both blockers fully on screen and start their renders. */
async function startBlockers(gate: { open: (only?: string[]) => Promise<void> }): Promise<void> {
  for (const p of BLOCKER_PATHS) await report(modelTile(p), { inPark: true, inView: true })
  await gate.open(BLOCKER_PATHS)
}
/** The rendered paths after the blockers. */
const renderedAfterBlockers = (): string[] => rendered().filter((p) => !BLOCKER_PATHS.includes(p))

describe('bands rank work through the whole pipeline', () => {
  it('a visible folder’s preview models are rendered — never deferred by the hidden-set merge', async () => {
    // The cell that fails if App's wrapper over-reaches: preview models are in
    // `thumbEntries` and never in `shownEntries`, so a wrapper built on that
    // difference marks every one of them far (round-2 review, N1).
    const gate = gateThumbs()
    peek.mockResolvedValue(found(2))
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))
    await gate.open()

    expect(rendered()).toEqual(expect.arrayContaining(['/models/a/m0.stl', '/models/a/m1.stl']))
  })

  it('a folder’s sheet fills after the model tiles beside it', async () => {
    // Cells rank one band worse than their folder (D2, amended): a visible
    // folder's cells are `near`, behind the visible model tile. The cell's
    // render is pushed *first*, so were cells at the folder's own band both
    // would be visible and the cell would win on insertion order.
    const gate = gateThumbs()
    const LISTING: DirListing = { path: '/models', entries: [...BLOCKERS, dir('a'), model('x.stl')] }
    peek.mockResolvedValue(found(1))
    await mountApp('/models', LISTING)
    const hold = holdSlots()
    await intersect(dirTile('/models/a')) // peek lands; the cell queues
    await report(modelTile('/models/x.stl'), { inPark: true, inView: true })
    await startBlockers(gate)
    await gate.open(['/models/a/m0.stl'])
    await gate.open(['/models/x.stl'])
    await gate.open()
    await hold.release()

    const order = renderedAfterBlockers()
    expect(order.indexOf('/models/x.stl')).toBeLessThan(order.indexOf('/models/a/m0.stl'))
  })

  it('a peek landing after the band reports does not wipe the ranking (F1)', async () => {
    // `thumbEntries` is rebuilt when a peek lands; the hook's per-listing reset
    // must key on the listing, not on that array — or the ranking vanished at
    // exactly the moment the user had stopped scrolling and the peeks answered.
    // The control is the same cell with the peek landing first.
    let answer!: (found: DirEntry[]) => void
    peek.mockReturnValue(new Promise<DirEntry[]>((resolve) => (answer = resolve)))
    const gate = gateThumbs()
    const LISTING: DirListing = { path: '/models', entries: [...BLOCKERS, dir('a'), model('x.stl'), model('y.stl')] }
    await mountApp('/models', LISTING)
    const hold = holdSlots()
    await intersect(dirTile('/models/a')) // peek requested, not yet answered
    await report(modelTile('/models/y.stl'), { inPark: false, inView: false }) // y far
    await report(modelTile('/models/x.stl'), { inPark: true, inView: true }) // x visible
    await startBlockers(gate)
    await act(async () => answer(found(1))) // the peek lands *after* the reports
    await settle()
    await gate.open(['/models/y.stl']) // y pushed first…
    await gate.open(['/models/x.stl'])
    await gate.open()
    await hold.release()

    // …and still renders after x: the ranking survived the landing.
    const order = renderedAfterBlockers()
    expect(order.indexOf('/models/x.stl')).toBeLessThan(order.indexOf('/models/y.stl'))
  })

  it('a filter-hidden model is reported far and rendered after what is shown', async () => {
    const gate = gateThumbs()
    const LISTING: DirListing = {
      path: '/models',
      entries: [...BLOCKERS, model('x.stl'), model('y.stl')],
    }
    await mountApp('/models', LISTING)
    const hold = holdSlots()
    await startBlockers(gate)
    const { openFind, findInput, type } = await import('./appHarness')
    await openFind()
    await type(findInput()!, 'x') // keeps x; hides y (and the running blockers)
    await settle()
    // A report arrives while y's tile is hidden: the wrapper merges y as far.
    await report(modelTile('/models/x.stl'), { inPark: true, inView: true })
    await gate.open()
    await hold.release()

    // Deferred, not withheld: y renders too, after x.
    const order = renderedAfterBlockers()
    expect(order.indexOf('/models/x.stl')).toBeLessThan(order.indexOf('/models/y.stl'))
    expect(order).toContain('/models/y.stl')
  })

  it('a hidden folder’s preview cells are reported far (finding 2)', async () => {
    const gate = gateThumbs()
    const LISTING: DirListing = {
      path: '/models',
      entries: [...BLOCKERS, dir('alpha'), model('z.stl')],
    }
    peek.mockResolvedValue([model('alpha/w.stl')])
    await mountApp('/models', LISTING)
    const hold = holdSlots()
    await intersect(dirTile('/models/alpha')) // peek lands: w is alpha's cell
    await startBlockers(gate)
    const { openFind, findInput, type } = await import('./appHarness')
    await openFind()
    await type(findInput()!, 'z') // keeps z; hides alpha (and the running blockers)
    await settle()
    // z is reported far itself, and its render is pushed *before* w's: under
    // the rule both are far and insertion order keeps z first; were w left
    // unreported it would rank above far and overtake z.
    await report(modelTile('/models/z.stl'), { inPark: false, inView: false })
    await gate.open(['/models/z.stl'])
    await gate.open(['/models/alpha/w.stl'])
    await gate.open()
    await hold.release()

    const order = renderedAfterBlockers()
    expect(order.indexOf('/models/z.stl')).toBeLessThan(order.indexOf('/models/alpha/w.stl'))
    expect(order).toContain('/models/alpha/w.stl')
  })

  it('a hidden tile that is a visible folder’s preview cell keeps the folder’s band', async () => {
    // The merge never overwrites a band the report carries. The preview
    // deliberately names a path outside the folder — the fixture's liberty,
    // since the mechanism joins on paths and the server's containment is not
    // what is under test.
    const gate = gateThumbs()
    const LISTING: DirListing = {
      path: '/models',
      entries: [...BLOCKERS, dir('alpha'), model('other.stl'), model('alpha-z.stl')],
    }
    peek.mockResolvedValue([model('other.stl')])
    await mountApp('/models', LISTING)
    const hold = holdSlots()
    await intersect(dirTile('/models/alpha'))
    await startBlockers(gate)
    const { openFind, findInput, type } = await import('./appHarness')
    await openFind()
    await type(findInput()!, 'alpha') // hides other.stl's tile alone
    await settle()
    await report(modelTile('/models/alpha-z.stl'), { inPark: false, inView: false }) // a far tile
    await report(dirTile('/models/alpha'), { inPark: true, inView: true })
    await gate.open(['/models/alpha-z.stl']) // the far tile is pushed first…
    await gate.open(['/models/other.stl'])
    await gate.open()
    await hold.release()

    // …yet other.stl renders before it: hidden as a tile, but the visible
    // folder's cell (near). Were the wrapper's `far` to overwrite that, both
    // would be far and alpha-z would keep its head start.
    const order = renderedAfterBlockers()
    expect(order.indexOf('/models/other.stl')).toBeLessThan(order.indexOf('/models/alpha-z.stl'))
  })

  it('a path that is both a visible tile and a far folder’s cell takes the nearest position', async () => {
    // Nearest wins per path (D2): x's own tile is visible, a's registration
    // of it is far. Pushed after the near tile y, x still runs first — under
    // last-write-wins it would be far and lose.
    const gate = gateThumbs()
    const LISTING: DirListing = { path: '/models', entries: [...BLOCKERS, dir('a'), model('x.stl'), model('y.stl')] }
    peek.mockResolvedValue([model('x.stl')]) // x is also a's cell
    await mountApp('/models', LISTING)
    const hold = holdSlots()
    await intersect(dirTile('/models/a')) // the peek lands
    // Rebuild the observers (a filter keystroke and back) so the tracked
    // state forgets the folder: below, x's own tile is heard *before* the
    // folder, so the folder's `far` registration is the later write — a
    // last-write-wins `put` would demote x; the nearest-wins max keeps it.
    const { openFind, findInput, type } = await import('./appHarness')
    await openFind()
    await type(findInput()!, 'zzz')
    await settle()
    await type(findInput()!, '')
    await settle()
    await report(modelTile('/models/x.stl'), { inPark: true, inView: true }) // x's own tile visible, heard first
    await report(dirTile('/models/a'), { inPark: false, inView: false }) // folder far, heard second
    await report(modelTile('/models/y.stl'), { inPark: true, inView: false }) // y near
    await startBlockers(gate)
    await gate.open(['/models/y.stl'])
    await gate.open(['/models/x.stl'])
    await gate.open()
    await hold.release()

    const order = renderedAfterBlockers()
    expect(order.indexOf('/models/x.stl')).toBeLessThan(order.indexOf('/models/y.stl'))
  })

  it('a far folder’s cells wait behind a visible tile', async () => {
    const gate = gateThumbs()
    const LISTING: DirListing = { path: '/models', entries: [...BLOCKERS, dir('a'), model('z.stl')] }
    peek.mockResolvedValue(found(1)) // a/m0 is a's cell, no tile of its own
    await mountApp('/models', LISTING)
    const hold = holdSlots()
    await intersect(dirTile('/models/a'))
    await report(dirTile('/models/a'), { inPark: false, inView: false }) // folder far → its cell far
    await report(modelTile('/models/z.stl'), { inPark: true, inView: true })
    await startBlockers(gate)
    await gate.open()
    await hold.release()

    const order = renderedAfterBlockers()
    expect(order.indexOf('/models/z.stl')).toBeLessThan(order.indexOf('/models/a/m0.stl'))
    expect(order).toContain('/models/a/m0.stl') // deferred, not withheld: it drains
  })

  it('a tile heard by only one observer is unreported, not a band from a defaulted half', async () => {
    // Code-review finding 6, at the pipeline level: deliver only the band
    // observer's record for x (near, by that half alone) — with the view half
    // unheard, x must be unreported (ranked after near), not derived as near.
    const gate = gateThumbs()
    const LISTING: DirListing = {
      path: '/models',
      entries: [...BLOCKERS, model('x.stl'), model('y.stl')],
    }
    await mountApp('/models', LISTING)
    const hold = holdSlots()
    await reportHalf(modelTile('/models/x.stl'), 'inPark', true) // x: one half only
    await report(modelTile('/models/y.stl'), { inPark: true, inView: false }) // y: near, both halves
    await startBlockers(gate)
    await gate.open(['/models/x.stl']) // x's render is pushed first…
    await gate.open(['/models/y.stl'])
    await gate.open()
    await hold.release()

    // …yet y runs first: near beats unreported. Were x derived from its one
    // heard half it would be `near` too and keep its head start.
    const order = renderedAfterBlockers()
    expect(order.indexOf('/models/y.stl')).toBeLessThan(order.indexOf('/models/x.stl'))
  })
})

/**
 * Listing-known thumbnails through the app (`thumbnail-image-serving` 5.3):
 * a tile whose entry vouches for its render draws from the image route with
 * no lookup, on the grid and in a folder's sheet alike, and a sheet cell's
 * failed image demotes the cell's own path.
 */
describe('tiles drawn from the listing', () => {
  const vouched = (name: string, gen = 5): DirEntry => ({
    ...model(name),
    thumb: {
      gen,
      framed: false,
      // Both variants vouched: the app reads whichever the occlusion
      // preference names (off in a fresh profile), and a cell about "the
      // listing vouches for this render" must not depend on that default.
      ao: { state: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION },
      noao: { state: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION },
    },
  })
  // The URL names the variant the app's occlusion preference selects — off
  // in a fresh profile — exactly as the lookup would have.
  const imgSrc = (el: Element | null | undefined): string | null =>
    el?.querySelector('img')?.getAttribute('src') ?? null

  it('mounts a vouched listing with no lookup traffic, and looks up the one entry it cannot vouch for', async () => {
    await mountApp('/models', {
      path: '/models',
      entries: [vouched('one.stl'), vouched('two.stl'), model('plain.stl')],
    })
    await settle()
    expect(getThumb.mock.calls.map((c) => c[0])).toEqual(['/models/plain.stl'])
    const byTitle = (t: string) => tiles().find((b) => b.getAttribute('title') === t)
    expect(imgSrc(byTitle('one.stl'))).toBe(thumbImageUrl('/models/one.stl', 1, aoEnabled(), 5))
    expect(imgSrc(byTitle('two.stl'))).toBe(thumbImageUrl('/models/two.stl', 1, aoEnabled(), 5))
  })

  it('a sheet cell’s image error demotes the cell’s path, not the folder’s', async () => {
    peek.mockResolvedValue([vouched('a/m0.stl'), vouched('a/m1.stl')])
    await mountApp('/models', ONE_FOLDER)
    await intersect(dirTile('/models/a'))
    await settle()
    expect(getThumb).not.toHaveBeenCalled()
    const cell = container.querySelector('[data-preview-cell="/models/a/m0.stl"]')
    expect(imgSrc(cell)).toBe(thumbImageUrl('/models/a/m0.stl', 1, aoEnabled(), 5))

    await act(async () => {
      cell!.querySelector('img')!.dispatchEvent(new Event('error'))
    })
    await settle()
    expect(getThumb.mock.calls.map((c) => c[0])).toEqual(['/models/a/m0.stl'])
    // The sibling cell was never touched, and the folder itself is not a thing
    // that is looked up.
    expect(imgSrc(container.querySelector('[data-preview-cell="/models/a/m1.stl"]'))).toBe(
      thumbImageUrl('/models/a/m1.stl', 1, aoEnabled(), 5),
    )
  })
})
