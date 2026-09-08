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

- [ ] 2.1 `.dockerignore` at the repo root: `node_modules`, `client/dist`, `.git`,
      `openspec`, `docs`, `.playwright-mcp`, caches — so the build context is the source
- [ ] 2.2 `deploy/demo/app.Dockerfile`: stage one on `oven/bun:1.3.14` installs the
      workspaces and runs `bun run --filter client build`; stage two on the same base
      copies `server/`, `shared/`, `client/dist` and the lockfile, installs production
      deps, and runs `bun server/src/index.ts` (D2). Env: `MODEL_BROWSER_CONFIG=
      /config/config.json`, `MODEL_BROWSER_CACHE=/cache`; `MODEL_BROWSER_INDEX` unset —
      the default is right in the shared namespace (D1)
- [ ] 2.3 Verify: `docker build -f deploy/demo/app.Dockerfile .` succeeds here, and the
      container started with a local corpus mounted logs `library <id> at /library/…` and
      answers `/api/features` on its loopback (`docker exec … curl 127.0.0.1:3177/…`)

## 3. The index image

- [ ] 3.1 `deploy/demo/index.Dockerfile`: `python:3.12-slim`, CPU torch from the wheel
      index, `transformers==5.15.0`, `numpy==2.5.2`, fastapi, uvicorn, huggingface_hub,
      pillow — the probe runbook's pins, cited as such in the file, with the note that a
      manifest in `mini-classify` retires this list (D2). `mini-classify`'s source is
      copied in from a path given as a build arg, since it is a sibling checkout and not
      part of this repository
- [ ] 3.2 Runtime: `HF_HUB_OFFLINE=1`, `HF_HOME=/hf` on a named volume, `--cache-dir
      /index`, `--host 127.0.0.1 --port 8077`, the collection root at the corpus mount;
      `--no-volume` until the index is rebuilt against the deployed tree (Open Question)
- [ ] 3.3 A `setup`-profile service in Compose that runs `hf download
      google/siglip2-so400m-patch16-512` into the `/hf` volume, so the checkpoint is
      fetched on the box by one command and never uploaded (D3)
- [ ] 3.4 Verify here: the image builds; started against the local `embed-cache-test`
      slice and a local checkpoint, `/status` turns `ready: true` and a query answers

## 4. Caddy

- [ ] 4.1 `deploy/demo/Caddyfile`: `models.masamaeda.com` site; `encode zstd gzip`;
      `reverse_proxy 127.0.0.1:3177`; `request_body max_size` on `/api/*`; a comment
      naming `caddy-ratelimit` as the route if a limit is ever wanted and why none is
      set now (D7). `Host` untouched
- [ ] 4.2 `deploy/demo/Caddyfile.local`: the same for `localhost` under `tls internal`
      (D8)
- [ ] 4.3 `caddy_data` named volume mounted at `/data` so the certificate survives
      rebuilds (D7)

## 5. Compose and the configuration file

- [ ] 5.1 `deploy/demo/compose.yaml`: services `caddy` (ports 80/443, `restart:
      unless-stopped`), `app` and `index` with `network_mode: "service:caddy"` (D1) and
      `restart: unless-stopped`; the corpus bind mount at `/library` rw for `app` and ro
      for `index` (D4); `/cache` bind mount for `app` (D5); `./config.json` read-only at
      `/config/config.json` (D6); the `hf` and `caddy_data` named volumes; the `setup` and
      `local` profiles. A comment on the `network_mode` line carries D1's reason
- [ ] 5.2 `deploy/demo/config.json` with `{ "root": "/library/miniatures/clustered-hq" }`
      — the one key the server reads today. **Hard ordering with `public-deployment`
      6.1, which adds the origins, bind and capability fields to this same file**:
      whichever lands second edits, neither recreates
- [ ] 5.3 `docker compose -f deploy/demo/compose.yaml config` validates; `--profile local
      up --build` here brings the stack up, `https://localhost/api/features` answers
      through Caddy (the guard sees a loopback `Host`), and the app's log shows the index
      probe succeeding

## 6. The runbook

- [ ] 6.1 `deploy/demo/README.md`: box preparation (§1), populating the volumes (the
      rsync lines for corpus and index from the probe runbook, the setup-profile command
      for the checkpoint), first deploy, redeploy (`git pull && docker compose up -d
      --build`), rollback (`git checkout <rev>` and the same), and what to check: the
      certificate, **the 403 before `public-deployment` lands and what turns it into
      the app**, `free -m` against D10's table, a reboot. The bake step carries the
      recipe pin `public-deployment`'s Risks name (2026-09-07, f354811 there): with
      `thumbWrites` off, a client whose `RIG_VERSION` has moved past the bake re-renders
      every tile on every visit and cannot heal itself, so the corpus is baked by the
      client build that ships and re-baked before deploying a build with a newer recipe —
      a committed `config.json` has no comment to carry this, the runbook does
- [ ] 6.2 `docs/hetzner-probe-runbook.md` keeps its tier table and the query probe; its
      setup section becomes a pointer at the README

## 7. The record

- [ ] 7.1 `docs/platform-surface.md`, user-dirs bullet: the container's paths —
      `/config/config.json`, `/cache`, `/library` — and the env overrides that place them
      (`MODEL_BROWSER_CONFIG`, `MODEL_BROWSER_CACHE`), as a fourth column of where files
      live
- [x] 7.2 `docs/web-demo-notes.md`: the "Two containers behind Caddy" default and the
      "Static client served by Hono" line point at this change (three containers, one
      namespace — the count changed); `web-demo-backlog` 1.4 records the draft — done at
      drafting, 2026-09-07
- [ ] 7.3 `openspec validate demo-infrastructure --strict`, and an archive dry run on a
      fresh copy

## 8. On the box

- [ ] 8.1 Populate: checkpoint via the setup profile; corpus and index via rsync
- [ ] 8.2 `docker compose up -d --build`; `curl -sI https://models.masamaeda.com/` shows
      the certificate and the redirect from HTTP; `/api/features` answers **403** from the
      guard — the expected pre-landing signal (D7) — and `docker compose exec caddy wget
      -qO- http://127.0.0.1:3177/api/features` answers 200 from inside the namespace
- [ ] 8.3 Record `free -m` with the stack idle and after one query, beside D10's table;
      reboot the box and confirm the stack returns without a hand
- [ ] 8.4 After `public-deployment` lands: `git pull && docker compose up -d --build`;
      the site loads the client and a search answers. Not this change's task to make true,
      but its task to confirm the box needed no other change
