"""Per-query latency through mini-classify's POST /query — the shape a demo visitor pays.

The same 16 queries as mini-classify's `eval/cpu_dtype.py`, so a run is
comparable to that harness, plus what a request actually costs on top of it:
one HTTP round trip and FastAPI's handling. Run it on a candidate host, and
again through an SSH tunnel from where visitors are, to separate "this CPU is
slow" from "this ocean is wide".

  python3 scripts/query-probe.py [--url http://127.0.0.1:8077] [--label CX33]

Baseline to compare against (2026-09-04, this repo's dev machine, Ryzen 9
7940HS, torch default threads, mini-classify serving embed-cache-test on
device=cpu — 2,165 models, 8 views, dim 1152 — over localhost):

    median 381.6 ms   p90 421.0 ms   min 331.8   max 536.1   (n=16)

The same machine held to two cores — `CUDA_VISIBLE_DEVICES= OMP_NUM_THREADS=2
taskset -c 0,1 serve_api.py … --no-volume --port 8078`, cores 0 and 1 being
distinct physical cores on this box, not SMT siblings — is the proxy for a
2-vCPU host:

    median 931.7 ms   p90 1004.3 ms   min 874.4   max 1083.5   (n=16)

and to four (`OMP_NUM_THREADS=4 taskset -c 0,1,2,3`), the 4-vCPU proxy:

    median 673.8 ms   p90 700.3 ms   min 658.1   max 708.3   (n=16)

i.e. a *desktop* Zen 4 pair already sits on the 1 s bar, and peak RSS was
2.78 GB (VmHWM), the 2.8 GB the sizing assumes. Read a 2-vCPU cloud box
against the 931.7 ms line, not against the 8-thread one.

Measured against those, on a Hetzner **CX23** (Falkenstein, 2 shared vCPU,
4 GB, Ubuntu 24.04, 2026-09-04, Masa's run): **median 1229.7 ms, p90
1389.3 ms** on the box — 1.32x the 2-core desktop line, and over the 1 s bar.
Same run: VmHWM 2.43 GB with the 2 GB swapfile untouched (so 4 GB fits), cold
SigLIP load 6.9 s, and the top-1 list identical to the baseline's on all 16
queries (no embedding drift on cloud x86). Through an SSH tunnel from the US
the same 16 queries measured 2317.9 ms median — that number carries a fresh
connection per request through the tunnel, so it is an upper bound, not what a
keep-alive browser connection would pay.

Higher than `cpu_dtype.py`'s 0.31 s median on the same machine because that
harness times `embed_texts` + score + rank in-process; this one times the
request. The demo's decided bar is a *median under 1 s* (web-demo-notes,
Decided table). The probe also records top-1 per query: a host whose rankings
differ is an embedding-parity finding, not a latency one.
"""

import argparse, json, statistics, time, urllib.request

QUERIES = ["a vampire", "guy with a crossbow crouching", "dragon", "a knight on horseback",
           "skeleton warrior", "wizard casting a spell", "treasure chest", "goblin archer",
           "a giant spider", "dwarf with a hammer", "stone wall ruins", "a werewolf",
           "an elf ranger", "a large demon", "a small house", "barrel"]

def post(url, text, timeout=120):
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(url + "/query", data=body,
                                 headers={"content-type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.load(r)
    return (time.perf_counter() - t0) * 1000, payload

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8077")
    ap.add_argument("--label", default="")
    ap.add_argument("--repeats", type=int, default=1)
    a = ap.parse_args()
    with urllib.request.urlopen(a.url + "/status", timeout=30) as r:
        st = json.load(r)
    print(f"{a.url}: ready={st['ready']} device={st['device']} cache={st['cache_dir']} "
          f"models={st['n_models']} views={st['n_views']} dim={st['dim']}")
    post(a.url, "warm up")                       # first call pays setup
    lat, top1 = [], {}
    for _ in range(a.repeats):
        for q in QUERIES:
            ms, out = post(a.url, q)
            lat.append(ms)
            res = out.get("results") or []
            top1.setdefault(q, res[0]["rel_path"] if res else None)
    lat.sort()
    row = {"label": a.label, "n": len(lat),
           "median_ms": round(statistics.median(lat), 1),
           "p90_ms": round(lat[int(len(lat) * .9) - 1], 1),
           "min_ms": round(lat[0], 1), "max_ms": round(lat[-1], 1)}
    print(f"median {row['median_ms']} ms  p90 {row['p90_ms']} ms  "
          f"min {row['min_ms']}  max {row['max_ms']}  (n={row['n']})")
    print("JSON " + json.dumps({**row, "top1": top1}))

main()
