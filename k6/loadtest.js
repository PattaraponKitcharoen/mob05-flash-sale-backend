import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';

// docker compose exposes Nginx on :80. Point BASE_URL at another team's
// deployment to run the cross-group comparison required by the report.
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const USER_COUNT = Number(__ENV.USER_COUNT || 500);
const TARGET_PRODUCT = __ENV.TARGET_PRODUCT || 'p-1001';

// Read load is a fixed amount of work: 1,000 concurrent users each issuing
// READ_ITERATIONS requests. The run ends when that work is done, so the
// elapsed time is itself the result.
const READ_VUS = Number(__ENV.READ_VUS || 1000);
const READ_ITERATIONS = Number(__ENV.READ_ITERATIONS || 100);
const READ_LIMIT = Number(__ENV.READ_LIMIT || 10);
const READ_PAGES = Number(__ENV.READ_PAGES || 2);
const FULL_SUMMARY = String(__ENV.FULL_SUMMARY || '') !== '';

const accepted = new Counter('orders_accepted');
const duplicate = new Counter('orders_duplicate');
const unexpected = new Counter('orders_unexpected');
const orderLatency = new Trend('order_latency', true);
const readLatency = new Trend('read_latency', true);

// Milliseconds since each scenario started, sampled at the end of every
// iteration. The max of this trend is the scenario's wall-clock duration.
const readElapsed = new Trend('read_elapsed_ms', true);
const writeElapsed = new Trend('write_elapsed_ms', true);
const readRequests = new Counter('read_requests');
const writeRequests = new Counter('write_requests');
// Anything that is not a valid response: 5xx, timeouts, unparseable bodies.
const readErrors = new Counter('read_errors');

export const options = {
  // p99 and max are what expose a bad tail; k6 shows neither by default.
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    // Read-heavy: 1,000 concurrent users against the cached product list.
    read_load: {
      executor: 'per-vu-iterations',
      vus: READ_VUS,
      iterations: READ_ITERATIONS,
      maxDuration: '5m',
      exec: 'readProducts',
      gracefulStop: '30s',
    },
    // Write-heavy: 500 distinct users racing for 50 units. Starts one second
    // in so the read load is already saturating the system.
    write_load: {
      executor: 'per-vu-iterations',
      vus: USER_COUNT,
      iterations: 1,
      startTime: '1s',
      maxDuration: '2m',
      exec: 'placeOrder',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Every request must be answered with a valid business outcome.
    checks: ['rate>0.99'],
    read_latency: ['p(95)<500'],
    // The write burst is measured while 1,000 readers already saturate the
    // CPU, so this budget covers queueing at the edge, not the handler.
    order_latency: ['p(95)<3000'],
  },
};

/**
 * Preparation phase: mint one JWT per simulated user before the measured
 * traffic starts, so authentication never shows up in the results.
 */
