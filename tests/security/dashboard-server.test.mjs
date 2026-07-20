import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createPasswordHash } from '../../dashboard/auth.mjs';
import { createDashboardServer } from '../../dashboard/server.mjs';

const host = 'dashboard.workoutreach.localhost';
const origin = `https://${host}`;

async function fixture() {
  const queries = [];
  const pool = {
    async query(text) {
      queries.push(text);
      if (text.includes('dashboard_set_company_status_v1')) throw new Error('VERSION_CONFLICT');
      if (text.includes('dashboard_stats_v1')) return { rows: [{ company_count: 0, smtp_accepted_count: 0, sent_waiting_count: 0, replied_count: 0, interested_count: 0, attention_count: 0 }] };
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const password = 'synthetic-dashboard-password';
  const app = createDashboardServer({ pool, passwordHash: await createPasswordHash(password), sessionSecret: 'z'.repeat(48), host });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, password, queries };
}

function request(base, path, options = {}) {
  return new Promise((resolveRequest, reject) => {
    const target = new URL(path, base);
    const req = httpRequest(target, { method: options.method || 'GET', headers: { Host: host, ...options.headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolveRequest({
          status: res.statusCode,
          headers: { get: (name) => {
            const value = res.headers[String(name).toLowerCase()];
            return Array.isArray(value) ? value[0] : (value ?? null);
          } },
          json: async () => JSON.parse(text),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('dashboard enforces Host, Origin, auth, CSRF and optimistic conflict handling', async (t) => {
  const app = await fixture();
  t.after(() => app.server.close());

  let response = await fetch(`${app.base}/healthz`, { headers: { host: 'wrong.localhost' } });
  assert.equal(response.status, 421);
  response = await request(app.base, '/api/stats');
  assert.equal(response.status, 401);
  response = await request(app.base, '/auth/login', { method: 'POST', headers: { Origin: 'https://wrong.localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: app.password }) });
  assert.equal(response.status, 403);

  response = await request(app.base, '/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: app.password }) });
  assert.equal(response.status, 200);
  const login = await response.json();
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.ok(login.csrfToken);

  response = await request(app.base, '/api/stats', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/u);

  const patchBody = JSON.stringify({ engagementStatus: 'REPLIED', expectedVersion: 1, actionKey: 'dashboard:synthetic:123456' });
  response = await request(app.base, '/api/companies/1/status', { method: 'PATCH', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: patchBody });
  assert.equal(response.status, 403);
  response = await request(app.base, '/api/companies/1/status', { method: 'PATCH', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': login.csrfToken }, body: patchBody });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'VERSION_CONFLICT');
  assert.ok(app.queries.every((query) => !query.includes('synthetic-dashboard-password')));
});

test('dashboard rejects oversized bodies and rate-limits failed login', async (t) => {
  const app = await fixture();
  t.after(() => app.server.close());
  let response = await request(app.base, '/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'x'.repeat(9000) }) });
  assert.equal(response.status, 413);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await request(app.base, '/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }) });
    assert.equal(response.status, 401);
  }
  response = await request(app.base, '/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }) });
  assert.equal(response.status, 429);
});
