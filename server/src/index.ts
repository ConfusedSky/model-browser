// Bun entry point — the only runtime-specific file. The app itself (Hono) runs
// unchanged on Node for a future Electron main/sidecar.
import { ThumbCache } from './cache'
import { createApp } from './app'
import { ZipTempStore, createLauncher } from './launch'
import { createLibrary } from './library'

const library = createLibrary()
// Positional to keep the three existing parameters' defaults; the library is
// what files entries under `<cache>/<id>/` and gates the sweep (D5).
const cache = new ThumbCache(undefined, undefined, undefined, library)
// The resolved library, named once at start: the root is a viewpoint and the
// top is found by walking up from it, so which tree is open is not something a
// reader can infer from the configuration alone (D1, and R1's warning).
void library.state().then((s) => {
  if (s.state === 'ready') {
    console.log(`library ${s.id} at ${s.top}`)
    // The startup sweep resolves every cached path through the library, so it
    // has nothing to say until there is one.
    void cache.maintain()
  } else console.log(`library: ${s.state}`)
})

const app = createApp(cache, createLauncher(), new ZipTempStore(), library)

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
