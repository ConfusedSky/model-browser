// @vitest-environment happy-dom
//
// The stale-marker reconciliation through App (listing-tree-cache §5.2, design
// D5): the server answers a listing from a cached tree it has not checked yet
// and says so on the wire (`DirListing.stale`). The client shows those entries
// at once with a "refreshing" line, and asks **once** more — an ordinary
// `listDir`, because there is no new transport to add (the Hono app must run on
// Node unchanged, architecture D1). The corrected answer lands through the same
// guards every other answer does.
//
// The two things easiest to get wrong, and what pins each here:
//
//  - **The follow-up must not raise the skeleton.** `busy` is what drives it,
//    and a request that counted would blank the grid for the length of the
//    server's revalidation pass (~5.6s cold) — the very listing this feature
//    exists to keep on screen. Pinned by `no skeleton` below.
//  - **It must not loop.** The server's pass normally makes the follow-up come
//    back unmarked, but not always: a pass that failed, or a root still
//    unvalidated once the revalidation TTL has lapsed, answers marked again
//    (D5's corrections paragraph). One follow-up per landed stale answer, keyed
//    to that answer's own identity so navigating away and back still gets one.
//
// §6.4 lives here too, because it is the same emission: a listing entry that
// arrived with a `pose` is not asked about, and the pose it carried reaches the
// thumbnail sweep all the same.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraState, DirListing, IndexPose } from '../../shared/types'
import { SKELETON_DELAY_MS } from '../src/hooks/useDelayedFlag'
import {
  click,
  container,
  dir,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  pathInput,
  pressEnter,
  semanticPosesFor,
  settle,
  skeleton,
  tiles,
  type,
  unmountApp,
  wait,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)
/** The viewer is out of scope except for what App hands it: this keeps the last
 *  props so the pose cell can read the orientation that reached the layer, and
 *  draws nothing (poseWave's stub, for its reason). */
const viewerProps = vi.hoisted(() => ({
  last: null as { pose?: IndexPose; camera?: CameraState; axis?: string } | null,
}))
vi.mock('../src/viewer/ViewerLayer', () => ({
  default: (props: { pose?: IndexPose; camera?: CameraState; axis?: string }) => {
    viewerProps.last = props
    return null
  },
}))

/** The boot listing — folders only, so no thumbnail machinery runs under the
 *  reconciliation cells and a tile count is a listing count. */
const HOME: DirListing = { path: '/models', entries: [dir('a')] }
const ELSEWHERE: DirListing = { path: '/other', entries: [dir('z')] }
/** What the cache held, and what the disk turned out to hold. Different entries
 *  so "the corrected listing arrived" is visible in the grid rather than
 *  inferred from a request count. */
const STALE_A: DirListing = { path: '/models/a', entries: [dir('a/b')], stale: true }
const FRESH_A: DirListing = { path: '/models/a', entries: [dir('a/c')] }

const pastDelay = () => wait(SKELETON_DELAY_MS + 50)

/** The affordance: the one aria-live region in the app. */
function refreshing(): Element | null {
  return container.querySelector('[aria-live="polite"]')
}
/**
 * The header's transient line, when it is in the failure tone. Selected on the
 * tone rather than on the element, because the same `<p>` carries a command's
 * confirmation — "no banner" has to mean "no *error*", not "no line".
 */
function headerError(): string | null {
  return container.querySelector('header p.text-red-400')?.textContent ?? null
}
/** Each tile's visible label, in grid order. */
function labelled(): string[] {
  return tiles().map((t) => t.textContent ?? '')
}

