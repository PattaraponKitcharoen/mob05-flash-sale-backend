import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';

// docker compose exposes Nginx on :80. Point BASE_URL at another team's
// deployment to run the cross-group comparison required by the report.
const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const USER_COUNT = Number(__ENV.USER_COUNT || 500);
const TARGET_PRODUCT = __ENV.TARGET_PRODUCT || 'p-1001';

const READ_VUS = Number(__ENV.READ_VUS || 1000);
const READ_ITERATIONS = Number(__ENV.READ_ITERATIONS || 1);
const READ_LIMIT = Number(__ENV.READ_LIMIT || 10);
const READ_PAGES = Number(__ENV.READ_PAGES || 2);

const accepted = new Counter('orders_accepted');
const duplicate = new Counter('orders_duplicate');
const soldOut = new Counter('orders_sold_out');
const unexpected = new Counter('orders_unexpected');
const orderLatency = new Trend('order_latency', true);
const readLatency = new Trend('read_latency', true);

const readElapsed = new Trend('read_elapsed_ms', true);
const writeElapsed = new Trend('write_elapsed_ms', true);
const readRequests = new Counter('read_requests');
const writeRequests = new Counter('write_requests');

// === ANTI METRICS ===
const antiDtoCaught = new Counter('anti_dto_caught');
const antiDtoFailed = new Counter('anti_dto_failed');
const antiTypeCaught = new Counter('anti_type_caught');
const antiTypeFailed = new Counter('anti_type_failed');

export const options = {
  scenarios: {
    // === ORIGINAL SCENARIOS ===
    read_load: {
      executor: 'per-vu-iterations',
      vus: READ_VUS,
      iterations: READ_ITERATIONS,
      maxDuration: '5m',
      exec: 'readProducts',
      gracefulStop: '30s',
    },
    write_load: {
      executor: 'per-vu-iterations',
      vus: USER_COUNT,
      iterations: 1,
      startTime: '1s',
      maxDuration: '2m',
      exec: 'placeOrder',
      gracefulStop: '30s',
    },
    // === ANTI SCENARIOS ===
    anti_dto_validation: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 500,
      maxDuration: '1m',
      exec: 'antiDtoValidation',
    },
    anti_type_casting: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 500,
      maxDuration: '1m',
      exec: 'antiTypeCasting',
    },
    anti_cache_bloat: {
      executor: 'constant-vus',
      vus: 100, // 100 VUs spamming random pages to fill Redis
      duration: '30s', // burst of traffic
      exec: 'antiCacheBloat',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    read_latency: ['p(95)<500'],
    order_latency: ['p(95)<3000'],
  },
};

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

// === ORIGINAL FUNCTIONS ===

export function readProducts() {
  const page = ((__VU + __ITER) % READ_PAGES) + 1;
  const res = http.get(
    `${BASE_URL}/api/v1/products?page=${page}&limit=${READ_LIMIT}`,
    { tags: { name: 'GET /products' } },
  );
  readLatency.add(res.timings.duration);
  readRequests.add(1);
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
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    tags: { name: 'POST /orders' },
  };
  const payload = JSON.stringify({ productId: TARGET_PRODUCT });

  const burst = __VU % 5 === 0 ? 3 : 1;
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
    else if (res.status === 410) soldOut.add(1);
    else unexpected.add(1);

    check(res, {
      'order handled': (r) =>
        r.status === 202 || r.status === 409 || r.status === 410,
    });
  }
  writeElapsed.add(Date.now() - exec.scenario.startTime);
}

// === ANTI FUNCTIONS ===

export function antiDtoValidation(data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    tags: { name: 'POST /orders (Anti DTO)' },
  };
  // Send integer instead of string, or empty string
  const isInteger = __VU % 2 === 0;
  const payload = JSON.stringify(isInteger ? { productId: 12345 } : { productId: "" });

  const res = http.post(`${BASE_URL}/api/v1/orders`, payload, params);
  
  const isCaught = check(res, {
    'Anti DTO caught (400 Bad Request)': (r) => r.status === 400,
  });

  if (isCaught) {
    antiDtoCaught.add(1);
  } else {
    antiDtoFailed.add(1);
  }
}

export function antiTypeCasting() {
  // Send invalid string to ParseIntPipe
  const res = http.get(`${BASE_URL}/api/v1/products?page=invalid_string&limit=-5`, {
    tags: { name: 'GET /products (Anti Type)' }
  });

  const isCaught = check(res, {
    'Anti Type Casting caught (400 Bad Request)': (r) => r.status === 400,
  });

  if (isCaught) {
    antiTypeCaught.add(1);
  } else {
    antiTypeFailed.add(1);
  }
}

export function antiCacheBloat() {
  // Request random large pages to force Redis to cache new keys rapidly
  // If they didn't set maxmemory, their Redis will crash (OOM)
  const page = Math.floor(Math.random() * 50000) + 1000;
  http.get(`${BASE_URL}/api/v1/products?page=${page}&limit=10`, {
    tags: { name: 'GET /products (Anti Cache Bloat)' }
  });
}

// === TEARDOWN & SUMMARY ===

export function teardown() {
  const res = http.get(`${BASE_URL}/api/v1/metrics/cache`);
  if (res.status === 200) {
    console.log(`cache stats: ${res.body}`);
  }
}

function fmt(ms) {
  return `${(ms / 1000).toFixed(2)}s (${Math.round(ms)} ms)`;
}

export function handleSummary(data) {
  const m = data.metrics;
  const readMs = m.read_elapsed_ms ? m.read_elapsed_ms.values.max : 0;
  const writeMs = m.write_elapsed_ms ? m.write_elapsed_ms.values.max : 0;
  const readReqs = m.read_requests ? m.read_requests.values.count : 0;
  const writeReqs = m.write_requests ? m.write_requests.values.count : 0;

  const dtoFail = m.anti_dto_failed ? m.anti_dto_failed.values.count : 0;
  const typeFail = m.anti_type_failed ? m.anti_type_failed.values.count : 0;

  let antiResult = '';
  if (dtoFail > 0 || typeFail > 0) {
    antiResult = `    ❌ ANTI TEST FAILED: Target system lacks proper Validation/Pipes!\n       DTO Failures (Expected 400, got something else): ${dtoFail}\n       Type Failures (Expected 400, got something else): ${typeFail}`;
  } else {
    antiResult = `    ✅ ANTI TEST PASSED: Target system successfully rejected invalid data.`;
  }

  const lines = [
    '',
    '  █ WORKLOAD COMPLETION TIME',
    '',
    `    read  : ${READ_VUS} concurrent users x ${READ_ITERATIONS} requests`,
    `            ${readReqs} requests in ${fmt(readMs)}`,
    `            ${(readReqs / (readMs / 1000)).toFixed(0)} req/s`,
    '',
    `    write : ${USER_COUNT} concurrent users (every 5th fires 3x)`,
    `            ${writeReqs} requests in ${fmt(writeMs)}`,
    `            ${(writeReqs / (writeMs / 1000)).toFixed(0)} req/s`,
    '',
    `    total run: ${fmt(data.state.testRunDurationMs)}`,
    '',
    '  █ ANTI-PATTERN TEST RESULTS',
    '',
    antiResult,
    '',
  ];

  return {
    stdout:
      lines.join('\n') + '\n' +
      textSummary(data, { indent: '  ', enableColors: true }),
  };
}
