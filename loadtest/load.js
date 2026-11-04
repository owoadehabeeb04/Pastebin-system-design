// Main load test: pastes created at WRITE_RATE/s and read at READ_RATE/s, through Nginx.
// Defaults are the design targets (350 writes/s, 3,500 reads/s). Scale down with env vars if the laptop can't keep up.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://nginx';
const READ_RATE = Number(__ENV.READ_RATE || 3500);
const WRITE_RATE = Number(__ENV.WRITE_RATE || 350);
const DURATION = __ENV.DURATION || '60s';
const SEED = Number(__ENV.SEED || 2000);

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };
const TWO_KB = 'const x = "hello pastebin";\n'.repeat(75); // about 2 KB, the average paste size

export const options = {
  setupTimeout: '180s',
  scenarios: {
    writes: { executor: 'constant-arrival-rate', exec: 'write', rate: WRITE_RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 100, maxVUs: 1000 },
    reads: { executor: 'constant-arrival-rate', exec: 'read', rate: READ_RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 200, maxVUs: 3000 },
  },
  thresholds: {
    'http_req_duration{type:read}': ['p(95)<100'], // 95 of 100 reads faster than 100 ms
    http_req_failed: ['rate<0.01'], // under 1% errors
  },
};

// Pastes to read. Created once before the test starts.
export function setup() {
  const codes = [];
  for (let i = 0; i < SEED; i += 50) {
    const batch = [];
    for (let j = 0; j < 50; j++) {
      batch.push(['POST', `${BASE}/pastes`, JSON.stringify({ text: `seed ${i + j}\n${TWO_KB}`, type: 'code', language: 'js', expiresIn: 3600 }), JSON_HEADERS]);
    }
    for (const res of http.batch(batch)) {
      if (res.status !== 201) throw new Error(`seeding failed: ${res.status} ${res.body} (is the rate limit off? RATE_LIMIT_PER_MIN=0)`);
      codes.push(res.json('code'));
    }
  }
  return { codes };
}

export function write() {
  const body = JSON.stringify({ text: `${Math.random()}\n${TWO_KB}`, type: 'code', language: 'js', expiresIn: 3600 });
  const res = http.post(`${BASE}/pastes`, body, { ...JSON_HEADERS, tags: { type: 'write' } });
  check(res, { 'create is 201': (r) => r.status === 201 });
}

// A few pastes get most of the reads (index close to 0), like popular real-world pastes.
export function read(data) {
  const i = Math.floor(Math.pow(Math.random(), 3) * data.codes.length);
  const res = http.get(`${BASE}/pastes/${data.codes[i]}`, { tags: { type: 'read' } });
  check(res, { 'read is 200': (r) => r.status === 200 });
}
