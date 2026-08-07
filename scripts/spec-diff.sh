#!/usr/bin/env bash
# Diff change delta specs against the committed main specs, per requirement.
# MODIFIED requirements word-diff against openspec/specs; ADDED/REMOVED print in
# full; a capability with no main spec prints "new spec <path>".
# Usage:
#   scripts/spec-diff.sh                                    # all active changes
#   scripts/spec-diff.sh <change>                           # all specs of one change
#   scripts/spec-diff.sh <capability> <change> [requirement]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGES="$ROOT/openspec/changes"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
color=()
[[ -t 1 ]] && color=(--color)

# Print one requirement's block (header through last line before the next
# "### Requirement:" or "## " section header).
extract() {
  awk -v req="$2" '/^## /{p=0} /^### Requirement: /{p = ($0 == "### Requirement: " req)} p' "$1"
}

# Diff one capability's delta within a change; optional third arg limits to one requirement.
diff_capability() {
  local cap="$1" change="$2" only="${3:-}" op req
  local main="$ROOT/openspec/specs/$cap/spec.md"
  local delta="$CHANGES/$change/specs/$cap/spec.md"
  [[ -f $delta ]] || { echo "no delta spec: $delta" >&2; return 1; }
  if [[ ! -f $main ]]; then
    echo "new spec $delta"
    return 0
  fi
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
}

# All capability deltas of one change.
diff_change() {
  local change="$1" delta cap
  [[ -d $CHANGES/$change ]] || { echo "no such change: $change" >&2; return 1; }
  for delta in "$CHANGES/$change"/specs/*/spec.md; do
    [[ -f $delta ]] || continue
    cap="$(basename "$(dirname "$delta")")"
    echo "─── $change / $cap"
    diff_capability "$cap" "$change"
  done
}

case $# in
  0)
    for dir in "$CHANGES"/*/; do
      change="$(basename "$dir")"
      [[ $change == archive ]] && continue
      compgen -G "$dir/specs/*/spec.md" > /dev/null || continue
      diff_change "$change"
    done ;;
  1) diff_change "$1" ;;
  *) diff_capability "$1" "$2" "${3:-}" ;;
esac
