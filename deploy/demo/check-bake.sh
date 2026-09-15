#!/bin/sh
# deploy/demo/check-bake.sh <manifest> [<index dir>]
#
# Refuses a redeploy whose checkout would serve a baked thumbnail store under a
# different recipe than the one that baked it (corpus-bake D2). Four values are
# enforced: RIG_VERSION and POSE_VERSION as the checkout's client source spells
# them against the manifest's "rig" and "poseVersion", and — when an index
# directory is given — the sha256 of its pose-cache.json and run-params.json
# against the manifest's "poseCacheSha256" and "runParamsSha256". A missing
# index file is a disagreement, not a skip.
#
# One line reports without refusing: when the manifest's client.commit differs
# from `git rev-parse HEAD` it prints `commit: checkout <a>, bake <b>` and
# leaves the exit code alone — equal versions are the recipe's own statement
# that the pixels are the same (CLAUDE.md routes every pixel change through
# RIG_VERSION). It stays silent when git cannot answer or the manifest carries
# no commit.
#
# Exit 0 silently when all agree; exit 1 printing each disagreement as
# `rig: checkout 8, bake 7`; exit 1 with `no bake manifest at <path>` when the
# manifest is absent. Every read is line-oriented (`grep`, `sed`, `sha256sum` —
# the box has no jq, Bun or Node) and refuses unless its pattern matches exactly
# one line: a moved or renamed constant, a duplicated one, a manifest a hand
# re-serialised onto one line, or a future key that shares a name all break the
# check loudly rather than compare against nothing or the wrong line. The
# manifest's formatting is `manifestText` in scripts/bake-demo.ts — two-space
# indent, every key on its own line.
#
# The source paths resolve relative to this script's own directory, so the check
# works from /opt/model-browser whatever the caller's cwd. Two environment
# overrides exist FOR TESTS ONLY — the suite points them at fixture copies of the
# source files (a duplicated constant, a two-digit version); a deploy never sets
# them:
#   CHECK_BAKE_RENDERER_TS   path read for RIG_VERSION  (client/src/three/renderer.ts)
#   CHECK_BAKE_POSE_TS       path read for POSE_VERSION (client/src/three/pose.ts)
set -u

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
repo=$(CDPATH= cd -- "$here/../.." && pwd) || exit 1
renderer=${CHECK_BAKE_RENDERER_TS:-$repo/client/src/three/renderer.ts}
pose=${CHECK_BAKE_POSE_TS:-$repo/client/src/three/pose.ts}

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "usage: $0 <manifest> [<index dir>]" >&2
  exit 2
fi
manifest=$1
index=${2-}

if [ ! -f "$manifest" ]; then
  echo "no bake manifest at $manifest"
  exit 1
fi

# The patterns: BRE, one capture each, and each consumes its whole line so the
# value `sed` prints is the capture alone — an unanchored pattern would leave
# the line's tail in sed's output, and `[0-9]` against `12` would still print
# `12` by that accident. The source pair is D2's
# `^export const RIG_VERSION = ([0-9]+)` (a trailing comment on that line is
# tolerated); the manifest reads pin the writer's formatting (indent,
# `"key": value`, optional trailing comma, nothing else).
RIG_PAT='^export const RIG_VERSION = \([0-9]\{1,\}\).*$'
POSE_PAT='^export const POSE_VERSION = \([0-9]\{1,\}\).*$'
MAN_RIG_PAT='^ *"rig": \([0-9]\{1,\}\),\{0,1\}$'
MAN_POSE_PAT='^ *"poseVersion": \([0-9]\{1,\}\),\{0,1\}$'
MAN_POSE_CACHE_PAT='^ *"poseCacheSha256": "\([0-9a-f]\{64\}\)",\{0,1\}$'
MAN_RUN_PARAMS_PAT='^ *"runParamsSha256": "\([0-9a-f]\{64\}\)",\{0,1\}$'
MAN_COMMIT_PAT='^ *"commit": "\([0-9a-f]\{1,\}\)",\{0,1\}$'

# Reporting lines go to fd 3 (stdout) so a function whose value is captured by
# `$(...)` can still print a refusal.
exec 3>&1
fail=0

# count_lines <file> <pattern>: how many lines match. (`grep -c` prints 0 and
# exits 1 at zero matches; the count is what matters here.)
count_lines() {
  grep -c -e "$2" -- "$1" 2>/dev/null || true
}

# read_one <label> <file> <pattern>: the pattern's capture on stdout when it
# matches exactly one line; otherwise a refusal on fd 3 and a non-zero return.
read_one() {
  if [ ! -r "$2" ]; then
    echo "$1: cannot read $2" >&3
    return 1
  fi
  n=$(count_lines "$2" "$3")
  if [ "$n" != 1 ]; then
    echo "$1: $n lines match in $2, expected exactly 1" >&3
    return 1
  fi
  sed -n -e "s/$3/\1/p" -- "$2"
}

# differ <label> <checkout value> <bake value>: one disagreement line when the
# two are both known and unequal.
differ() {
  if [ -n "$2" ] && [ -n "$3" ] && [ "$2" != "$3" ]; then
    echo "$1: checkout $2, bake $3"
    fail=1
  fi
}

src_rig=$(read_one RIG_VERSION "$renderer" "$RIG_PAT") || fail=1
src_pose=$(read_one POSE_VERSION "$pose" "$POSE_PAT") || fail=1
man_rig=$(read_one '"rig"' "$manifest" "$MAN_RIG_PAT") || fail=1
man_pose=$(read_one '"poseVersion"' "$manifest" "$MAN_POSE_PAT") || fail=1
man_pose_cache=$(read_one '"poseCacheSha256"' "$manifest" "$MAN_POSE_CACHE_PAT") || fail=1
man_run_params=$(read_one '"runParamsSha256"' "$manifest" "$MAN_RUN_PARAMS_PAT") || fail=1

differ rig "$src_rig" "$man_rig"
differ poseVersion "$src_pose" "$man_pose"

# check_index_file <file name> <bake hash>: the file under $index against the
# manifest's hash; absent is a disagreement.
check_index_file() {
  f=$index/$1
  if [ ! -r "$f" ]; then
    echo "$1: index missing $f, bake ${2:-?}"
    fail=1
    return
  fi
  actual=$(sha256sum "$f") || { echo "$1: sha256sum failed on $f"; fail=1; return; }
  actual=${actual%% *}
  if [ -n "$2" ] && [ "$actual" != "$2" ]; then
    echo "$1: index $actual, bake $2"
    fail=1
  fi
}

if [ -n "$index" ]; then
  check_index_file pose-cache.json "$man_pose_cache"
  check_index_file run-params.json "$man_run_params"
fi

# The commit: reported, never enforced. Zero "commit" lines is a bake that did
# not know its commit — silent. Two or more is the manifest's format gone
# wrong, refused like every other read.
n=$(count_lines "$manifest" "$MAN_COMMIT_PAT")
case $n in
  0) ;;
  1)
    if head=$(git -C "$repo" rev-parse HEAD 2>/dev/null); then
      baked=$(sed -n -e "s/$MAN_COMMIT_PAT/\1/p" -- "$manifest")
      if [ "$head" != "$baked" ]; then
        echo "commit: checkout $head, bake $baked"
      fi
    fi
    ;;
  *)
    echo "\"commit\": $n lines match in $manifest, expected at most 1"
    fail=1
    ;;
esac

exit $fail
