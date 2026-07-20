import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPasswordHash } from '../dashboard/auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const syntheticPassword = 'Synthetic-Dashboard-QA-2026';
const compose = ['compose', '-f', 'compose.yaml', '-f', 'compose.smoke.yaml', '-f', 'compose.dashboard-smoke.yaml', '-p', 'workoutreach-dashboard-smoke'];
const smokeDir = resolve(root, 'artifacts/dashboard-smoke');
await mkdir(smokeDir, { recursive: true });
await writeFile(resolve(smokeDir, 'dashboard_password_hash'), `${await createPasswordHash(syntheticPassword)}\n`, { mode: 0o600 });

function run(args, { allowFailure = false, input = undefined, capture = false } = {}) {
  const result = spawnSync(args[0], args.slice(1), { cwd: root, input, encoding: 'utf8', stdio: capture ? 'pipe' : (input ? ['pipe', 'inherit', 'inherit'] : 'inherit') });
  if (result.status !== 0 && !allowFailure) throw new Error(`${args[0]} failed with exit ${result.status ?? 1}`);
  return result.stdout ?? '';
}

function request(path, { method = 'GET', body, cookie, csrf } = {}) {
  return new Promise((resolveRequest, reject) => {
    const headers = { Host: 'dashboard.workoutreach.localhost', Origin: 'https://dashboard.workoutreach.localhost:8443' };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const req = httpsRequest({ hostname: '127.0.0.1', port: 8443, servername: 'dashboard.workoutreach.localhost', path, method, headers, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolveRequest({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

run(['node', 'scripts/bootstrap-dev-secrets.mjs']);
try {
  run(['docker', ...compose, 'up', '-d', '--build', 'workoutreach-postgres', 'workoutreach-dashboard']);
  run(['docker', ...compose, '--profile', 'tools', 'run', '--rm', 'workoutreach-dashboard-provision']);
  run(['docker', ...compose, '--profile', 'tools', 'run', '--rm', 'workoutreach-migrate']);
  const fixture = await readFile(resolve(root, 'tests/integration/dashboard-browser-fixture.sql'), 'utf8');
  run(['docker', ...compose, 'exec', '-T', 'workoutreach-postgres', 'psql', '-Xq', '-U', 'workoutreach_admin', '-d', 'workoutreach_business'], { input: fixture });
  run(['docker', ...compose, 'up', '-d', 'workoutreach-n8n', 'workoutreach-proxy']);

  let health;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { health = await request('/healthz'); if (health.status === 200) break; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  if (health?.status !== 200) throw new Error('Dashboard HTTPS health check failed');
  const login = await request('/auth/login', { method: 'POST', body: JSON.stringify({ password: syntheticPassword }) });
  if (login.status !== 200) throw new Error('Dashboard synthetic login failed');
  const session = JSON.parse(login.body);
  const cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0];
  if (!cookie || !session.csrfToken) throw new Error('Dashboard secure session missing');
  const list = await request('/api/companies?engagementStatus=SENT_WAITING&limit=50', { cookie });
  const parsedList = JSON.parse(list.body);
  if (list.status !== 200 || parsedList.items.length !== 1 || parsedList.items[0].deliveryStatus !== 'SMTP_ACCEPTED') throw new Error('Dashboard SMTP list contract failed');
  const company = parsedList.items[0];
  const update = await request(`/api/companies/${company.companyId}/status`, { method: 'PATCH', cookie, csrf: session.csrfToken, body: JSON.stringify({
    engagementStatus: 'REPLIED', expectedVersion: company.version, safeNote: 'Synthetic visual smoke', nextActionAt: null,
    actionKey: 'dashboard:visual:smoke:0001',
  }) });
  if (update.status !== 200 || JSON.parse(update.body).company.engagementStatus !== 'REPLIED') throw new Error('Dashboard synthetic status update failed');
  const logout = await request('/auth/logout', { method: 'POST', cookie, csrf: session.csrfToken });
  if (logout.status !== 200) throw new Error('Dashboard logout failed');

  const inspect = JSON.parse(run(['docker', 'inspect', 'workoutreach-smoke-dashboard'], { capture: true }))[0];
  const networks = Object.keys(inspect.NetworkSettings.Networks);
  const portBindings = Object.keys(inspect.HostConfig.PortBindings ?? {});
  if (networks.length !== 1 || !networks[0].endsWith('_workoutreach_internal') || portBindings.length !== 0) throw new Error('Dashboard network/port isolation failed');
  console.log(JSON.stringify({ gate: 'dashboard-docker-smoke', ok: true, url: 'https://dashboard.workoutreach.localhost:8443', synthetic_only: true, login: true, logout: true, status_update: true, smtp_rows: 1, external_calls: 0, kept_running: keep }));
} finally {
  if (!keep) run(['docker', ...compose, '--profile', 'tools', 'down', '--volumes', '--remove-orphans'], { allowFailure: true });
}
