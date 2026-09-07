# Hetzner probe runbook

One box, about an hour, roughly a cent. It answers the demo's one open
measurement — gate 3.3, "does a shared cloud vCPU hold a search under 1 s?" —
and gets a first real number for the transatlantic half of the EU-origin
question. **2026-09-04: only CX23 was in stock**, so the run is the 4 GB /
2 vCPU tier; CX33 and the ARM CAX21 stay below for whenever stock returns, and
the ARM parity question stays open until one is. See `docs/web-demo-notes.md`
for why those are the open items; this file is the how, and can be deleted
once the numbers are folded back into the notes.

**Assumptions** (say so if any is wrong):

- You order and own the box; nothing here needs a Hetzner API token.
- The index shipped is `embed-cache-test` (the demo corpus, 2,165 models) —
  **not** the 11 GB STL tree, which `--no-volume` makes unnecessary.
- The bar is a **median under 1 s**. Two baselines on the 7940HS, both from
  2026-09-04 and both recorded in `scripts/query-probe.py`: **381.6 ms** with
  all 8 threads, and **931.7 ms** held to two physical cores — the second is
  the one a 2-vCPU CX23 is read against, and it is already *on* the bar on
  desktop silicon. Peak RSS in that run was 2.78 GB.
- Billing is hourly. Delete the server when done or it bills the month.

**So expect CX23 to miss the 1 s bar**, and treat the run as measuring by how
much rather than whether. That is still worth an hour: it prices the gap
between a 2-vCPU and a 4-vCPU host in milliseconds, and if the gap is small
the tier decision is settled cheaply. If it misses badly, the notes already
name the fallback — a warm text-tower endpoint (Modal, ~$0/mo at demo traffic,
tens of ms) in front of a small box, which fixes latency and cost together.

## 0. Order

Hetzner Cloud console → project → Add server:

| | type | arch | vCPU | RAM | disk | list | |
|---|---|---|---|---|---|---|---|
| **now** | **CX23** | shared x86 | 2 | 4 GB | 40 GB NVMe | €3.99 | in stock |
| later | CX33 | shared x86 | 4 | 8 GB | 80 GB NVMe | €6.49 | out of stock 2026-09-04 |
| later | CAX21 | Ampere ARM | 4 | 8 GB | 80 GB NVMe | €7.99 | out of stock 2026-09-04 |

CX23 is not a downgrade for this question — it *is* the 4 GB tier the sweep
favours, so the run tests the two things the notes flag as tight: whether
2.8 GB of SigLIP fits beside the OS in 4 GB, and whether two shared vCPUs hold
the 1 s bar. 40 GB of disk is ample (≈10 GB used: 4.3 GB checkpoint, ~1.5 GB
venv, 275 MB index).

Location **Falkenstein (FSN1)** or Nuremberg — the cost-optimized CX/CAX lines
are not sold in Ashburn. Image **Ubuntu 26.04** (what the box shipped on 2026-09-04). Keep the public IPv4
(+€0.50/mo) and add your SSH key.

**Record what the order page actually charges.** The notes carry "Hetzner
Falkenstein CX33 €8.49" from 2026-08-28, and €8.49 is exactly CAX21 + the IPv4
surcharge — so that line is probably mislabelled, and the current €6.49/€7.99
figures come from review sites, not Hetzner (their price table is JS-rendered
and does not come back to a fetch).

## 1. Setup — on each box

```sh
ssh root@<ip>
apt-get update && apt-get install -y rsync

# 4 GB against a 2.8 GB peak: give the kernel somewhere to go rather than an OOM
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
curl -LsSf https://astral.sh/uv/install.sh | sh && . "$HOME/.local/bin/env"
mkdir -p ~/mc && cd ~/mc && uv venv --python 3.12

# A / CX33 (x86): the default PyPI wheel is the CUDA build — take the CPU index
uv pip install --index-url https://download.pytorch.org/whl/cpu torch
# B / CAX21 (ARM): PyPI's aarch64 wheels are CPU-only already
uv pip install torch

uv pip install "transformers==5.15.0" "numpy==2.5.2" fastapi uvicorn huggingface_hub pillow
```

## 2. Ship the code, the index, and the probe — from this machine

```sh
rsync -az --exclude .venv --exclude 'embed-cache*' --exclude logs \
  --exclude debug-renders --exclude cluster-sheets --exclude __pycache__ \
  ~/Documents/tests/mini-classify/ root@<ip>:~/mc/

# ~275 MB: the embeddings plus the records --no-volume enumerates from
rsync -az --info=progress2 \
  ~/Documents/tests/mini-classify/embed-cache-test/embeds \
  ~/Documents/tests/mini-classify/embed-cache-test/pose-cache.json \
  ~/Documents/tests/mini-classify/embed-cache-test/run-params.json \
  ~/Documents/tests/mini-classify/embed-cache-test/walk-*.json \
  root@<ip>:~/mc/embed-cache-test/

rsync -az ~/Documents/model-browser/scripts/query-probe.py root@<ip>:~/mc/
```

## 3. Weights — pull them on the box (4.3 GB)

```sh
cd ~/mc && .venv/bin/hf download google/siglip2-so400m-patch16-512
```

Hetzner's link fetches this in a couple of minutes; from home it would be a
4.3 GB upload.

## 4. Serve and measure — on each box

