## Context

The demo is decided down to the box. The app half is `public-deployment` (drafted,
0/43 applied): the configuration file, the configured-origin guard, the bind address,
static serving of the built client. The corpus, index and checkpoint exist and have been
run on the target once — `docs/hetzner-probe-runbook.md`, 2026-09-04, a venv installed
by hand over SSH, `serve_api.py --no-volume` on a 275 MB slice of `embed-cache-test`,
SigLIP peaking at 2.43 GB on the 4 GB CX23. What has never been written down is the
box itself: what runs, how it is built, how it is reached, what survives a rebuild.

Constraints the code already fixes, none of which this change moves:

- `server/src/index.ts` binds `127.0.0.1:3177` — a literal until `public-deployment`
  reads it from configuration — and `guard.ts` refuses any `Host` that is not
  loopback (`LOOPBACK_HOST`) and any non-loopback `Origin`.
- `server/src/semantic.ts` reaches the index at `DEFAULT_BASE`, `http://127.0.0.1:8077`,
  unless `MODEL_BROWSER_INDEX` says otherwise; `serve_api.py` binds `--host 127.0.0.1`
  by default.
- The configuration file is wherever `MODEL_BROWSER_CONFIG` points; the thumbnail and
  listing caches live wherever `MODEL_BROWSER_CACHE` points (`ThumbCache` and
  `SnapshotStore` share the default `~/.cache/model-browser`); `library.ts` writes the
  library marker under `<library>/.model-browser/` on first start, and where the volume
  refuses the write it names the library by a hash of its real path instead
  (`writeMarker`, `hashedId`, the `unmarked` flag).
- Bun-only APIs are confined to `index.ts` (D1); the runtime the container runs is Bun,
  which is the runtime the entry point was written for. The client builds with
  `bun run --filter client build`; nothing serves `client/dist` until `public-deployment`
  D8.
- `mini-classify` has no `pyproject.toml`, `requirements.txt` or lockfile. What it needs
  is recorded once, in the probe runbook: Python 3.12, CPU torch from
  `download.pytorch.org/whl/cpu`, `transformers==5.15.0`, `numpy==2.5.2`, fastapi,
  uvicorn, huggingface_hub, pillow; `run_serve.sh` runs it with `HF_HUB_OFFLINE=1`.
- The box: Hetzner CX23, 2 shared vCPU, 4 GB, 40 GB NVMe, Ubuntu 26.04, Falkenstein,
  public IPv4 kept. Memory is the tight axis — 2.43 GB peak for the index, with the app,
  Caddy and Docker beside it.

## Goals / Non-Goals

**Goals:**

- One command from a checkout on the box brings up the whole stack, and the same command
  brings it up on a developer machine against a local corpus.
- Only Caddy is reachable from outside; the app and the index keep their loopback-only
  shape with no configuration.
- Nothing that is expensive or stateful lives inside an image: corpus, caches,
  checkpoint, certificates.
- A deploy is a pull and a rebuild; a rollback is a checkout and a rebuild; both keep
  the certificate.

**Non-Goals:**

- Anything the app reads or serves — origins, capability fields, static serving,
  withheld routes. `public-deployment` owns those; this change mounts its file.
- The bake, the index rebuild against the deployed tree, and the credits page
  (`web-demo-backlog` 1.7, 1.8). This change gives them a place to write and a path
  to agree on, nothing more.
- A CDN or a second origin. The notes leave origin/CDN open as a design question; a CDN
  in front changes nothing here except the Caddyfile's trusted-proxy line.
- CI-built images and a registry. There is no CI in this repository; images build on
  the box.
- Monitoring, log shipping, backups beyond "the corpus and index are copies of what is
  on this machine".

## Decisions

### D1: One shared network namespace, not a bridge network

All three containers join the network namespace of one of them (Compose's
`network_mode: "service:<name>"`), so they share a loopback. Caddy proxies to
`127.0.0.1:3177`; the app finds the index at `127.0.0.1:8077`; the index binds loopback.
Only Caddy publishes ports, and it publishes only 80 and 443.

This is the pod shape, and it is chosen because it is *exactly the topology every
constraint above was written for*. The app's bind is a loopback literal until
`public-deployment` lands; the guard's `Host` and `Origin` rules are loopback rules; the
index's default address is loopback; none of that needs a flag, an env var or a wait.
It also makes the security boundary a property of the namespace rather than of three
services each remembering to bind narrowly: there is no interface on which the app or
the index could be reached even by mistake.

*Alternative — a Compose bridge network with service names.* The conventional shape:
Caddy proxies to `app:3177`, the app reaches `index:8077`. Rejected for now because it
needs the app to bind `0.0.0.0` (which `public-deployment` makes configurable, and which
this change must not wait for), needs `MODEL_BROWSER_INDEX` set, and widens what the app
container listens on to every container on the bridge. When `public-deployment` lands,
the bridge shape becomes *possible*; nothing about it becomes *better*, so the pod shape
stays.

*Alternative — host networking.* Same loopback sharing, but with the host's namespace,
so a stray `0.0.0.0` bind would be public. Rejected.

