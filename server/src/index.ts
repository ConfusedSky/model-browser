// Bun entry point — the only runtime-specific file. The app itself (Hono) runs
// unchanged on Node for a future Electron main/sidecar.
import { ThumbCache } from './cache'
import { ALL_FEATURES, createApp } from './app'
import { ZipTempStore, createLauncher } from './launch'
import { createLibrary } from './library'
import { ListingCache } from './listingCache'
import { createOverrideHolder } from './overrides'
import { SnapshotStore } from './snapshot'

const library = createLibrary()
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

// The feature report is built here rather than left to `createApp`'s default,
// because this is the construction site the demo change edits: today every
// capability is on, and 1.3 replaces this value with its env selection without
// touching the route or the type (feature-report D4).
const app = createApp(
  cache,
  createLauncher(),
  new ZipTempStore(),
  library,
  overrides,
  ALL_FEATURES,
  snapshots,
  listings,
)

export default {
  port: 3177,
  hostname: '127.0.0.1',
  // Bun closes an idle connection after 10s by default, which silently killed
  // every listing that walked a large library off a slow disk: a cold flat or
  // deep-search walk measured ~32s on a spinning USB exfat drive (2.4 ms per
  // entry cold, against 0.16 ms on SSD), and the client saw a bare network
  // error rather than a listing. 255 is Bun's maximum. It is a floor under the
  // failure, not a guarantee: a walk that spends its whole 200k-step budget on
  // that hardware would still outlast it, which is a caching problem, not a
  // timeout one.
  idleTimeout: 255,
  fetch: app.fetch,
}
