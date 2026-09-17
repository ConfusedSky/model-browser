#!/bin/bash
# Box-local model fetch every 2 s for 60 s, with loadavg. Semantic queries fired from
# second 20 to second 40 to create the contention this is testing for.
R="--resolve models.masamaeda.com:443:127.0.0.1"
U="https://models.masamaeda.com/api/file?path=%2F1_Treasure_Token_for_DD_or_Other_RPG_2615634%2FTreasure.stl"
Q="https://models.masamaeda.com/api/semantic"
echo "t,phase,ttfb,total,bytes,bps,load1"
for i in $(seq 0 29); do
  T=$((i*2))
  PH=idle
  if [ $T -ge 20 ] && [ $T -lt 40 ]; then
    PH=loaded
    for q in 1 2 3; do
      curl -s -o /dev/null -m 30 $R -X POST -H 'content-type: application/json' \
        -d '{"text":"a dragon miniature with wings"}' "$Q" &
    done
  fi
  M=$(curl -s -o /dev/null -m 60 $R -w '%{time_starttransfer},%{time_total},%{size_download},%{speed_download}' "$U")
  L=$(cut -d' ' -f1 /proc/loadavg)
  echo "$T,$PH,$M,$L"
  sleep 2
done
wait
