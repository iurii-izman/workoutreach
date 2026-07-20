import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['dashboard_db_password', 'dashboard_password_hash', 'dashboard_session_secret']) {
  try { await access(join(root, '.secrets', name)); } catch { throw new Error('Run npm run dashboard:setup first'); }
}
const result = spawnSync('docker', ['compose', 'up', '-d', '--build', 'workoutreach-dashboard', 'workoutreach-proxy'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ ok: true, url: 'https://dashboard.workoutreach.localhost' }));
