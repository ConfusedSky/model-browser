## 1. The box, prepared once

- [ ] 1.1 Hetzner cloud firewall on the CX23: inbound 22, 80, 443 only; outbound open.
      Applied from the console, recorded in `deploy/demo/README.md` (D9)
- [ ] 1.2 DNS at Namecheap: `A` and `AAAA` records for `models.masamaeda.com` to the box;
      verify with `dig +short` from this machine *before* any container starts, since
      the first ACME attempt happens at first `up` (D7)
- [ ] 1.3 On the box: Docker Engine + Compose plugin from Docker's apt repository; the
      2 GB swapfile from the probe runbook, made permanent in `/etc/fstab`; a clone of this
      repository at `/opt/model-browser` (D9)
- [ ] 1.4 Record `free -m` on the idle box in the README beside D10's table — the baseline
      the first deploy's number is read against

## 2. The application image

- [x] 2.1 `.dockerignore` at the repo root: `node_modules`, `client/dist`, `.git`,
      `openspec`, `docs`, `.playwright-mcp`, caches — so the build context is the source.
      Written 2026-09-08; `deploy/` is excluded too, so the configuration exists only as
      the mount D6 gives it and never also as a layer
- [x] 2.2 `deploy/demo/app.Dockerfile`: stage one on `oven/bun:1.3.14` installs the
      workspaces and runs `bun run --filter client build`; stage two on the same base
      copies `server/`, `shared/`, `client/dist` and the lockfile, installs production
      deps, and runs `bun server/src/index.ts` (D2). Env: `MODEL_BROWSER_CONFIG=
      /config/config.json`, `MODEL_BROWSER_CACHE=/cache`; `MODEL_BROWSER_INDEX` unset —
      the default is right in the shared namespace (D1).
      Written 2026-09-08. Two workspaces, not three: `shared/` has no manifest, so the
      install layer copies the root, `server` and `client` manifests. The runtime stage
      copies `server/src` and not `server/test`, and `tsconfig.base.json` because both
      workspace tsconfigs extend it
- [x] 2.3 Verify: `docker build -f deploy/demo/app.Dockerfile .` succeeds here, and the
      container started with a local corpus mounted logs `library <id> at /library/…` and
      answers `/api/features` on its loopback (`docker exec … curl 127.0.0.1:3177/…`).
      **Run 2026-09-08**: `Successfully built 96a0a683d46d`; started against
      `~/Documents/tests/test-models` with the committed `config.json`, the container logs
      `client at /app/client/dist` and
      `library 5358d071-9b27-4f3d-a1de-4f34bc793143 at /library/miniatures/clustered-hq`.
      The image has no curl and the app binds container-loopback, so the probe is
      `docker exec … bun -e 'fetch(…)'`: `/api/features` 200
      `{"thumbWrites":false,"appLaunch":false,"chatTab":false,"hostDetails":false,"maintenance":false}`,
      `/api/library` 200 `{"state":"ready","id":"5358d071-…","root":"/"}` (no `top`), `/`
      200 the client's `<!doctype html>`. `clientDist`'s default resolving with no env var
      is therefore measured, not read

## 3. The index image

- [x] 3.1 `deploy/demo/index.Dockerfile`: `python:3.12-slim`, CPU torch from the wheel
      index, `transformers==5.15.0`, `numpy==2.5.2`, fastapi, uvicorn, huggingface_hub,
      pillow — the probe runbook's pins, cited as such in the file, with the note that a
      manifest in `mini-classify` retires this list (D2). `mini-classify`'s source is
      copied in from a path given as a build arg, since it is a sibling checkout and not
      part of this repository.
      Written 2026-09-08. **A named build context, not a build arg** (approved at
      check-in): `compose.yaml` binds `mini-classify` to `${MINI_CLASSIFY_DIR}` and the
      Dockerfile does `COPY --from=mini-classify`. A build arg cannot reach outside the
      context at all, and making the checkout the context sends the whole of it — 22 GB
      and 282,381 files on this machine, and `.dockerignore` cannot be added to another
      repository. Only `serve_api.py` and `src/` are copied: nothing else is imported on
      the serve path
- [x] 3.2 Runtime: `HF_HUB_OFFLINE=1`, `HF_HOME=/hf` on a named volume, `--cache-dir
      /index`, `--host 127.0.0.1 --port 8077`, the collection root at the corpus mount;
      `--no-volume` until the index is rebuilt against the deployed tree (Open Question).
      Written 2026-09-08, with the CMD carrying why ROOT is not decoration under
      `--no-volume`: `Collection.load` scopes the manifest enumeration to it exactly as
      the walk would, and it is what the index reports as `collection_root`, which the app
      maps through `library.libPathOf` — so both containers must mount the corpus at the
      same path. Confirmed live (3.4): hits come back as
      `/library/miniatures/clustered-hq/…` and the app reads them as library paths
