import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const postgresArgs = ['compose', 'exec', '-T', 'workoutreach-postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'workoutreach_admin', '-d', 'workoutreach_business'];

function run(args, { capture = false } = {}) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(`docker ${args.join(' ')} failed with exit ${result.status ?? 1}${capture ? `: ${result.stderr}` : ''}`);
  return String(result.stdout ?? '').trim();
}

function query(sql) {
  return run([...postgresArgs, '-Atqc', sql], { capture: true });
}

function queryConcurrent(sql) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('docker', [...postgresArgs, '-Atqc', sql], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code !== 0) rejectPromise(new Error(`Concurrent approval failed with exit ${code}: ${stderr}`));
      else resolvePromise(stdout.trim());
    });
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

run(['compose', 'cp', 'tests/integration/stage2-smoke-setup.sql', 'workoutreach-postgres:/tmp/stage2-smoke-setup.sql']);
run([...postgresArgs, '-f', '/tmp/stage2-smoke-setup.sql']);

const replayCallback = query("SELECT callback_data FROM workoutreach.issue_mock_approval_token('WO-STG201',1,101,202)");
const replayFirst = query(`SELECT result_code FROM workoutreach.handle_mock_send_callback(${sqlLiteral(replayCallback)},101,202,'tg:stage2-replay')`);
const replaySecond = query(`SELECT result_code FROM workoutreach.handle_mock_send_callback(${sqlLiteral(replayCallback)},101,202,'tg:stage2-replay')`);
if (replayFirst !== 'MOCK_OUTBOX_CREATED' || replaySecond !== replayFirst) throw new Error('Replay did not return one stable mock result');
const dispatchFirst = query("SELECT result_code FROM workoutreach.dispatch_next_mock_outbox('stage2-smoke-worker')");
const dispatchSecond = query("SELECT result_code FROM workoutreach.dispatch_next_mock_outbox('stage2-smoke-worker')");
if (dispatchFirst !== 'MOCK_ACCEPTED' || dispatchSecond !== '') throw new Error('Mock dispatcher replay contract failed');

const suppressedCallback = query("SELECT callback_data FROM workoutreach.issue_mock_approval_token('WO-STG202',1,101,202)");
const suppressedResult = query(`SELECT result_code FROM workoutreach.handle_mock_send_callback(${sqlLiteral(suppressedCallback)},101,202,'tg:stage2-suppressed')`);
if (suppressedResult !== 'SUPPRESSION_BLOCKED') throw new Error('Suppression was not enforced at approval');

const concurrentCallback = query("SELECT callback_data FROM workoutreach.issue_mock_approval_token('WO-STG203',1,101,202)");
const concurrentSql = (key) => `SELECT result_code FROM workoutreach.handle_mock_send_callback(${sqlLiteral(concurrentCallback)},101,202,${sqlLiteral(key)})`;
const concurrentResults = await Promise.all([
  queryConcurrent(concurrentSql('tg:stage2-concurrent')),
  queryConcurrent(concurrentSql('tg:stage2-concurrent')),
]);
if (!concurrentResults.every((result) => result === 'MOCK_OUTBOX_CREATED')) throw new Error('Concurrent replay did not return one stable mock result');
query("INSERT INTO workoutreach.suppression(recipient_hmac,reason,source,safe_note) VALUES (repeat('c',64),'OWNER_BLOCK','operator','Synthetic dispatch-time suppression') ON CONFLICT (recipient_hmac) DO NOTHING RETURNING recipient_hmac");
const dispatchSuppressed = query("SELECT result_code FROM workoutreach.dispatch_next_mock_outbox('stage2-smoke-worker')");
const dispatchAfterSuppression = query("SELECT result_code FROM workoutreach.dispatch_next_mock_outbox('stage2-smoke-worker')");
if (dispatchSuppressed !== 'SUPPRESSION_BLOCKED' || dispatchAfterSuppression !== '') throw new Error('Dispatch-time suppression contract failed');

run(['compose', 'cp', 'tests/integration/stage2-smoke-assert.sql', 'workoutreach-postgres:/tmp/stage2-smoke-assert.sql']);
const assertion = run([...postgresArgs, '-Atqf', '/tmp/stage2-smoke-assert.sql'], { capture: true });

const evidence = {
  ok: true,
  replay: { first: replayFirst, second: replaySecond, outbox_rows: 1 },
  suppression: { approval_result: suppressedResult, approval_outbox_rows: 0, dispatch_result: dispatchSuppressed },
  concurrency: { results: concurrentResults.sort(), outbox_rows: 1 },
  dispatch: { first: dispatchFirst, immediate_replay: 'NO_WORK', after_late_suppression: dispatchSuppressed, final: 'NO_WORK' },
  safety: { transport: 'mock', mail_transmitted: false, live_send_enabled: false, daily_send_limit: 0 },
  database_assertion: assertion,
};
mkdirSync(resolve(root, 'artifacts/evidence'), { recursive: true });
writeFileSync(resolve(root, 'artifacts/evidence/stage2-db-smoke.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ gate: 'stage2-db-smoke', ...evidence }, null, 2));
