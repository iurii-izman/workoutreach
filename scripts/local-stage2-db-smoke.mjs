import { readFile } from 'node:fs/promises';
import { createFixtureFetcher, createModelStub } from '../n8n/code/lib/fixture-adapters.mjs';
import { analyzeDryRun, loadOfferProfile } from '../n8n/code/lib/pipeline.mjs';
import { PostgresBotStore } from '../n8n/code/lib/postgres-store.mjs';
import pg from 'pg';

const { Pool } = pg;
const root = new URL('../', import.meta.url).pathname;
const jobId = 'WO-LOC201';
const userId = '91001';
const chatId = '92002';
const suppressionHmacKey = (await readFile('/run/secrets/suppression_hmac_key', 'utf8')).trim();
const password = (await readFile('/run/secrets/business_db_password', 'utf8')).trim();

function pool() {
  return new Pool({
    host: 'workoutreach-postgres', port: 5432, database: 'workoutreach_business', user: 'workoutreach_app', password,
    max: 4, application_name: 'workoutreach-local-stage2-smoke',
  });
}

async function cleanup(activePool) {
  await activePool.query('DELETE FROM workoutreach.message_events WHERE job_id=$1', [jobId]);
  await activePool.query('DELETE FROM workoutreach.outbox WHERE job_id=$1', [jobId]);
  await activePool.query('DELETE FROM workoutreach.operator_actions WHERE job_id=$1', [jobId]);
  await activePool.query('DELETE FROM workoutreach.jobs WHERE job_id=$1', [jobId]);
}

let firstPool = pool();
let store = new PostgresBotStore({ pool: firstPool, suppressionHmacKey, modelId: 'synthetic-model' });
try {
  await store.verifyReady();
  await cleanup(firstPool);
  await store.syncAllowlist({ userIds: new Set([userId]), chatIds: new Set([chatId]) });
  await store.beginJob({ updateId: 920001, jobId, inputUrl: 'https://synthetic-company.example/', userId, chatId });
  await store.reserveAnalysis(jobId, 1, 5);

  const offerProfile = await loadOfferProfile(root, 'fixtures/offer-profile.synthetic-eval.v1.yaml');
  const analyze = async (seed) => analyzeDryRun({
    root,
    inputUrl: 'https://synthetic-company.example/',
    fetcher: await createFixtureFetcher(root, 'synthetic-company'),
    modelAdapter: await createModelStub(root, 'synthetic-company'),
    offerProfile,
    seed,
    jobId,
  });

  const first = await analyze('local-stage2-v1');
  const persistedFirst = await store.persistAnalysis(first, { draftVersion: 1, userId, chatId });
  await store.close();

  const secondPool = pool();
  firstPool = secondPool;
  store = new PostgresBotStore({ pool: secondPool, suppressionHmacKey, modelId: 'synthetic-model' });
  await store.verifyReady();
  const afterRestart = await store.getAuthorizedJob(jobId, userId, chatId);
  if (afterRestart?.status !== 'DRAFT_READY' || Number(afterRestart.draft_version) !== 1) throw new Error('Draft did not survive store restart');

  const regeneration = await store.applyReviewAction({
    callbackData: persistedFirst.callbacks.regenerate, userId, chatId, updateId: 920002,
  });
  if (regeneration.result_code !== 'REGENERATION_STARTED' || regeneration.job_status !== 'ANALYZING') throw new Error('Regeneration did not enter ANALYZING');
  await store.reserveAnalysis(jobId, 2, 5);
  const second = await analyze('local-stage2-v2');
  const persistedSecond = await store.persistAnalysis(second, { draftVersion: 2, userId, chatId });

  const approved = await store.approveMock({ callbackData: persistedSecond.callbacks.send, userId, chatId, updateId: 920003 });
  const replay = await store.approveMock({ callbackData: persistedSecond.callbacks.send, userId, chatId, updateId: 920003 });
  if (approved.result_code !== 'MOCK_OUTBOX_CREATED' || replay.result_code !== approved.result_code) throw new Error('Mock approval replay contract failed');

  const counts = await secondPool.query(
    `SELECT
       (SELECT count(*)::int FROM workoutreach.drafts WHERE job_id=$1) AS drafts,
       (SELECT count(*)::int FROM workoutreach.analyses WHERE job_id=$1) AS analyses,
       (SELECT count(*)::int FROM workoutreach.outbox WHERE job_id=$1) AS outbox,
       (SELECT status FROM workoutreach.jobs WHERE job_id=$1) AS status`,
    [jobId],
  );
  const row = counts.rows[0];
  if (row.drafts !== 2 || row.analyses !== 6 || row.outbox !== 1 || row.status !== 'APPROVED') throw new Error('Persisted local runtime counts are invalid');

  console.log(JSON.stringify({
    gate: 'local-stage2-db-smoke', ok: true, restart_recovery: true,
    draft_versions: row.drafts, immutable_analysis_rows: row.analyses,
    replay_outbox_rows: row.outbox, final_job_status: row.status,
    openai_calls: 0, telegram_calls: 0, mail_transmitted: false,
  }, null, 2));
} finally {
  await cleanup(firstPool).catch(() => {});
  await store.close().catch(() => {});
}
