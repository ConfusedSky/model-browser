// Bun entry point — the only runtime-specific file. The app itself (Hono) runs
// unchanged on Node for a future Electron main/sidecar.
import { statSync } from 'node:fs'
import type { FeatureReport } from '../../shared/types'
import { ThumbCache } from './cache'
import { DEFAULT_FEATURES, createApp } from './app'
import { ConfigError, loadConfig } from './config'
import { ZipTempStore, createLauncher } from './launch'
import { createLibrary } from './library'
import { ListingCache } from './listingCache'
import { createOverrideHolder } from './overrides'
import { SnapshotStore } from './snapshot'
import { clientDist, createStaticHandler, route } from './static'

// The deployment's configuration, parsed **once**, here, before anything is
// built from it (public-deployment D2). An absent file is silent and means the
// defaults; a file that was authored and cannot be used stops the server rather
// than being read as an absent root, because a misread file may have been the
// one carrying the origin and the capabilities, and continuing would serve
// under a posture nobody chose. It is a deploy-time error, where the operator
// is watching — and it fails here, beside the startup lines, for the reason
// `library-overrides` reports a broken store here.
const config = await loadConfig(process.env).catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
})

const library = createLibrary(process.env, config)
// Positional to keep the three existing parameters' defaults; the library is
// what files entries under `<cache>/<id>/` and gates the sweep (D5).
const cache = new ThumbCache(undefined, undefined, undefined, library)
// The walked-tree cache, filed under the same per-library directory and bounded
// by its own knob (`listing-tree-cache` D2). Built here rather than inside
// `createApp` for `cache`'s reason: the startup sweep below needs it.
const snapshots = new SnapshotStore(undefined, undefined, library)
// The listing cache, built here rather than left to `createApp`'s default for
// the same reason the two above are: the startup pass below must run on the
// **instance the app serves from**, or the app would still believe every root
// unchecked and re-run the pass behind the first listing (§6.5).
const listings = new ListingCache(snapshots)
// Built here rather than left to `createApp`'s default so the eager load below
// can use it: a malformed store then reports beside the startup line rather
// than on whichever request happened to ask first (library-overrides D1).
const overrides = createOverrideHolder(library)
// The resolved library, named once at start: the root is a viewpoint and the
// top is found by walking up from it, so which tree is open is not something a
// reader can infer from the configuration alone (D1, and R1's warning).
void library.state().then((s) => {
  if (s.state === 'ready') {
    console.log(`library ${s.id} at ${s.top}`)
    // The store is read once per resolved library, so reading it here is the
    // whole of the work — and it is where a broken store gets to complain while
    // someone is still looking at the startup output. A library that resolves
    // later loads, and reports, on the first request that asks.
    void overrides.store()
    // The startup sweep resolves every cached path through the library, so it
    // has nothing to say until there is one.
    void cache.maintain()
    // Startup revalidation (§6.5, design D8): every root this library has a
    // snapshot for is re-checked at once, so a change made while the app was
    // closed is usually found before anyone lists anything.
    //
    // **Never a startup walk.** A root with no snapshot is not walked here: an
    // eager cold walk would grind a spinning, sometimes-absent volume at every
    // launch for a listing nobody asked for. What runs is the incremental pass
    // — one `stat` per directory — and it runs one root at a time, because two
    // passes at once contend for the same disk head with whatever the user is
    // actually waiting for.
    //
    // A library that resolves ready only *later* is covered by its first
    // request's ordinary revalidation: this hook fires once at process start,
    // which is the shape the requirement binds and the shape the eager override
    // load above already has.
    void (async () => {
      // The snapshot store's sweep is its own — one location, two bounds (D2) —
      // and runs here for the reason the thumbnail sweep runs above: it is
      // filed per library, so it has nothing to sweep until the library has
      // resolved.
      //
      // **Awaited, so the sweep finishes before the pass starts writing.** The
      // sweep reaps stray `.tmp` files and every `save` the pass makes writes
      // one, so a pass running *into* a sweep is the reaper-versus-live-save
      // race the stage-1/2 review names (finding 8). The sweep now reaps only
      // temps older than a minute, which is the actual fix; the ordering here
      // is kept because it costs nothing and does not depend on that age.
      await snapshots.maintain()
      for (const root of await snapshots.roots()) await listings.revalidate(library, root)
    })()
  } else console.log(`library: ${s.state}`)
})

