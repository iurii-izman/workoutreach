import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testDatabase = 'workoutreach_restore_smoke';
const dumpPath = '/tmp/workoutreach-business-smoke.dump';

function docker(args, { allowFailure = false, capture = false } = {}) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'workoutreach-postgres', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0 && !allowFailure) throw new Error(`Docker backup/restore command failed with exit ${result.status ?? 1}${capture ? `: ${result.stderr}` : ''}`);
  return String(result.stdout ?? '').trim();
}

function dropTestDatabase() {
  docker(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'workoutreach_admin', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE);`], { allowFailure: true });
}

try {
  dropTestDatabase();
  docker(['pg_dump', '-U', 'workoutreach_admin', '-d', 'workoutreach_business', '--format=custom', '--file', dumpPath]);
  docker(['createdb', '-U', 'workoutreach_admin', '--owner=workoutreach_app', testDatabase]);
  docker(['pg_restore', '-U', 'workoutreach_admin', '-d', testDatabase, '--exit-on-error', dumpPath]);
  const restored = docker([
    'psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-U', 'workoutreach_admin', '-d', testDatabase,
    '-c', "SELECT json_build_object('migration_count', count(*), 'has_stage2', bool_or(version = '003_stage_2_mock_outbox'), 'has_local_runtime', bool_or(version = '004_local_stage_2_runtime'), 'has_model_budget', bool_or(version = '005_local_model_budget'), 'has_smtp', bool_or(version = '006_guarded_smtp_delivery'), 'has_stage3_sendability', bool_or(version = '007_stage_3_template_sendability'), 'has_dashboard', bool_or(version = '008_local_operator_dashboard')) FROM workoutreach.schema_migrations;",
  ], { capture: true });
  if (!restored.includes('"has_stage2" : true') || !restored.includes('"has_local_runtime" : true') || !restored.includes('"has_model_budget" : true') || !restored.includes('"has_smtp" : true') || !restored.includes('"has_stage3_sendability" : true') || !restored.includes('"has_dashboard" : true')) throw new Error('Restored database is missing a required migration');
  const evidence = { ok: true, source_database: 'workoutreach_business', restore_database: testDatabase, format: 'custom', restored_check: restored };
  mkdirSync(resolve(root, 'artifacts/evidence'), { recursive: true });
  writeFileSync(resolve(root, 'artifacts/evidence/backup-restore-smoke.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ gate: 'backup-restore-smoke', ...evidence }, null, 2));
} finally {
  dropTestDatabase();
  docker(['rm', '-f', dumpPath], { allowFailure: true });
}
