import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { allowedOrigins } from '../server/cors.js';

const DASHBOARD = 'https://trade-tracker-fe.onrender.com';
const brokers = { list: [{ code: 'R', name: 'Robinhood' }], codes: ['R'], defaultBroker: 'R' };

let server;
let baseUrl;

// No database needed: CORS answers preflights itself and /api/info doesn't query.
before(async () => {
  server = createApp({ brokers, corsOrigins: [DASHBOARD] }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('reads CORS_ORIGINS as a comma-separated list', () => {
  assert.deepEqual(allowedOrigins({ CORS_ORIGINS: ` ${DASHBOARD}/ , http://localhost:5173` }), [
    DASHBOARD,
    'http://localhost:5173',
  ]);
  assert.deepEqual(allowedOrigins({}), []);
});

test('the dashboard’s site may call the API', async () => {
  const res = await fetch(`${baseUrl}/api/info`, { headers: { Origin: DASHBOARD } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), DASHBOARD);
  assert.match(res.headers.get('vary') ?? '', /Origin/);
});

test('preflights for PATCH and DELETE with JSON are answered', async () => {
  const res = await fetch(`${baseUrl}/api/trades/some-id`, {
    method: 'OPTIONS',
    headers: {
      Origin: DASHBOARD,
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), DASHBOARD);
  assert.match(res.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(res.headers.get('access-control-allow-methods'), /DELETE/);
  assert.equal(res.headers.get('access-control-allow-headers'), 'Content-Type');
});

test('other sites get no CORS headers', async () => {
  const res = await fetch(`${baseUrl}/api/info`, { headers: { Origin: 'https://elsewhere.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