export function setup() {
  const tokens = [];
  for (let i = 1; i <= USER_COUNT; i++) {
    const res = http.post(
      `${BASE_URL}/api/v1/auth/token`,
      JSON.stringify({ userId: `user-${i}` }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (res.status !== 200) {
      throw new Error(`auth failed for user-${i}: ${res.status} ${res.body}`);
    }
    tokens.push(res.json('accessToken'));
  }
  return { tokens };
}

export function readProducts() {
  // Spread readers across pages so the test is not a single hot key.
  const page = ((__VU + __ITER) % READ_PAGES) + 1;
  const res = http.get(
    `${BASE_URL}/api/v1/products?page=${page}&limit=${READ_LIMIT}`,
    { tags: { name: 'GET /products' } },
  );
  readLatency.add(res.timings.duration);
  readRequests.add(1);
  if (res.status !== 200) readErrors.add(1);
  check(res, {
    'read 200': (r) => r.status === 200,
    'read has data': (r) => {
      try {
        return Array.isArray(r.json('data'));
      } catch (_) {
        return false;
      }
    },
  });
  readElapsed.add(Date.now() - exec.scenario.startTime);
}

export function placeOrder(data) {
  // __VU is unique across the whole test run, not just this scenario -
  // read_load also allocates VUs (up to READ_VUS) before write_load starts,
  // so raw __VU values here are not a clean 1..USER_COUNT range. Mapping them
  // via modulo caused two different VUs to collide on the same token (a fake
  // duplicate) while another token went unused (a missing acceptance).
  // iterationInTest is scoped to this scenario and starts at 0, so with
  // vus: USER_COUNT and iterations: 1 it lands on each token exactly once.
  const idx = exec.scenario.iterationInTest;
  const token = data.tokens[idx % data.tokens.length];
  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    tags: { name: 'POST /orders' },
  };
  const payload = JSON.stringify({ productId: TARGET_PRODUCT });

  // Every fifth user double-taps: three simultaneous requests from the same
  // JWT, which must still yield at most one reservation.
  const burst = idx % 5 === 0 ? 3 : 1;
  const requests = [];
  for (let i = 0; i < burst; i++) {
    requests.push(['POST', `${BASE_URL}/api/v1/orders`, payload, params]);
  }

  const responses = http.batch(requests);
  for (const res of responses) {
    orderLatency.add(res.timings.duration);
    writeRequests.add(1);
    if (res.status === 202) accepted.add(1);
    else if (res.status === 409) duplicate.add(1);
    else unexpected.add(1);

    check(res, {
      'order handled': (r) => r.status === 202 || r.status === 409,
    });
  }
  writeElapsed.add(Date.now() - exec.scenario.startTime);
}

// ---------------------------------------------------------------------------
// Summary formatting
// ---------------------------------------------------------------------------

const LINE = '='.repeat(66);

function padR(v, n) {
  let s = String(v);
  while (s.length < n) s += ' ';
  return s;
}

function padL(v, n) {
  let s = String(v);
  while (s.length < n) s = ' ' + s;
  return s;
}

/** 101201 -> "101,201" */
function num(n) {
  const parts = String(Math.round(n)).split('');
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const fromEnd = parts.length - i;
    out += parts[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return out;
}

function secs(ms) {
  return `${(ms / 1000).toFixed(2)} s`;
}

function rate(count, ms) {
  if (!ms) return '-';
  return `${num(count / (ms / 1000))} req/s`;
}

function pct(part, total) {
  if (!total) return '0.000 %';
  return `${((part / total) * 100).toFixed(3)} %`;
}

function trend(metric) {
  const v = (metric && metric.values) || {};
  return {
    med: v.med || 0,
    p90: v['p(90)'] || 0,
    p95: v['p(95)'] || 0,
    p99: v['p(99)'] || 0,
    max: v.max || 0,
  };
}

function latencyRow(label, t) {
  return (
    '    ' +
    padR(label, 18) +
    padL(t.med.toFixed(1), 8) +
    padL(t.p90.toFixed(1), 8) +
    padL(t.p95.toFixed(1), 8) +
    padL(t.p99.toFixed(1), 8) +
    padL(t.max.toFixed(1), 9)
  );
}

function verdict(ok, text) {
  return `    ${ok ? 'PASS' : 'FAIL'}  ${text}`;
}

/**
 * k6's default output buries the three numbers the assignment asks for
 * (Req/s, p95, error rate) inside forty lines of internal timing metrics, and
 * its own `http_req_failed` counts 409 as a failure even though it is the
 * correct business answer. This prints the report instead.
 */
export function handleSummary(data) {
  const m = data.metrics;
  const count = (name) => (m[name] ? m[name].values.count : 0);

  const readMs = m.read_elapsed_ms ? m.read_elapsed_ms.values.max : 0;
  const writeMs = m.write_elapsed_ms ? m.write_elapsed_ms.values.max : 0;
  const totalMs = data.state.testRunDurationMs;

  const readReqs = count('read_requests');
  const writeReqs = count('write_requests');
  const totalReqs = count('http_reqs');

  const okCount = count('orders_accepted');
  const dupCount = count('orders_duplicate');
  const badCount = count('orders_unexpected');
  const readErr = count('read_errors');

  // Real errors are transport failures and unexpected status codes only.
  // 409 (already reserved) is a correct answer - everyone else is queued as
  // 202 and sold-out is resolved asynchronously by the worker, not here.
  const realErrors = readErr + badCount;
  const rejections = dupCount;

  const checks = (m.checks && m.checks.values) || { passes: 0, fails: 0 };
  const checksTotal = checks.passes + checks.fails;

  const readT = trend(m.read_latency);
  const orderT = trend(m.order_latency);

  const out = [];
  const push = (l) => out.push(l === undefined ? '' : l);

  push('');
  push(LINE);
  push(`  FLASH SALE LOAD TEST   ${BASE_URL}`);
  push(LINE);
  push('');
  push('  THROUGHPUT');
  push(
    '    ' +
    padR('overall', 18) +
    padL(rate(totalReqs, totalMs), 14) +
    '   ' +
    padL(num(totalReqs), 9) +
    ' requests / ' +
    secs(totalMs),
  );
  push(
    '    ' +
    padR('GET  /products', 18) +
    padL(rate(readReqs, readMs), 14) +
    '   ' +
    padL(num(readReqs), 9) +
    ' requests / ' +
    secs(readMs),
  );
  push(
    '    ' +
    padR('POST /orders', 18) +
    padL(rate(writeReqs, writeMs), 14) +
    '   ' +
    padL(num(writeReqs), 9) +
    ' requests / ' +
    secs(writeMs),
  );
  push('');
  push('  LATENCY (ms)');
  push(
    '    ' +
    padR('endpoint', 18) +
    padL('med', 8) +
    padL('p90', 8) +
    padL('p95', 8) +
    padL('p99', 8) +
    padL('max', 9),
  );
  push(latencyRow('GET  /products', readT));
  push(latencyRow('POST /orders', orderT));
  push('');
  push('  ERROR RATE');
  push(
    '    ' +
    padR('real errors', 22) +
    padL(num(realErrors), 9) +
    ' of ' +
    padL(num(totalReqs), 9) +
    '   ' +
    padL(pct(realErrors, totalReqs), 9),
  );
  push(
    '    ' +
    padR('business rejections', 22) +
    padL(num(rejections), 9) +
    ' of ' +
    padL(num(writeReqs), 9) +
    '   ' +
    padL(pct(rejections, writeReqs), 9) +
    `   (409: ${num(dupCount)})`,
  );
  push(
    '    ' +
    padR('checks passed', 22) +
    padL(num(checks.passes), 9) +
    ' of ' +
    padL(num(checksTotal), 9) +
    '   ' +
    padL(pct(checks.passes, checksTotal), 9),
  );
  push('');
  push(`  ORDER OUTCOMES   (${TARGET_PRODUCT})`);
  push('    ' + padR('202 accepted (queued)', 22) + padL(num(okCount), 9));
  push('    ' + padR('409 duplicate user', 22) + padL(num(dupCount), 9));
  push('    ' + padR('unexpected status', 22) + padL(num(badCount), 9));
  push('');
  push('  VERDICT');
  push(verdict(realErrors === 0, `error rate ${pct(realErrors, totalReqs)}`));
  push(
    verdict(readT.p95 < 500, `GET  /products p95 ${readT.p95.toFixed(1)} ms`),
  );
  push(
    verdict(orderT.p95 < 3000, `POST /orders   p95 ${orderT.p95.toFixed(1)} ms`),
  );

  if (readMs < 2000) {
    push('');
    push('  WARNING');
    push(
      `    read phase lasted only ${secs(readMs)} - mostly connection setup`,
    );
    push(
      '    and cold cache. Raise READ_ITERATIONS until it runs 3 s or more,',
    );
    push('    otherwise the throughput and p95 figures are not comparable.');
  }

  push(LINE);
  push('');

  let stdout = out.join('\n');
  if (FULL_SUMMARY) {
    stdout += textSummary(data, { indent: '  ', enableColors: true });
  }
  return { stdout };
}
