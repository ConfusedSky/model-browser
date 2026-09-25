#!/usr/bin/env bash
export LC_ALL=C
# Does the edge keep what it cached? Warms disjoint cohorts once, then probes each cohort
# exactly once at its age — a probe re-warms what it touches, so a cohort is spent after it.
#
#   .ai/probe-edge-retention.sh <output.csv> [ages in seconds, space-separated]
#
# Reading it:
#   - `status` answers "did this visitor pay the origin leg". MISS or EXPIRED means yes.
#   - `age_hdr` on a HIT is seconds since the copy was admitted, and with Tiered Cache it
#     can be inherited from the upper tier. Near the cohort's age means the warmed copy
#     survived somewhere in Cloudflare; small means something refilled it in between.
#   - `colo` is recorded on every request because anycast does not pin this machine to one
#     PoP. A HIT on a colo other than the one warmed is the upper tier answering, which is
#     also what a visitor from elsewhere gets. `ttfb_net` separates the two: a local HIT is
#     one short round trip, an upper-tier HIT crosses to near the origin.
set -uo pipefail
HOST=${HOST:-https://models.masamaeda.com}
OUT=${1:?usage: probe-edge-retention.sh <output.csv> [ages...]}
shift
AGES=( "${@:-3600 7200 14400 28800 57600 86400}" )
[[ ${#AGES[@]} -eq 1 ]] && read -r -a AGES <<<"${AGES[0]}"
THUMBS_PER=10
GLBS_PER=3

exec 9>"$OUT.lock"
flock -n 9 || { echo "retention: another run holds $OUT.lock" >&2; exit 1; }

ROOT=$(curl -s -m 60 "$HOST/api/dir?path=/")
# A slice the latency probe's fixed batch (the last 20 thumbnails) never touches.
mapfile -t THUMBS < <(printf '%s' "$ROOT" | python3 -c '
import json,sys,urllib.parse
d=json.load(sys.stdin); out=[]
for e in d.get("entries",[]):
    for p in e.get("preview",[]):
        t=p.get("thumb") or {}
        if (t.get("ao") or {}).get("state")=="hit":
            out.append("/api/thumb/image?path=%s&mtime=%s&gen=%s" % (urllib.parse.quote(p["path"],safe=""), p["mtime"], t["gen"]))
print("\n".join(out[500:-20]))
')
mapfile -t GLBS < <(printf '%s' "$ROOT" | python3 -c '
import json,sys,urllib.parse
d=json.load(sys.stdin); out=[]
for e in d.get("entries",[]):
    for p in e.get("preview",[]):
        if p.get("kind")=="model" and p.get("format")=="stl":
            out.append("/api/model.glb?path=%s&mtime=%s" % (urllib.parse.quote(p["path"],safe=""), p["mtime"]))
print("\n".join(out[200:]))
')
need_t=$(( ${#AGES[@]} * THUMBS_PER )); need_g=$(( ${#AGES[@]} * GLBS_PER ))
if (( ${#THUMBS[@]} < need_t || ${#GLBS[@]} < need_g )); then
  echo "retention: ${#THUMBS[@]} thumbnails and ${#GLBS[@]} models — need $need_t and $need_g" >&2
  exit 1
fi

# ts,phase,cohort,target_age,kind,url,colo,code,status,age_hdr,ttfb_net,total,bytes
hit() {  # phase cohort target kind url
  local r
  r=$(curl -s -o /dev/null -m 150 -w '%{http_code}|%header{cf-ray}|%header{cf-cache-status}|%header{age}|%{time_appconnect}|%{time_starttransfer}|%{time_total}|%{size_download}' "$HOST$5")
  IFS='|' read -r code ray st age ac tt tot by <<<"$r"
  printf '%s,%s,%s,%s,%s,"%s",%s,%s,%s,%s,%s,%s,%s\n' "$(date -Is)" "$1" "$2" "$3" "$4" "$5" \
    "${ray##*-}" "$code" "${st:-none}" "${age:-}" "$(awk "BEGIN{printf \"%.4f\", $tt-$ac}")" "$tot" "$by" >>"$OUT"
}
cohort_urls() {  # cohort index -> kind<TAB>url lines
  local i=$1
  printf 'thumb\t%s\n' "${THUMBS[@]:$(( i * THUMBS_PER )):$THUMBS_PER}"
  printf 'glb\t%s\n' "${GLBS[@]:$(( i * GLBS_PER )):$GLBS_PER}"
}

echo "ts,phase,cohort,target_age,kind,url,colo,code,status,age_hdr,ttfb_net,total,bytes" >"$OUT"
for i in "${!AGES[@]}"; do
  while IFS=$'\t' read -r kind url; do
    hit warm1 "$i" "${AGES[i]}" "$kind" "$url"
    hit warm2 "$i" "${AGES[i]}" "$kind" "$url"
  done < <(cohort_urls "$i")
done
T0=$(date +%s)
for i in "${!AGES[@]}"; do
  target=$(( T0 + AGES[i] ))
  while (( $(date +%s) < target )); do sleep 30; done
  while IFS=$'\t' read -r kind url; do
    hit probe "$i" "${AGES[i]}" "$kind" "$url"
  done < <(cohort_urls "$i")
done
