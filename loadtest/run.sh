#!/usr/bin/env bash
# Usage:
#   loadtest/run.sh load  <cache true|false>     main load test with the cache on or off
#   loadtest/run.sh failure <cache true|false>   read test while Postgres is stopped, then started
# Extra k6 settings go in env vars: READ_RATE, WRITE_RATE, DURATION, SEED.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1   # stop Git Bash on Windows from rewriting /loadtest paths
mode=${1:?load|failure}; cache=${2:?true|false}
mkdir -p loadtest/out

# Rate limit off (one k6 machine = one IP). Compose only restarts the API if these values changed.
CACHE_ENABLED=$cache RATE_LIMIT_PER_MIN=0 docker compose up -d api1 api2 api3 nginx >/dev/null
docker compose exec -T redis redis-cli flushall >/dev/null   # every run starts with an empty cache
sleep 5

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
  docker compose stop postgres >/dev/null
  sleep 10
  echo "start $(date +%s)" >> loadtest/out/events.txt
  docker compose start postgres >/dev/null
  wait $k6pid || true
  node loadtest/analyze.js loadtest/out/failure.csv loadtest/out/events.txt | tee "loadtest/out/failure-analysis-cache-$cache.txt"
fi