- [x] 3.3 A `setup`-profile service in Compose that runs `hf download
      google/siglip2-so400m-patch16-512` into the `/hf` volume, so the checkpoint is
      fetched on the box by one command and never uploaded (D3).
      Written 2026-09-08: same image as `index`, `HF_HUB_OFFLINE=0` for that run alone,
      `restart: "no"`, and no `network_mode` — it runs before the stack does and needs the
      default network to reach the internet. The 4.3 GB download itself was not run here;
      the rehearsal mounted this machine's `~/.cache/huggingface` at `/hf` instead, which
      is the alternative the README names
- [x] 3.4 Verify here: the image builds; started against the local `embed-cache-test`
      slice and a local checkpoint, `/status` turns `ready: true` and a query answers.
      **Run 2026-09-08**: the image builds in 81 s (`Successfully built 06fdeaa1d2ae`);
      started against `embed-cache-test` read-only and `~/.cache/huggingface` at `/hf`, it
      logs `warmup ready: 2165 models on cpu in 5.3 s` and `POST /query {"text":"a
      dragon"}` answers in 0.96 s with `matched: 2165`, top hit
      `/library/miniatures/clustered-hq/Bronze_Dragon_2832574/Young_Bronze_Dragon.stl`.
      **One caveat, stated rather than hidden**: this machine has no `buildx`
      (`docker buildx version` → `unknown command`), and named contexts need BuildKit, so
      the image was built from a scratch context holding `serve_api.py` + `src/` with the
      committed Dockerfile's two `COPY --from=mini-classify` lines rewritten to plain
      `COPY` (`sed 's/--from=mini-classify //'`) — every pin, ENV and the CMD are the
      committed file's. The named-context mechanism itself is verified only by
      `docker compose config` and by the engine's own error naming the feature

## 4. Caddy

