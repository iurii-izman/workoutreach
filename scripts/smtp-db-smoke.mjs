import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = ['compose', 'exec', '-T', 'workoutreach-postgres', 'psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-U', 'workoutreach_admin', '-d', 'workoutreach_business'];
function query(sql) {
  const result = spawnSync('docker', [...base, '-c', sql], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) throw new Error(`SMTP DB smoke failed: ${result.stderr}`);
  return result.stdout.trim();
}
function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }

const jobId = 'WO-SMTP01';
try {
  query(`DELETE FROM workoutreach.outbox WHERE job_id='${jobId}'; DELETE FROM workoutreach.operator_actions WHERE job_id='${jobId}'; DELETE FROM workoutreach.jobs WHERE job_id='${jobId}'; SELECT workoutreach.configure_local_smtp_runtime(true,1); INSERT INTO workoutreach.operator_allowlist(telegram_user_id,telegram_chat_id,enabled) VALUES(93001,94001,true) ON CONFLICT(telegram_user_id,telegram_chat_id) DO UPDATE SET enabled=true; INSERT INTO workoutreach.jobs(job_id,canonical_url,hostname,telegram_user_id,telegram_chat_id,status,expires_at) VALUES('${jobId}','https://smtp-smoke.example/','smtp-smoke.example',93001,94001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour'); INSERT INTO workoutreach.drafts(job_id,draft_version,recipient_email,recipient_hmac,subject,body_text,body_html,template_version,template_sha256,sendable) VALUES('${jobId}',1,'recipient@smtp-smoke.example',repeat('d',64),'Synthetic SMTP','Synthetic body','<p>Synthetic body</p>','synthetic',repeat('e',64),false);`);
  const callback = query(`SELECT callback_data FROM workoutreach.issue_local_review_token('${jobId}',1,'smtp_send',93001,94001)`);
  const approved = query(`SELECT result_code FROM workoutreach.handle_smtp_send_callback(${literal(callback)},93001,94001,'tg:smtp-smoke')`);
  const replay = query(`SELECT result_code FROM workoutreach.handle_smtp_send_callback(${literal(callback)},93001,94001,'tg:smtp-smoke')`);
  const claimed = query("SELECT outbox_id||':'||job_id FROM workoutreach.claim_next_smtp_outbox('smtp-smoke-worker')");
  const outboxId = Number(claimed.split(':')[0]);
  if (approved !== 'SMTP_OUTBOX_CREATED' || replay !== approved || !Number.isSafeInteger(outboxId)) throw new Error('SMTP approval/replay/claim contract failed');
  const completed = query(`SELECT workoutreach.complete_smtp_outbox(${outboxId},'smtp-smoke-worker','<synthetic@smtp-smoke.example>')`);
  const final = query(`SELECT j.status||':'||o.status FROM workoutreach.jobs j JOIN workoutreach.outbox o USING(job_id) WHERE j.job_id='${jobId}'`);
  if (completed !== 't' || final !== 'PROVIDER_ACCEPTED:SMTP_ACCEPTED') throw new Error('SMTP completion contract failed');
  console.log(JSON.stringify({ gate: 'smtp-db-smoke', ok: true, replay_rows: 1, claimed_once: true, provider_accepted: true, mail_transmitted: false }));
} finally {
  query(`DELETE FROM workoutreach.outbox WHERE job_id='${jobId}'; DELETE FROM workoutreach.operator_actions WHERE job_id='${jobId}'; DELETE FROM workoutreach.jobs WHERE job_id='${jobId}'; SELECT workoutreach.configure_local_smtp_runtime(false,0);`);
}
