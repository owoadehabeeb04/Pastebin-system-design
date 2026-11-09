#!/usr/bin/env bash
# Usage:
#   loadtest/run.sh load  <cache true|false>     main load test with the cache on or off
#   loadtest/run.sh failure <cache true|false>   read test while Postgres is stopped, then started
# Extra k6 settings go in env vars: READ_RATE, WRITE_RATE, DURATION, SEED.
# SCALE=1 runs 10 API containers instead of 3 (uses docker-compose.scale.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1   # stop Git Bash on Windows from rewriting /loadtest paths
mode=${1:?load|failure}; cache=${2:?true|false}
mkdir -p loadtest/out

if [ "${SCALE:-}" = 1 ]; then dc="docker compose -f docker-compose.yml -f docker-compose.scale.yml"; extra=""
else dc="docker compose"; extra="--remove-orphans"; fi   # back to 3 APIs: remove the extra ones

# Rate limit off (one k6 machine = one IP). Compose only restarts the API if these values changed.
CACHE_ENABLED=$cache RATE_LIMIT_PER_MIN=0 $dc up -d $extra >/dev/null 2>&1
$dc exec -T redis redis-cli flushall >/dev/null   # every run starts with an empty cache
# Wait until Nginx really serves requests (APIs may still be starting): 20 clean answers in a row.
ok=0
for _ in $(seq 1 120); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' localhost:8080/pastes/zzzzzzz)" = 404 ]; then ok=$((ok+1)); else ok=0; fi
  [ $ok -ge 20 ] && break
  sleep 0.5
done
[ $ok -ge 20 ] || { echo "stack did not become ready"; exit 1; }

k6() {
  docker run --rm -i --network pastebin_default -v "$PWD/loadtest:/loadtest" \
    -e READ_RATE -e WRITE_RATE -e DURATION -e SEED grafana/k6 run "$@"
}

if [ "$mode" = load ]; then
  k6 --summary-trend-stats="avg,med,p(90),p(95),p(99),max" /loadtest/load.js | tee "loadtest/out/load-cache-$cache.txt"
else
  : "${DURATION:=60s}"; export DURATION
  rm -f loadtest/out/failure.csv
  k6 --out csv=/loadtest/out/failure.csv /loadtest/failure.js > "loadtest/out/failure-cache-$cache.txt" &
  k6pid=$!
  sleep 25                                     # seeding takes a few seconds, then 15 s of healthy traffic
  echo "stop $(date +%s)" > loadtest/out/events.txt
  $dc stop postgres >/dev/null
  sleep 10
  echo "start $(date +%s)" >> loadtest/out/events.txt
  $dc start postgres >/dev/null
  wait $k6pid || true
  node loadtest/analyze.js loadtest/out/failure.csv loadtest/out/events.txt | tee "loadtest/out/failure-analysis-cache-$cache.txt"
fi