```sh
cd ~/mc
ROOT=/home/masa/Documents/tests/test-models/miniatures/deduplicated
mkdir -p "$ROOT"          # scope path only — --no-volume reads nothing under it
.venv/bin/python serve_api.py "$ROOT" --cache-dir embed-cache-test \
  --no-volume --port 8077 > ~/serve.log 2>&1 &

# /status answers at once; queries 503 until SigLIP loads (~16 s on the 4060 box)
until .venv/bin/python -c "import json,urllib.request as u;\
exit(0 if json.load(u.urlopen('http://127.0.0.1:8077/status'))['ready'] else 1)"; \
  do sleep 2; done

.venv/bin/python query-probe.py --label CX23
free -m; swapon --show    # did it need the swap? that answers "does 4 GB fit"
grep -i "load\|ready" ~/serve.log | tail -3       # how long the load took here
grep VmHWM /proc/$(pgrep -f "[s]erve_api.py")/status   # peak RSS vs the 2.8 GB budget
```

A `ready:false` that never clears with a `CacheUnusable` failure means the
cache copied wrong, not that it is still warming.

## 5. The transatlantic half — from this machine

Do not open 8077 to the internet; tunnel it. The round trip is still paid, so
the measurement stands:

```sh
ssh -N -L 8077:127.0.0.1:8077 root@<ip> &
python3 ~/Documents/model-browser/scripts/query-probe.py \
  --url http://127.0.0.1:8077 --label "CX23 from US"
```

This is the *search* interaction only. The full per-interaction benchmark the
notes ask for — first paint, a scroll screen of contact sheets, a lightbox
open — needs the app and its baked thumbnails on the box, and is a separate
job that `immutable-thumbnail-serving` should land first.

## 6. Teardown

Delete the server in the console. Hourly billing stops at deletion.

## What to bring back

- the order-page price (closes the €8.49 mislabel);
- the `JSON …` line each `query-probe.py` run prints — two of them: one on the
  box, one through the tunnel;
- SigLIP load seconds and `VmHWM` from the box — a cold load is the 16 s the
  notes cite, and `VmHWM` near 2.8 GB in 4 GB is the number the tier rests on;
- whether the top-1 list matches the baseline's. A mismatch on x86 would be a
  real surprise; the question is live for the ARM box whenever CAX21 restocks,
  where a differing list is an embedding-parity finding (fp32 matmul
  associativity across architectures) that decides ARM on correctness, not
  price.

## Run log

**2026-09-04, CX23 (Falkenstein, 2 shared vCPU, 4 GB), Masa's run.** Executed
as written; nothing in the procedure needed changing.

The four numbers this run produced live in `scripts/query-probe.py`'s docstring,
beside the baselines they are read against — one home, not three. In summary:
the box missed the 1 s bar by about a quarter, and the tunnelled figure is an
upper bound (a fresh connection per request), not a visitor's latency.

Alongside: VmHWM **2.43 GB** and the swapfile untouched (68 KB) — 4 GB fits;
cold SigLIP load **6.9 s**, not the 16 s the notes carried; top-1 identical to
the desktop baseline on all 16 queries.

Read against this machine's own scaling through the same path (8 threads
381.6 ms, 4 cores 673.8 ms, 2 cores 931.7 ms), CX23 is 1.32x the 2-core line,
so **CX33 projects to ~890 ms** — inside the bar by about 10%, on a
single-point factor. The full reasoning and what it means for the tier is in
`docs/web-demo-notes.md` under Measurements.

Still open, in the order they matter:

1. a CX33 when it restocks — the projection wants one real point;
2. `ping -c 10 <ip>` from the US while a box is up, to split the tunnel's
   ~1.09 s into RTT and per-request setup;
3. the per-interaction benchmark (first paint, a scroll screen of sheets, a
   lightbox open) — needs the app and baked thumbnails on the box;
4. a CAX21 for the ARM parity question.

## Addendum: the whole app on the box (2026-09-04)

Done after the query probe, driven over SSH. Shape, so it can be repeated:

```sh
# on the box
curl -fsSL https://bun.sh/install | bash          # needs unzip first on Ubuntu 26.04
sysctl -w vm.overcommit_memory=1                  # or SigLIP's 4.5 GB mmap fails at 4 GB
# from here
bun run build -C client                           # build locally; 2 vCPU is not for vite
rsync -az --exclude node_modules --exclude .git ./ root@<ip>:/root/mb/
rsync -az ~/Documents/tests/test-models/miniatures/clustered-hq/ root@<ip>:/root/corpus/clustered-hq/
# on the box: bun install, then three processes —
#   serve_api.py /root/corpus/clustered-hq --cache-dir embed-cache-test --no-volume --port 8077
#   MODEL_BROWSER_ROOT=/root/corpus/clustered-hq bun src/index.ts        (127.0.0.1:3177)
#   bun demo-front.ts                                                    (127.0.0.1:8080)
# from here
ssh -N -L 8080:127.0.0.1:8080 root@<ip>   # then browse http://localhost:8080
```

`demo-front.ts` is 25 lines: static `dist`, `/api/*` proxied to 3177. The tunnel
is what keeps `guard` happy (`Host: localhost:8080` is loopback) — **do not**
bind either process to a public interface; that is what `public-deployment` is
for, and it is not implemented.

Two gotchas that cost time here: `pkill -f` patterns that also appear in the
ssh command line kill the ssh session itself (twice), and backgrounded starts
need `setsid nohup … < /dev/null` in a **script file** on the box, not inline
in the ssh argv.

Results are in `docs/web-demo-notes.md` — headline: 19 s and 32.5 MB to settle
the first screen, 28.4 MB of it STL geometry for folder sheets.

