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

The zone is at Namecheap on their BasicDNS (`dns1`/`dns2.registrar-servers.com`).
§10 records what is actually published and what it takes to move the zone to
Cloudflare, which the CDN work needs.

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
committed `config.json` sets `root` to `/library/miniatures/decimated`, so the
corpus must arrive at `$CORPUS_DIR/miniatures/decimated`.

## 3. Populate the volumes

**3.1 The checkpoint**, on the box, one command (D3):

```sh
cd /opt/model-browser
docker compose -f deploy/demo/compose.yaml --profile setup run --rm --build setup
```

4.3 GB into the `hf` volume, in a couple of minutes on Hetzner's link — where
from a developer machine it would be a 4.3 GB upload. It is the one container
that talks to the internet on purpose (`HF_HUB_OFFLINE=0` for that run only).

**3.2 The corpus**, from this machine (4.6 GB, ~24 MB/s on the probe run). The
bytes ship from `miniatures/decimated/` (quadric decimation, since 2026-09-15 —
vertex clustering altered ND-licensed models too far in spirit; `clustered-hq`
shipped before). `decimated/` is the whole ship: its 3,122 STLs are the shipped
set exactly. Ten kit directories in it are empty and so never travel — it mirrors
`deduplicated/`'s coverage, and in those ten every file was a duplicate of another
kit's, most of them Thingiverse's `SoLongb.stl` takedown placeholder, which is
byte-identical across the kits that carry it.

```sh
ssh root@<ip> 'mkdir -p /srv/corpus/miniatures/decimated/.model-browser /srv/cache /srv/index'

# Models only, by list. The dot entries and anything that is not a model are
# excluded by policy — the app refuses non-model paths now, but what is not
# shipped cannot be served by a later change of mind either.
(cd ~/Documents/tests/test-models/miniatures/decimated && \
  find . -type f -iname '*.stl' ! -path './.model-browser/*' | sed 's|^\./||' | sort) > /tmp/ship-files.txt
rsync -az --info=progress2 --files-from=/tmp/ship-files.txt \
  ~/Documents/tests/test-models/miniatures/decimated/ \
  root@<ip>:/srv/corpus/miniatures/decimated/
```

Then the one dot-path that *does* travel:

```sh
rsync -az \
  ~/Documents/tests/test-models/miniatures/decimated/.model-browser/overrides.json \
  root@<ip>:/srv/corpus/miniatures/decimated/.model-browser/
```

`overrides.json` is the override store (`library-overrides`), and on this corpus
it is the **Creative Commons credits** — author, licence, `licenseUrl` (the deed
URL with version) and source URL per kit, plus `modified` (what was done to the
served copy; absent means served unchanged) — which the lightbox shows: the
licence label links to the deed, and the modified phrase is the notice the
licences require (`credits-completion`). A corpus without it is not the demo.
The server reads it once per resolved library, so a regenerated store needs the
app restarted (the `up --build` below does that).

`library.json` beside it must **not** travel. It is the library marker, and D4
has the box write its own on first start: that id names the cache directory the
bake fills (§7 — which is why the bake comes after the first deploy, and why its
rsync targets the box's id rather than this machine's), so a copied one would tie
the box's cache to this machine's library identity.

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

This is the one deploy line without §6's pin check in front of it, by
construction rather than by exception: the check reads
`/srv/cache/<id>/bake/bake.json`, and that id directory does not exist until the
app has written its marker on this very start (D4) — the bake (§7) comes after,
and every later `up` (§6) runs behind the check.

## 5. What to check

**The certificate and the redirect.**

```sh
curl -sI https://models.masamaeda.com/ | head -3
curl -sI http://models.masamaeda.com/ | head -3    # 308 to https://
openssl s_client -connect models.masamaeda.com:443 -servername models.masamaeda.com </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates
```

Nothing here issued or installed anything: Caddy did (D7). If it did not, its log
carries the ACME error — `docker compose logs caddy`.

**Since the zone went proxied (§10) that check no longer sees Caddy's certificate.**
What it reports is Cloudflare's Universal certificate for the edge —
`CN=masamaeda.com`, a different expiry — and it would keep reporting a healthy one
while the origin's had expired, which under Full (strict) is a 526 for every visitor.
Caddy's own certificate is reachable only by addressing the origin directly:

```sh
openssl s_client -connect 157.90.25.110:443 -servername models.masamaeda.com </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates     # CN=models.masamaeda.com — Caddy's
```

**From the box itself — not `127.0.0.1:3177`.** The three containers share one
network namespace (D1), so the app's loopback bind exists *inside* that namespace
and not on the host's. `curl http://127.0.0.1:3177/...` from an SSH session answers
`Connection refused`, which reads like a dead app and is not. Go through Caddy
instead, resolving the public name to loopback:

```sh
curl -s --resolve models.masamaeda.com:443:127.0.0.1 \
  -o /dev/null -w 'ttfb %{time_starttransfer} total %{time_total} size %{size_download}\n' \
  'https://models.masamaeda.com/api/file?path=<url-encoded library path>'
```

That is also the only way to time the box's own serving without the wire in the
way. Measured 2026-09-17 on a 2.5 MB model: **38 ms idle, 87 ms while three
`/api/semantic` queries loaded the index** — a real 2.4x of contention, and 2.7%
of what a US visitor waits for the same file.

**The app.**

