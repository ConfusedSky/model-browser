## Why

Everything the demo needs from the app is drafted or landed, and the host is decided
(the Hetzner CX23 gate 3.3 ran on, as it is — `docs/web-demo-notes.md`, Decided,
2026-09-07). What does not exist anywhere is the box's own shape: how the two servers
and a TLS terminator are built, started, kept running and fed the corpus, the index and
the checkpoint. Today that shape lives only in a probe runbook that hand-installs a venv
over SSH. Masa split it out on 2026-09-03 as its own ticket because it depends on nothing
in the app and can be written and rehearsed before `public-deployment` lands — and
deployment now outranks everything else on the demo list.

## What Changes

- **A `deploy/demo/` directory that brings the whole stack up from a checkout with one
  command**: a Compose file, an image for the app (Bun, the built client alongside the
  server), an image for the semantic index (`mini-classify`'s `serve_api.py`, CPU torch),
  and Caddy for TLS.
- **The three services share one loopback.** Caddy, the app and the index run in a single
  network namespace, so the app's guard, its hardcoded loopback bind and the index's
  default address all hold with no configuration, and nothing but Caddy can be reached
  from outside the box. Only ports 80 and 443 are published; the Hetzner cloud firewall
  admits those and SSH and nothing else.
- **TLS is automatic.** Caddy obtains and renews the certificate for
  `models.masamaeda.com`, redirects HTTP to HTTPS, and serves HTTP/2 — the trip-count
  lever the notes name for an ocean away. No rate limiting at launch: the index serialises
  queries and the flat walk is budgeted, so abuse degrades to queueing; the plugin route
  is recorded for when that changes.
- **State lives outside the containers**: the corpus, the thumbnail and listing caches,
  the 4.3 GB checkpoint and the certificates are volumes or bind mounts, so an image
  rebuild or a rollback loses none of them, and the stack restarts on reboot.
- **The deployment's configuration reaches the box from the repository.**
  `deploy/demo/config.json` is bind-mounted from the checkout into the app container at
  the path `MODEL_BROWSER_CONFIG` names; a deploy is a pull and a rebuild, and a config
  change is a commit. This change creates the file with the one key the server reads
  today (`root`); `public-deployment` 6.1 adds the rest.
- **The same Compose file rehearses locally**, against a local corpus and Caddy's
  internal CA, so the stack is tested on this machine before it is tested on the box.
- **An operator runbook** (`deploy/demo/README.md`) replaces the probe runbook's setup
  half: box preparation, first deploy, redeploy, rollback, and what to check.

## Capabilities

### New Capabilities
- `deployment-infrastructure`: how the public deployment is built, exposed, kept running
  and fed — one public entry point, one shared loopback, state outside containers,
  reproducible from the checkout, rehearsable locally.

### Modified Capabilities

None. The app's own behaviour is untouched: `public-deployment` owns what the server
accepts and serves, and this change consumes it as it is.

## Impact

- **New files only in the repository**: `deploy/demo/{compose.yaml, Caddyfile,
  Caddyfile.local, app.Dockerfile, index.Dockerfile, config.json, README.md}` and a
  `.dockerignore` at the repo root. No source file changes.
- **`docs/platform-surface.md`** gains the container's paths under the user-dirs bullet:
  a container is a fourth "platform" for where files live, driven by the env overrides
  the server already has (`MODEL_BROWSER_CONFIG`, `MODEL_BROWSER_CACHE`).
- **`docs/web-demo-notes.md`** points its "Two containers behind Caddy" default at this
  change; `web-demo-backlog` 1.4 records it as drafted. `docs/hetzner-probe-runbook.md`
  keeps only what this change does not absorb — the tier table for a later upgrade run.
- **External dependencies**: Docker Engine with the Compose plugin on the box; the
  `oven/bun`, `python:3.12-slim` and `caddy` images; the CPU torch wheel index. The
  index image pins what the probe runbook installed by hand, because `mini-classify`
  carries no dependency manifest — a gap that belongs upstream and is noted there.
- **Ordering.** `public-deployment` landed on 2026-09-08 before this change was applied,
  so the box serves the app on its first deploy: the smoke test expects the client at `/`
  and the demo posture at `/api/features`, with a foreign `Origin` refused as the guard's
  liveness check. The bake (`web-demo-backlog` 1.7) runs after the app's first start on
  the box, which is when the library marker is written and the cache directory gets its
  name.
