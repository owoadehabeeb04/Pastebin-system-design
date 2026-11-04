
Pastebin: build handoff
Put this file at the root of the project folder as CLAUDE.md, then start Claude Code in that folder.

0. How to work with me (read first)
I am learning system design and backend development. Explain what you are doing and why in plain language, in short sentences.
Build in the slices from section 8, in order. After each slice: run the tests and show me the result. (Updated: I said to build slices 1 to 6 in one go, without stopping between them. The Next.js slice is skipped for now. Database access uses TypeORM.)
Keep it simple. No extra features, no extra libraries beyond the stack below. If you think something is missing from this spec, ask me.
Items marked (assumption) are my guesses. Use them, but tell me if one causes trouble.
Black and white only for any diagram you draw (Mermaid is fine).
1. What we are building
A pastebin: a user pastes plain text or code and gets back a short link. Anyone with the link can read the paste until it expires. Designed for 30 million active users, in three regions (US East, US West, Europe). We build and load-test one local copy of this design, not the whole multi-region setup.

2. Stack
API: NestJS (TypeScript)
Database: PostgreSQL
Cache and rate limiter: Redis
Large text storage: S3 (use MinIO locally as a stand-in)
Web client: Next.js (last slice, optional for load testing)
Local setup: Docker Compose (Postgres, Redis, MinIO, 2 or 3 API containers, Nginx)
Load tests: k6
3. Requirements
Functional:

Create a paste: plain text or code, with an expiry time. Returns a short link.
Read a paste by its short link. This is the most used feature (read-heavy).
Code pastes carry a language name so the client can do syntax highlighting.
Expiry: after expires_at the paste can no longer be opened.
Non-functional:

High availability: no single point of failure.
Fast reads. Durability: a saved paste is never lost before it expires.
Limit: at most 10,000 characters per paste.
Not in version 1: user accounts, login, deleting a paste early.
4. Estimates (the load test targets come from these)
30M pastes a day, about 350 writes a second.
10 reads per paste, so 300M reads a day, about 3,500 reads a second.
Average paste about 2 KB, so about 60 GB a day.
Cache: the most popular 20% of a day's pastes is about 12 GB, fits one Redis server.
5. API
POST /pastes

Body: { text: string, type: "code" | "plain_text", language?: string, expiresIn: number } where expiresIn is seconds.
Defaults and limits (assumption): default 86,400 (1 day), minimum 60, maximum 2,592,000 (30 days).
Returns 201 { code, url, expiresAt }.
Errors: 400 for empty text, text over 10,000 characters, or a bad expiresIn. 429 when rate limited.
GET /pastes/:code

Returns 200 { code, text, type, language, expiresAt }.
Returns 404 if the code does not exist or expires_at has passed.
6. Key design decisions
Short code. 7 characters from 0-9 a-z A-Z (62 characters, about 3.5 trillion codes). No symbols, because / ? # % break URLs. UUIDs are too long.

Generate a random code on the server.
Insert the row with code as the primary key. Do NOT check first and then save: two servers could pick the same code at once.
If Postgres rejects the insert as a duplicate key, generate a new code and retry. Cap retries at 5, then return 500.
Expiry. Store expires_at (a timestamp), never an is_expired flag. On every read, compare now with expires_at. A cleanup job runs every hour, deletes expired rows from Postgres and their files from S3.

Cache (Redis).

Reads check Redis first. On a miss, read Postgres (and S3 if needed), then save a copy in Redis.
Set the Redis key's TTL to the time left until expires_at, so Redis never serves an expired paste.
Cache 404 results for a short time (30 seconds) (assumption) so missing codes do not hammer the database.
Large pastes. If the text is over 10 KB, store it in S3 and keep only s3_key in Postgres. With a 10,000 character limit this is rare, but multi-byte characters can push a paste past 10 KB.

Rate limit. At most 10 pastes a minute per IP address. Keep the count in Redis (a key per IP that expires after one minute) so every API server sees the same count. Over the limit returns 429. The limit must be configurable by an environment variable, and the load tests must raise or disable it (one load-test machine is one IP).

Sharding. The real design splits Postgres into shards (each with a primary plus read replicas; a replica is promoted if its primary fails), because one 22 TB-a-year database is too big and too slow to back up. Locally we run ONE Postgres. Write the data access code so the shard is picked from the paste code in one place, so adding shards later does not mean rewriting everything. Do not build real sharding.

CDN, regions, load balancer failover. Not built locally. Nginx in front of 2 or 3 API containers stands in for the load balancer.

7. Data model (PostgreSQL)
CREATE TABLE users (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  code         CHAR(7) PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id),   -- null for anonymous pastes
  text         TEXT,                          -- null when stored in S3
  s3_key       TEXT,                          -- set when text is over 10 KB
  type         TEXT NOT NULL CHECK (type IN ('code', 'plain_text')),
  language     TEXT,
  device_info  TEXT,                          -- from the User-Agent header
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX notes_expires_at_idx ON notes (expires_at);  -- for the cleanup job
Use migrations, not manual SQL. Exactly one of text and s3_key is set.

8. Build slices (stop after each one)
API and Postgres only. Docker Compose with Postgres. POST and GET with the short code, collision retry, size limit, expiry. Unit tests plus API tests.
Redis cache and rate limiter. Read-through cache with TTL, the 404 cache, the 429 rate limit. A CACHE_ENABLED environment variable so we can switch the cache off for load tests.
S3 (MinIO). Pastes over 10 KB go to S3.
Cleanup job. Hourly job deleting expired rows and S3 files.
Scale out locally. 2 or 3 API containers behind Nginx.
Load tests with k6 (section 9).
Next.js page (optional): a form to create a paste and a page to view one.
9. Tests
Correctness tests (write these in slice 1 to 4):

An expired paste returns 404, in Postgres and when it is cached in Redis.
Two inserts with the same code: the second retries with a new code (test by forcing the generator to return the same code once).
10,001 characters returns 400. 10,000 characters is accepted.
The 11th paste in a minute from one IP returns 429. After a minute it works again.
A paste over 10 KB is stored in S3 and read back identically.
The cleanup job removes expired rows and their S3 files, and leaves unexpired ones.
Load tests with k6 (slice 6). k6 is a robot that pretends to be thousands of users and measures how long each request takes. Scripts live in loadtest/.

Traffic mix: create pastes at 350 a second, read at 3,500 a second (10 reads per paste, favouring recent and popular pastes, which is what makes the cache useful). If the laptop cannot reach this, run at a scaled-down rate and tell me what rate it reached.
Pass rules (k6 thresholds): p95 of read time under 100 ms (p95 means 95 out of 100 reads are faster than this), error rate under 1%.
Run the same test twice, with CACHE_ENABLED=true and false. Report both p95 numbers side by side. The cache should make reads clearly faster.
Rate limit off or raised for load tests.
Failure test: while a read test runs, stop the Postgres container and then start it again. Report what the errors look like and how long recovery takes. (We cannot test replica promotion locally. Say so in the report.)
10. Deliverables
Working code, docker compose up brings everything up.
README.md: how to run the app, the tests and the load tests.
loadtest/RESULTS.md: the k6 numbers (cache on and off, failure test), plus what could not be validated locally (CDN, regions, shards, replica promotion).
11. Reference: architecture (Mermaid)
check cache first
check cache first
check cache first
write, or read on cache miss
write, or read on cache miss
write, or read on cache miss
text over 10 KB
text over 10 KB
text over 10 KB
User
CDN (not built locally)
Nginx load balancer
API server 1
API server 2
API server 3
Redis
PostgreSQL(sharded in the real design)
S3 / MinIO
