# syntax=docker/dockerfile:1
#
# The demo's semantic-index image: `mini-classify`'s `serve_api.py` on CPU torch
# (`demo-infrastructure` D2/D3). The `syntax` line above is what guarantees the
# named build context below, whatever the engine's builtin frontend is.
#
#   docker compose -f deploy/demo/compose.yaml build index
#
# **The pins below are the probe runbook's** — `docs/hetzner-probe-runbook.md`
# §1, the venv that ran gate 3.3 on this box on 2026-09-04. They are copied here
# because `mini-classify` has no dependency manifest: no pyproject.toml, no
# requirements.txt, no lockfile. That is a gap upstream, not a decision. The day
# that repository grows a manifest, this list is deleted and the manifest is
# installed instead; until then a torch or transformers bump is a two-place
# edit, here and in the runbook, and the runbook names this file for that
# reason.
FROM python:3.12-slim

# Its own layer, and its own index: PyPI's default x86_64 torch wheel is the
# CUDA build — gigabytes of driver stack for a box with no GPU. This is the
# slowest layer in the stack and the one worth keeping cached across rebuilds.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch

# `huggingface_hub[cli]` for the `hf` command the `setup` service runs to fetch
# the checkpoint (D3); the rest is what `serve_api.py` imports.
RUN pip install --no-cache-dir \
      "transformers==5.15.0" \
      "numpy==2.5.2" \
      fastapi \
      uvicorn \
      "huggingface_hub[cli]" \
      pillow

# `mini-classify` is a sibling checkout, not part of this repository, so its
# source arrives as a **named build context** rather than as this build's own
# context: `compose.yaml` binds the name `mini-classify` to ${MINI_CLASSIFY_DIR}
# and BuildKit fetches only what these two lines ask for.
#
# Not `build.context: ${MINI_CLASSIFY_DIR}`, which is the obvious spelling:
# Docker reads `.dockerignore` from the context root, a file that cannot be
# added to another repository, so the context would be the whole checkout — 22
# GB and 282,381 files on the machine this was written on (.venv, embed-cache512
# and the debug renders included). The box's clone at /opt/mini-classify is
# clean, but the local rehearsal is not, and the rehearsal is the point (D8).
#
# `serve_api.py` and `src/` are the whole of what runs: it imports `src.api`,
# `src.cachedir` and `src.collection` at module scope and `src.embedder` inside
# the warmup thread, and reads no data file of its own — the categories list and
# the up-axis labels beside them in that repository belong to the classifier.
WORKDIR /mc
COPY --from=mini-classify serve_api.py ./
COPY --from=mini-classify src/ ./src/

# The 4.3 GB SigLIP checkpoint is a volume, never a layer (D3): in the image it
# would be rebuilt on every code change and would make a rollback a 4.3 GB
# operation. The `setup` profile in compose.yaml runs `hf download` into the
# `hf` volume once, on the box. `HF_HUB_OFFLINE=1` is what `run_serve.sh` runs
# with, and it is a safety line as much as a speed one: a missing checkpoint
# then fails loudly instead of quietly pulling 4.3 GB at the first query.
#
# PYTHONUNBUFFERED so `docker compose logs index` shows the warmup lines as they
# happen rather than a page at a time — the load takes seconds and the operator
# is watching for `ready`.
ENV HF_HUB_OFFLINE=1 \
    HF_HOME=/hf \
    PYTHONUNBUFFERED=1

# The positional ROOT is not decoration under `--no-volume`. That flag makes the
# server enumerate the collection from the cache's own records (pose-cache.json,
# run-params.json) and read nothing under the root — but `Collection.load`
# scopes that enumeration to ROOT exactly as the walk would, and ROOT is what
# the index reports as `collection_root`. The app maps that absolute path
# through its own library (`semantic.ts`, `mapCollectionRoot` →
# `library.libPathOf`), so **the two containers must see the corpus at the same
# mount path or the index covers nothing**: hence /library in both, and ROOT
# equal to the app's configured root in deploy/demo/config.json.
#
# `--no-volume` goes when the index is rebuilt against the deployed tree
# (`web-demo-backlog` 1.7, the design's Open Question); the corpus is already
# mounted here read-only so that day needs no Compose edit.
#
# Expect a paragraph at startup saying the cache was built against
# .../miniatures/deduplicated and you have asked for /library/... — `cache_root`
# warns and proceeds for read-only tools. It is the shipped cache's recorded
# root, not a fault; the probe run on the box saw the same and came back ready.
CMD ["python", "serve_api.py", "/library/miniatures/clustered-hq", \
     "--cache-dir", "/index", "--no-volume", \
     "--host", "127.0.0.1", "--port", "8077"]