### D2: Images built on the box from pinned bases, no registry

`app.Dockerfile` is a two-stage build on `oven/bun:1.3.14` (this machine's Bun,
pinned exactly): install the workspaces, `bun run --filter client build`, then copy
`server/`, `shared/` and `client/dist` into a slim stage that runs
`bun server/src/index.ts`. `index.Dockerfile` is `python:3.12-slim` with the probe
runbook's pins installed from the CPU wheel index and `mini-classify`'s source copied
in. Caddy is the stock `caddy:2` image.

Built on the box because there is no CI, no registry, and one box. The client build and
the torch install are minutes on two vCPUs and happen at deploy time, not at request
time. The cost is that a deploy briefly competes with serving for CPU; Compose builds
before it swaps containers, so the old stack serves through the build.

The index image pins by hand what `mini-classify` never wrote down. That is the right
place only until that repository grows a manifest; the Dockerfile says so, and the pins
are the runbook's so the two cannot disagree.

*Alternative — a prebuilt image pushed from this machine.* Rejected: it moves the build
to a machine that is not the box and adds a registry account for one image nobody else
pulls.

### D3: The checkpoint and the index are volumes, populated once, never in an image

The 4.3 GB SigLIP checkpoint is pulled *on the box* (Hetzner's link fetches it in
minutes; from here it is a 4.3 GB upload) into a named volume that the index container
mounts as its Hugging Face cache, and the container runs `HF_HUB_OFFLINE=1` as
`run_serve.sh` does. The embeddings and records (`embed-cache-test`'s `embeds/`,
`pose-cache.json`, `run-params.json`, `walk-*.json`, ~275 MB) are rsync'd into a
directory the index container mounts as its `--cache-dir`. Neither is in an image: an
image with 4.3 GB of weights would be rebuilt on every code change and would make a
rollback a 4.3 GB operation.

Populating the checkpoint is a one-shot Compose service (`profiles: [setup]`) that runs
`hf download` into the volume, so the runbook's step is one command and the same image.

### D4: The corpus is a read-write bind mount, and the app writes only under `.model-browser/`

The corpus (`miniatures/clustered-hq/`, 1.8 GB, plus `metadata/`) is rsync'd to the box
and bind-mounted into *both* the app and the index containers at the same path, so the
index's collection root and the app's library resolve the same files. Mounted
read-write, not read-only, for two reasons that both come from `library-root`: the app
writes its marker (`<library>/.model-browser/library.json`) on first start, and without
it names the library by a hash of the container path — a name that would change if the
mount point ever did, orphaning the baked cache; and `library-overrides` keeps the
override store beside that marker. Nothing else the app does on the demo writes under
the library: thumbnail writes are refused by `public-deployment`, and the launcher is
withheld.

The consequence for ordering: the bake (`web-demo-backlog` 1.7) writes thumbnails into
the cache directory named by the library id, so it runs *after* the app's first start on
the box, and against the same mount path.

### D5: The caches are one bind mount named by `MODEL_BROWSER_CACHE`

`ThumbCache` and `SnapshotStore` both default to `~/.cache/model-browser` and both read
`MODEL_BROWSER_CACHE`. The app container sets it to `/cache`, a bind mount on the box.
Bind mount rather than named volume because the bake and any hand inspection want a path
on the host, and because it is the one thing worth copying off the box.

### D6: The configuration file is bind-mounted from the checkout

`deploy/demo/config.json` is committed (`public-deployment` D10 decided that; this change
creates the file with the single key the server reads today, `root`, and
`public-deployment` 6.1 fills in the rest). Compose mounts it read-only at
`/config/config.json` and sets `MODEL_BROWSER_CONFIG` to that path. So the file reaches
the box the way the code does — `git pull` — and a configuration change is a commit,
reviewed like one, applied by the same redeploy command.

*Alternative — copy the file into the image.* Rejected: a configuration change would
need an image rebuild, and the file would exist in two places with two ages.

*Alternative — environment variables in Compose.* Rejected by `public-deployment` D1
for the app; Compose's `environment:` carries only the three path variables above, which
describe the container and not the deployment.

### D7: Caddy, stock image, automatic TLS, no rate limit at launch

`Caddyfile`: one site block for `models.masamaeda.com` with `encode zstd gzip`,
`reverse_proxy 127.0.0.1:3177`, and a request-body cap on `/api/*`. Caddy obtains the
certificate from Let's Encrypt (ZeroSSL as fallback), renews it, redirects HTTP to HTTPS,
and speaks HTTP/2 by default — the notes' first-screen measurement found ~114 requests
each paying an ocean RTT over HTTP/1.1, and multiplexing is the cheapest answer to that.
Caddy's `/data` is a named volume so a rebuild or rollback keeps the certificate; Let's
Encrypt limits duplicate issuance to five a week, which a careless rebuild loop would hit.

`Host` is passed through unchanged. Until `public-deployment` lands the guard therefore
answers every proxied API request 403 — which is the *honest* pre-landing smoke signal:
TLS terminated, proxy reached the app, app refused a stranger. A `header_up Host`
rewrite would make the smoke test green by lying to the guard, and would have to be
removed later; it is not added.

