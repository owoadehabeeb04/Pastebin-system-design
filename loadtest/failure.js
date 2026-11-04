// Failure test: steady reads while run-failure.sh stops and starts Postgres.
// No thresholds on purpose: we want to see the errors, not abort on them.
import http from 'k6/http';

const BASE = __ENV.BASE || 'http://nginx';
const RATE = Number(__ENV.READ_RATE || 500);
const DURATION = __ENV.DURATION || '60s';

export const options = {
  setupTimeout: '120s',
  scenarios: { reads: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 100, maxVUs: 1000 } },
};

export function setup() {
  const codes = [];
  for (let i = 0; i < 200; i++) {
    const res = http.post(`${BASE}/pastes`, JSON.stringify({ text: `seed ${i}`, type: 'code', language: 'js', expiresIn: 3600 }), { headers: { 'Content-Type': 'application/json' } });
    if (res.status !== 201) throw new Error(`seeding failed: ${res.status} (RATE_LIMIT_PER_MIN=0 needed)`);
    codes.push(res.json('code'));
  }
  return { codes };
}

export default function (data) {
  // 200 pastes, evenly: with the cache on they are all cached after the first second.
  http.get(`${BASE}/pastes/${data.codes[Math.floor(Math.random() * data.codes.length)]}`, { timeout: '5s' });
}
