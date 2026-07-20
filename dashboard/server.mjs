import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  LoginRateLimiter,
  clearSessionCookie,
  createSession,
  parseCookie,
  sessionCookie,
  verifyPassword,
  verifySession,
} from './auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(root, 'dashboard', 'public');
const MAX_BODY_BYTES = 8 * 1024;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const STATUSES = new Set(['NOT_CONTACTED', 'SENT_WAITING', 'REPLIED', 'INTERESTED', 'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DO_NOT_CONTACT']);
const DELIVERY = new Set(['SMTP_ACCEPTED', 'MOCK', 'SMTP_PENDING', 'SMTP_CLAIMED', 'ERROR', 'NOT_SENT']);
const SORTS = {
  last_sent: "COALESCE(last_smtp_accepted_at, 'epoch'::timestamptz)",
  updated: 'updated_at',
};

function secretPath(name) {
  return process.env[`${name.toUpperCase()}_FILE`] || `/run/secrets/${name}`;
}

async function loadSecret(name, minimum = 1) {
  const value = (await readFile(secretPath(name), 'utf8')).trim();
  if (Buffer.byteLength(value) < minimum) throw new Error(`Invalid ${name} secret`);
  return value;
}

function securityHeaders(contentType) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    'Content-Type': contentType,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function send(res, status, body, contentType = 'application/json; charset=utf-8', extra = {}) {
  const payload = contentType.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(status, { ...securityHeaders(contentType), 'Content-Length': Buffer.byteLength(payload), ...extra });
  res.end(payload);
}

function clientKey(req) {
  return String(req.socket.remoteAddress ?? 'local').slice(0, 80);
}

async function readJson(req) {
  if (String(req.headers['content-type'] ?? '').toLowerCase() !== 'application/json') {
    const error = new Error('CONTENT_TYPE_REQUIRED');
    error.status = 415;
    throw error;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('BODY_TOO_LARGE');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('JSON_INVALID');
    error.status = 400;
    throw error;
  }
}

function encodeCursor(row, sort) {
  const value = sort === 'last_sent' ? (row.last_smtp_accepted_at ?? '1970-01-01T00:00:00.000Z') : row.updated_at;
  return Buffer.from(JSON.stringify({ value, id: Number(row.company_id) }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!cursor.value || !Number.isSafeInteger(cursor.id) || cursor.id < 1) throw new Error();
    const date = new Date(cursor.value);
    if (Number.isNaN(date.getTime())) throw new Error();
    return { value: date.toISOString(), id: cursor.id };
  } catch {
    const error = new Error('CURSOR_INVALID');
    error.status = 400;
    throw error;
  }
}

function camelKey(key) {
  return key.replace(/_([a-z])/gu, (_, letter) => letter.toUpperCase());
}

function publicRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value]));
}

