# Load test results

Run on one Windows laptop (12 CPUs, 16 GB RAM, Docker Desktop). Everything ran on that one machine at the same time: k6, Nginx, 3 API containers, Postgres, Redis, S3. So these numbers are a lower bound for the design, not a measurement of it.

## Summary

- **The design target (3,500 reads/s + 350 writes/s) was NOT reached.** The pass rules (read p95 under 100 ms, errors under 1%) were met only at a scaled-down rate.
- **Scaled-down rate that passed: 500 reads/s + 50 writes/s** (14% of target, same 10:1 read-to-write mix), with the cache on. Read p95 was 16 ms.
- **The cache matters a lot.** At that same rate, cache off gave read p95 of 3.67 s and 0.55% errors.
- **The limit on this machine is the API tier's CPU**, not Postgres, Redis or Nginx. Each API container used about one full CPU core (Node uses one core per process). Three containers reach roughly 800 to 1,000 requests/s. About 10 or more containers would be needed for 3,500 reads/s. This was not tried.
- **Postgres outage:** with the cache off, every read failed (HTTP 500) for the 14 seconds around the outage and service was back about 3 seconds after Postgres restarted. With the cache on, no reads failed.

## 1. Cache on vs cache off

Same script ([load.js](load.js)), 60 seconds, 500 reads/s + 50 writes/s, rate limit off. Reads pick from 2,000 pre-created pastes, skewed so a few are very popular.

| | Cache ON | Cache OFF |
|---|---|---|
| Read p95 | **16.3 ms** | **3.67 s** |
| Read median | 2.7 ms | 905 ms |
| Read p99 | 55 ms | 20 s |
| Error rate | 0.00% | 0.55% |
| Requests/s achieved | 546 | 450 (3,939 iterations dropped) |
| Threshold p95 < 100 ms | pass | **fail** |
| Threshold errors < 1% | pass | pass |

Why cache off is so slow: every read needs a Postgres connection. Each API container has a pool of 20, and when it is full a request waits up to 2 seconds and then fails. The API logs show `timeout exceeded when trying to connect`, which are the 500s that make up the 0.55%.

## 2. How high can it go (cache on)

| Reads/s + writes/s | Read p95 | Errors | Result |
|---|---|---|---|
| 500 + 50 (60 s) | 16 ms | 0% | pass |
| 800 + 80 (60 s) | 422 ms | 0% | fail (p95), the API containers are full |
| 1,000 + 100 (30 s) | 223 ms | 0% | fail (p95) |
| 3,500 + 350 (30 s) | 26.5 s | 1.45% | fail. Only about 565 requests/s got through, 86,953 iterations were dropped by k6 |

Between 500 and 800 the system goes from fine to overloaded. Past that, requests queue up and latency grows into seconds.

### Two findings from getting here

1. **Nginx opened a new connection to the API for every request.** The first run managed only about 430 requests/s. Adding `keepalive 64` and HTTP/1.1 to the upstream (and a Node keep-alive timeout longer than Nginx's) made the same 1,000 reads/s go through at full speed (1,008 requests/s). Both are now in [../nginx.conf](../nginx.conf) and [../src/main.ts](../src/main.ts).
2. **Per-container CPU:** during the 900 reads/s run the API containers were at 89%, 98% and 89% of one core, Nginx 69%, Postgres 30%, Redis 20%. The API tier is the bottleneck. To go higher: more API containers (the cheapest step), then look at how much CPU each request costs.

## 3. Failure test: stop Postgres during a read test

Script: [failure.js](failure.js), 300 reads/s over 200 pastes for 60 seconds. Postgres stopped about 20 seconds in, started again 13 seconds later. Per-second output: [out/](out/) (`failure-analysis-cache-*.txt`).

| | Cache OFF | Cache ON |
|---|---|---|
| Reads that failed | 2,892 of 17,419 (16.6%) | **0 of 18,001** |
| What the failures look like | HTTP **500** (the DB connection error is not turned into a 503) | none |
| First / last failed second | +22 s / +36 s | none |
| Recovery after Postgres started | **about 3 s** (first clean second +37 s) | not applicable |

How to read this:

- **Cache off:** failures start about 2 seconds after the stop command and end about 3 seconds after the start command, which is Postgres booting and the API pools reconnecting. Nothing had to be restarted by hand.
- **Cache on:** the 200 test pastes were all cached after the first second, so Redis kept answering. This is the cache doing its availability job, but it only covers pastes that are already cached. A cache miss during the outage still fails with a 500, and so does creating a paste (every write needs Postgres). The test did not exercise those.
- **Improvement to consider:** return 503 (service unavailable) instead of 500 when Postgres is unreachable, so clients know to retry.

## 4. Other checks done

- **One API container stopped:** 60 requests through Nginx, all returned 200. Nginx retried on the other two.
- **Rate limit across containers:** 10 pastes accepted, the rest got 429, with requests spread over all three API containers (the count is shared through Redis). The Redis key was the real client address, not Nginx's.
- **Load spreading:** a fresh batch of 30 reads split 10 / 11 / 9 over the three containers.

## 5. What could NOT be validated locally

- **CDN:** not built. Read-heavy traffic in the real design would be partly absorbed by the CDN before it ever reaches Nginx.
- **Three regions (US East, US West, Europe):** one local copy only. Cross-region latency, data replication between regions and regional failover are untested.
- **Sharding:** one Postgres runs here. The shard is chosen in one function (`shardIndex`) and that is unit-tested for stability, but nothing has been tested with real shards: no resharding, no cross-shard behaviour, and no check that the load spreads evenly.
- **Replica promotion:** there are no read replicas, so "a replica is promoted when its primary fails" cannot be tested. The Postgres outage above shows what happens with NO failover: the database is down until it is restarted.
- **Single points of failure left locally:** one Nginx, one Redis, one Postgres, one S3. Only the API tier is redundant here (and tested with one container stopped). In the real design each of these is replicated or managed.
- **Real S3:** a local stand-in (SeaweedFS) was used, so S3 latency and limits were not tested. The load test pastes were about 2 KB, so the S3 path was not exercised under load.
- **The full 3,500 reads/s target:** needs far more CPU than this laptop can give the API tier.
- **Realistic traffic:** reads use 2,000 pre-made pastes with a skew towards a few of them. Real access patterns (and the "favour recent pastes" effect) are only approximated, and pastes created during the test are not read back.
