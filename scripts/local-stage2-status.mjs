import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  return spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

const names = ['workoutreach-postgres', 'workoutreach-n8n', 'workoutreach-proxy', 'workoutreach-bot'];
const containers = {};
for (const name of names) {
  const inspected = run('docker', ['inspect', '--format', '{{json .State}}', name]);
  if (inspected.status !== 0) containers[name] = { present: false, running: false, health: null };
  else {
    const state = JSON.parse(inspected.stdout.trim());
    containers[name] = { present: true, running: state.Running === true, health: state.Health?.Status ?? null };
  }
}

let database = { reachable: false };
if (containers['workoutreach-postgres'].running) {
  const query = run('docker', [
    'compose', '-f', 'compose.yaml', '-f', 'compose.local.yaml', 'exec', '-T', 'workoutreach-postgres',
    'psql', '-X', '-Atq', '-U', 'workoutreach_admin', '-d', 'workoutreach_business',
    '-c', "SELECT json_build_object('migration_004',bool_or(version='004_local_stage_2_runtime'),'migration_005',bool_or(version='005_local_model_budget'),'jobs',(SELECT count(*) FROM workoutreach.jobs),'mock_outbox',(SELECT count(*) FROM workoutreach.outbox),'model_runs_today',(SELECT count(*) FROM workoutreach.model_runs WHERE run_date=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date)) FROM workoutreach.schema_migrations;",
  ]);
  if (query.status === 0) database = { reachable: true, ...JSON.parse(query.stdout.trim()) };
}

const ok = containers['workoutreach-postgres'].health === 'healthy'
  && containers['workoutreach-n8n'].health === 'healthy'
  && containers['workoutreach-bot'].health === 'healthy'
  && database.reachable
  && database.migration_004 === true
  && database.migration_005 === true;

console.log(JSON.stringify({
  ok,
  mode: 'local-postgres-long-polling',
  containers,
  database,
  public_webhook: false,
  postgres_public_port: false,
  mail_transport: 'disabled',
}, null, 2));
if (!ok) process.exitCode = 1;
