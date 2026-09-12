// @vitest-environment happy-dom
import type { CameraState, IndexPose, IndexScore, OrbitAxis } from '../../shared/types'
import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../src/api/client'
import { GestureTracker } from '../src/lib/gesture'
import type { ScoreScale } from '../src/lib/scoreScale'
import type { MeshLru } from '../src/three/lru'
import ViewerLayer, { type ViewerState } from '../src/viewer/ViewerLayer'

// The overlay drives real ViewerSession math; only the WebGL renderer is faked.
vi.mock('../src/three/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/renderer')>()),
  getRenderer: () => ({
    setSize: () => {},
    render: () => {},
    domElement: document.createElement('canvas'),
  }),
  // ViewerSession.render() drives the live post-process chain through this
  // export — stubbed, since a real chain would want a GL context.
  getLiveChain: () => ({ render: () => {} }),
  makeScene: () => ({ scene: new THREE.Scene(), rig: new THREE.Group() }),
  renderThumbnail: () => Promise.resolve(new Blob()),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ENTRY = {
  name: 'box.stl',
  path: '/models/box.stl',
  kind: 'model' as const,
  format: 'stl' as const,
  size: 10,
  mtime: 1,
}

function makeProps() {
  const viewer: ViewerState = {
    mode: 'orbit',
    entry: ENTRY,
    rect: { left: 0, top: 0, width: 100, height: 100 },
    originEl: null,
  }
  let resolvePersist!: () => void
  const persistGate = new Promise<void>((r) => {
    resolvePersist = r
  })
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
  return {
    resolvePersist,
    props: {
      viewer,
      // Typed at the Props widths, not inferred as `undefined`, so a test can
      // supply a camera, axis, or pose without widening this helper.
      camera: undefined as CameraState | undefined,
      axis: undefined as OrbitAxis | undefined,
      pose: undefined as IndexPose | undefined,
      score: undefined as IndexScore | undefined,
      scoreScale: null as ScoreScale | null,
      ao: true,
      // `overrides` beside `getThumb`: the panel reads the entry's overrides
      // when it opens in lightbox mode (library-overrides 2.2), and "nothing
      // resolves" is what a library with no store answers — so these cases keep
      // the panel they were written against.
      api: {
        getThumb: vi.fn().mockResolvedValue({ status: 'miss' }),
        overrides: vi.fn().mockResolvedValue({}),
      } as unknown as ApiClient,
      lru: { acquire: vi.fn().mockResolvedValue(mesh) } as unknown as MeshLru<THREE.Object3D>,
      tracker: new GestureTracker(),
      onPromote: vi.fn(),
      onCloseIntent: vi.fn(),
      closeSignal: 0,
      onDismiss: vi.fn(),
      onPersist: vi.fn(() => persistGate),
      onLoadError: vi.fn(),
      onEntryMenu: vi.fn(),
      // No menu in these cases, so the lightbox owns Escape throughout.
      menuOpen: { current: false },
      // No panel affordances either: these cases are the gesture and the
      // persist, and App is what decides that row's contents.
      panelCommands: [],
      libraryTop: '/lib',
      onCommand: vi.fn(),
    },
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

async function render(props: ReturnType<typeof makeProps>['props']): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  props.tracker.start(50, 50) // the press that opened the overlay
  await act(async () => {
    root!.render(<ViewerLayer {...props} />)
  })
  await act(async () => {}) // session built from the resolved acquire
}

function pointer(type: string, x: number, y: number): void {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y }))
}

async function dragAndReleaseOutside(): Promise<void> {
  await act(async () => {
    pointer('pointermove', 80, 50) // beyond the drag threshold
    pointer('pointermove', 90, 60)
    pointer('pointerup', 500, 500) // release outside the tile rect
  })
}