```sh
curl -s https://models.masamaeda.com/api/features        # the demo posture: every field false but `intro`
curl -s https://models.masamaeda.com/ | head -5          # the client's index.html, not JSON
curl -s https://models.masamaeda.com/api/library         # ready, and **no `top`** — hostDetails is off
curl -s -o /dev/null -w '%{http_code}\n' https://models.masamaeda.com/about.html   # 200 while `intro` is on
```

`intro` is the one capability on. It was withheld on 2026-09-15 pending a review
of the introduction and the About page, and turned back on 2026-09-16 once they
had been read live. While it is off the build still carries `about.html` and the
app withholds it because the configuration says so — `/about.html` answers 404.
Ask `/about.html/` and `/about.html%2F` as well when checking either posture: the
withholding gate was keyed on the request's *spelling* when it landed and served
those two while `/about.html` 404'd. Flipping `intro` is a `config.json` change,
deployed like any other (§6).

Withholding the introduction also withholds the **consolidated credits list**,
which the corpus's attribution issue called the one gating compliance item for
CC-BY. Attribution stays present either way — per-kit credits show in the
lightbox panel (`/api/overrides`, not gated on `intro`) and `/api/credits`
answers for every kit — but only to a visitor who opens a model. No single page
lists them while `intro` is off, which is the thing to weigh before withholding
it again.

**The two startup lines**, which are the only place the resolved library top can
be read at all (`hostDetails` withholds it on the wire):

```sh
docker compose -f deploy/demo/compose.yaml logs app | grep -E 'client at|library '
# client at /app/client/dist
# library <id> at /library/miniatures/decimated
```

Two things to look at in that second line. The path must be
`/library/miniatures/decimated` — the index reports the same absolute path as
its collection root, and if the two disagree the index silently covers nothing.
And the `<id>` is the box's own, and this line is where it is read — never
assumed: §7's rsync targets `/srv/cache/<id>/` and §6's check reads the manifest
under it. It must **not** be an id from this machine (`5358d071-…` is this
machine's `clustered-hq` marker; the bake's own local id under `decimated` is read
from `/api/library`): a different id is the proof that the marker was written on
the box, as D4 intends, rather than copied in with the models.

As of the decimated cutover it is still
`54c0a4e9-d05b-4a53-8aad-e37a8b384422` — **the box did not mint a new one**. The
marker records only `{id, version}` and no root, so the box's own `library.json`
travelled with the corpus to the new root and the identity survived the move,
which is why the 2026-09-15 bake shipped into that existing directory. Read the
line rather than reasoning about it: an id is only wrong here if it is *this
machine's*.

**Every example query still answers**, from the **developer machine** rather than
the box — the box has no Bun outside the container, and the guard admits a POST
with no `Origin` and the right `Host`:

```sh
bun run scripts/check-example-queries.ts https://models.masamaeda.com
# 6 example queries answer on https://models.masamaeda.com
```

It asks each chip's phrase under the options a visitor's click runs with, so a
`dead:` line means the banner would show that visitor an empty grid: replace
that phrase in `shared/exampleQueries.ts` with one the corpus answers. A
`failed:` line is not about the phrases at all — the origin or its index is not
answering.

While `intro` is off no visitor sees those chips at all, so a `dead:` line is
not a live defect then; it is what the introduction shows the day the capability
goes back on, which is why the check stays in this list rather than waiting for
it.

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
`/library/miniatures/decimated`. That is `cache_root` reporting the recorded
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

**A redeploy runs only on an explicit go-ahead from Masa in the conversation.** A
deploy step written into a tasks.md is not one, and neither is a change being
finished and verified. A new visitor-facing surface ships with its capability key
**off** until he has reviewed it live — the landing page and About were withheld
on 2026-09-15 for exactly that. An instruction to change one thing on the live
site authorises that deploy alone, so say which other commits would ride along
with it.

```sh
cd /opt/model-browser && git pull && \
  sh deploy/demo/check-bake.sh /srv/cache/<id>/bake/bake.json /srv/index && \
  docker compose -f deploy/demo/compose.yaml up -d --build
```

The `<id>` is the one §5's startup line reports. The middle command is the bake's
recipe pin (§7): it compares the checkout's `RIG_VERSION` and `POSE_VERSION` with
the ones the shipped store was rendered under, and the SHA-256 of
`/srv/index/pose-cache.json` and `run-params.json` with the ones the bake hashed,
and exits non-zero on any disagreement. The `&&` is the refusal: the build does
not start and the running stack keeps serving — nothing is half-deployed. A build
that *fails* has the same shape and is the trap: the old container keeps serving
with nothing at the shell saying the new one never replaced it, so curl
`/api/features` from outside after every deploy rather than trusting the exit.
Give it
the index directory: called without one it prints `index: not checked, no index
directory given` and skips the two hash **comparisons** — it still enforces both hash
lines' format, and still refuses a manifest whose hash line is malformed or duplicated —
which is a weaker gate than the line above promises. What to
do about it is a re-bake (§7) from the checkout you meant to deploy, shipped
before the `up` is retried. There is no override flag; leaving the check off the
line is the shell history's record that a build whose every tile re-renders on
every visit, for every visitor, was chosen. A `commit: checkout <a>, bake <b>`
line is information, not a refusal: at equal versions the recipe says the pixels
are the same, and a copy change does not cost an eleven-minute bake.

A redeploy that moves `root` in `config.json` is the first deploy again for the
check's purposes: the box mints a new id on that start and no manifest can exist
under it yet, so that one deploy runs without the check, like §4, and the bake
(§7) follows it.

A configuration change is the same command: `config.json` is committed and
mounted from the checkout (D6), so it arrives with the code and is reviewed like
it.

Rollback is a checkout and the same command, check included:

```sh
cd /opt/model-browser && git checkout <rev> && \
  sh deploy/demo/check-bake.sh /srv/cache/<id>/bake/bake.json /srv/index && \
  docker compose -f deploy/demo/compose.yaml up -d --build
```

A rollback across a `RIG_VERSION` or `POSE_VERSION` bump is refused the same way,
for the same reason: the store on the box was baked under the newer recipe, and
the older client would re-render every tile on every visit. It needs that
revision's bake — run from the checkout at `<rev>` and shipped (§7) — before the
`up`. A `<rev>` older than the check itself has no script to run and the line
refuses on that too; such a revision predates the bake, and a rollback to it is
§4's case.

Either way the corpus, the caches, the embeddings, the checkpoint and the
certificate are untouched — none of them is in an image. `docker compose down`
stops the stack and keeps every volume; `down -v` would destroy the checkpoint
and the certificate, so it is never the command you want here.

What no redeploy touches because it is not on the box at all: a visitor's
framings live in their browser's `localStorage` (`thumbWrites` is off). Since
`file-frame-spindle` the stored axis is the model file's own, and a framing held
from before that change reads a quarter turn off — expendable, per-browser
conveniences the demo never promised to keep.

## 7. The bake, and its recipe pin

The corpus is baked **after** the app's first start on the box (§4): the store
ships into `$CACHE_DIR/<box id>/`, and that id does not exist until the app has
written the marker (D4, §3.2). It is run from this machine — the box carries
nothing but the container engine — by `scripts/bake-demo.ts`
(`openspec/changes/corpus-bake/design.md`, D1–D6; cited as such below):

```sh
bun run scripts/bake-demo.ts --root <corpus top> --cache <scratch cache dir> \
  --index-cache <the index's cache dir> [--port 3199] [--client <scratch build dir>] \
  [--ship <user@host> --ship-dir </srv/cache/<box id>>] [--origin <https://url>]
```

**`--origin` is required whenever `--ship`'s host is a bare IP**, which the box's
is: no https origin follows from an address, and a hardcoded default would verify
a ship to one box against another box's store. The run refuses at argv rather than
shipping the bytes and leaving task 4.2 undone, so the demo's ship line is
`--ship root@<ip> --ship-dir /srv/cache/<id> --origin https://models.masamaeda.com`.

For the demo `--root` is `~/Documents/tests/test-models/miniatures/decimated` (the
tree the box serves, §3.2), `--cache` a scratch directory that is not
`~/.cache/model-browser` (the bake's own instance mints a library id under
`decimated` and fills `<cache>/<local id>/`; the script reads that id from
`/api/library`, never assumes it), and `--index-cache` the cache directory the
index was started on. The script builds the client to a scratch directory (never
`client/dist`, which the dev instance on 3177 serves), starts its own server on
`--port` with writes and maintenance on, drives *Generate* in a headless Chromium
twice — once per occlusion pill state, each pass settled and then re-counted with
the poses primed, at zero, before the pill is toggled — verifies every sidecar and
both renders on disk
against the enumeration, audits every unposed render against the index, writes
the manifest, runs the check below on it, and prints the ship commands (or, under
`--ship`, runs them and then verifies: it waits for the box to answer
`/api/library` as `ready`, hit-checks three models on both variants, and checks
every example query the introduction offers — any of which failing ends the run
non-zero, because a run that shipped bytes must not exit 0 with its verification
undone). Its server is killed on every exit path, so a `Ctrl-C`
leaves the scratch port free; the dev instance on 3177 is untouched throughout.

**The index precondition.** The index must be running with its collection root at
`decimated` — the tree the demo ships, not the `deduplicated` tree its
`run-params.json` records — and it is the user's to start, not the script's:

```sh
cd ~/Documents/tests/mini-classify && .venv/bin/python serve_api.py \
  ~/Documents/tests/test-models/miniatures/decimated \
  --cache-dir embed-cache-test --no-volume --port 8077
```

`MODEL_BROWSER_INDEX` overrides the index's base URL (default
`http://127.0.0.1:8077`). The script draws no render until two checks pass.
Through its own instance, `/api/semantic/status?fresh=true` must be `ready` with
`collectionRoot: '/'` — an index rooted at any other tree asks for no poses and
bakes every render unposed, corpus-wide, and a stray marker *above* `decimated`
(a `.model-browser/library.json` left in `test-models`) reads `/miniatures/decimated`
here instead of `/`, with every sidecar keyed wrong for the box; one check, both
mistakes. And directly, the index's own `/status` must be `ready` with a
`cache_dir` naming `--index-cache` (an absolute one equal to its realpath, a
relative one equal to its basename) — which is what ties the manifest's
fingerprint to the index that actually framed the renders. That answer's
`n_models`, `views`, `elevations` and `up_axis` go into the manifest.

**What ships, and what does not** (D4). The local id directory, whole, minus
`snapshots/` — the sidecars, both renders per model and `bake/` — into the
**box's** id directory, whose name differs and is read from §5's startup line:

```sh
rsync -az --info=progress2 --exclude 'snapshots/' \
  <scratch cache>/<local id>/ root@<ip>:/srv/cache/<box id>/
ssh root@<ip> 'cd /opt/model-browser && docker compose -f deploy/demo/compose.yaml restart app'
```