// The feature report, built here rather than left to `createApp`'s default,
// because this is the construction site: the deployment's declarations over the
// maintained set, as **one value** from which both `/api/features` and the
// routes' refusals are read, so a declaration and a refusal cannot disagree
// (public-deployment D5). Nothing re-derives a capability from the
// configuration a second time.
const features: FeatureReport = { ...DEFAULT_FEATURES, ...config.features }

const app = createApp(
  cache,
  createLauncher(),
  new ZipTempStore(),
  library,
  overrides,
  features,
  snapshots,
  listings,
  // Loopback is allowed besides, always — the guard adds it whatever is here.
  config.origins ?? [],
)

/**
 * The built client, if there is one. Serving files is adapter-specific, so it
 * is wired here and not mounted on the Hono app (D1/D8). With no build present
 * this stays null and every request goes to the API exactly as before, so the
 * development loop — where Vite serves the client — does not start depending on
 * a build.
 */
const dist = clientDist(process.env)
const client = statSync(dist, { throwIfNoEntry: false })?.isDirectory() === true
  ? createStaticHandler(dist)
  : null
// Said out loud, beside the `library …` line, because the absence is silent and
// looks exactly like the app being broken: an image that builds the client
// *after* the server starts, or one whose build failed, serves the API and
// nothing else until it is restarted, and every request for the app answers 404
// with no line anywhere saying why. Operator-facing stdout, so the directory is
// named — it is the one thing that makes the answer actionable.
console.log(
  client === null ? `no built client at ${dist}: serving the API only` : `client at ${dist}`,
)

export default {
  // Where the deployment says, defaulting to loopback (D8). The demo's own
  // configuration pins loopback on purpose: `demo-infrastructure` D1 puts the
  // proxy, the app and the index in one network namespace.
  port: config.listen?.port ?? 3177,
  hostname: config.listen?.host ?? '127.0.0.1',
  // Bun closes an idle connection after 10s by default, which silently killed
  // every listing that walked a large library off a slow disk: a cold flat or
  // deep-search walk measured ~32s on a spinning USB exfat drive (2.4 ms per
  // entry cold, against 0.16 ms on SSD), and the client saw a bare network
  // error rather than a listing. 255 is Bun's maximum. It is a floor under the
  // failure, not a guarantee: a walk that spends its whole 200k-step budget on
  // that hardware would still outlast it, which is a caching problem, not a
  // timeout one.
  idleTimeout: 255,
  // A cap on what a request may send. It is not above every legitimate body,
  // and this comment used to claim it was ("an order of magnitude of room").
  // Two bodies to size it against:
  //
  //   `PUT /api/thumb` — a base64 256² WebP with its camera and axis, ~10–20 KB.
  //   Comfortably under.
  //
  //   `POST /api/semantic/poses` — up to `POSES_MAX` (1024) library paths, each
  //   admitted at up to `MAX_PATH_BYTES` (4096, `library.ts`). The worst case a
  //   client could construct without being refused anywhere else is therefore
  //   1024 × 4096 = 4 MiB of path exactly, plus its JSON quoting — ~4.2 MiB,
  //   four times this cap rather than a tenth of it.
  //
  // 1 MiB is still the value, chosen on what libraries actually hold rather
  // than on the admissible maximum: a real library path runs ~100–200 bytes, so
  // a full 1024-path wave is ≈105–205 KB, 5–10x under. Sizing for the
  // 4096-byte worst case would mean accepting a 4 MiB body from anyone, which
  // is the thing the cap exists to refuse. The cost when a wave does exceed it
  // is bounded and self-healing: `semanticPosesFor` (the client) chunks at
  // `POSES_MAX` and is per-chunk tolerant, so a 413 loses that chunk's poses
  // and nothing else — the paths are simply absent from the map, which already
  // reads as "the index has no orientation for this", and the next wave asks
  // again. Defence in depth: `demo-infrastructure`'s Caddy has its own cap in
  // front of this, and this is the one that holds when the app is reached
  // directly. Bun-only, so it lives here with the rest of the runtime's own
  // configuration.
  maxRequestBodySize: 1_048_576,
  fetch: (req: Request) => route(req, app.fetch, client),
}
