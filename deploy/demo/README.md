# The demo deployment

Everything the public demo runs on: three containers, one command, one box. This
file is the operator's — box preparation, populating the volumes, first deploy,
redeploy, rollback, and what to check. The *why* of every choice is
`openspec/changes/demo-infrastructure/design.md` (D1–D10), and the decisions are
cited as `(D1)` and so on below rather than re-argued.

It absorbs the setup half of `docs/hetzner-probe-runbook.md`, which keeps its
tier table and its query probe for the day an upgrade run is wanted.

## What runs

| container | image | what it is | reachable from |
|---|---|---|---|
| `caddy` | stock `caddy:2` | TLS, HTTP/2 and HTTP/3, reverse proxy | the internet, ports 80 and 443 only |
| `app` | built from `app.Dockerfile` | the Bun server and the built client | inside the namespace, `127.0.0.1:3177` |
| `index` | built from `index.Dockerfile` | `mini-classify`'s `serve_api.py`, CPU torch | inside the namespace, `127.0.0.1:8077` |

The three share **one network namespace** (D1): Caddy publishes the only ports,
and the app and the index keep the loopback shape their defaults were written
for, with no address configuration anywhere. Nothing but Caddy can be reached
from outside the box even if a service inside were to bind every interface.

State lives outside the images (D3, D4, D5, D6, D7), so a rebuild, a redeploy or
a rollback keeps all of it:

| mount | in the container | what it holds |
|---|---|---|
| `$CORPUS_DIR` | `/library` (rw for `app`, ro for `index`) | the models, and `.model-browser/` beside them |
| `$CACHE_DIR` | `/cache` | thumbnails and listing snapshots |
| `$INDEX_DIR` | `/index` (ro) | the embeddings and records the index serves from |
| `./config.json` | `/config/config.json` (ro) | the deployment's configuration, from the checkout |
| volume `hf` | `/hf` | the 4.3 GB SigLIP checkpoint |
| volume `caddy_data` | `/data` | the certificate and the ACME account |

## 1. Prepare the box — once (D9)

The box is the Hetzner CX23 the probe ran on: 2 shared vCPU, 4 GB, 40 GB NVMe,
Ubuntu 26.04, Falkenstein, public IPv4 kept.

**1.1 Firewall.** A *Hetzner cloud* firewall on the server, from the console:
inbound TCP 22, 80 and 443 (and UDP 443 for HTTP/3), outbound open, everything
else denied. A cloud firewall rather than `ufw` on purpose — it sits outside the
box, so a mistake in the box's own rules cannot open it.

**1.2 DNS, and verify it before anything starts.** `A` and `AAAA` records for
`models` at Namecheap, pointing at the box's addresses. Then, from this machine:

```sh
dig +short models.masamaeda.com A
dig +short models.masamaeda.com AAAA
```

Both must answer with the box's addresses **before the first `up`**: the first
ACME attempt happens the moment Caddy starts, and Let's Encrypt allows five
duplicate issuances a week (D7).