function htmlPage(authenticated) {
  const title = authenticated ? 'Компании — Workoutreach' : 'Вход — Workoutreach';
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/assets/style.css"></head>
<body data-authenticated="${authenticated ? 'true' : 'false'}"><a class="skip-link" href="#main">К содержимому</a>
<div id="app" aria-live="polite"></div><script src="/assets/app.js" defer></script></body></html>`;
}

function originAllowed(req, expectedOrigin) {
  return req.headers.origin === expectedOrigin;
}

function csrfAllowed(req, session) {
  const token = req.headers['x-csrf-token'];
  return typeof token === 'string' && token === session.csrf;
}

function dbError(error) {
  const code = String(error?.message ?? 'DATABASE_ERROR');
  const map = {
    VERSION_CONFLICT: [409, 'VERSION_CONFLICT'],
    COMPANY_CAMPAIGN_NOT_FOUND: [404, 'NOT_FOUND'],
    ENGAGEMENT_STATUS_INVALID: [400, 'ENGAGEMENT_STATUS_INVALID'],
    ACTION_KEY_INVALID: [400, 'ACTION_KEY_INVALID'],
    ACTION_KEY_REUSED: [409, 'ACTION_KEY_REUSED'],
    SAFE_NOTE_TOO_LONG: [400, 'SAFE_NOTE_TOO_LONG'],
    SAFE_NOTE_CONTAINS_PII: [400, 'SAFE_NOTE_CONTAINS_PII'],
    NEXT_ACTION_REQUIRED: [400, 'NEXT_ACTION_REQUIRED'],
    NEXT_ACTION_NOT_ALLOWED: [400, 'NEXT_ACTION_NOT_ALLOWED'],
    EXPECTED_VERSION_INVALID: [400, 'EXPECTED_VERSION_INVALID'],
    SENT_WAITING_SYSTEM_MANAGED: [400, 'SENT_WAITING_SYSTEM_MANAGED'],
    SMTP_ACCEPTANCE_IMMUTABLE: [400, 'SMTP_ACCEPTANCE_IMMUTABLE'],
    DO_NOT_CONTACT_CONFIRMATION_REQUIRED: [400, 'DO_NOT_CONTACT_CONFIRMATION_REQUIRED'],
    DO_NOT_CONTACT_REASON_INVALID: [400, 'DO_NOT_CONTACT_REASON_INVALID'],
    ACCEPTED_RECIPIENT_REQUIRED: [400, 'ACCEPTED_RECIPIENT_REQUIRED'],
    DO_NOT_CONTACT_TERMINAL: [409, 'DO_NOT_CONTACT_TERMINAL'],
  };
  return map[code] ?? [500, 'DATABASE_ERROR'];
}

export function createDashboardServer({ pool, passwordHash, sessionSecret, host = 'dashboard.workoutreach.localhost', publicOrigin = `https://${host}`, port = 3000, now = () => Date.now() }) {
  const expectedOrigin = publicOrigin;
  const limiter = new LoginRateLimiter();

  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== host) return send(res, 421, { error: 'HOST_INVALID' });
      const url = new URL(req.url, expectedOrigin);
      const method = req.method ?? 'GET';
      const session = verifySession(parseCookie(req.headers.cookie, 'workoutreach_session'), sessionSecret, now());

      if (url.pathname === '/healthz') {
        if (method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'GET' });
        await pool.query('SELECT 1');
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/assets/app.js' || url.pathname === '/assets/style.css') {
        if (method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'GET' });
        const filename = url.pathname.endsWith('.js') ? 'app.js' : 'style.css';
        const type = filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
        return send(res, 200, await readFile(join(publicRoot, filename), 'utf8'), type);
      }
      if (url.pathname === '/favicon.ico') {
        if (method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'GET' });
        res.writeHead(204, securityHeaders('image/x-icon'));
        return res.end();
      }

      if (url.pathname === '/auth/login') {
        if (method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'POST' });
        if (!originAllowed(req, expectedOrigin)) return send(res, 403, { error: 'ORIGIN_INVALID' });
        const rate = limiter.check(clientKey(req), now());
        if (!rate.allowed) return send(res, 429, { error: 'LOGIN_RATE_LIMITED' }, undefined, { 'Retry-After': String(rate.retryAfter) });
        const body = await readJson(req);
        if (typeof body.password !== 'string' || !(await verifyPassword(body.password, passwordHash))) {
          limiter.failure(clientKey(req), now());
          return send(res, 401, { error: 'LOGIN_INVALID' });
        }
        limiter.success(clientKey(req));
        const created = createSession(sessionSecret, now());
        return send(res, 200, { ok: true, csrfToken: created.payload.csrf }, undefined, { 'Set-Cookie': sessionCookie(created.token) });
      }

      if (url.pathname === '/auth/logout') {
        if (method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'POST' });
        if (!session) return send(res, 401, { error: 'SESSION_EXPIRED' }, undefined, { 'Set-Cookie': clearSessionCookie() });
        if (!originAllowed(req, expectedOrigin) || !csrfAllowed(req, session)) return send(res, 403, { error: 'REQUEST_FORBIDDEN' });
        return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': clearSessionCookie() });
      }

      if (url.pathname === '/' || url.pathname === '/login') {
        if (method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'GET' });
        return send(res, 200, htmlPage(Boolean(session)), 'text/html; charset=utf-8');
      }

      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'NOT_FOUND' });
      if (!session) return send(res, 401, { error: 'SESSION_EXPIRED' }, undefined, { 'Set-Cookie': clearSessionCookie() });

      if (url.pathname === '/api/session' && method === 'GET') {
        return send(res, 200, { csrfToken: session.csrf, expiresAt: new Date(session.exp).toISOString() });
      }
      if (url.pathname === '/api/stats' && method === 'GET') {
        const result = await pool.query('SELECT * FROM workoutreach.dashboard_stats_v1()');
        return send(res, 200, publicRow(result.rows[0]));
      }
      if (url.pathname === '/api/companies' && method === 'GET') {
        const search = String(url.searchParams.get('q') ?? '').trim();
        if (search.length > 100) return send(res, 400, { error: 'SEARCH_TOO_LONG' });
        const engagement = url.searchParams.get('engagementStatus');
        const delivery = url.searchParams.get('deliveryStatus');
        if (engagement && !STATUSES.has(engagement)) return send(res, 400, { error: 'ENGAGEMENT_STATUS_INVALID' });
        if (delivery && !DELIVERY.has(delivery)) return send(res, 400, { error: 'DELIVERY_STATUS_INVALID' });
        const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
        const sort = Object.hasOwn(SORTS, url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'updated';
        const cursor = decodeCursor(url.searchParams.get('cursor'));
        const from = url.searchParams.get('sentFrom');
        const to = url.searchParams.get('sentTo');
        if (from && Number.isNaN(new Date(from).getTime())) return send(res, 400, { error: 'DATE_INVALID' });
        if (to && Number.isNaN(new Date(to).getTime())) return send(res, 400, { error: 'DATE_INVALID' });

        const values = [];
        const clauses = ["campaign_type = 'career_outreach'"];
        const add = (value) => { values.push(value); return `$${values.length}`; };
        if (search) {
          const p = add(`%${search}%`);
          clauses.push(`(company_name ILIKE ${p} OR canonical_hostname ILIKE ${p} OR recipient_email ILIKE ${p} OR last_job_id ILIKE ${p})`);
        }
        if (engagement) clauses.push(`engagement_status = ${add(engagement)}`);
        if (delivery) clauses.push(`delivery_status = ${add(delivery)}`);
        if (from) clauses.push(`last_smtp_accepted_at >= ${add(new Date(from).toISOString())}::timestamptz`);
        if (to) clauses.push(`last_smtp_accepted_at < ${add(new Date(to).toISOString())}::timestamptz + interval '1 day'`);
        const sortExpression = SORTS[sort];
        if (cursor) clauses.push(`(${sortExpression}, company_id) < (${add(cursor.value)}::timestamptz, ${add(cursor.id)}::bigint)`);
        values.push(limit + 1);
        const result = await pool.query(
          `SELECT company_id,campaign_type,company_name,canonical_hostname,canonical_url,fact,
             masked_recipient_email,last_smtp_accepted_at,delivery_status,engagement_status,safe_note,
             next_action_at,sent_at,send_count,version,last_job_id,job_status,error_code,updated_at,outreach_blocked
           FROM workoutreach.dashboard_company_detail_v1 WHERE ${clauses.join(' AND ')}
           ORDER BY ${sortExpression} DESC, company_id DESC LIMIT $${values.length}`,
          values,
        );
        const hasMore = result.rows.length > limit;
        const rows = result.rows.slice(0, limit);
        return send(res, 200, {
          items: rows.map(publicRow),
          nextCursor: hasMore ? encodeCursor(rows.at(-1), sort) : null,
        });
      }

      const companyMatch = url.pathname.match(/^\/api\/companies\/(\d+)$/u);
      if (companyMatch && method === 'GET') {
        const companyId = Number(companyMatch[1]);
        if (!Number.isSafeInteger(companyId)) return send(res, 404, { error: 'NOT_FOUND' });
        const [detail, timeline] = await Promise.all([
          pool.query("SELECT * FROM workoutreach.dashboard_company_detail_v1 WHERE company_id=$1 AND campaign_type='career_outreach'", [companyId]),
          pool.query("SELECT * FROM workoutreach.dashboard_company_timeline_v1 WHERE company_id=$1 AND campaign_type='career_outreach' ORDER BY created_at DESC LIMIT 200", [companyId]),
        ]);
        if (!detail.rows[0]) return send(res, 404, { error: 'NOT_FOUND' });
        return send(res, 200, { company: publicRow(detail.rows[0]), timeline: timeline.rows.map(publicRow) });
      }

      const statusMatch = url.pathname.match(/^\/api\/companies\/(\d+)\/status$/u);
      if (statusMatch && method === 'PATCH') {
        if (!originAllowed(req, expectedOrigin) || !csrfAllowed(req, session)) return send(res, 403, { error: 'REQUEST_FORBIDDEN' });
        const body = await readJson(req);
        const companyId = Number(statusMatch[1]);
        if (!STATUSES.has(body.engagementStatus) || !Number.isInteger(body.expectedVersion)
            || typeof body.actionKey !== 'string' || !Number.isSafeInteger(companyId)) {
          return send(res, 400, { error: 'PATCH_INVALID' });
        }
        const result = await pool.query(
          `SELECT * FROM workoutreach.dashboard_set_company_status_v1($1,'career_outreach',$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, body.engagementStatus, body.expectedVersion, body.safeNote ?? null,
            body.nextActionAt ?? null, body.actionKey, body.confirmDoNotContact === true,
            body.doNotContactReason ?? null],
        );
        return send(res, 200, { company: publicRow(result.rows[0]) });
      }

      const allowed = url.pathname.endsWith('/status') ? 'PATCH' : 'GET';
      return send(res, 405, { error: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: allowed });
    } catch (error) {
      if (error?.status) return send(res, error.status, { error: error.message });
      const [status, code] = dbError(error);
      if (status === 500) console.error(JSON.stringify({ level: 'error', code: 'DASHBOARD_REQUEST_FAILED' }));
      return send(res, status, { error: code });
    }
  });
  return { server, port, host };
}

async function main() {
  const passwordHash = await loadSecret('dashboard_password_hash', 40);
  const sessionSecret = await loadSecret('dashboard_session_secret', 32);
  const dbPassword = await loadSecret('dashboard_db_password', 24);
  const host = process.env.DASHBOARD_HOST || 'dashboard.workoutreach.localhost';
  const publicOrigin = process.env.DASHBOARD_PUBLIC_ORIGIN || `https://${host}`;
  const port = Number.parseInt(process.env.DASHBOARD_PORT || '3000', 10);
  const pool = new pg.Pool({
    host: process.env.WORKOUTREACH_DB_HOST || 'workoutreach-postgres',
    port: Number.parseInt(process.env.WORKOUTREACH_DB_PORT || '5432', 10),
    database: process.env.WORKOUTREACH_DB_NAME || 'workoutreach_business',
    user: 'workoutreach_dashboard',
    password: dbPassword,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'workoutreach-dashboard',
  });
  const app = createDashboardServer({ pool, passwordHash, sessionSecret, host, publicOrigin, port });
  app.server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ level: 'info', event: 'dashboard_started' })));
  const stop = async () => {
    app.server.close();
    await pool.end();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(JSON.stringify({ level: 'error', code: 'DASHBOARD_START_FAILED' }));
    process.exit(1);
  });
}