const POSE: IndexPose = {
  up: [0, 1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'siglip',
  confidence: 0.9,
  front: { view: 5, azimuth_deg: 225, elevation_deg: 20 },
}

beforeEach(() => {
  viewerProps.last = null
})
afterEach(() => unmountApp())

describe('a stale-marked listing', () => {
  it('renders at once, says it is refreshing, and never raises the skeleton', async () => {
    await mountApp('/models', HOME)
    await settle()
    // Installed after the mount, which resets `listDir` to the boot listing
    // (the harness's rule). The follow-up never answers, so the app is held in
    // exactly the state the requirement is about: cached entries on screen,
    // revalidation outstanding.
    let calls = 0
    listDir.mockImplementation(() => {
      calls++
      return calls === 1 ? Promise.resolve(STALE_A) : new Promise<DirListing>(() => {})
    })

    await click(tiles()[0]!)
    await settle()

    expect(labelled()).toEqual(['b']) // shown immediately, not withheld
    expect(refreshing()?.textContent).toBe('Refreshing…')
    expect(calls).toBe(2) // the navigation, and the follow-up it provoked

    // The follow-up is still out. It owes the user nothing — the answer it
    // corrects is on screen — so the skeleton must never take that grid away.
    await pastDelay()
    expect(skeleton()).toBeNull()
    expect(labelled()).toEqual(['b'])
    expect(refreshing()).not.toBeNull()
  })

  it('reconciles: the follow-up replaces the entries and the line goes', async () => {
    await mountApp('/models', HOME)
    await settle()
    let calls = 0
    listDir.mockImplementation(() => {
      calls++
      return Promise.resolve(calls === 1 ? STALE_A : FRESH_A)
    })

    await click(tiles()[0]!)
    await settle()

    expect(calls).toBe(2)
    expect(labelled()).toEqual(['c']) // the tree as the disk actually has it
    expect(refreshing()).toBeNull() // an unmarked answer says nothing
  })

  it('a follow-up that is itself stale shows the line and stops — one, not a loop', async () => {
    await mountApp('/models', HOME)
    await settle()
    // Marked for the first six answers, then unmarked. The floor is the MOCK's,
    // not the client's: without the once-guard the client would keep asking,
    // and the floor makes that surface as a wrong count instead of as a test
    // that never returns.
    let calls = 0
    listDir.mockImplementation(() => {
      calls++
      return Promise.resolve(calls <= 6 ? STALE_A : FRESH_A)
    })

    await click(tiles()[0]!)
    await settle()
    await settle() // room for a loop to show itself

    expect(calls).toBe(2)
    expect(refreshing()?.textContent).toBe('Refreshing…')
    // Still the cached answer, because the client stopped asking rather than
    // grinding until the server happened to agree.
    expect(labelled()).toEqual(['b'])
  })

  it('a follow-up that fails says nothing at all — no banner over a good grid', async () => {
    await mountApp('/models', HOME)
    await settle()
    let calls = 0
    listDir.mockImplementation(() => {
      calls++
      return calls === 1
        ? Promise.resolve(STALE_A)
        : Promise.reject(new Error('Failed to fetch'))
    })

    await click(tiles()[0]!)
    await settle()
    await settle() // room for a retry to show itself

    expect(calls).toBe(2)
    // The request that failed asked for nothing the user asked for. The listing
    // it was going to correct is on screen, complete and rendered, and the only
    // thing lost is a correction nobody knew was coming — so reporting it as
    // the navigation having failed is a lie about which request broke, painted
    // over entries that failure never touched.
    expect(headerError()).toBeNull()
    expect(labelled()).toEqual(['b'])
    // Still truthful, and for the reason the line says: it was *not* refreshed.
    expect(refreshing()?.textContent).toBe('Refreshing…')
    // And not retried — the once-guard is the effect's dependency, and no
    // answer landed to change it.
    expect(skeleton()).toBeNull()
  })

  it('but an ordinary request that fails still says so', async () => {
    // The control, without which the cell above would pass on a reducer that
    // had simply stopped reporting failures. Same rejection, same navigation —
    // the only difference is that this one is what the user asked for.
    await mountApp('/models', HOME)
    await settle()
    listDir.mockImplementation(() => Promise.reject(new Error('Failed to fetch')))

    await click(tiles()[0]!)
    await settle()

    expect(headerError()).toBe('Failed to fetch')
  })

  it('an unmarked listing shows no line and asks nothing further', async () => {
    await mountApp('/models', HOME)
    await settle()
    let calls = 0
    listDir.mockImplementation(() => {
      calls++
      return Promise.resolve(FRESH_A)
    })

    await click(tiles()[0]!)
    await settle()
    await settle()

    expect(calls).toBe(1)
    expect(refreshing()).toBeNull()
    expect(labelled()).toEqual(['c'])
  })

  it('a superseded follow-up is discarded — the newer listing stands', async () => {
    await mountApp('/models', HOME)
    await settle()
    let landFollowUp!: () => void
    let calls = 0
    listDir.mockImplementation((p: string) => {
      calls++
      if (p === '/other') return Promise.resolve(ELSEWHERE)
      if (calls === 1) return Promise.resolve(STALE_A)
      return new Promise<DirListing>((res) => {
        landFollowUp = () => res(FRESH_A)
      })
    })

    await click(tiles()[0]!)
    await settle()
    expect(refreshing()).not.toBeNull()

    // Away, while the follow-up is still out.
    await type(pathInput(), '/other')
    await pressEnter(pathInput())
    await settle()
    expect(labelled()).toEqual(['z'])

    // The correction for a listing nobody is looking at, home at last.
    landFollowUp()
    await settle()

    expect(labelled()).toEqual(['z']) // it did not reach the grid
    expect(refreshing()).toBeNull() // nor put the line back up
  })

  it('a fresh listing navigated to after a stale one gets its own follow-up', async () => {
    // The once-guard is keyed to the ANSWER, not held beside the app: a boolean
    // that survived the navigation would suppress this second listing's
    // follow-up and leave a cached tree on screen with nothing checking it.
    await mountApp('/models', HOME)
    await settle()
    const asked: string[] = []
    listDir.mockImplementation((p: string) => {
      asked.push(p)
      if (p === '/other') return Promise.resolve({ ...ELSEWHERE, stale: true as const })
      return Promise.resolve(STALE_A)
    })

    await click(tiles()[0]!)
    await settle()
    expect(asked).toEqual(['/models/a', '/models/a'])

    await type(pathInput(), '/other')
    await pressEnter(pathInput())
    await settle()

    expect(asked).toEqual(['/models/a', '/models/a', '/other', '/other'])
    expect(refreshing()).not.toBeNull()
  })
})

describe('the pose wave asks only about what the listing did not carry', () => {
  // §6.4 / §7.3's client half. The server's pose layer attaches `pose` at
  // emission when it already holds one (§6.3); those entries are not a question.
  const POSED = { ...model('hero.stl'), pose: POSE }
  const BARE = model('quiet.stl')
  const MIXED: DirListing = { path: '/models', entries: [POSED, BARE] }

  it('names the unposed models only', async () => {
    await mountApp('/models', MIXED)
    await settle()
    await settle()

    // The wave still goes out, still in the background, still once — it simply
    // does not ask about the model whose orientation it was handed.
    expect(semanticPosesFor).toHaveBeenCalledTimes(1)
    expect(semanticPosesFor).toHaveBeenCalledWith(['/models/quiet.stl'])
  })

  it('a listing whose models all carry poses asks nothing at all', async () => {
    await mountApp('/models', {
      path: '/models',
      entries: [POSED, { ...model('quiet.stl'), pose: POSE }],
    })
    await settle()
    await settle()

    // An empty batch would be a round trip spent to be told `{}` — the same
    // rule a listing of folders alone already follows.
    expect(semanticPosesFor).not.toHaveBeenCalled()
  })

  it('the carried pose reaches the same consumer a wave-supplied one does', async () => {
    // The other half of the narrowing, and the half that makes it safe: not
    // asking is only correct if the pose the listing carried is actually used.
    // `poses[viewer.entry.path]` is where App hands an orientation on — the
    // handoff `pose-for-every-model` pinned for the wave — so the carried one
    // arriving there is "downstream consumers see one shape" (§6.4) in the one
    // place that can tell the two sources apart, and cannot.
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2Fhero.stl', MIXED)
    await settle()

    expect(viewerProps.last).not.toBeNull()
    expect(viewerProps.last!.pose).toEqual(POSE)
    // And it got there with no request behind it: the wave was told about the
    // other model only.
    expect(semanticPosesFor).toHaveBeenCalledWith(['/models/quiet.stl'])
  })

  it('an explicit null pose is an answer, and provokes no ask', async () => {
    // The third wire state (`listing-tree-cache` §6.9, round-3 finding 6):
    // `pose: null` is the server saying it asked the index and there is no
    // orientation for this model. A never-embedded folder used to cost a wave on
    // *every* landing — the server knew the answer and had no way to say it — so
    // this is the half of the loop that closes on the client.
    //
    // The filter that gets it right is `e.pose === undefined`, which reads a
    // `null` as known because `null !== undefined`. It is code that was already
    // correct; this cell is what keeps a later "tidy" to `!e.pose` from quietly
    // reopening the loop.
    await mountApp('/models', {
      path: '/models',
      entries: [POSED, { ...model('quiet.stl'), pose: null }],
    })
    await settle()
    await settle()

    expect(semanticPosesFor).not.toHaveBeenCalled()
  })

  it('files a null pose as a settled absence — the viewer opens at the default, knowing it', async () => {
    // Inverted 2026-09-11 (`pose-rerender` D5). `carriedPoses` builds the map the
    // thumbnail sweep and the viewer read, and a `null` filed there is the server
    // saying it asked and the index holds none — a *state*, not an orientation.
    // The sweep reads it as "a render drawn under an orientation is stale, redraw
    // at the default"; the viewer opens at the default either way and is handed
    // the `null` so both read one map. Only absence — never asked — stays
    // `undefined`, and that is what the wave asks about.
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2Fquiet.stl', {
      path: '/models',
      entries: [POSED, { ...model('quiet.stl'), pose: null }],
    })
    await settle()

    expect(viewerProps.last).not.toBeNull()
    expect(viewerProps.last!.pose).toBeNull()
  })
})
