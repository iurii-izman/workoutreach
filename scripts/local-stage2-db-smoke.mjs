import { readFile } from 'node:fs/promises';
import { createFixtureFetcher, createModelStub } from '../n8n/code/lib/fixture-adapters.mjs';
import { analyzeDryRun, loadOfferProfile } from '../n8n/code/lib/pipeline.mjs';
import { PostgresBotStore } from '../n8n/code/lib/postgres-store.mjs';
import pg from 'pg';

const { Pool } = pg;
const root = new URL('../', import.meta.url).pathname;
const jobId = 'WO-LOC201';
const contactJobId = 'WO-CNT201';
const manualJobId = 'WO-MAN201';
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
  for (const id of [jobId, contactJobId, manualJobId]) {
    await activePool.query('DELETE FROM workoutreach.message_events WHERE job_id=$1', [id]);
    await activePool.query('DELETE FROM workoutreach.outbox WHERE job_id=$1', [id]);
    await activePool.query('DELETE FROM workoutreach.operator_actions WHERE job_id=$1', [id]);
    await activePool.query('DELETE FROM workoutreach.jobs WHERE job_id=$1', [id]);
  }
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
  await store.failJob(jobId, 'PHRASE_SENTENCE_COUNT');
  const resumeFact = await store.getResumeFact(jobId, userId, chatId);
  if (!resumeFact?.fact || resumeFact.decision !== 'READY_FOR_REVIEW') throw new Error('Verified fact was not available for retry resume');
  const retry = await store.prepareRetry({ jobId, userId, chatId, updateId: 920003 });
  const retryReplay = await store.prepareRetry({ jobId, userId, chatId, updateId: 920003 });
  if (retry.result_code !== 'RETRY_STARTED' || retry.draft_version !== 2 || retryReplay.replay !== true) throw new Error('Failed-job retry contract failed');
  await store.reserveAnalysis(jobId, 2, 5);
  const second = await analyze('local-stage2-v2');
  const persistedSecond = await store.persistAnalysis(second, { draftVersion: 2, userId, chatId });

  const approved = await store.approveMock({ callbackData: persistedSecond.callbacks.send, userId, chatId, updateId: 920004 });
  const replay = await store.approveMock({ callbackData: persistedSecond.callbacks.send, userId, chatId, updateId: 920004 });
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

  await store.beginJob({ updateId: 920010, jobId: contactJobId, inputUrl: 'https://synthetic-company.example/', userId, chatId });
  const fixtureFetcher = await createFixtureFetcher(root, 'synthetic-company');
  const ambiguousFetcher = async (url) => {
    const response = await fixtureFetcher(url);
    if (new URL(url).pathname !== '/contacts') return response;
    const body = response.body.replace('</body>', '<a href="mailto:info@synthetic-company.example">Info</a></body>');
    return { ...response, body, bytes: Buffer.byteLength(body) };
  };
  const review = await analyzeDryRun({
    root, inputUrl: 'https://synthetic-company.example/', fetcher: ambiguousFetcher,
    modelAdapter: await createModelStub(root, 'synthetic-company'), offerProfile, jobId: contactJobId,
  });
  if (review.status !== 'NEEDS_REVIEW') throw new Error('Ambiguous contact did not stop before model analysis');
  const persistedReview = await store.persistContactReview(review, { userId, chatId });
  const selectedCandidate = persistedReview.candidates.find((candidate) => candidate.email === 'info@synthetic-company.example');
  if (!selectedCandidate?.callbackData?.startsWith(`contact:${contactJobId}:`)) throw new Error('Contact review callback was not issued');
  const selectedContact = await store.selectPublishedContact({ callbackData: selectedCandidate.callbackData, userId, chatId, updateId: 920011 });
  if (selectedContact.result_code !== 'CONTACT_SELECTED' || selectedContact.selection?.type !== 'published') throw new Error('Published contact selection failed');
  await store.reserveAnalysis(contactJobId, 1, 5);
  const selectedDraft = await analyzeDryRun({
    root, inputUrl: selectedContact.canonical_url, fetcher: ambiguousFetcher,
    modelAdapter: await createModelStub(root, 'synthetic-company'), offerProfile, jobId: contactJobId,
    contactSelection: selectedContact.selection,
  });
  await store.persistAnalysis(selectedDraft, { draftVersion: 1, userId, chatId });
  const contactState = await store.getAuthorizedJob(contactJobId, userId, chatId);
  if (contactState?.status !== 'DRAFT_READY') throw new Error('Selected contact did not continue to a persisted draft');

  await store.beginJob({ updateId: 920020, jobId: manualJobId, inputUrl: 'https://synthetic-company.example/', userId, chatId });
  const noContactFetcher = async (url) => {
    const response = await fixtureFetcher(url);
    if (!String(response.contentType).startsWith('text/html')) return response;
    const body = response.body.replaceAll('hello@synthetic-company.example', 'contact-form');
    return { ...response, body, bytes: Buffer.byteLength(body) };
  };
  const noContact = await analyzeDryRun({
    root, inputUrl: 'https://synthetic-company.example/', fetcher: noContactFetcher,
    modelAdapter: await createModelStub(root, 'synthetic-company'), offerProfile, jobId: manualJobId,
  });
  if (noContact.status !== 'NEEDS_CONTACT') throw new Error('Missing contact did not stop before model analysis');
  await store.persistContactReview(noContact, { userId, chatId });
  const manual = await store.selectManualContact({ jobId: manualJobId, email: 'known@manual.example', userId, chatId, updateId: 920021 });
  if (manual.provenance !== 'manual' || manual.selection?.type !== 'manual') throw new Error('Manual contact provenance was not explicit');
  await store.reserveAnalysis(manualJobId, 1, 5);
  const manualDraft = await analyzeDryRun({
    root, inputUrl: manual.canonical_url, fetcher: noContactFetcher,
    modelAdapter: await createModelStub(root, 'synthetic-company'), offerProfile, jobId: manualJobId,
    contactSelection: manual.selection,
  });
  await store.persistAnalysis(manualDraft, { draftVersion: 1, userId, chatId });
  const manualState = await secondPool.query(
    `SELECT j.status,c.category,c.provenance FROM workoutreach.jobs j
     JOIN workoutreach.contact_candidates c ON c.job_id=j.job_id AND c.normalized_email='known@manual.example'
     WHERE j.job_id=$1`, [manualJobId],
  );
  if (manualState.rows[0]?.status !== 'DRAFT_READY' || manualState.rows[0]?.category !== 'manual' || manualState.rows[0]?.provenance !== 'manual') throw new Error('Manual contact was not persisted as manual');

  console.log(JSON.stringify({
    gate: 'local-stage2-db-smoke', ok: true, restart_recovery: true,
    draft_versions: row.drafts, immutable_analysis_rows: row.analyses,
    replay_outbox_rows: row.outbox, final_job_status: row.status,
    failed_job_retry: { resumed: true, idempotent: true, verified_fact_reusable: true },
    contact_review: { pre_model_stop: true, hashed_callback: true, published_selection: true, manual_provenance: true, final_status: contactState.status },
    openai_calls: 0, telegram_calls: 0, mail_transmitted: false,
  }, null, 2));
} finally {
  await cleanup(firstPool).catch(() => {});
  await store.close().catch(() => {});
}