const settle = (ms = 120) => act(() => new Promise((r) => setTimeout(r, ms)))

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('orbit → thumbnail handoff', () => {
  it('holds dismissal until the persist resolves, then dismisses once', async () => {
    const { props, resolvePersist } = makeProps()
    await render(props)
    await dragAndReleaseOutside()
    expect(props.onPersist).toHaveBeenCalled()

    await settle()
    expect(props.onDismiss).not.toHaveBeenCalled() // still holding

    resolvePersist()
    await settle()
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('a held dismissal yields to a new gesture on the tile', async () => {
    const { props, resolvePersist } = makeProps()
    await render(props)
    await dragAndReleaseOutside()

    await act(async () => {
      pointer('pointerdown', 50, 50) // new press before the hold completes…
      const el = container!.querySelector<HTMLElement>('.fixed')
      el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }))
    })
    resolvePersist()
    await settle()
    expect(props.onDismiss).not.toHaveBeenCalled() // …so the old hold is a no-op
  })

  it('a release without a drag dismisses nothing and promotes as before', async () => {
    const { props } = makeProps()
    await render(props)
    await act(async () => {
      pointer('pointerup', 50, 50) // no movement: click
    })
    await settle()
    expect(props.onPromote).toHaveBeenCalled()
    expect(props.onPersist).not.toHaveBeenCalled()
    expect(props.onDismiss).not.toHaveBeenCalled()
  })

  it('a viewer replaced during a hold re-arms the gesture: the new tile can promote', async () => {
    const { props, resolvePersist } = makeProps()
    await render(props)
    await dragAndReleaseOutside() // hold pending on tile A

    // A press on tile B replaces the viewer prop without unmounting the layer.
    const viewerB: ViewerState = {
      mode: 'orbit',
      entry: { ...ENTRY, name: 'b.stl', path: '/models/b.stl' },
      rect: { left: 200, top: 0, width: 100, height: 100 },
      originEl: null,
    }
    props.tracker.start(250, 50)
    await act(async () => {
      root!.render(<ViewerLayer {...props} viewer={viewerB} />)
    })
    resolvePersist()
    await settle()
    expect(props.onDismiss).not.toHaveBeenCalled() // stale hold yielded

    await act(async () => {
      pointer('pointerup', 250, 50) // release without drag on tile B
    })
    expect(props.onPromote).toHaveBeenCalled() // gesture state was re-armed
  })

  it('a release persists through the props in force, not the ones the listeners were installed with', async () => {
    // The window pointerup listener is installed once and used to hold the
    // mount render's release path, whose `onPersist` closed over the mount
    // render's viewer: a viewer swapped in during a held dismissal had its
    // pixels persisted under the *old* tile's path. Found in review
    // (native-context-menu-bypass), pre-existing; the release now reaches the
    // current render's function through a ref. Falsify by calling
    // `endGesture` directly from the effect again: `stale` takes the call.
    const { props, resolvePersist } = makeProps()
    await render(props)
    await dragAndReleaseOutside() // hold pending on tile A, through the mount's onPersist
    const stale = props.onPersist
    expect(stale).toHaveBeenCalledTimes(1)

    const viewerB: ViewerState = {
      mode: 'orbit',
      entry: { ...ENTRY, name: 'b.stl', path: '/models/b.stl' },
      rect: { left: 200, top: 0, width: 100, height: 100 },
      originEl: null,
    }
    // App re-creates `persist` for the new viewer; the layer is not remounted.
    const fresh = vi.fn(() => Promise.resolve())
    props.tracker.start(250, 50)
    await act(async () => {
      root!.render(<ViewerLayer {...props} viewer={viewerB} onPersist={fresh} />)
    })
    resolvePersist()
    await settle()

    await act(async () => {
      pointer('pointermove', 280, 50) // a drag on tile B…
      pointer('pointermove', 290, 60)
      pointer('pointerup', 290, 60) // …released inside it
    })
    await settle()
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(stale).toHaveBeenCalledTimes(1) // no second call through the mount's copy
  })

  it('a failed or slow persist cannot wedge the overlay (timeout fallback)', async () => {
    const { props } = makeProps() // persist gate never resolves
    await render(props)
    await dragAndReleaseOutside()
    await settle(1700) // past PERSIST_HOLD_MS
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
  }, 8000)
})

