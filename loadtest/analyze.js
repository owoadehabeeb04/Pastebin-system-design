// Reads the k6 CSV from the failure test and prints, second by second, how many reads worked and failed.
// Usage: node loadtest/analyze.js <k6.csv> <events.txt>
// events.txt has lines like "stop 1700000000" and "start 1700000010" (unix seconds).
const fs = require('fs');
const [csvPath, eventsPath] = process.argv.slice(2);

const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const head = lines[0].split(',');
const [iMetric, iTime, iStatus] = ['metric_name', 'timestamp', 'status'].map((c) => head.indexOf(c));

const perSec = new Map();
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (c[iMetric] !== 'http_req_duration') continue;
  if (c[iStatus] === '201') continue; // the seeding POSTs before the test, not reads
  const s = Number(c[iTime]);
  const row = perSec.get(s) || { ok: 0, bad: 0, codes: {} };
  const status = c[iStatus];
  if (status === '200') row.ok++;
  else { row.bad++; row.codes[status] = (row.codes[status] || 0) + 1; }
  perSec.set(s, row);
}

const events = Object.fromEntries(fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => l.split(' ')));
const secs = [...perSec.keys()].sort((a, b) => a - b);
const t0 = secs[0];
console.log(`stop postgres at +${events.stop - t0}s, start postgres at +${events.start - t0}s`);
console.log('second  ok    failed  (status codes of failures)');
for (const s of secs) {
  const r = perSec.get(s);
  console.log(`+${String(s - t0).padStart(3)}s  ${String(r.ok).padStart(5)} ${String(r.bad).padStart(6)}  ${r.bad ? JSON.stringify(r.codes) : ''}`);
}
const bad = secs.filter((s) => perSec.get(s).bad > 0);
const total = [...perSec.values()].reduce((a, r) => ({ ok: a.ok + r.ok, bad: a.bad + r.bad }), { ok: 0, bad: 0 });
console.log(`\ntotal ok=${total.ok} failed=${total.bad} (${((100 * total.bad) / (total.ok + total.bad)).toFixed(1)}%)`);
if (bad.length) {
  const lastBad = bad[bad.length - 1];
  const recovered = secs.find((s) => s > lastBad && perSec.get(s).bad === 0 && perSec.get(s).ok > 0);
  console.log(`first failure +${bad[0] - t0}s, last failure +${lastBad - t0}s`);
  console.log(`recovery: ${lastBad - events.start >= 0 ? lastBad - events.start : 0}s after Postgres was started again (first clean second +${recovered - t0}s)`);
} else console.log('no failed reads at all');