Both trailing slashes, no `--delete`: nothing on the box is removed by a ship, and
a stale sidecar is overwritten by key. The script prints this pair with both ids
filled in, since the id mapping is the part a hand gets wrong. `snapshots/` stays
behind because the tree snapshot is the box's own, with its own root and stats.
Nothing else needs shipping: contact sheets are derived in memory per listing, and
poses are the index's, already under `/srv/index`. Before the rsync, `stat` a
shipped model inside the app container and confirm its mtime equals this
machine's copy to the nanosecond — a sidecar is a hit only where path and `mtime`
agree, and a box still serving other bytes reads every shipped tile `stale`,
which no visitor can heal.

**The restart** is for the first listing, not for correctness (D3).
`ThumbCache.read` goes to disk on every call, so the files are served the moment
they land. What a restart buys is the startup sweep (`maintain`), which
re-remembers every sidecar: without it, every path the box's process has ever
looked up and found absent stays memoised as absent, the first listing of it
annotates `miss`, and each such tile pays one JSON lookup before it reaches the
image route. The sweep runs in the background after start; give it a minute
before measuring a first visit.

**The manifest** is `/srv/cache/<box id>/bake/bake.json` (D2): the recipe (`rig`,
`poseVersion`, `lighting`, `size`), the client commit and whether the tree was
dirty, the counts (models, renders per variant, posed and unposed), the rates, and
what the index's `/status` said beside the SHA-256 of its `pose-cache.json` and
`run-params.json`. It lives in `bake/`, not beside the sidecars, because both
store sweeps parse every `*.json` at their level as a sidecar: at the cache top a
stranger is removed by the legacy sweep; at the id level one with no `path` is
skipped with a `console.warn` naming it and left on disk (`maintain`'s guard,
`corpus-bake` 1.7). Before that guard the startup sweep threw on such a file
silently and left every sidecar after it unremembered — so a `maintain` warning in
`docker compose logs app` after a restart means a `bake.json` was copied up a
level; move it back. It is never deleted at the id level.

**What triggers a re-bake** (D6) — three things, all unhealable on the box because
`thumbWrites` is off:

* `RIG_VERSION` or `POSE_VERSION` moves — every stored render fails on every visit
  for every visitor; the check refuses the redeploy until the store is re-baked.
* The corpus changes — a new kit (no sidecar; a miss the client renders per visit)
  or a re-exported file (its mtime moves and the sidecar reads `stale`). *Generate*
  is incremental against a seeded `--cache` (below), so the re-bake renders only
  what changed — but it must be run.
* The index's poses change, **by re-embedding or by view configuration** — a pose
  is a function of both `pose-cache.json` and `run-params.json` (whose `views` and
  `elevations` key the `front` each entry resolves to, from which the render's
  `poseKey` derives), which is why the fingerprint hashes both files and a §3.3
  rsync that changes either is refused at the next redeploy.

**Re-baking part of a corpus needs two seeds**, and the obvious spelling of
either costs a full run or arms a deploy refusal days later. "*Generate* is
incremental" above is a property of the **store `--cache` points at**, not of the
script: from an empty scratch directory every model is a miss and the run is the
whole corpus. So pull the box's own store and its own index first, and bake
against those:

```sh
# 1. the store — the ids differ; the box's is §5's startup line, the local one is
#    `id` in decimated/.model-browser/library.json, and bake-demo.ts remaps them
#    at ship. Exclude snapshots/ for the same reason the ship line does.
rsync -az --exclude 'snapshots/' root@<ip>:/srv/cache/<box id>/ <scratch cache>/<local id>/
# 2. the index — a copy, kept outside the mini-classify checkout
rsync -az root@<ip>:/srv/index/ <scratch index>/
```

