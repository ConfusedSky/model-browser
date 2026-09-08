// @vitest-environment happy-dom
//
// What `SidePanel` does with the feature report (`public-deployment` 4.3/4.4):
// which tab a profile opens on when the deployment does not offer the one it
// recorded, and what a viewer is told about an index they cannot repair.
//
// Driven against the component rather than through App, because both rules are
// about inputs App only ever passes through — a report and an `IndexAvailability`
// — and mounting the whole app to choose an index `detail` would assert the
// wiring twice while making the case harder to read. The wiring itself (that
// App hands the panel its report at all) is covered where the tabs are already
// asserted end to end, in bulkJobSurfaces.test.tsx and similarTuning.test.tsx.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FeatureReport, IndexAvailability } from '../../shared/types'
import SidePanel, { INDEX_UNAVAILABLE, resolveTab } from '../src/components/SidePanel'
import { TUNING_DEFAULTS } from '../src/lib/searchOptions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The panel's own storage key, written out rather than imported — renaming it
 *  would drop every profile's state, and a test that renamed with it would say
 *  nothing about that (similarTuning.test.tsx's rule). */
const TAB_KEY = 'model-browser:panel-tab'

/** The server's own defaults — what today's server answers with no
 *  configuration, `chatTab` off among them (`public-deployment` D4). Spelt out
 *  for the reason `appHarness`' copy is: a client suite reaching into
 *  `server/src/app` would pass while the two drifted. */
const DEFAULTS: FeatureReport = {
  thumbWrites: true,
  appLaunch: true,
  chatTab: false,
  hostDetails: true,
  maintenance: true,
}
/** A deployment that offers the chat tab — the report this panel behaved as if
 *  it always had, before the tab became withholdable. */
const WITH_CHAT: FeatureReport = { ...DEFAULTS, chatTab: true }
/** A deployment declaring its host none of the viewer's business (D11). */
const NO_HOST: FeatureReport = { ...DEFAULTS, hostDetails: false }

/** The bulk-job launcher, shaped as App hands it over. Nothing here presses its
 *  buttons — it exists so a cell can make the library tab appear and then take
 *  it away, which is the runtime fallback's only trigger. */
const JOBS = {
  count: () => Promise.resolve({ generate: 0, reset: 0, incomplete: false }),
  launch: () => {},
  recountKey: 0,
  resetAdjust: 0,
}

let container: HTMLElement
let root: Root

type Options = {
  features?: FeatureReport | null
  index?: IndexAvailability
  library?: typeof JOBS | null
  /** `meaning` so the index sentence is shown even for `absent`, which a name
   *  search deliberately does not report (`showIndexState`). */
  mode?: 'name' | 'meaning'
  path?: string
}

/** Render (or re-render, keeping the mounted component's state) the panel. */
async function show(opts: Options = {}): Promise<void> {
  await act(async () => {
    root.render(
      <SidePanel
        query={null}
        similar={null}
        library={opts.library ?? null}
        path={opts.path ?? '/models'}
        folderMatching
        kinds="both"
        mode={opts.mode ?? 'meaning'}
        tuning={TUNING_DEFAULTS}
        index={opts.index ?? { state: 'ready', collectionRoot: '/models' }}
        scope={null}
        features={opts.features === undefined ? DEFAULTS : opts.features}
        onFolderMatching={() => {}}
        onKinds={() => {}}
        onMode={() => {}}
        onTuning={() => {}}
        onSimilarTuning={() => {}}
      />,
    )
  })
}

const tabButtons = (): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
const tabNames = (): string[] => tabButtons().map((b) => b.textContent!.replace('•', '').trim())
const selectedTab = (): string | undefined =>
  tabNames()[tabButtons().findIndex((b) => b.getAttribute('aria-selected') === 'true')]
const tabButton = (name: string): HTMLButtonElement | undefined =>
  tabButtons()[tabNames().indexOf(name)]
/** The paragraph the panel prints about the index — the sentence and whatever
 *  follows it, together, which is the point of 7.7. */
const indexLine = (): string => {
  const ps = Array.from(container.querySelectorAll('p'))
  return ps.find((p) => /index|Meaning search/i.test(p.textContent ?? ''))?.textContent ?? ''
}

beforeEach(() => {
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('the chat tab is a capability, and the fallback lands on a tab there is (7.6)', () => {
  it('opens a profile with no recorded tab on search, and records nothing', async () => {
    // The store's parse degrades an absent key to `chat`, so this profile
    // "wants" a tab this deployment does not have. It opens on search — and
    // the store is still empty, because resolving is a read (D7).
    await show()
    expect(tabNames()).toEqual(['search'])
    expect(selectedTab()).toBe('search')
    expect(localStorage.getItem(TAB_KEY)).toBeNull()
  })

  it('opens a profile that recorded chat on search, and leaves the record alone', async () => {
    // The half D7 is named for: a profile carried between deployments must not
    // come home edited by having visited one. Rewriting the parse would have
    // erased a preference the profile is entitled to keep.
    localStorage.setItem(TAB_KEY, 'chat')
    await show()
    expect(tabNames()).toEqual(['search'])
    expect(selectedTab()).toBe('search')
    expect(localStorage.getItem(TAB_KEY)).toBe('chat')
  })

  it('behaves exactly as before where a known report offers the tab', async () => {
    localStorage.setItem(TAB_KEY, 'chat')
    await show({ features: WITH_CHAT })
    expect(tabNames()).toEqual(['chat', 'search'])
    expect(selectedTab()).toBe('chat')
    expect(localStorage.getItem(TAB_KEY)).toBe('chat')
  })

  it('withholds the tab while the report is unknown, and offers it when it lands', async () => {
    // An offer is withheld until a KNOWN report declares it on, so an in-flight
    // report reads exactly like a deployment that says no — nothing renders and
    // then vanishes a round trip later. The chat-panel capability asks for the
    // second half in as many words: "until the report says the tab is offered".
    localStorage.setItem(TAB_KEY, 'chat')
    await show({ features: null })
    expect(tabNames()).toEqual(['search'])
    expect(selectedTab()).toBe('search')

    await show({ features: WITH_CHAT })
    expect(tabNames()).toEqual(['chat', 'search'])
    expect(selectedTab()).toBe('chat')
    // Still a read: the report resolving re-asks what the profile wanted and
    // writes nothing back.
    expect(localStorage.getItem(TAB_KEY)).toBe('chat')
  })

  it('lands a viewer on search when the library tab goes away under them', async () => {
    // The runtime fallback, and the one this decision was found by reading the
    // tree for: this effect landed on `chat` — the very tab a deployment may
    // withhold — so on this deployment it landed on nothing at all.
    await show({ library: JOBS })
    expect(tabNames()).toEqual(['search', 'library'])
    await act(async () => tabButton('library')!.click())
    expect(selectedTab()).toBe('library')

    await show({ library: null })
    expect(tabNames()).toEqual(['search'])
    expect(selectedTab()).toBe('search')
  })

  it('still prefers chat for that fallback where the deployment has one', async () => {
    // The preference the effect was written with is intact: the user was doing
    // maintenance, and search is nobody's search here. It is a preference now
    // rather than a destination, which is the whole change.
    await show({ features: WITH_CHAT, library: JOBS })
    await act(async () => tabButton('library')!.click())
    expect(selectedTab()).toBe('library')

    await show({ features: WITH_CHAT, library: null })
    expect(selectedTab()).toBe('chat')
  })
})

describe('resolveTab, the one rule both fallbacks read (7.6)', () => {
  it('keeps the preferred tab when the deployment has it', () => {
    expect(resolveTab('chat', ['chat', 'search'])).toBe('chat')
    expect(resolveTab('search', ['search', 'library'])).toBe('search')
    expect(resolveTab('library', ['search', 'similar', 'library'])).toBe('library')
  })

  it('falls back to the first tab there is when it does not', () => {
    // `search` is never withheld, so it is the leftmost tab wherever `chat` is
    // absent — which is what makes "the first available" and "search" the same
    // answer on every deployment that can reach this branch.
    expect(resolveTab('chat', ['search'])).toBe('search')
    expect(resolveTab('chat', ['search', 'library'])).toBe('search')
    expect(resolveTab('library', ['search'])).toBe('search')
    expect(resolveTab('similar', ['chat', 'search'])).toBe('chat')
  })
})

describe('the index states a viewer cannot repair collapse into one (7.7)', () => {
  // A `detail` on every one of these, deliberately: the server withholds it
  // under this same field (`public-deployment` 3.7), so a client cell that fed
  // none would pass with the client rule deleted. This drives the client with
  // the text present, which only the client can now suppress.
  const DETAIL = 'cache /home/operator/.cache/mini-classify is unusable'

  it('says one thing for absent, volume-gone and wedged, and prints no detail', async () => {
    for (const state of ['absent', 'volume-gone', 'wedged'] as const) {
      await show({ features: NO_HOST, index: { state, detail: DETAIL } })
      expect(indexLine()).toBe(INDEX_UNAVAILABLE)
      expect(indexLine()).not.toContain(DETAIL)
      // And none of the three repairs is named — which is the requirement, not
      // the sentence: no service to start, no volume to mount.
      expect(indexLine()).not.toMatch(/start|mount|volume/i)
    }
  })

  it('keeps warming distinct, because waiting is a thing the viewer can do', async () => {
    // A deployment's own start is a real wait and "come back in a moment" is
    // honest where "start the service" is not.
    await show({ features: NO_HOST, index: { state: 'warming', elapsed: 4 } })
    expect(indexLine()).toBe('Meaning search is starting up (4s)…')
    expect(indexLine()).not.toBe(INDEX_UNAVAILABLE)
  })

  it('keeps outside-the-collection distinct, because the viewer can browse elsewhere', async () => {
    // A fact about where the viewer is, not about the operator's machine.
    await show({
      features: NO_HOST,
      index: { state: 'ready', collectionRoot: '/models' },
      path: '/elsewhere',
    })
    expect(indexLine()).toContain('does not cover this folder')
    expect(indexLine()).not.toBe(INDEX_UNAVAILABLE)
  })

  it('says today’s sentences, detail and all, where the host is the viewer’s own', async () => {
    for (const features of [DEFAULTS, null]) {
      await show({ features, index: { state: 'absent', detail: DETAIL } })
      expect(indexLine()).toBe(`Meaning search is not running — start the index to use it. ${DETAIL}`)

      await show({ features, index: { state: 'volume-gone', detail: DETAIL } })
      expect(indexLine()).toBe(
        `Meaning search is running, but its library volume is not mounted. ${DETAIL}`,
      )

      await show({ features, index: { state: 'wedged', detail: DETAIL } })
      expect(indexLine()).toBe(`Meaning search did not finish starting. ${DETAIL}`)
    }
  })
})
