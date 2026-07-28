import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  return spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

const names = ['workoutreach-postgres', 'workoutreach-n8n', 'workoutreach-proxy', 'workoutreach-dashboard', 'workoutreach-bot'];
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
    '-c', "SELECT json_build_object('migration_004',bool_or(version='004_local_stage_2_runtime'),'migration_005',bool_or(version='005_local_model_budget'),'migration_006',bool_or(version='006_guarded_smtp_delivery'),'migration_007',bool_or(version='007_stage_3_template_sendability'),'migration_008',bool_or(version='008_local_operator_dashboard'),'migration_009',bool_or(version='009_owner_daily_capacity'),'migration_010',bool_or(version='010_immutable_migration_registry'),'migration_011',bool_or(version='011_pilot_contact_resolution'),'migration_012',bool_or(version='012_universal_first_resilience'),'jobs',(SELECT count(*) FROM workoutreach.jobs),'mock_outbox',(SELECT count(*) FROM workoutreach.outbox WHERE transport='mock'),'smtp_outbox',(SELECT count(*) FROM workoutreach.outbox WHERE transport='smtp'),'model_runs_today',(SELECT count(*) FROM workoutreach.model_runs WHERE run_date=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date),'mail',(SELECT json_build_object('enabled',live_send_enabled,'transport',mail_transport,'daily_limit',daily_send_limit,'kill_switch',kill_switch_enabled) FROM workoutreach.mail_runtime_controls WHERE singleton)) FROM workoutreach.schema_migrations;",
  ]);
  if (query.status === 0) database = { reachable: true, ...JSON.parse(query.stdout.trim()) };
}

const ok = containers['workoutreach-postgres'].health === 'healthy'
  && containers['workoutreach-n8n'].health === 'healthy'
  && containers['workoutreach-proxy'].health === 'healthy'
  && containers['workoutreach-dashboard'].health === 'healthy'
  && containers['workoutreach-bot'].health === 'healthy'
  && database.reachable
  && database.migration_004 === true
  && database.migration_005 === true
  && database.migration_006 === true
  && database.migration_007 === true
  && database.migration_008 === true
  && database.migration_009 === true
  && database.migration_010 === true
  && database.migration_011 === true
  && database.migration_012 === true;

console.log(JSON.stringify({
  ok,
  mode: 'local-postgres-long-polling',
  containers,
  database,
  public_webhook: false,
  postgres_public_port: false,
  mail_transport: database.mail?.transport ?? 'unknown',
}, null, 2));
if (!ok) process.exitCode = 1;
