#!/usr/bin/env bash
# `bun run dev:remote` — the dev servers, reachable from the other machines on
# this tailnet. With `--demo`, the same under the shipped demo posture
# (`bun run dev:remote-demo`). With `--preview` (`bun run preview:remote-demo`),
# no Vite: the client is built and the server alone serves it on 3177, the way
# the box does, beside an index when one can be found. Judge performance there,
# never on 5173, which runs React's development build.
#
# Nothing here is a second deployment: the API still binds loopback and Vite
# still binds loopback. What reaches them from outside is `tailscale serve`,
# which terminates TLS at the tailnet name and proxies to those loopback
# ports. So the whole difference from `bun run dev` is three names agreeing:
#
#   - Vite must admit the tailnet name as a `Host` (`allowedHosts`), or it
#     answers its blocked-host page instead of the app.
#   - The API's guard must admit `https://<name>:5173` as an origin, because
#     Vite's proxy forwards the browser's `Host` rather than rewriting it; and
#     `https://<name>:3177`, where the built client (`client/dist`) is served
#     on the tailnet directly.
#     That lives in the deployment's configuration, which is read once at
#     start — hence the check below rather than a line in the app.
#   - A serve entry must exist for 5173. Adding one needs root, so this script
#     reports a missing one and prints the command rather than trying.
#
# Vite is pinned to IPv4 loopback here (`VITE_HOST`): its default bind is
# IPv6-only, and `tailscale serve` proxies to 127.0.0.1.
set -euo pipefail

demo=""
preview=""
for arg in "$@"; do
  case "$arg" in
    --demo) demo=1 ;;
    --preview) preview=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

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
built="https://$name:3177"

top=$(cd "$(dirname "$0")/.." && pwd)
if [ -n "$demo" ]; then
  # The demo posture, plus this tailnet's origin — which is why the shipped
  # file is not used directly and not edited: `deploy/demo/config.json` names
  # the *public* origin and is what the box deploys, so a machine-specific name
  # has no business in it. A copy with this machine's origins appended is
  # written per run and pointed at instead, leaving the tracked file alone. Its
  # `root` is the box's path, so it needs the same override `dev:demo` gives it.
  export MODEL_BROWSER_CONFIG="${XDG_RUNTIME_DIR:-/tmp}/model-browser-dev-remote-demo.json"
  jq --arg o "$origin" --arg b "$built" '.origins += [$o, $b]' "$top/deploy/demo/config.json" \
    > "$MODEL_BROWSER_CONFIG"
  export MODEL_BROWSER_ROOT="${MODEL_BROWSER_ROOT:-$HOME/Documents/tests/test-models/miniatures/decimated}"
  echo "demo posture: every capability off, root $MODEL_BROWSER_ROOT"
else
  config=${MODEL_BROWSER_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/model-browser/config.json}
  for o in "$origin" "$built"; do
    if ! jq -e --arg o "$o" '(.origins // []) | index($o)' "$config" >/dev/null 2>&1; then
      echo "warning: $config does not list $o in \"origins\";"
      echo "         the app will load there but every /api request answers 403 forbidden host."
      echo "         Add it and restart the server."
    fi
  done
fi

if ! tailscale serve status --json 2>/dev/null | jq -e '.TCP["5173"]' >/dev/null; then
  echo "warning: no tailnet serve entry for 5173. Add one (needs root):"
  echo "         sudo tailscale serve --bg --https=5173 127.0.0.1:5173"
fi

if [ -z "$preview" ]; then
  echo "app for this tailnet: $origin (dev), $built (built client, once client/dist exists)"
  exec env VITE_HOST=127.0.0.1 VITE_ALLOWED_HOSTS="$name" bun run --filter '*' dev
fi

if ! tailscale serve status --json 2>/dev/null | jq -e '.TCP["3177"]' >/dev/null; then
  echo "warning: no tailnet serve entry for 3177. Add one (needs root):"
  echo "         sudo tailscale serve --bg --https=3177 127.0.0.1:3177"
fi

(cd "$top/client" && bun run build)

# Baked posed renders are fresh only against the pose their index answers:
# with no index, every one reads as stale and the device re-renders it with
# WebGL, which the live demo never does. The bake records the index cache it
# was made with, so that is the default.
root=${MODEL_BROWSER_ROOT:-$(jq -r '.root // empty' "${MODEL_BROWSER_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/model-browser/config.json}" 2>/dev/null)}
id=$(jq -r '.id // empty' "$root/.model-browser/library.json" 2>/dev/null || true)
bake="${MODEL_BROWSER_CACHE:-$HOME/.cache/model-browser}/$id/bake/bake.json"
index_dir=${INDEX_DIR:-$(jq -r '.index.cacheDir // empty' "$bake" 2>/dev/null || true)}
mini=${MINI_CLASSIFY_DIR:-$HOME/Documents/tests/mini-classify}
if curl -s -m 2 http://127.0.0.1:8077/status >/dev/null; then
  echo "index: already answering on 8077, left as it is"
elif [ -n "$index_dir" ] && [ -x "$mini/.venv/bin/python" ]; then
  echo "index: $index_dir (stopped when this script exits)"
  (cd "$mini" && exec .venv/bin/python serve_api.py "$root" --cache-dir "$index_dir" \
    --no-volume --host 127.0.0.1 --port 8077) &
  index_pid=$!
else
  echo "warning: no index started (INDEX_DIR unset and no bake at $bake,"
  echo "         or no $mini/.venv). Posed thumbnails will re-render on the device."
fi

echo "built client for this tailnet: $built"
# Its children go with it however it ends — Ctrl-C, or a `kill` of this
# script's PID, which would otherwise orphan the server on 3177.
cd "$top/server"
bun src/index.ts &
server_pid=$!
trap 'kill "$server_pid" ${index_pid:+"$index_pid"} 2>/dev/null' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wait "$server_pid"