describe('an index pose survives into the live session', () => {
  it('a posed thumbnail stores no axis, and the viewer must not read that as the default', async () => {
    // The symptom: the tile rendered at the pose and the live view abandoned it
    // the moment you dragged. A posed thumbnail deliberately stores no axis,
    // and the cache used to answer the default for that absence, so the viewer
    // read a stored orientation where there was none. The pose is read in file
    // coordinates (file-frame-spindle D4): `up` [0, -1, 0] is the `-y` spindle,
    // so the picker must show Y *and* flip — not the STL default Z, and not
    // the unsigned Y. A signed axis on purpose: `[0, 1, 0]` would expect `['Y']`,
    // which a picker ignoring the sign entirely also answers.
    const { props } = makeProps()
    const posed: React.ComponentProps<typeof ViewerLayer> = {
      ...props,
      viewer: { ...props.viewer, mode: 'lightbox' as const },
      api: {
        getThumb: vi.fn().mockResolvedValue({ status: 'hit', posed: 2 }),
        overrides: vi.fn().mockResolvedValue({}),
      } as unknown as ApiClient,
      pose: {
        up: [0, -1, 0] as [number, number, number],
        azimuth_zero: [1, 0, 0] as [number, number, number],
        source: 'siglip',
        confidence: 0.9,
        front: { view: 6, azimuth_deg: 270, elevation_deg: 20 },
      },
    }
    await render(posed as unknown as ReturnType<typeof makeProps>['props'])

    const pressed = Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[aria-label="Orbit axis"] button'),
    ).filter((b) => b.getAttribute('aria-pressed') === 'true')
    // Y *and* the flip toggle: the spindle is '-y', not 'y'. Asserting the
    // whole pressed set is what distinguishes the right axis from its negation.
    expect(pressed.map((b) => b.textContent)).toEqual(['Y', 'flip'])
  })

  it('a +Y pose marks Y with no flip — issue #8’s cross-check, the unsigned case on purpose', async () => {
    // The −y sibling above is what pins the sign; this one pins that an
    // unsigned pose on an STL is read as Y, not as the format's default Z.
    const { props } = makeProps()
    const posed: React.ComponentProps<typeof ViewerLayer> = {
      ...props,
      viewer: { ...props.viewer, mode: 'lightbox' as const },
      api: {
        getThumb: vi.fn().mockResolvedValue({ status: 'hit', posed: 2 }),
        overrides: vi.fn().mockResolvedValue({}),
      } as unknown as ApiClient,
      pose: {
        up: [0, 1, 0] as [number, number, number],
        azimuth_zero: [1, 0, 0] as [number, number, number],
        source: 'siglip',
        confidence: 0.9,
        front: { view: 6, azimuth_deg: 270, elevation_deg: 20 },
      },
    }
    await render(posed as unknown as ReturnType<typeof makeProps>['props'])

    const pressed = Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[aria-label="Orbit axis"] button'),
    ).filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed.map((b) => b.textContent)).toEqual(['Y'])
  })
})

describe('an un-framed model opens about its format’s up axis', () => {
  // Nothing stored, no pose: the spindle is the format's up convention, from
  // the one definition (`defaultAxisFor`, file-frame-spindle D2). STL is Z-up,
  // OBJ Y-up; the tile menu marks the same letters (orbitAxisMenu.test.tsx).
  const pressed = (): string[] =>
    Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[aria-label="Orbit axis"] button'),
    )
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent ?? '')

  it('an STL in the lightbox marks Z, not flipped', async () => {
    const { props } = makeProps()
    await render({ ...props, viewer: { ...props.viewer, mode: 'lightbox' as const } })
    expect(pressed()).toEqual(['Z'])
  })

  it('an OBJ in the lightbox marks Y, not flipped', async () => {
    const { props } = makeProps()
    const obj = {
      ...props.viewer,
      mode: 'lightbox' as const,
      entry: { ...ENTRY, name: 'bracket.obj', path: '/models/bracket.obj', format: 'obj' as const },
    }
    await render({ ...props, viewer: obj })
    expect(pressed()).toEqual(['Y'])
  })
})

describe('an index pose is advisory', () => {
  it('opening at a pose and closing without touching it writes nothing', async () => {
    // The failure this pinned: the index's suggestion becoming the user's stored
    // orientation after a single open — durable, invisible, and thereafter
    // winning over the re-classification that would have corrected it. Until
    // `pose-rerender` D4 the close still saved the *pixels* (labelled posed and
    // keyless, no camera); an untouched close now persists nothing at all — the
    // tile already shows this framing, and the grid's own sweep follows the
    // pose state, so the close has nothing to add and a camera to withhold.
    const { props } = makeProps()
    const posed: React.ComponentProps<typeof ViewerLayer> = {
      ...props,
      viewer: { ...props.viewer, mode: 'lightbox' as const },
      pose: {
        up: [0, 1, 0] as [number, number, number],
        azimuth_zero: [1, 0, 0] as [number, number, number],
        source: 'siglip',
        confidence: 0.9,
        front: { view: 5, azimuth_deg: 270, elevation_deg: 20 },
      },
    }
    await render(posed as unknown as ReturnType<typeof makeProps>['props'])

    // ✕ raises a close *intent*; App answers by bumping closeSignal, which is
    // what runs the close (url-navigation D3).
    await act(async () => {
      root!.render(<ViewerLayer {...posed} closeSignal={1} />)
    })
    await act(async () => {})

    expect(posed.onDismiss).toHaveBeenCalled()
    expect(posed.onPersist).not.toHaveBeenCalled()
  })
})
