// Bun entry point — the only runtime-specific file. The app itself (Hono) runs
// unchanged on Node for a future Electron main/sidecar.
import { ThumbCache } from './cache'
import { createApp } from './app'

const cache = new ThumbCache()
void cache.maintain()

const app = createApp(cache)

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