**1.3 Docker.** Docker Engine and the Compose plugin from Docker's own apt
repository (Ubuntu's `docker.io` is older and ships no `docker compose`):

```sh
apt-get update && apt-get install -y ca-certificates curl rsync
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

**1.4 Memory: swap, and overcommit.** Both permanent, both measured needs, not
precautions.

```sh
# 2 GB of floor under a 2.43 GB peak in 4 GB. The probe run never touched it
# (68 KB used); it is there so an unlucky moment queues instead of OOMs.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# SigLIP mmaps its 4.5 GB checkpoint. On a 4 GB box, once the app holds memory,
# that mmap fails — `unable to mmap 4546331880 bytes`, and the index wedges,
# which the app surfaces as an index failure (hetzner-probe-runbook, addendum
# 2026-09-04). The gate-3.3 probe never saw it because the index ran alone.
echo 'vm.overcommit_memory=1' > /etc/sysctl.d/99-model-browser.conf
sysctl --system
```

**1.5 The two checkouts.**

```sh
git clone https://github.com/ConfusedSky/model-browser.git /opt/model-browser
git clone https://github.com/ConfusedSky/mini-classify.git /opt/mini-classify
```

`mini-classify` is a *build input*, not a running service: the index image copies
`serve_api.py` and `src/` out of it at build time (D2). Keep the clone clean —
no venv, no embedding caches — because BuildKit walks whatever is there. If the
repository is not reachable from the box, the probe runbook's `rsync` of the
source is the fallback; what must arrive is `serve_api.py` and `src/`.

**1.6 The baseline.** Before anything is deployed, record the idle box:

```sh
free -m
```

That is the number the first deploy's `free -m` is read against, at the bottom of
this file.

## 2. The environment the box sets

Compose reads `deploy/demo/.env` from this directory automatically. The box's:

```sh
# /opt/model-browser/deploy/demo/.env
MINI_CLASSIFY_DIR=/opt/mini-classify
CORPUS_DIR=/srv/corpus
CACHE_DIR=/srv/cache
INDEX_DIR=/srv/index
```

It is deliberately not committed — these are one machine's paths, and the
committed defaults are the ones this repository's own machine rehearses with. So
`git status` on the box shows it untracked; that is expected, and `git pull`
never touches it.

`CORPUS_DIR` is the *library root's parent tree*, not the kit directory: the
committed `config.json` sets `root` to `/library/miniatures/clustered-hq`, so the
corpus must arrive at `$CORPUS_DIR/miniatures/clustered-hq`.

## 3. Populate the volumes

**3.1 The checkpoint**, on the box, one command (D3):

```sh
cd /opt/model-browser
docker compose -f deploy/demo/compose.yaml --profile setup run --rm --build setup
```

4.3 GB into the `hf` volume, in a couple of minutes on Hetzner's link — where
from a developer machine it would be a 4.3 GB upload. It is the one container
that talks to the internet on purpose (`HF_HUB_OFFLINE=0` for that run only).

**3.2 The corpus**, from this machine (1.8 GB, ~24 MB/s on the probe run):

```sh
ssh root@<ip> 'mkdir -p /srv/corpus/miniatures/clustered-hq/.model-browser /srv/cache /srv/index'

# Models only. The dot entries and anything that is not a model are excluded by
# policy — the app refuses non-model paths now, but what is not shipped cannot
# be served by a later change of mind either.
rsync -az --info=progress2 \
  --exclude '.*' --include '*/' --include '*.stl' --exclude '*' \
  ~/Documents/tests/test-models/miniatures/clustered-hq/ \
  root@<ip>:/srv/corpus/miniatures/clustered-hq/
```

Then the one dot-path that *does* travel:

```sh
rsync -az \
  ~/Documents/tests/test-models/miniatures/clustered-hq/.model-browser/overrides.json \
  root@<ip>:/srv/corpus/miniatures/clustered-hq/.model-browser/
```

`overrides.json` is the override store (`library-overrides`), and on this corpus
it is the **CC-BY credits** — author, licence and source URL per kit, which the
lightbox shows and the credits page (`web-demo-backlog` 1.8) will generate from.
A corpus without it is not the demo.

`library.json` beside it must **not** travel. It is the library marker, and D4
has the box write its own on first start: that id names the cache directory the
bake fills, so a copied one would tie the box's cache to this machine's library
identity.

**3.3 The index** (~275 MB), from this machine:

```sh
rsync -az --info=progress2 \
  ~/Documents/tests/mini-classify/embed-cache-test/embeds \
  ~/Documents/tests/mini-classify/embed-cache-test/pose-cache.json \
  ~/Documents/tests/mini-classify/embed-cache-test/run-params.json \
  ~/Documents/tests/mini-classify/embed-cache-test/cache-meta.json \
  ~/Documents/tests/mini-classify/embed-cache-test/walk-*.json \
  root@<ip>:/srv/index/
```

`cache-meta.json` is not in the probe runbook's list and is not optional here:
an unstamped cache makes `require_cache_version` *write* the stamp, and `/index`
is mounted read-only, so a missing stamp turns into `unreadable cache in /index`
and the index never becomes ready.

## 4. First deploy

```sh
cd /opt/model-browser
docker compose -f deploy/demo/compose.yaml up -d --build
```

The client build and the torch install happen here, on the box (D2): minutes on
two vCPUs the first time, cached after. Compose builds before it swaps
containers, so an existing stack serves through a rebuild.

## 5. What to check

**The certificate and the redirect.**

```sh
curl -sI https://models.masamaeda.com/ | head -3
curl -sI http://models.masamaeda.com/ | head -3    # 308 to https://
openssl s_client -connect models.masamaeda.com:443 -servername models.masamaeda.com </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates
```

Nothing here issued or installed anything: Caddy did (D7). If it did not, its log
carries the ACME error — `docker compose logs caddy`.

**The app.**

```sh
curl -s https://models.masamaeda.com/api/features        # the demo posture: every field false
curl -s https://models.masamaeda.com/ | head -5          # the client's index.html, not JSON
curl -s https://models.masamaeda.com/api/library         # ready, and **no `top`** — hostDetails is off
```

**The two startup lines**, which are the only place the resolved library top can
be read at all (`hostDetails` withholds it on the wire):

```sh
docker compose -f deploy/demo/compose.yaml logs app | grep -E 'client at|library '
# client at /app/client/dist
# library <id> at /library/miniatures/clustered-hq
```

Two things to look at in that second line. The path must be
`/library/miniatures/clustered-hq` — the index reports the same absolute path as
its collection root, and if the two disagree the index silently covers nothing.
And the `<id>` must **not** be the id in this machine's corpus marker
(`.model-browser/library.json`, `5358d071-…` as of 2026-09-08): a different id is
the proof that the marker was written on the box, as D4 intends, rather than
copied in with the models.

**The guard is alive.** A foreign `Origin` is the check, not a foreign `Host` —
Caddy's site block never forwards a `Host` it does not serve:

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Origin: https://evil.example' https://models.masamaeda.com/api/features
# 403
```

A 403 on the *plain* request instead means `origins` in `deploy/demo/config.json`
does not name the host Caddy is serving — a misconfigured origin looks exactly
like a dead site.

**From inside the namespace**, which is where the app actually listens:

```sh
docker compose -f deploy/demo/compose.yaml exec caddy wget -qO- http://127.0.0.1:3177/api/features
```

**The index.** `docker compose logs index` reaches a `ready` warmup line; a
search through the app answers. Expected noise on the way, not a fault: a
paragraph saying the cache was built against
`/home/masa/.../miniatures/deduplicated` and you have asked for
`/library/miniatures/clustered-hq`. That is `cache_root` reporting the recorded
root of the shipped cache; read-only tools warn and proceed, and the probe run on
the box saw the same before answering correctly.

A `ready:false` that never clears, with a `CacheUnusable` failure, is a wrong or
incomplete `/index` — not a warming delay.

**Memory**, against the table at the bottom:

```sh
free -m               # idle, and again after one search
swapon --show         # did it need the swap?
```

**A reboot.** `reboot`, then confirm the stack came back with no hand: `restart:
unless-stopped` on all three is the whole mechanism (D9) — there is no systemd
unit to check.

## 6. Redeploy, and rollback

```sh
cd /opt/model-browser && git pull && docker compose -f deploy/demo/compose.yaml up -d --build
```

A configuration change is the same command: `config.json` is committed and
mounted from the checkout (D6), so it arrives with the code and is reviewed like
it.

Rollback is a checkout and the same command:

```sh
cd /opt/model-browser && git checkout <rev> && docker compose -f deploy/demo/compose.yaml up -d --build
```

Either way the corpus, the caches, the embeddings, the checkpoint and the
certificate are untouched — none of them is in an image. `docker compose down`
stops the stack and keeps every volume; `down -v` would destroy the checkpoint
and the certificate, so it is never the command you want here.

## 7. The bake, and its recipe pin

The corpus is baked (`web-demo-backlog` 1.7) **after** the app's first start on
the box: the bake writes into `$CACHE_DIR/<library id>/`, and that id does not
exist until the app has written the marker (D4).

The pin that matters, from `public-deployment`'s Risks (2026-09-07): with
`thumbWrites` off, a visitor's client cannot heal a stale cache. If the client
that ships has a `RIG_VERSION` newer than the bake's, every tile re-renders on
every visit, for every visitor, forever. So:

* bake with the **client build that ships**, and
* **re-bake before deploying a build whose `RIG_VERSION` has moved.**

`config.json` is JSON and can carry no comment saying so, which is why it is said
here.

## 8. Rehearsing locally (D8)

The same file, the same images, the same namespace, against a local corpus and
Caddy's internal CA:

```sh
CADDYFILE=Caddyfile.local CACHE_DIR=/tmp/model-browser-demo-cache \
  docker compose -f deploy/demo/compose.yaml up --build
curl -k https://localhost/api/features
```

No environment is needed beyond those two: the mount defaults in `compose.yaml`
are this repository's machine's layout. `CACHE_DIR` is worth passing anyway —
its default is `./cache`, which Docker would create root-owned inside the
checkout.

Building needs **buildx** (`docker-buildx-plugin`, or Arch's `docker-buildx`).
The index image copies `mini-classify` out of a named build context, which the
classic builder cannot do: without buildx the build stops at `the classic
builder doesn't support additional contexts`. Compose warns that it wants buildx
for any build regardless. The app needs no configuration change either — its
guard admits a loopback `Host` and a loopback `Origin` whatever the deployment's
origins say, so the committed `config.json`, capabilities and all, is exercised
exactly as it will be on the box. `docker compose exec caddy caddy trust` once,
if you want a browser without a certificate warning.

The index will not become ready without a checkpoint in the `hf` volume: either
run the `setup` profile once (§3.1, 4.3 GB) or, if this machine already has the
model under `~/.cache/huggingface`, mount that directory at `/hf` for the
rehearsal with a second compose file that replaces the volume on the one target:

```yaml
# hf-local.yaml — rehearsal only
services:
  index:
    volumes:
      - ~/.cache/huggingface:/hf:ro
```

```sh
CADDYFILE=Caddyfile.local CACHE_DIR=/tmp/model-browser-demo-cache \
  docker compose -f deploy/demo/compose.yaml -f hf-local.yaml up --build
```

Rehearsed this way on 2026-09-08 (buildx 0.35, the index image built through the
named context in 55 s): the app answered the demo posture and the client at `/`,
`/api/library` without `top`, a foreign `Origin` 403, `http://` a 308, the index
was ready in 19 s from this machine's cache, and a meaning search through Caddy
answered library paths with no host string in the body.

## 9. The memory budget (D10)

| resident | source |
|---|---|
| index, peak | 2.43 GB (VmHWM on the CX23, 2026-09-04, Masa's run) |
| app | ~150 MB, Bun with the listing snapshot for 2,254 models — unmeasured on the box; measure at first deploy |
| Caddy | ~30 MB |
| Docker daemon | ~100 MB |
| OS | ~300 MB |

About 3.0 GB against 4 GB, with 2 GB of swap as the floor. **Record the real
`free -m` here at first deploy**, idle and after one search, beside §1.6's
baseline. If the app's share is wrong by a factor that matters, the remedy is the
CX33 resize the host decision already names, not a change to this design.

First deploy, 2026-09-09 (`free -m`, MB): before `up`, box idle — used 754, free 708;
stack up and idle — used 1303, free 247, swap 74; after one meaning search — used
1332. `docker stats`: index 873 MiB, app 46 MiB, caddy 26 MiB. Well inside D10's table;
the index's resident share is under the probe's 2.43 GB peak because the checkpoint is
mapped, not read, and the kernel keeps it in page cache under `buff/cache`.
