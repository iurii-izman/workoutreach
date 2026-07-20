import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(resolve(root, 'tests/integration/dashboard-smoke.sql'));
const result = spawnSync('docker', ['compose', 'exec', '-T', 'workoutreach-postgres', 'psql', '-X', '-q', '-U', 'workoutreach_admin', '-d', 'workoutreach_business'], {
  cwd: root,
  input: sql,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'Dashboard database smoke failed\n');
  process.exit(result.status ?? 1);
}
console.log(JSON.stringify({ gate: 'dashboard-db-smoke', ok: true, synthetic_only: true, transaction: 'rolled_back', external_calls: 0 }));
