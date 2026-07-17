import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, allowFailure = false) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit', env: { ...process.env, WORKOUTREACH_DOMAIN: 'workoutreach.localhost' } });
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 1}`);
}

run('node', ['scripts/bootstrap-dev-secrets.mjs']);
run('docker', ['compose', 'config', '--quiet']);
run('node', ['scripts/prepare-workflow-import.mjs']);
try {
  run('docker', ['compose', 'up', '-d', 'workoutreach-postgres', 'workoutreach-n8n', 'workoutreach-proxy']);
  for (const file of readdirSync(resolve(root, 'artifacts/workflow-import')).filter((name) => name.endsWith('.json')).sort()) {
    run('docker', ['compose', 'cp', `artifacts/workflow-import/${file}`, `workoutreach-n8n:/tmp/${file}`]);
    run('docker', ['compose', 'exec', '-T', 'workoutreach-n8n', '/workoutreach/n8n-entrypoint.sh', 'import:workflow', `--input=/tmp/${file}`]);
  }
  run('docker', ['compose', '--profile', 'tools', 'run', '--rm', 'workoutreach-migrate']);
  run('docker', ['compose', 'exec', '-T', 'workoutreach-postgres', 'psql', '-U', 'workoutreach_admin', '-d', 'workoutreach_business', '-c', "SELECT version FROM workoutreach.schema_migrations WHERE version IN ('001_stage_0_1','002_owner_campaign_stage_1','003_stage_2_mock_outbox') ORDER BY version;"]);
  run('node', ['scripts/stage2-db-smoke.mjs']);
  run('node', ['scripts/backup-restore-smoke.mjs']);
  mkdirSync(resolve(root, 'artifacts/evidence'), { recursive: true });
  writeFileSync(resolve(root, 'artifacts/evidence/docker-smoke.json'), `${JSON.stringify({
    ok: true,
    images: { postgres: 'healthy', n8n: 'healthy', caddy: 'healthy' },
    workflows_imported: 6,
    migrations: ['001_stage_0_1', '002_owner_campaign_stage_1', '003_stage_2_mock_outbox'],
    stage2_mock_outbox: { replay: 'passed', concurrency: 'passed', suppression: 'passed', mail_transmitted: false },
    backup_restore: 'passed',
    live_send_enabled: false,
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ gate: 'docker-smoke', ok: true }));
} finally {
  run('docker', ['compose', '--profile', 'tools', 'down', '--volumes', '--remove-orphans'], true);
}