- [x] 4.1 `deploy/demo/Caddyfile`: `models.masamaeda.com` site; `encode zstd gzip`;
      `reverse_proxy 127.0.0.1:3177`; `request_body max_size` on `/api/*`; a comment
      naming `caddy-ratelimit` as the route if a limit is ever wanted and why none is
      set now (D7). `Host` untouched.
      Written 2026-09-08. The matcher-scoped spelling is `request_body @api { max_size
      1MB }` (Caddy's directive syntax is `request_body [<matcher>] { … }`), and 1MB is
      the app's own `maxRequestBodySize`, deliberately the same number. Exercised through
      Caddyfile.local (4.2): a 1.2 MB `PUT /api/thumb` answers **413** over HTTP/1.1 (over
      HTTP/2 curl reports a stream error instead — refused either way), `encode` returns
      `content-encoding: zstd` on the JS bundle, and plain HTTP answers **308** to https
- [x] 4.2 `deploy/demo/Caddyfile.local`: the same for `localhost` under `tls internal`
      (D8).
      Written 2026-09-08 and used for the whole of 5.3's rehearsal: `https://localhost/`
      answers 200 over HTTP/2 under Caddy's internal CA, with `alt-svc: h3=":443"` — so
      the HTTP/3 the compose file publishes 443/udp for is really on
- [x] 4.3 `caddy_data` named volume mounted at `/data` so the certificate survives
      rebuilds (D7).
      Written 2026-09-08; after `docker compose down` the volume `demo_caddy_data` is
      still listed, which is the property (a certificate is not re-issued by a redeploy)

## 5. Compose and the configuration file

- [x] 5.1 `deploy/demo/compose.yaml`: services `caddy` (ports 80/443, `restart:
      unless-stopped`), `app` and `index` with `network_mode: "service:caddy"` (D1) and
      `restart: unless-stopped`; the corpus bind mount at `/library` rw for `app` and ro
      for `index` (D4); `/cache` bind mount for `app` (D5); `./config.json` read-only at
      `/config/config.json` (D6); the `hf` and `caddy_data` named volumes; the `setup` and
      `local` profiles. A comment on the `network_mode` line carries D1's reason.
      Written 2026-09-08, with one deviation: there is **no `local` profile**. Compose
      cannot swap one service's mount by profile, so the rehearsal's Caddyfile is chosen
      by variable instead — `./${CADDYFILE:-Caddyfile}` as the mount source, driven by
      `CADDYFILE=Caddyfile.local docker compose … up`. `setup` is a profile as specified.
      Every machine-specific mount takes a `~`-rooted default (expansion verified with
      `docker compose config`), so the rehearsal needs no environment at all
- [x] 5.2 `deploy/demo/config.json` — **created in full by `public-deployment` 6.1
      (2026-09-07, its stage A1)**: `root` `/library/miniatures/clustered-hq`, the origin,
      loopback `listen` (this change's D1), every capability field stated. Nothing for
      this change to write; Compose mounts it read-only at `/config/config.json` (D6).
      The ordering this line declared is discharged
- [x] 5.3 `docker compose -f deploy/demo/compose.yaml config` validates; `--profile local
      up --build` here brings the stack up, `https://localhost/api/features` answers
      through Caddy (the guard sees a loopback `Host`), and the app's log shows the index
      probe succeeding.
      **Run 2026-09-08.** `config` validates, with and without `--profile setup`.
      `CADDYFILE=Caddyfile.local … up -d` brings all three containers up (the build was
      `--no-build` over images built by hand, since this machine has no `buildx` — 3.4).
      Through Caddy, on `https://localhost`: `/api/features` 200 with every field false,
      `/` 200 the client, `/api/library` 200 with no `top`, `Origin:
      https://evil.example` → **403**, `http://localhost/` → 308. `docker compose logs
      app` shows `client at /app/client/dist` and `library … at
      /library/miniatures/clustered-hq`; `logs index` shows `warmup ready: 2165 models`;
      and the index probe succeeding is `GET /api/semantic/status` →
      `{"state":"ready","covers":["stl"],"elapsed":39.8,"collectionRoot":"/"}` — the app
      reaching the index across the shared namespace with no address configured, which is
      D1's whole claim. End to end, `POST /api/semantic {"text":"a dragon","path":"/"}`
      returns library-path entries. `docker compose down` keeps the volumes

## 6. The runbook

- [x] 6.1 `deploy/demo/README.md`: box preparation (§1), populating the volumes (the
      rsync lines for corpus and index from the probe runbook, the setup-profile command
      for the checkpoint), first deploy, redeploy (`git pull && docker compose up -d
      --build`), rollback (`git checkout <rev>` and the same), and what to check: the
      certificate, **what a healthy box answers** (`public-deployment` landed 2026-09-08,
      so the smoke expectations below are the app's, not a guard's 403): `/api/features`
      with the demo posture, `/` the client, the two startup lines in `docker compose logs
      app` — `client at …/client/dist` and `library <id> at /library/miniatures/clustered-hq`,
      the only place the resolved top can be read since `hostDetails` withholds it on the
      wire — and `Origin: https://evil.example` → 403 as the guard's liveness check (a
      foreign `Host` never reaches the app through Caddy's site block), `free -m` against
      D10's table, a reboot. The bake step carries the
      recipe pin `public-deployment`'s Risks name (2026-09-07, f354811 there): with
      `thumbWrites` off, a client whose `RIG_VERSION` has moved past the bake re-renders
      every tile on every visit and cannot heal itself, so the corpus is baked by the
      client build that ships and re-baked before deploying a build with a newer recipe —
      a committed `config.json` has no comment to carry this, the runbook does
- [x] 6.2 `docs/hetzner-probe-runbook.md` keeps its tier table and the query probe; its
      a committed `config.json` has no comment to carry this, the runbook does.
      Written 2026-09-08. Four things the pinned list did not carry, each with its source:
      `vm.overcommit_memory=1` made permanent in box prep (the probe runbook's addendum —
      SigLIP's 4.5 GB mmap fails at 4 GB once the app holds memory, `unable to mmap
      4546331880 bytes`, and the index wedges); the corpus rsync ships
      `.model-browser/overrides.json` after all, since on this corpus it is the CC-BY
      credits, while `library.json` is left for the box to write (D4) and the marker check
      is "the id is not this machine's"; the index rsync adds `cache-meta.json`, which the
      probe runbook omits and a read-only `/index` makes mandatory — an unstamped cache
      makes `require_cache_version` *write* the stamp, which on a ro mount becomes
      `unreadable cache in /index`; and the `cache_root` mismatch paragraph is named as
      expected output rather than a fault (seen verbatim in 3.4's run)
- [x] 7.1 `docs/platform-surface.md`, user-dirs bullet: the container's paths —
      `/config/config.json`, `/cache`, `/library` — and the env overrides that place them
      (`MODEL_BROWSER_CONFIG`, `MODEL_BROWSER_CACHE`), as a fourth column of where files
      live
      Done 2026-09-08: the user-dirs bullet gained the container column — `/config/config.json`, `/cache`, `/library`, the client at its in-image default, `/index` and `/hf` for the index
- [x] 7.2 `docs/web-demo-notes.md`: the "Two containers behind Caddy" default and the
      "Static client served by Hono" line point at this change (three containers, one
      namespace — the count changed); `web-demo-backlog` 1.4 records the draft — done at
      drafting, 2026-09-07
- [x] 7.3 `openspec validate demo-infrastructure --strict`, and an archive dry run on a
      fresh copy
      Done 2026-09-08: strict validate passes; the archive dry run on a fresh copy applies (no delta collisions — the capability is new)
## 8. On the box

- [ ] 8.1 Populate: checkpoint via the setup profile; corpus and index via rsync
- [ ] 8.2 `docker compose up -d --build`; `curl -sI https://models.masamaeda.com/` shows
      the certificate and the redirect from HTTP; `/api/features` answers 200 with every
      field off (the demo posture); `/` is the client; `/api/library` carries no `top`;
      `curl -H 'Origin: https://evil.example' …/api/features` answers 403 `forbidden
      origin` — the guard's liveness check, since Caddy never forwards a foreign `Host`
      (D7); and `docker compose exec caddy wget -qO- http://127.0.0.1:3177/api/features`
      answers the same 200 from inside the namespace
- [ ] 8.3 Record `free -m` with the stack idle and after one query, beside D10's table;
      reboot the box and confirm the stack returns without a hand
- [ ] 8.4 `public-deployment` landed before this change was applied, so there is no
      second deploy: 8.2 already expects the app. Kept as the place to confirm a meaning
      search answers through Caddy end to end, and that the box needed nothing beyond
      this change
