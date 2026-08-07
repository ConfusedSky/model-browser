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
  fetch: app.fetch,
}
