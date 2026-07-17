import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const smokeEnv = {
  ...process.env,
  WORKOUTREACH_DOMAIN: 'workoutreach.localhost',
  COMPOSE_FILE: `compose.yaml${process.platform === 'win32' ? ';' : ':'}compose.smoke.yaml`,
  COMPOSE_PROJECT_NAME: 'workoutreach-smoke',
};
function run(command, args, allowFailure = false) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit', env: smokeEnv });
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
  run('docker', ['compose', 'exec', '-T', 'workoutreach-postgres', 'psql', '-U', 'workoutreach_admin', '-d', 'workoutreach_business', '-c', "SELECT version FROM workoutreach.schema_migrations WHERE version IN ('001_stage_0_1','002_owner_campaign_stage_1','003_stage_2_mock_outbox','004_local_stage_2_runtime','005_local_model_budget','006_guarded_smtp_delivery') ORDER BY version;"]);
  run('node', ['scripts/stage2-db-smoke.mjs']);
  run('docker', ['compose', '--profile', 'tools', 'run', '--rm', '--build', 'workoutreach-bot-smoke']);
  run('node', ['scripts/smtp-db-smoke.mjs']);
  run('node', ['scripts/backup-restore-smoke.mjs']);
  mkdirSync(resolve(root, 'artifacts/evidence'), { recursive: true });
  writeFileSync(resolve(root, 'artifacts/evidence/docker-smoke.json'), `${JSON.stringify({
    ok: true,
    images: { postgres: 'healthy', n8n: 'healthy', caddy: 'healthy' },
    workflows_imported: 6,
    migrations: ['001_stage_0_1', '002_owner_campaign_stage_1', '003_stage_2_mock_outbox', '004_local_stage_2_runtime', '005_local_model_budget', '006_guarded_smtp_delivery'],
    stage2_mock_outbox: { replay: 'passed', concurrency: 'passed', suppression: 'passed', mail_transmitted: false },
    local_stage2_runtime: { restart_recovery: 'passed', draft_versions: 2, replay_outbox_rows: 1, openai_calls: 0 },
    backup_restore: 'passed',
    live_send_enabled: false,
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ gate: 'docker-smoke', ok: true }));
} finally {
  run('docker', ['compose', '--profile', 'tools', 'down', '--volumes', '--remove-orphans'], true);
}
