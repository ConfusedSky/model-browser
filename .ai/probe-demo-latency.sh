#!/usr/bin/env bash
export LC_ALL=C   # $EPOCHREALTIME and awk both parse decimals; a comma locale breaks sub()
# Baseline for the CDN question (issue #24; deploy/demo/README.md §10 holds the numbers and
# the summarising snippet): what a visitor pays today, and how much that varies while the
# box does other work. One sample per interval, CSV to the output file, which is locked so
# two runs cannot interleave rows into one file.
#
# Do not edit this script while a run is using it: bash reads a script incrementally, so a
# run started before the edit carries on writing the old columns into the new file.
#
#   .ai/probe-demo-latency.sh <output.csv> [samples] [interval-seconds]
#
# Comparability with an "after" run is the whole point, so:
#
#   - `ok=0` marks a row that must be excluded from the timings, and `why` says which
#     check failed. Never discard those rows: a CDN that turns slow-but-complete answers
#     into failures (Cloudflare gives up on an origin at 125 s, which is why the model
#     fetch allows 150 — a shorter timeout turns a 524 into a curl error) would read as
#     pure improvement, because every row it broke left the average. Compare the ok/not-ok
#     split between runs before comparing any timing.
#   - every latency column is reported **net of connection setup** as well as raw. The
#     subtracted value is `time_appconnect`, which is DNS plus TCP plus TLS, not the TLS
#     handshake alone. An edge terminating TLS shortens all three for bypassed routes too.
#   - `model_bps` is transfer-only throughput — `size / (total - starttransfer)` — not
#     curl's `speed_download`, which divides by a total including the round trip.
#   - the model is drawn fresh per sample from a narrow size band, so the box's page cache
#     is not warm for the file being timed and two samples stay comparable. Its byte count
#     is checked against the listing's `size`: a truncated transfer still reports HTTP 200.
#   - `batch_hit` counts only the batch renders an edge served **without contacting the
#     origin** — HIT, STALE, UPDATING. REVALIDATED is deliberately excluded: it is served
#     from cache only after a blocking origin revalidation, which is the round trip the
#     whole experiment is trying to remove. It still shows in `batch_cf`, the full
#     histogram.
#   - the batch repeats the same 20 URLs every sample, which is what lets an edge cache
#     them; the standalone thumbnail is drawn at random from a disjoint pool and is meant
#     to stay a cold-object measurement, so it reads MISS on a healthy edge. Gate on
#     `batch_hit`, never on `thumb_cf`.
#   - `%header{}` needs curl 7.84 or newer; the startup check refuses to run without it.
set -uo pipefail
HOST=${HOST:-https://models.masamaeda.com}
OUT=${1:?usage: probe-demo-latency.sh <output.csv> [samples] [interval]}
SAMPLES=${2:-60}
INTERVAL=${3:-60}

exec 9>"$OUT.lock"
if ! flock -n 9; then
  echo "probe: another run holds $OUT.lock — one writer per file, or the rows interleave" >&2
  exit 1
fi

H=$(mktemp); # The lock file stays on disk: unlinking it while this process still holds the descriptor
# would let a second run create a fresh one and write the same CSV.
trap 'rm -f "$H"' EXIT INT TERM

W='%{http_code},%{exitcode},%{time_appconnect},%{time_starttransfer},%{time_total},%{size_download}'

# Two diagnoses, kept apart: a host that cannot be reached is not an old curl.
CHECK=$(curl -s -o /dev/null -m 10 -w '%{http_code} %header{content-type}' "$HOST/api/features")
case $CHECK in
  200\ */*) ;;
  200*) echo "probe: this curl does not expand %header{} (needs 7.84+); batch_hit would be a lie" >&2; exit 1 ;;
  *)    echo "probe: $HOST/api/features answered '$CHECK' — is the demo up?" >&2; exit 1 ;;
esac

ROOT=$(curl -s -m 30 "$HOST/api/dir?path=/")   # one listing, so the two pools agree

# Models in a narrow size band: a small file is all round trip, and a 5 MB file next to a
# 1 MB one makes the throughput column an artefact of size rather than of the box.
mapfile -t MODELS < <(printf '%s' "$ROOT" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for e in d.get("entries",[]):
    for p in e.get("preview",[]):
        if p.get("kind")=="model" and 2_000_000 <= p.get("size",0) <= 2_600_000:
            print(p["path"], p["size"], sep="\t")
')

# Thumbnail URLs, each naming its own current generation so the origin answers the
# immutable tier. Re-derived per run rather than pinned: after a re-bake a pinned
# generation is stale, the origin says `no-cache`, and no edge would ever cache it.
mapfile -t THUMBS < <(printf '%s' "$ROOT" | python3 -c '
import json,sys,urllib.parse
d=json.load(sys.stdin)
for e in d.get("entries",[]):
    for p in e.get("preview",[]):
        t=p.get("thumb") or {}
        if (t.get("ao") or {}).get("state")!="hit": continue
        q=urllib.parse.quote(p["path"],safe="")
        m=p["mtime"]; g=t["gen"]
        print(f"/api/thumb/image?path={q}&mtime={m}&gen={g}")
')

if (( ${#MODELS[@]} < 5 || ${#THUMBS[@]} < 25 )); then
  echo "probe: ${#MODELS[@]} models and ${#THUMBS[@]} thumbnails from the root listing — need 5 and 25" >&2
  exit 1
fi
BATCH=( "${THUMBS[@]: -20}" )                  # the fixed 20 a screen would repeat
SOLO=( "${THUMBS[@]:0:${#THUMBS[@]}-20}" )     # disjoint pool for the cold single

enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"; }
sub() { awk "BEGIN{printf \"%.4f\", $1-$2}"; }
bps() { awk "BEGIN{d=$2-$3; printf \"%d\", (d>0)? $1/d : 0}"; }

echo "ts,ok,why,thumb_code,thumb_exit,thumb_cf,thumb_cc_immutable,thumb_ttfb,thumb_ttfb_net,thumb_bytes,batch_total,batch_total_net,batch_ok,batch_hit,batch_cf,model_code,model_exit,model_cf,model_ttfb,model_ttfb_net,model_total,model_bytes,model_expected,model_bps,model_path,dir_code,dir_exit,dir_ttfb,dir_ttfb_net" >"$OUT"
for ((i=0;i<SAMPLES;i++)); do
  DEADLINE=$(( $(date +%s) + INTERVAL ))
  TS=$(date -Is)
  IFS=$'\t' read -r MPATH MSIZE <<<"${MODELS[RANDOM % ${#MODELS[@]}]}"
  PE=$(enc "$MPATH")
  TURL=${SOLO[RANDOM % ${#SOLO[@]}]}

  T=$(curl -s -o /dev/null -m 30 -D "$H" -w "$W" "$HOST$TURL")
  TCF=$(grep -ai '^cf-cache-status:' "$H" | tr -d '\r' | awk '{print $2}')
  grep -qai '^cache-control:.*immutable' "$H" && TCC=1 || TCC=0
  IFS=, read -r TCODE TEXIT TTLS TTTFB _ TBYTES <<<"$T"

  # One connection, no concurrency cap: HTTP/2 multiplexes, which is the shape a browser
  # gives a screen of tiles. `-Z` is what makes curl do that rather than 20 in a row.
  BARGS=(); for u in "${BATCH[@]}"; do
    BARGS+=( -o /dev/null -w '%{http_code} %{time_appconnect} %{exitcode} %{size_download} %header{cf-cache-status}\n' "$HOST$u" )
  done
  BS=$EPOCHREALTIME
  BOUT=$(curl -s -m 60 --http2 -Z "${BARGS[@]}")
  BE=$EPOCHREALTIME
  BTOTAL=$(sub "$BE" "$BS")
  BOK=$(awk '$1=="200" && $3=="0" && $4+0 > 0' <<<"$BOUT" | wc -l)
  BHIT=$(awk 'BEGIN{n=0} {s=toupper($5)} s=="HIT"||s=="STALE"||s=="UPDATING"{n++} END{print n}' <<<"$BOUT")
  BCF=$(awk '{s=toupper($5); if (s=="") s="NONE"; print s}' <<<"$BOUT" \
        | sort | uniq -c | awk '{printf "%s%s:%d", (n++?"|":""), $2, $1}')
  # Exactly one of the 20 transfers pays the handshake and they finish out of order, so
  # the largest appconnect is the connection's, not the first line's.
  BTLS=$(awk 'BEGIN{m=0} {if ($2+0 > m) m=$2+0} END{printf "%.6f", m}' <<<"$BOUT")
  BNET=$(sub "$BTOTAL" "$BTLS")

  M=$(curl -s -o /dev/null -m 150 -D "$H" -w "$W" "$HOST/api/file?path=$PE")
  MCF=$(grep -ai '^cf-cache-status:' "$H" | tr -d '\r' | awk '{print $2}')
  IFS=, read -r MCODE MEXIT MTLS MTTFB MTOTAL MBYTES <<<"$M"
  MBPS=$(bps "$MBYTES" "$MTOTAL" "$MTTFB")

  D=$(curl -s -o /dev/null -m 30 -w "$W" "$HOST/api/dir?path=/")
  IFS=, read -r DCODE DEXIT DTLS DTTFB _ _ <<<"$D"

  WHY=""
  [[ $TCODE == 200 && $MCODE == 200 && $DCODE == 200 ]] || WHY="$WHY status"
  [[ $TEXIT == 0 && $MEXIT == 0 && $DEXIT == 0 ]] || WHY="$WHY curlexit"
  [[ $BOK == 20 ]] || WHY="$WHY batch"
  [[ $TCC == 1 ]] || WHY="$WHY notimmutable"
  [[ $MBYTES == "$MSIZE" ]] || WHY="$WHY short"
  [[ $MBPS -gt 0 ]] || WHY="$WHY zerobps"
  [[ -z $WHY ]] && OK=1 || OK=0

  echo "$TS,$OK,\"${WHY# }\",$TCODE,$TEXIT,${TCF:-none},$TCC,$TTTFB,$(sub "$TTTFB" "$TTLS"),$TBYTES,$BTOTAL,$BNET,$BOK,$BHIT,$BCF,$MCODE,$MEXIT,${MCF:-none},$MTTFB,$(sub "$MTTFB" "$MTLS"),$MTOTAL,$MBYTES,$MSIZE,$MBPS,\"$MPATH\",$DCODE,$DEXIT,$DTTFB,$(sub "$DTTFB" "$DTLS")" >>"$OUT"

  (( i + 1 < SAMPLES )) || break
  NOW=$(date +%s); (( DEADLINE > NOW )) && sleep $(( DEADLINE - NOW ))
done