No rate limit. Stock Caddy has none; `mini-classify` serialises queries so a flood queues
rather than overloads; the flat walk is bounded by its 200k-step budget. If abuse shows,
the route is a builder stage adding `caddy-ratelimit` — recorded in the Caddyfile beside
the body cap so the next operator does not go looking. Nginx was weighed for its
built-in `limit_req` and declined: TLS automation is the feature that matters daily, and
Caddy's is zero-configuration.

### D8: A `local` profile rehearses the stack on a developer machine

`Caddyfile.local` serves `localhost` under Caddy's internal CA, and a `local` Compose
profile swaps it in and points the corpus mount at a directory of the developer's
choosing. Everything else is identical — same images, same namespace, same env. That is
what makes this change testable before the box is touched: `docker compose --profile
local up --build` here proves the images build, the namespace wiring holds, the app finds
the index and the caches land where they should.

### D9: The box is prepared by hand, once, and the runbook says how

Docker Engine and the Compose plugin from Docker's apt repository, the 2 GB swapfile the
probe runbook already used (measured untouched at 2.43 GB peak, kept as a floor under an
OOM), a Hetzner cloud firewall admitting 22, 80 and 443 inbound and nothing else, DNS
`A` and `AAAA` records for `models` at Namecheap pointing at the box, and a clone of this
repository under `/opt/model-browser`. Restart-on-reboot is Compose's `restart:
unless-stopped`, not a systemd unit. All of it is a page in `deploy/demo/README.md`,
which absorbs the probe runbook's setup half; the probe runbook keeps its tier table for
the day an upgrade run is wanted.

A cloud firewall rather than `ufw` because it sits outside the box: a mistake in the box's
own rules cannot open it.

### D10: The memory budget is stated, not assumed

| resident | source |
|---|---|
| index, peak | 2.43 GB (VmHWM on the CX23, 2026-09-04, Masa's run) |
| app | ~150 MB, Bun with the listing snapshot for 2,254 models — unmeasured on the box; measure at first deploy |
| Caddy | ~30 MB |
| Docker daemon | ~100 MB |
| OS | ~300 MB |

About 3.0 GB against 4 GB, with 2 GB of swap as the floor. The first deploy records the
real `free -m` beside this table in the runbook; if the app's share is wrong by a factor
that matters, the CX33 resize the host decision already names is the remedy, not a
change to this design.

## Risks / Trade-offs

- [Compose's `network_mode: service:` is less known than a bridge network] → It is
  documented in every file that uses it, with D1's reason; and the local profile
  exercises exactly the same wiring, so a mistake shows here before the box.
- [The index image pins by hand what upstream never declared] → The Dockerfile names
  the probe runbook as its source and the runbook names the Dockerfile; a manifest in
  `mini-classify` retires both. Until then a `transformers` or `torch` bump is a
  two-place edit.
- [Building on a 2 vCPU box competes with serving] → Compose builds before swapping,
  so the old stack serves through it; the client build is under a minute, the torch
  layer is cached after the first build. Acceptable for a demo; a registry is the
  answer if it stops being.
- [The pre-landing smoke test is a 403] → Stated as the expected signal in the runbook,
  with what changes it (`public-deployment` D3 and D8). A reviewer measuring "the app
  does not load" before that change lands should read this line, not file a bug.
- [A read-write corpus mount on a public box] → Nothing reachable writes to it: thumbnail
  writes are refused, the launcher withheld, and the only paths the app writes are under
  `.model-browser/`. The index container mounts it read-only.
- [Certificate issuance depends on DNS and port 80 being right on the first try] → Caddy
  retries with backoff and logs the ACME error; the runbook's first-deploy step checks
  DNS resolves to the box *before* `up`, and the certificate volume means a fixed DNS
  record does not re-issue.
- [The corpus and index on the box are copies] → They are copies of what is on this
  machine, which is the source of truth; the runbook's rsync lines are the backup in
  reverse. Nothing on the box is unique except the marker and the bake, both
  regenerable.

## Migration Plan

1. Rehearse locally with the `local` profile against a local corpus; every task in §2–§5
   is verifiable here.
2. Prepare the box (§1 tasks): firewall, swap, Docker, DNS, clone.
3. Populate the volumes: checkpoint via the setup profile, corpus and index via rsync.
4. `docker compose up -d --build`; confirm the certificate and the 403.
5. When `public-deployment` lands: `git pull`, `docker compose up -d --build`; the 403
   becomes the app.
6. Rollback at any step: `git checkout <previous>` and the same command; volumes and
   certificate untouched.

## Open Questions

- Whether the index container should mount the corpus at all before the index is
  rebuilt against the deployed tree (`web-demo-backlog` 1.7): `--no-volume` enumerates
  from `pose-cache.json` and reads nothing under the root, which is how the probe ran.
  This change mounts it read-only from the start so the rebuild needs no Compose edit;
  the flag is dropped when the rebuilt index lands.
