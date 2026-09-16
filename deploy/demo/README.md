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
shipped before). The *file set* is still `clustered-hq`'s, because that tree is
the deduplicated one with the incomplete kits dropped, while `decimated/` mirrors
`original/` whole — 282 byte-identical duplicates and 11 directories more. So the
list comes from one tree and the bytes from the other:

```sh
ssh root@<ip> 'mkdir -p /srv/corpus/miniatures/decimated/.model-browser /srv/cache /srv/index'

# Models only, by list. The dot entries and anything that is not a model are
# excluded by policy — the app refuses non-model paths now, but what is not
# shipped cannot be served by a later change of mind either.
(cd ~/Documents/tests/test-models/miniatures/clustered-hq && \
  find . -type f -iname '*.stl' ! -path './.model-browser/*' | sed 's|^\./||' | sort) > /tmp/ship-files.txt
rsync -az --info=progress2 --files-from=/tmp/ship-files.txt \
  ~/Documents/tests/test-models/miniatures/decimated/ \
  root@<ip>:/srv/corpus/miniatures/decimated/
```

Then the one dot-path that *does* travel:

```sh
rsync -az \
  ~/Documents/tests/test-models/miniatures/clustered-hq/.model-browser/overrides.json \
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

**The app.**

```sh
curl -s https://models.masamaeda.com/api/features        # the demo posture: every field false, `intro` included
curl -s https://models.masamaeda.com/ | head -5          # the client's index.html, not JSON
curl -s https://models.masamaeda.com/api/library         # ready, and **no `top`** — hostDetails is off
curl -s -o /dev/null -w '%{http_code}\n' https://models.masamaeda.com/about.html   # 404 while `intro` is off
```

`intro` went off on 2026-09-15, pending a review of the introduction and the
About page — both went live that day unreviewed. The last line is what that
posture looks like from outside: the build still carries `about.html`, and the
app withholds it because the configuration says so. Worth asking rather than
assuming — the withholding gate was keyed on the request's *spelling* when it
landed, so `/about.html/` and `/about.html%2F` served the page while
`/about.html` 404'd. Ask one of those too. Turning the introduction on is a
`config.json` change, deployed like any other (§6), after which every one of
them answers 200.

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
not a live defect today; it is what the introduction would show the day the
capability goes back on, which is why the check stays in this list rather than
waiting for it.

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
not start and the running stack keeps serving — nothing is half-deployed. What to
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
  [--ship <user@host> --ship-dir /srv/cache/<box id>]
```

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
the manifest, runs the check below on it, and prints the ship commands (or runs
them under `--ship`). Its server is killed on every exit path, so a `Ctrl-C`
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
  is incremental, so the re-bake renders only what changed — but it must be run.
* The index's poses change, **by re-embedding or by view configuration** — a pose
  is a function of both `pose-cache.json` and `run-params.json` (whose `views` and
  `elevations` key the `front` each entry resolves to, from which the render's
  `poseKey` derives), which is why the fingerprint hashes both files and a §3.3
  rsync that changes either is refused at the next redeploy.

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
