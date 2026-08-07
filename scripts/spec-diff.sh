#!/usr/bin/env bash
# Diff a change's delta spec against the committed main spec, per requirement.
# MODIFIED requirements word-diff against openspec/specs; ADDED/REMOVED print in full.
# Usage: scripts/spec-diff.sh <capability> <change> [requirement]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
usage="usage: spec-diff.sh <capability> <change> [requirement]"
cap="${1:?$usage}"
change="${2:?$usage}"
only="${3:-}"

main="$ROOT/openspec/specs/$cap/spec.md"
delta="$ROOT/openspec/changes/$change/specs/$cap/spec.md"
[[ -f $delta ]] || { echo "no delta spec: $delta" >&2; exit 1; }

# Print one requirement's block (header through last line before the next
# "### Requirement:" or "## " section header).
extract() {
  awk -v req="$2" '/^## /{p=0} /^### Requirement: /{p = ($0 == "### Requirement: " req)} p' "$1"
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
color=()
[[ -t 1 ]] && color=(--color)

# Emit "<delta section>\t<requirement name>" pairs, then handle each per its operation.
while IFS=$'\t' read -r op req; do
  [[ -n $only && $req != "$only" ]] && continue
  case "$op" in
    *MODIFIED*)
      echo "== MODIFIED: $req"
      extract "$main" "$req" > "$tmp/main.md"
      extract "$delta" "$req" > "$tmp/change.md"
      if [[ ! -s $tmp/main.md ]]; then
        echo "!! requirement not found in $main — full delta text:"
        cat "$tmp/change.md"
      else
        git diff --no-index --word-diff "${color[@]}" "$tmp/main.md" "$tmp/change.md" | tail -n +5 || true
      fi ;;
    *ADDED*)
      echo "== ADDED: $req (new requirement — full text)"
      extract "$delta" "$req" ;;
    *REMOVED*)
      echo "== REMOVED: $req"
      extract "$delta" "$req" ;;
    *)
      echo "== ${op#\#\# } — $req (full delta text)"
      extract "$delta" "$req" ;;
  esac
  echo
done < <(awk '/^## /{sec=$0} /^### Requirement: /{name=$0; sub(/^### Requirement: /,"",name); print sec "\t" name}' "$delta")