The index copy is the part that is not optional. The manifest pins the SHA-256 of
`pose-cache.json` and `run-params.json`, and `check-bake.sh` compares those
against the box's `/srv/index` at every later redeploy — so baking against the
local `embed-cache-test` writes a manifest that **refuses the next deploy**, and
says so only then. The two drift on their own: mini-classify keys its pose cache
`path|mtime_seconds|size`, so re-exporting a model moves its key and the loader
drops the old entry rather than migrating it (`load_pose_cache` in
mini-classify's `src/pose.py`). Two caches over the same models therefore hash
differently once either side re-exports — and they can *also* hold identical pose
values while hashing differently, because `migrate_pose_mtimes.py` re-keys an
in-place rewrite without re-deciding the pose. Either way the hash is what breaks
the gate, not the poses, so pull the box's copy rather than try to reconcile.

Because `--index-cache` must be what the index server reports as `cache_dir`, the
copy needs a server pointed at it. Simplest is to start the precondition server
above on `<scratch index>` instead of `embed-cache-test` and leave the port
alone. Where 8077 must stay on `embed-cache-test` for other work, run a second on
a spare port, with `CUDA_VISIBLE_DEVICES=""` so the first keeps the GPU:

```sh
cd ~/Documents/tests/mini-classify && CUDA_VISIBLE_DEVICES="" .venv/bin/python \
  serve_api.py ~/Documents/tests/test-models/miniatures/decimated \
  --cache-dir <scratch index> --no-volume --port 8078
# then bake with MODEL_BROWSER_INDEX=http://127.0.0.1:8078
# and --index-cache <scratch index>
```

Seeding is for the case where only the corpus moved. When the corpus *and* the
index have both moved — a re-embed — seeding from the box is the wrong shape:
ship corpus, index and store together, then restart **both** containers. A corpus
rsync alone leaves every changed model's sidecar `stale`, which on a
`thumbWrites: false` deployment no visitor can heal; and a new `/srv/index` is
not picked up by landing the bytes, because the index loads its matrix once at
warmup and never re-reads the mount (`serve_api.py`: "One worker, no reload").
`--ship`'s restart is `restart app` alone, so the index needs its own:

```sh
ssh root@<ip> 'cd /opt/model-browser && \
  docker compose -f deploy/demo/compose.yaml restart index app'
```

Restart the index *before* the app, so the app's startup sweep asks an index that
is already serving the new poses; `POST /reload {"rescan": true}` is the lighter
alternative where a SigLIP reload is not wanted.

**The pin** is `sh deploy/demo/check-bake.sh <manifest> [<index dir>]`, POSIX `sh`
over `grep`, `sed` and `sha256sum` because the box has no Bun. It compares four
values — the checkout's `RIG_VERSION` and `POSE_VERSION` against the manifest's
`rig` and `poseVersion`, and the SHA-256 of `<index dir>/pose-cache.json` and
`run-params.json` against the manifest's — exits 0 silently when all agree, else
names each disagreement (`rig: checkout 8, bake 7`) and exits 1; a missing
manifest is exit 1 too. It also prints `commit: checkout <a>, bake <b>` when the
commits differ, which never moves the exit code: equal versions are the recipe's
own statement that the pixels are the same. The bake runs it locally as its last
step against the manifest it just wrote, and §6 runs it on the box in front of
both its lines, redeploy and rollback — which is how "bake with the client build
that ships, and re-bake before a build whose `RIG_VERSION` has moved" stopped
being a sentence in this file and became a command that refuses. `config.json` is
JSON and can carry no comment saying any of this, which is why it is said here.

**The figures** — models, renders, rates, bytes shipped and the first-visit counts
— are the live run's and are recorded where they can be re-read, not here:
`openspec/changes/corpus-bake/tasks.md` 3.2, 4.1 and 4.3, and
`docs/web-demo-notes.md` item 8 once it ships. The 2026-09-14 run on
`clustered-hq` (design D-cost) is the cost scale only: its store reads `stale`
against the decimated corpus and cannot ship.

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

## 10. The zone: on Cloudflare since 2026-09-18

An R2 custom domain requires the zone on Cloudflare, so the CDN work (issue #24)
needed this move. Nothing about the box changed, at any step. **The move is done** —
the rest of this section is the record of how, kept because the failure modes are
not obvious and the revert depends on them.

### Where things stand

| | |
|---|---|
| Registrar | Namecheap, nameservers set to **Custom DNS** |
| Nameservers | `lily.ns.cloudflare.com`, `ricardo.ns.cloudflare.com` |
| Cloudflare account / zone | `Masamaedae@gmail.com`, account `56f9a3b5db52c638fe8babeaee0a6390`, **Free** plan |
| Zone status | Active |
| `models` A / AAAA | `157.90.25.110` / `2a01:4f8:1c16:d835::1`, **proxied since 2026-09-18** — the zone answers Cloudflare anycast (`104.21.33.208`, `172.67.166.160`), not the box |
| Encryption mode | Full (strict) |
| Universal certificate | Active, `*.masamaeda.com`, expires 2026-12-17 |
| Caddy's own certificate | unchanged and still doing the work, since nothing is proxied |

**To revert the whole thing:** set the nameservers back to
`dns1.registrar-servers.com` / `dns2.registrar-servers.com` at Namecheap. Their zone
still holds the same records. Grey-clouding is *not* the revert for the nameserver
move — see step 1 below.

**What was published before the move** (`dig`, 2026-09-18), which is the checklist the
import had to match:

| record | value |
|---|---|
| NS | `dns1.registrar-servers.com`, `dns2.registrar-servers.com` |
| `models` A / AAAA | `157.90.25.110` / `2a01:4f8:1c16:d835::1` |
| MX ×5 | `eforward1`–`eforward5.registrar-servers.com` (priorities 10/10/10/15/20) |
| TXT | `v=spf1 include:spf.efwd.registrar-servers.com ~all` |
| apex A, `www`, DNSSEC DS | none |

**The trap, and it loses mail silently.** Namecheap's Advanced DNS → *Host
Records* table lists **only the two `models` records**. Mail Settings, further down
the same page, reads *Email Forwarding* (confirmed in the UI 2026-09-18) — and
that mode is what publishes the mail records. The SPF TXT appears under Mail
Settings carrying a **padlock rather than a delete control**, so it is
system-managed and goes away with the mode. The five MX appear in **neither**
table: they follow from the forwarding mode and are listed nowhere in the
interface at all.

So the obvious procedure — copy Host Records into Cloudflare — would drop every
mail record. **Build the import checklist from `dig`, not from the page.**

**What actually happened on 2026-09-18, which is the opposite way round.**
Cloudflare's scan queries DNS, so it found all five MX and the SPF TXT by itself.
What it missed was **`models` — both the A and the AAAA** — because a scanner
cannot enumerate subdomains and `models` is not a guessable name. Its own wording
admits this ("our scan may have missed uncommon records or custom subdomains").
Accepting the scan unedited and switching nameservers would have left
`models.masamaeda.com` not resolving at all: the demo dark, mail fine. Both
directions fail silently, which is the reason the rule is `dig` rather than any
one screen — the check is that **all eight records** are present, not that the
mail ones are.

Namecheap's documentation says forwarding is configured "if your domain is pointed
to our BasicDNS, PremiumDNS or FreeDNS"; whether their relays keep accepting mail
for a domain on foreign nameservers is documented neither way, so do not rely on
it. Since forwarding is actually in use here, plan on **Cloudflare Email Routing**
(free, same job) rather than on recreating the eforward records and hoping.

**DNSSEC is off** — the Status toggle in Advanced DNS, and no DS published — which
removes the usual way this goes wrong: there is no DS record to withdraw first.
Re-check before starting (`dig +short DS masamaeda.com`), since turning it on
later changes the answer.

**The move:**

1. Record the published set with `dig` (the table above). Host Records and Mail
   Settings between them do not show it all — see the trap above.
2. Cloudflare → Add a Site → `masamaeda.com` → Free. It imports what it can find.
3. **Check the import against step 1's `dig` output**, not against Host Records.
   Add the five MX and the SPF TXT by hand if the scan missed them.
4. SSL/TLS → **Full (strict)** *before* the switch. A new zone can default to a
   weaker mode, and the first proxied request must not be served under Flexible.
   Note what this couples: under Full (strict) an expired origin certificate is a
   526 for every visitor, where today it is a browser warning.
5. Leave `models` **grey-clouded** (DNS only). Behaviour identical to today.
6. Namecheap → Domain List → Manage → Nameservers → Custom DNS → the two
   Cloudflare nameservers. (A nameserver change is not a transfer; the registrar
   lock is irrelevant.)
7. Wait for the zone to read Active, then verify:

```sh
dig +short NS masamaeda.com            # the two Cloudflare names
dig +short A models.masamaeda.com      # 157.90.25.110
dig +short MX masamaeda.com            # the five eforward hosts, or their replacement
curl -sI https://models.masamaeda.com | head -3
```

8. Send mail to the forwarded address from an outside account. If it does not
   arrive, that is step 3's failure showing up late — configure Cloudflare Email
   Routing and drop the eforward MX records.

**Executed 2026-09-18.** What actually happened, against what this section predicted:

- The `.com` delegation updated in about **three minutes**, not the 48 hours Namecheap's
  confirmation warns about. `1.1.1.1` and `8.8.8.8` were both answering from
  `lily`/`ricardo.ns.cloudflare.com` within the same window, and the zone went Active
  without anyone pressing "Check nameservers now".
- All eight records verified through the new delegation, and the app answered HTTP 200
  throughout. No interruption at any point.
- The 172800-second (48 h) NS TTL on the `.com` delegation is still the ceiling for
  stragglers. It does not matter while both zones agree — but **do not orange-cloud until
  it has passed**, or half the resolvers get a proxied answer and half a direct one, which
  makes any measurement meaningless.
- **Namecheap's Email Redirect list was empty.** The forwarding *mode* was on and
  publishing the MX, but no forwarding rules existed, so mail to `@masamaeda.com` was
  reaching the eforward relays and going nowhere. The mail risk this section warns about
  was therefore mostly theoretical here — check before assuming it applies again.
- **The encryption mode has its own Save button, below the fold.** Selecting a radio on
  SSL/TLS → Configuration does nothing on its own: the setting reverts on reload unless you
  scroll past the four mode cards and press **Save**. Three attempts were lost to this
  before the button was found. Nothing about the zone's pending state was to blame.

**Settled 2026-09-18, before anything was proxied:**

| setting | value | where |
|---|---|---|
| Encryption mode | **Full (strict)** | SSL/TLS → Configuration (mind the Save button) |
| Browser Integrity Check | **off** | Security → Settings. It challenges bare `curl`, which is what the probe is — left on, it turns the measurement into fast small 403s that read as an improvement |
| Cache rule 1 | `http.request.uri.path eq "/api/thumb/image"` → Eligible for cache | Caching → Cache Rules |
| Cache rule 2 | `starts_with(http.request.uri.path, "/api/") and ... ne "/api/thumb/image" and ... ne "/api/model.glb"` → Bypass cache | same |
| Cache rule 3 | `http.request.uri.path eq "/api/model.glb"` → Eligible for cache, **Edge TTL 1 day (ignore cache-control)** | same |

Rules 2 and 3 were rewritten on 2026-09-21 once the byte routes declared themselves — see
*What the rules are now*, below. Rule 1 is unchanged.

**How the rules interact, since it decides the whole design.** Cache Rules are
*stackable*: every matching rule applies, and "for conflicting settings (for example,
bypass cache versus eligible for cache), the last matching rule wins"
(developers.cloudflare.com/cache/how-to/cache-rules/order/). There is no ambiguity
exception — Cloudflare never declines a setting because two rules disagree, it just takes
the later one. So a bypass rule that also matched a cacheable path would silently decide
the outcome by position alone. **Rule 2 therefore excludes both cacheable paths in its own
expression**, which makes order irrelevant and the intent readable in the rule itself.

Two Edge TTL notes, and they differ per route because the origins differ:

- `/api/thumb/image` needs none. It already sends `public, max-age=31536000, immutable` at
  a current generation, and the default ("use cache-control if present") respects that.
- `/api/model.glb` sends **no `Cache-Control` at all**, and the Edge TTL default is "use
  cache-control if present, **bypass cache if not**" — which would have bypassed every GLB
  and made the rule a no-op. It is set to *ignore cache-control and use 1 day*. One day is
  a judgement call: the GLB URL is `?path=` with **no version in it**, so a re-derived mesh
  (new source mtime) is invisible to the edge. The corpus is static between deploys, so a
  day is cheap; **a corpus swap or a re-bake needs a purge**, and that belongs in §7's ship
  steps if the TTL is ever raised.

Bot Fight Mode was already off. The AI crawler policies (Search/Agent/Training) and Bot
Preference Sync were left at Cloudflare's defaults — they do nothing while nothing is
proxied, and they are a content decision rather than part of this work.

### Verified through the edge, 2026-09-18

Proxying went on with the three rules already in place. Measured from US Pacific against
the SJC edge, second request in each pair:

| request | cold | warm | against the direct baseline |
|---|---|---|---|
| `/api/thumb/image` at a current `gen` | MISS | **HIT, 69 ms** | 507 ms — **7.3x** |
| `/api/model.glb` (593,140 B) | MISS 1.61 s | **HIT 0.365 s** | 4.4x |
| `/assets/main-*.js` (682,385 B) | MISS 1.23 s | **HIT 0.234 s** | 5.3x, and with **no rule** — `.js` is in the default cached set |
| `/api/dir` | DYNAMIC, not cached | | correct |
| `/` | DYNAMIC, not cached | | correct — it is `no-cache` on purpose |

Full (strict) validates against Caddy's certificate: 200 rather than 526. Page TTFB roughly
halved (0.513 s → 0.258 s) simply because TLS now terminates at an edge — that gain applies
even to bypassed routes, which is why the probe reports TTFB net of connection setup.

**A stale `gen` looks exactly like a broken CDN.** The first test used a generation captured
earlier the same day. The origin correctly answered `no-cache` for it, so every request came
back `EXPIRED` — found in cache, revalidated against the origin, never a HIT. Nothing was
wrong with the rule. **Take the `gen` from a live listing before concluding anything about
edge caching**; `.ai/probe-demo-latency.sh` re-derives it per run for this reason.

Whether there is any CDN work after this — an R2 bucket (**`wnam` location hint**: the
box is already the `weur` copy, and the hint cannot be changed after creation), its
custom domain, and a Worker route mapping `/api/file` and `/api/thumb/image` onto object
keys — is now a measurement rather than a plan. Issue #39 decides it, against the baseline
below. Most of what R2 was for is already had: GLB is about a quarter of the STL it
replaced, and an edge HIT already serves it from a PoP near the visitor. What is left to
buy is cheaper *misses* on a 3,122-model long tail.

### What the rules are now (2026-09-21)

The rules above were shaped around a client that names no version. Both halves of that have
since shipped — `byte-route-cache-headers` (issue #36) gave `/api/file` and `/api/model.glb`
an optional `mtime` naming the version the caller believes it is asking for, and
`client-names-model-version` (issue #42) sends it from the listing entry the client already
holds — so the rules were rewritten to let the origin decide:

| | |
|---|---|
| Rule 1 | `http.request.uri.path eq "/api/thumb/image"` → Eligible for cache. **Unchanged.** |
| Rule 2, *api bypass except thumbnails* | `starts_with(http.request.uri.path, "/api/") and ... ne "/api/thumb/image" and ... ne "/api/model.glb" and ... ne "/api/file"` → Bypass cache |
| Rule 3, *byte routes cacheable* | `http.request.uri.path eq "/api/model.glb" or http.request.uri.path eq "/api/file"` → Eligible for cache, Edge TTL **use cache-control if present, bypass cache if not** |

Rule 3's blind one-day TTL is gone, and with it the purge-on-re-bake caveat above: a
re-derived mesh is a different URL rather than a stale hit. No purge was needed at the flip
— the client's URLs carry `&mtime=`, so they are new keys and the old version-less ones age
out on their own. Rule 2 still excludes every cacheable path in its own expression, for the
ordering reason above.

**`/api/file` needs rule 3, not just an exemption from rule 2.** Dropping it from the bypass
only stops Cloudflare being told not to cache it; nothing under `/api/` has a
default-cacheable extension, so it would have stayed DYNAMIC. Being *named* by an eligibility
rule is what makes it cacheable at all.

**Deploy the box before touching the rules.** The Edge TTL default is *use cache-control if
present, bypass cache if not*, so a rule that respects the origin against a box that sends no
`Cache-Control` bypasses every GLB and silently undoes the caching the demo has. Confirm the
origin itself declares the header — through the proxy you read the edge's answer, not the
box's:

```sh
curl -sI --resolve models.masamaeda.com:443:157.90.25.110 \
  "https://models.masamaeda.com/api/model.glb?path=<encoded>&mtime=<the listing's mtime>" \
  | grep -i cache-control        # want: public, max-age=31536000, immutable
```

**Browser Cache TTL was overriding the origin, and is now `Respect Existing Headers`**
(Caching → Configuration). It was Cloudflare's default of *4 hours*, and it rewrites
`Cache-Control` on responses the zone considers **cacheable** — so the moment rule 3 made the
byte routes eligible, an unversioned or mis-keyed request came back `max-age=14400` in place
of the origin's `no-cache`. That is precisely the tier `byte-route-cache-headers` added a
validator to: a caller holding a superseded version would have cached it for four hours
rather than revalidating. `/` was never affected, because it is DYNAMIC and the override
reaches only cacheable responses — which is why the setting looked harmless for three days.
Nothing on the box relies on it: Caddy and the app declare `immutable` on `/assets/*`,
`/api/thumb/image` at a current `gen` and both byte routes at a current `mtime`, and
`no-cache` on `/` and the version-less tiers.

Verified through the edge after the change:

| request | `cf-cache-status` | `Cache-Control` |
|---|---|---|
| `/api/model.glb` at a current `mtime` | HIT | `public, max-age=31536000, immutable` |
| `/api/model.glb` with no `mtime`, or a stale one | MISS then REVALIDATED | `no-cache` |
| `/api/file` at a current `mtime` | HIT | `public, max-age=31536000, immutable` |
| `/assets/main-*.js` | HIT | `public, max-age=31536000, immutable` |
| `/` | DYNAMIC | `no-cache` |
| `/api/dir` | DYNAMIC | none |

**Tiered Cache is still off** (Caching → Tiered Cache). Smart Tiered Cache is free on every
plan and reduces origin load, so it is worth turning on — but it changes what a miss costs,
so turn it on *between* measurements rather than during one. Note it is not a substitute for
an R2 `wnam` bucket: Smart Topology picks the upper tier closest to the **origin**, so it
sits near Falkenstein and a US miss still crosses the Atlantic. The topologies that would
help a distant visitor, Generic Global and Regional Tiered Cache, are Enterprise only.

### What staying proxied costs, standing

Proxying was originally scoped as a time-boxed experiment that ended by grey-clouding the
records. It did not end, and the two conditions it was time-boxed against are now standing
ones. Neither is an emergency; both are things to know before reading a report of odd
behaviour.

- **Slow answers become failures.** Cloudflare gives up on an origin at 125 seconds and
  serves a 524. `Caddyfile`'s deliberate posture — no rate limit, a serialising index
  behind it, abuse degrading to *waiting* rather than to failure — now has a ceiling it did
  not have. A request the box would have served slowly is a 524 to the visitor.
- **Caddy's renewal has never run behind the edge.** The origin certificate expires
  2026-12-08, so the first attempt is due around 2026-11-08, and under Full (strict) a
  failed one is a 526 for every visitor rather than a browser warning. TLS-ALPN-01 cannot
  succeed through a proxy that terminates TLS, and the HTTP-01 path is currently answered
  by Cloudflare rather than by the box. Issue #45 has the measurements and what to do.
- **The terms question.** Cloudflare's Application Services terms, which govern the CDN,
  restrict serving "a disproportionate percentage of pictures … or other large files";
  their Developer Platform terms, which govern R2 and Workers, carry no such clause. Serving
  the box's own images through the free CDN is the pattern the first set restricts, and it
  is one of the arguments for the bucket rather than against it.

Grey-clouding the `models` records (DNS only) reverts all of this in one click and changes
nothing on the box. It does not revert the nameserver move — see above.

### The baseline, and the probe

`.ai/probe-demo-latency.sh` is what measures a visitor's experience from outside; run it
rather than reading figures out of any document. It takes the output path as an argument
and holds a `flock` on `<output>.lock`, because two runs writing one file interleave rows
into something that looks like data and is not.

```sh
.ai/probe-demo-latency.sh .ai/demo-latency/after.csv 60 60
```

Its own header comment says what each column survives; the three that decide whether a
result means anything are `ok`/`why` (a truncated transfer still reports HTTP 200, and a
Cloudflare challenge is a fast small 403), `batch_hit` (HIT, STALE and UPDATING only —
REVALIDATED means the edge asked the origin first, which is the round trip being removed),
and the `*_net` columns (net of `time_appconnect`, which is DNS plus TCP plus TLS, all
three of which an edge shortens even for bypassed routes). Summarise with the excluded rows
*first*: a CDN that turns slow-but-complete answers into failures would otherwise read as
pure improvement, because every row it broke left the average.

```sh
python3 - <<'PY'
import csv, collections, statistics as st
allrows = list(csv.DictReader(open('.ai/demo-latency/demo-latency-before.csv')))
rows = [r for r in allrows if r['ok'] == '1']
print('rows', len(allrows), 'ok', len(rows))
print('excluded by reason:', collections.Counter(r['why'] for r in allrows if r['ok'] != '1'))
if not rows:
    raise SystemExit('no ok rows — read the why column before reading any timing')
gate = [r for r in rows if int(r['batch_hit']) == 20 and float(r['batch_total_net']) < 0.3]
print('rows passing the phase-1 gate:', len(gate),
      '| best batch_hit:', max(int(r['batch_hit']) for r in rows))
for c in ('thumb_ttfb','thumb_ttfb_net','batch_total','batch_total_net','model_total','model_bps','dir_ttfb'):
    v = [float(r[c]) for r in rows]
    print(f'{c:16s} min {min(v):.3f} med {st.median(v):.3f} max {max(v):.3f}')
PY
```

**The direct baseline, 60 samples over an hour on 2026-09-16, every row `ok=1`**, taken
from US Pacific against the box with nothing proxied. This is what an after-run is compared
against, and the file it came from (`.ai/demo-latency/`) is gitignored, so the table is the
only durable copy:

| column | min | median | max | spread |
|---|---|---|---|---|
| `thumb_ttfb_net` (one round trip) | 0.165 | 0.168 | 0.173 | 5% |
| `batch_total_net` (20 renders) | 0.657 | 0.681 | 0.781 | 19% |
| `model_total` (2,500,084 B of STL) | 1.686 | 1.772 | 4.101 | 143% |
| `model_bps` | 696,802 | 1,960,577 | 2,084,160 | 3.0x |

Structural facts behind those numbers, stable across every version of the probe: one round
trip to Falkenstein is ~168 ms, connection setup completes at ~342 ms cold, and 20 renders
multiplexed over one HTTP/2 connection take ~1.0 s, ~0.68 s net of setup. **Do not read the
model spread as the box being busy** — the median is distance. 2,500,084 bytes from an IW10
initial window at a 168 ms round trip needs 8 slow-start round trips, 1.344 s, against a
measured transfer of 1.262 s; and §5's loopback measurement puts the box's whole contention
effect at 48 ms of the 1,772 ms a visitor waits. The model column is also pessimistic by
construction: the probe opens a fresh connection per model where a browser reuses the
HTTP/2 one it already has.
