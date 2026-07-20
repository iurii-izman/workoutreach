import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPasswordHash } from '../dashboard/auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.secrets');
await mkdir(target, { recursive: true });
let created = 0;
let reused = 0;
for (const [name, bytes] of [['postgres_admin_password', 32], ['n8n_db_password', 32], ['business_db_password', 32], ['n8n_encryption_key', 48], ['suppression_hmac_key', 48], ['dashboard_db_password', 32], ['dashboard_session_secret', 48]]) {
  const path = join(target, name);
  try {
    await writeFile(path, `${randomBytes(bytes).toString('base64url')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    created += 1;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = (await readFile(path, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{32,}$/u.test(existing)) throw new Error(`Existing development secret ${name} is invalid; rotate it with the documented destructive reset procedure`);
    await chmod(path, 0o600);
    reused += 1;
  }
}
const dashboardHashPath = join(target, 'dashboard_password_hash');
try {
  await writeFile(dashboardHashPath, `${await createPasswordHash(randomBytes(32).toString('base64url'))}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  created += 1;
} catch (error) {
  if (error?.code !== 'EEXIST') throw error;
  const existing = (await readFile(dashboardHashPath, 'utf8')).trim();
  if (!existing.startsWith('scrypt$16384$8$1$')) throw new Error('Existing development secret dashboard_password_hash is invalid');
  await chmod(dashboardHashPath, 0o600);
  reused += 1;
}
console.log(JSON.stringify({ ok: true, mode: 'local-development-only', files: 8, created, reused, path: '.secrets', secrets_rotated: false }));
