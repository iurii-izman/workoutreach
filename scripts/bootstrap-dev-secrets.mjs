import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.secrets');
await mkdir(target, { recursive: true });
for (const [name, bytes] of [['postgres_admin_password', 32], ['n8n_db_password', 32], ['business_db_password', 32], ['n8n_encryption_key', 48]]) {
  await writeFile(join(target, name), `${randomBytes(bytes).toString('base64url')}\n`, { encoding: 'utf8', mode: 0o600 });
}
console.log(JSON.stringify({ ok: true, mode: 'ephemeral-development-only', files: 4, path: '.secrets' }));
