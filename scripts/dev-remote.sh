#!/usr/bin/env bash
# `bun run dev:remote` — the dev servers, reachable from the other machines on
# this tailnet. With `--demo`, the same under the shipped demo posture
# (`bun run dev:remote-demo`).
#
# Nothing here is a second deployment: the API still binds loopback and Vite
# still binds loopback. What reaches them from outside is `tailscale serve`,
# which terminates TLS at the tailnet name and proxies to those loopback
# ports. So the whole difference from `bun run dev` is three names agreeing:
#
#   - Vite must admit the tailnet name as a `Host` (`allowedHosts`), or it
#     answers its blocked-host page instead of the app.
#   - The API's guard must admit `https://<name>:5173` as an origin, because
#     Vite's proxy forwards the browser's `Host` rather than rewriting it.
#     That lives in the deployment's configuration, which is read once at
#     start — hence the check below rather than a line in the app.
#   - A serve entry must exist for 5173. Adding one needs root, so this script
#     reports a missing one and prints the command rather than trying.
#
# Vite is pinned to IPv4 loopback here (`VITE_HOST`): its default bind is
# IPv6-only, and `tailscale serve` proxies to 127.0.0.1.
set -euo pipefail

demo=""
[ "${1:-}" = "--demo" ] && demo=1

if ! command -v tailscale >/dev/null; then
  echo "tailscale not installed: use 'bun run dev' and browse 127.0.0.1:5173" >&2
  exit 1
fi

name=$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')
if [ -z "$name" ] || [ "$name" = "null" ]; then
  echo "this machine has no tailnet name (MagicDNS off?): use 'bun run dev'" >&2
  exit 1
fi
origin="https://$name:5173"

top=$(cd "$(dirname "$0")/.." && pwd)
if [ -n "$demo" ]; then
  # The demo posture, plus this tailnet's origin — which is why the shipped
  # file is not used directly and not edited: `deploy/demo/config.json` names
  # the *public* origin and is what the box deploys, so a machine-specific name
  # has no business in it. A copy with one origin appended is written per run
  # and pointed at instead, leaving the tracked file alone. Its `root` is the
  # box's path, so it needs the same override `dev:demo` gives it.
  export MODEL_BROWSER_CONFIG="${XDG_RUNTIME_DIR:-/tmp}/model-browser-dev-remote-demo.json"
  jq --arg o "$origin" '.origins += [$o]' "$top/deploy/demo/config.json" \
    > "$MODEL_BROWSER_CONFIG"
  export MODEL_BROWSER_ROOT="${MODEL_BROWSER_ROOT:-$HOME/Documents/tests/test-models/miniatures/decimated}"
  echo "demo posture: every capability off, root $MODEL_BROWSER_ROOT"
else
  config=${MODEL_BROWSER_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/model-browser/config.json}
  if ! jq -e --arg o "$origin" '(.origins // []) | index($o)' "$config" >/dev/null 2>&1; then
    echo "warning: $config does not list $origin in \"origins\";"
    echo "         the app will load but every /api request answers 403 forbidden host."
    echo "         Add it and restart the server."
  fi
fi

if ! tailscale serve status --json 2>/dev/null | jq -e '.TCP["5173"]' >/dev/null; then
  echo "warning: no tailnet serve entry for 5173. Add one (needs root):"
  echo "         sudo tailscale serve --bg --https=5173 127.0.0.1:5173"
fi

echo "app for this tailnet: $origin"
exec env VITE_HOST=127.0.0.1 VITE_ALLOWED_HOSTS="$name" bun run --filter '*' dev
