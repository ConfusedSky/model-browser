// Bun entry point — the only runtime-specific file. The app itself (Hono) runs
// unchanged on Node for a future Electron main/sidecar.
import { statSync } from "node:fs";
import type { FeatureReport } from "../../shared/types";
import { ThumbCache } from "./cache";
import { DEFAULT_FEATURES, createApp } from "./app";
import { ConfigError, loadConfig } from "./config";
import { ZipTempStore, createLauncher } from "./launch";
import { createLibrary } from "./library";
import { ListingCache } from "./listingCache";
import { createOverrideHolder } from "./overrides";
import { createDescribe } from "./preview";
import { SnapshotStore } from "./snapshot";
import { clientDist, createStaticHandler, route } from "./static";

// Parsed **once**, before anything is built from it (public-deployment D2), and
// fatal when unusable — in front of the operator, beside the startup lines.
const config = await loadConfig(process.env).catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
});

const library = createLibrary(process.env, config);
// The library files entries under `<cache>/<id>/` and gates the sweep (D5).
const cache = new ThumbCache(undefined, undefined, undefined, library);
const snapshots = new SnapshotStore(undefined, undefined, library);
// Built here, not left to `createApp`'s defaults: the startup work below must run
// on the **instances the app serves from** (§6.5, library-overrides D1).
const listings = new ListingCache(snapshots);
const overrides = createOverrideHolder(library);
// Which tree is open cannot be inferred from the configuration: the top is found
// by walking up from the root (D1).
void library.state().then((s) => {
  if (s.state === "ready") {
    console.log(`library ${s.id} at ${s.top}`);
    // All of this is filed per library, so it waits for one. A library that
    // resolves later does this work on the first request that asks.
    void overrides.store();
    void cache.maintain();
    // Startup revalidation (§6.5, D8), and **never a startup walk**: a root with
    // no snapshot is left alone rather than cold-walked off a spinning volume for
    // a listing nobody asked for. One root at a time, to spare the disk head.
    void (async () => {
      // Awaited: the sweep reaps `.tmp` files and every `save` below writes one.
      await snapshots.maintain();
      for (const root of await snapshots.roots())
        await listings.revalidate(library, root);
    })();
  } else console.log(`library: ${s.state}`);
});

// One value, read by both `/api/features` and the routes' refusals, so the two
// cannot disagree (public-deployment D5).
const features: FeatureReport = { ...DEFAULT_FEATURES, ...config.features };

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
);

// Wired here, not mounted on the Hono app, because serving files is
// adapter-specific (D1/D8). Null with no build: the dev loop needs none.
const dist = clientDist(process.env);
const client =
  statSync(dist, { throwIfNoEntry: false })?.isDirectory() === true
    ? createStaticHandler(dist, {
        intro: features.intro,
        // The entry document's link previews (link-previews D1): the handler
        // takes a function, so nothing in `static.ts` learns what a library is.
        describe: createDescribe({
          library,
          cache,
          overrides,
          origins: config.origins ?? [],
          distDir: dist,
        }),
      })
    : null;
// Said out loud: a failed or late client build otherwise 404s the app silently.
console.log(
  client === null
    ? `no built client at ${dist}: serving the API only`
    : `client at ${dist}`,
);

export default {
  // Where the deployment says, defaulting to loopback (D8).
  port: config.listen?.port ?? 3177,
  hostname: config.listen?.host ?? "127.0.0.1",
  // Bun's maximum. Its 10s default kills a cold walk of a large library off a
  // slow disk, and the client sees a network error rather than a listing.
  idleTimeout: 255,
  // Deliberately *below* the largest admissible body — a full `/poses` wave of
  // `MAX_PATH_BYTES` paths — since real paths are far shorter and a 413 only
  // costs that chunk its poses. Bun-only, hence here.
  maxRequestBodySize: 1_048_576,
  fetch: (req: Request) => route(req, app.fetch, client),
};
