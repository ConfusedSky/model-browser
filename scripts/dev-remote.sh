#!/usr/bin/env bash
# `bun run dev:remote` — the dev servers, reachable from the other machines on
# this tailnet.
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

if ! command -v tailscale >/dev/null; then
  echo "tailscale not installed: use 'bun run dev' and browse 127.0.0.1:5173" >&2
  exit 1
fi

name=$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')
if [ -z "$name" ] || [ "$name" = "null" ]; then
  echo "this machine has no tailnet name (MagicDNS off?): use 'bun run dev'" >&2
  exit 1
fi

config=${MODEL_BROWSER_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/model-browser/config.json}
origin="https://$name:5173"
if ! jq -e --arg o "$origin" '(.origins // []) | index($o)' "$config" >/dev/null 2>&1; then
  echo "warning: $config does not list $origin in \"origins\";"
  echo "         the app will load but every /api request answers 403 forbidden host."
  echo "         Add it and restart the server."
fi

if ! tailscale serve status --json 2>/dev/null | jq -e '.TCP["5173"]' >/dev/null; then
  echo "warning: no tailnet serve entry for 5173. Add one (needs root):"
  echo "         sudo tailscale serve --bg --https=5173 127.0.0.1:5173"
fi

echo "app for this tailnet: https://$name:5173"
exec env VITE_HOST=127.0.0.1 VITE_ALLOWED_HOSTS="$name" bun run --filter '*' dev
