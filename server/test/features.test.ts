import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FeatureReport } from '../../shared/types'
import { DEFAULT_FEATURES, createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { createLibrary } from '../src/library'
import { LOOPBACK, libraryFor, realTempDir } from './helpers'

/**
 * `GET /api/features` — the report the client shapes surfaces by
 * (feature-report D2/D4). Three cells: what a default server says, that an
 * injected value is what is answered, and that the answer arrives before there
 * is a library.
 *
 * The default set is the **maintained** configuration, not "everything on"
 * (`public-deployment` D4): `chatTab` is off, because the tab is a placeholder
 * with no backend.
 */
describe('GET /api/features', () => {
  const lib = realTempDir('mb-features-lib-')
  const cache = realTempDir('mb-features-cache-')

  function appWith(features?: FeatureReport) {
    return createApp(new ThumbCache(cache), undefined, undefined, libraryFor(lib), undefined, features)
  }

  it('reports the maintained set when the app is built with no opinion', async () => {
    const res = await appWith().request('/api/features', { headers: LOOPBACK })
    expect(res.status).toBe(200)
    // The whole report, not a subset: a field this server grew and forgot to
    // decide about is a failure here rather than an undefined on the client.
    // Spelt out rather than compared against `DEFAULT_FEATURES`, so a default
    // that flips has to be flipped here too and cannot slip through green.
    expect(await res.json()).toEqual({
      thumbWrites: true,
      appLaunch: true,
      chatTab: false,
      hostDetails: true,
      maintenance: true,
    })
  })

  it('answers the injected value rather than a construction of its own', async () => {
    // The cell the deployment's configuration rides on: nothing between
    // `createApp`'s argument and the wire may reinterpret a field.
    const injected: FeatureReport = { ...DEFAULT_FEATURES, thumbWrites: false, chatTab: true }
    const res = await appWith(injected).request('/api/features', { headers: LOOPBACK })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(injected)
  })

  it('answers while the library is unconfigured, like /api/apps', async () => {
    // The UNGATED cell (D2): the surfaces the report shapes exist in every
    // library state, so a gated route here would leave the client unable to
    // learn what it may offer until a root appeared. `/api/apps` is the
    // precedent — asserted beside it so a regression names which one broke.
    const home = realTempDir('mb-features-unconfigured-')
    const bareCache = realTempDir('mb-features-unconfigured-cache-')
    const bare = createLibrary({ HOME: home, XDG_CONFIG_HOME: join(home, 'config') })
    const app = createApp(new ThumbCache(bareCache), undefined, undefined, bare)

    // The library really is unconfigured: a path route refuses, so the 200
    // below is the exemption and not a library that quietly resolved.
    const gated = await app.request('/api/dir?path=/', { headers: LOOPBACK })
    expect(gated.status).toBe(503)
    expect((await gated.json()).state).toBe('unconfigured')

    const res = await app.request('/api/features', { headers: LOOPBACK })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(DEFAULT_FEATURES)
    expect((await app.request('/api/apps', { headers: LOOPBACK })).status).toBe(200)

    rmSync(home, { recursive: true, force: true })
    rmSync(bareCache, { recursive: true, force: true })
  })
})
