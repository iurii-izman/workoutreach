import { spawnSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const probe = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', 'workoutreach-postgres'], { cwd: root, encoding: 'utf8' });
if (probe.status !== 0 || probe.stdout.trim() !== 'true') {
  console.log(JSON.stringify({ ok: true, backup: 'not_required', reason: 'database_not_running' }));
  process.exit(0);
}

const applied = spawnSync('docker', ['compose', 'exec', '-T', 'workoutreach-postgres', 'psql', '-XAtq', '-U', 'workoutreach_admin', '-d', 'workoutreach_business', '-c', "SELECT EXISTS(SELECT 1 FROM workoutreach.schema_migrations WHERE version='008_local_operator_dashboard')"], { cwd: root, encoding: 'utf8' });
if (applied.status === 0 && applied.stdout.trim() === 't') {
  console.log(JSON.stringify({ ok: true, backup: 'not_required', reason: 'migration_already_applied' }));
  process.exit(0);
}

const dump = spawnSync('docker', ['compose', 'exec', '-T', 'workoutreach-postgres', 'pg_dump', '-U', 'workoutreach_admin', '-d', 'workoutreach_business', '--format=custom', '--no-owner'], {
  cwd: root,
  encoding: null,
  maxBuffer: 512 * 1024 * 1024,
});
if (dump.status !== 0 || !dump.stdout?.length) throw new Error('Dashboard pre-migration backup failed');
const directory = join(root, '.runtime', 'backups');
await mkdir(directory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const target = join(directory, `pre-dashboard-008-${stamp}.dump`);
await writeFile(target, dump.stdout, { mode: 0o600, flag: 'wx' });
await chmod(target, 0o600);
console.log(JSON.stringify({ ok: true, backup: 'created', path: `.runtime/backups/${target.split(/[\\/]/u).at(-1)}`, contents_logged: false }));
