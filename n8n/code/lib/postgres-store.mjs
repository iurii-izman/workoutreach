import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { recipientFingerprint } from './approval.mjs';
import { normalizeExplicitEmail } from './contacts.mjs';
import { SafeStop } from './errors.mjs';
import { sha256, stableJson } from './normalize.mjs';

const { Pool } = pg;

function asInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new SafeStop('DATABASE_INPUT_INVALID', `${name} must be a safe integer`);
  return parsed;
}

function modelId(metadata, fallback) {
  return String(metadata?.model ?? metadata?.model_id ?? fallback ?? 'unknown');
}

function attachmentColumns(attachment) {
  if (attachment?.status !== 'VALIDATED') return [null, null, null, null];
  return [attachment.filename, attachment.mime_type, attachment.sha256, attachment.bytes];
}

export function createPostgresPoolFromEnv(env = process.env) {
  const password = env.WORKOUTREACH_DB_PASSWORD;
  if (!password) throw new SafeStop('DATABASE_CREDENTIAL_MISSING', 'Business database password is required');
  return new Pool({
    host: env.WORKOUTREACH_DB_HOST ?? 'workoutreach-postgres',
    port: Number(env.WORKOUTREACH_DB_PORT ?? 5432),
    database: env.WORKOUTREACH_DB_NAME ?? 'workoutreach_business',
    user: env.WORKOUTREACH_DB_USER ?? 'workoutreach_app',
    password,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'workoutreach-local-bot',
  });
}

export class PostgresBotStore {
  constructor({ pool, suppressionHmacKey, modelId: configuredModelId = 'gpt-5.6-luna', mailEnabled = false } = {}) {
    if (!pool || !suppressionHmacKey) throw new TypeError('PostgreSQL pool and suppression HMAC key are required');
    this.pool = pool;
    this.suppressionHmacKey = suppressionHmacKey;
    this.configuredModelId = configuredModelId;
    this.mailEnabled = mailEnabled === true;
  }

  async verifyReady() {
    const result = await this.pool.query("SELECT EXISTS(SELECT 1 FROM workoutreach.schema_migrations WHERE version = '004_local_stage_2_runtime') AND EXISTS(SELECT 1 FROM workoutreach.schema_migrations WHERE version = '005_local_model_budget') AND EXISTS(SELECT 1 FROM workoutreach.schema_migrations WHERE version = '006_guarded_smtp_delivery') AND EXISTS(SELECT 1 FROM workoutreach.schema_migrations WHERE version = '007_stage_3_template_sendability') AND EXISTS(SELECT 1 FROM workoutreach.schema_migrations WHERE version = '011_pilot_contact_resolution') AND EXISTS(SELECT 1 FROM workoutreach.schema_migrations WHERE version = '012_universal_first_resilience') AS ready, live_send_enabled, mail_transport, daily_send_limit, kill_switch_enabled FROM workoutreach.stage2_safety_controls WHERE singleton = true");
    const row = result.rows[0];
    if (!row?.ready) throw new SafeStop('DATABASE_MIGRATION_MISSING', 'Local Stage-2 runtime and model-budget migrations are required');
    return true;
  }

  async syncMailRuntime({ enabled = false, dailyLimit = 0 } = {}) {
    await this.pool.query('SELECT workoutreach.configure_local_smtp_runtime($1,$2)', [enabled === true, asInteger(dailyLimit, 'daily_send_limit')]);
    this.mailEnabled = enabled === true;
  }

  async syncAllowlist({ userIds, chatIds }) {
    const users = [...userIds];
    const chats = [...chatIds];
    if (users.length === 0 || users.length !== chats.length) throw new SafeStop('TELEGRAM_ALLOWLIST_INVALID', 'Local runtime requires matching user/chat allowlist pairs');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE workoutreach.operator_allowlist SET enabled = false');
      for (let index = 0; index < users.length; index += 1) {
        await client.query(
          'INSERT INTO workoutreach.operator_allowlist(telegram_user_id,telegram_chat_id,enabled) VALUES($1,$2,true) ON CONFLICT(telegram_user_id,telegram_chat_id) DO UPDATE SET enabled = true',
          [asInteger(users[index], 'telegram_user_id'), asInteger(chats[index], 'telegram_chat_id')],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async beginJob({ updateId, jobId, inputUrl, userId, chatId, ttlHours = 24 }) {
    const canonical = new URL(inputUrl);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const allowed = await client.query(
        'SELECT 1 FROM workoutreach.operator_allowlist WHERE telegram_user_id=$1 AND telegram_chat_id=$2 AND enabled=true',
        [asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
      );
      if (allowed.rowCount !== 1) throw new SafeStop('TELEGRAM_UNAUTHORIZED', 'Telegram user/chat pair is not enabled in PostgreSQL');
      const existingUpdate = await client.query('SELECT job_id,result_code FROM workoutreach.telegram_updates WHERE update_id=$1', [asInteger(updateId, 'update_id')]);
      if (existingUpdate.rowCount === 1) {
        const existingJob = existingUpdate.rows[0].job_id
          ? await client.query('SELECT job_id,canonical_url,status FROM workoutreach.jobs WHERE job_id=$1', [existingUpdate.rows[0].job_id])
          : { rows: [] };
        await client.query('COMMIT');
        return { created: false, replay: true, job: existingJob.rows[0] ?? null };
      }
      await client.query(
        `INSERT INTO workoutreach.jobs(job_id,canonical_url,hostname,telegram_user_id,telegram_chat_id,status,expires_at)
         VALUES($1,$2,$3,$4,$5,'RECEIVED',CURRENT_TIMESTAMP + ($6::text || ' hours')::interval)`,
        [jobId, canonical.href, canonical.hostname, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id'), asInteger(ttlHours, 'ttl_hours')],
      );
      await client.query(
        "INSERT INTO workoutreach.telegram_updates(update_id,telegram_user_id,telegram_chat_id,job_id,result_code) VALUES($1,$2,$3,$4,'RECEIVED')",
        [asInteger(updateId, 'update_id'), asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id'), jobId],
      );
      await client.query("UPDATE workoutreach.jobs SET status='FETCHING' WHERE job_id=$1", [jobId]);
      await client.query("UPDATE workoutreach.jobs SET status='ANALYZING' WHERE job_id=$1", [jobId]);
      await client.query('COMMIT');
      return { created: true, replay: false, job: { job_id: jobId, canonical_url: canonical.href, status: 'ANALYZING' }, draftVersion: 1 };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') throw new SafeStop('JOB_ID_CONFLICT', 'A persisted job already uses this identifier');
      throw error;
    } finally {
      client.release();
    }
  }

  async persistAnalysis(result, { draftVersion = 1, userId, chatId } = {}) {
    const version = asInteger(draftVersion, 'draft_version');
    if (version < 1 || version > 3) throw new SafeStop('DRAFT_VERSION_INVALID', 'Draft version must be between 1 and 3');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM workoutreach.jobs WHERE job_id=$1 FOR UPDATE', [result.job_id]);
      const job = locked.rows[0];
      if (!job || String(job.telegram_user_id) !== String(userId) || String(job.telegram_chat_id) !== String(chatId) || job.status !== 'ANALYZING') {
        throw new SafeStop('DATABASE_JOB_STATE_INVALID', 'Persisted job is not owned or not ready for analysis storage');
      }

      await client.query('DELETE FROM workoutreach.pages WHERE job_id=$1', [result.job_id]);
      await client.query('DELETE FROM workoutreach.contact_candidates WHERE job_id=$1', [result.job_id]);
      await client.query('DELETE FROM workoutreach.phone_candidates WHERE job_id=$1', [result.job_id]);
      for (const page of result.crawl.pages) {
        await client.query(
          `INSERT INTO workoutreach.pages(job_id,source_id,source_url,source_type,title,content_sha256,normalized_text)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [result.job_id, page.source_id, page.source_url, page.source_type, page.title || null, page.content_sha256, page.text],
        );
      }
      for (const contact of result.contact.candidates) {
        await client.query(
          `INSERT INTO workoutreach.contact_candidates(job_id,email,normalized_email,category,source_id,source_url,source_excerpt,automatic_selection_allowed,provenance)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [result.job_id, contact.email, contact.normalized_email, contact.category, contact.source_id, contact.source_url, contact.source_excerpt, contact.automatic_selection_allowed, contact.provenance ?? 'published'],
        );
      }
      for (const phone of result.phone.candidates ?? []) {
        await client.query(
          `INSERT INTO workoutreach.phone_candidates(job_id,phone,normalized_phone,source_id,source_url,source_excerpt,decision)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [result.job_id, phone.phone, phone.normalized_phone, phone.source_id, phone.source_url, phone.source_excerpt, result.phone.decision],
        );
      }

      const deterministicModel = result.analysis.personalization_mode === 'PERSONALIZED'
        ? 'reused-verified-stage'
        : 'deterministic-universal-opening';
      const analysisRows = [
        {
          stage: 'fact',
          model: modelId(result.evidence.fact_model, deterministicModel),
          promptVersion: result.evidence.fact_prompt_version,
          promptSha: result.evidence.fact_prompt_sha256,
          schemaSha: result.evidence.fact_schema_sha256,
          value: {
            company_name: result.analysis.company_name,
            fact: result.analysis.fact,
            source_id: result.analysis.source_id,
            source_excerpt: result.analysis.source_excerpt,
            source_type: result.analysis.source_type,
            published_at: result.analysis.published_at,
            confidence: result.analysis.confidence,
            decision: 'READY_FOR_REVIEW',
            warnings: [],
          },
        },
        {
          stage: 'phrase',
          model: modelId(result.evidence.phrase_model, deterministicModel),
          promptVersion: result.evidence.phrase_prompt_version,
          promptSha: result.evidence.phrase_prompt_sha256,
          schemaSha: result.evidence.phrase_schema_sha256,
          value: {
            personalization_phrase: result.analysis.personalization_phrase,
            overlap: result.analysis.overlap,
            offer_claim_ids: result.analysis.offer_claim_ids,
            word_count: result.analysis.word_count,
          },
        },
        {
          stage: 'aggregate',
          model: `${modelId(result.evidence.fact_model, deterministicModel)}+${modelId(result.evidence.phrase_model, deterministicModel)}`,
          promptVersion: `${result.evidence.fact_prompt_version}+${result.evidence.phrase_prompt_version}`,
          promptSha: sha256(`${result.evidence.fact_prompt_sha256}:${result.evidence.phrase_prompt_sha256}`),
          schemaSha: result.evidence.aggregate_schema_sha256 ?? sha256(stableJson({ fact: result.evidence.fact_schema_sha256, phrase: result.evidence.phrase_schema_sha256 })),
          value: { analysis: result.analysis, evidence: result.evidence },
        },
      ];
      for (const row of analysisRows) {
        await client.query(
          `INSERT INTO workoutreach.analyses(job_id,stage,version,model_id,prompt_version,prompt_sha256,schema_version,schema_sha256,offer_version,offer_sha256,result,decision)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
          [result.job_id, row.stage, version, row.model, row.promptVersion, row.promptSha, row.stage === 'aggregate' ? (result.evidence.aggregate_schema_version ?? 'aggregate.v2') : `${row.stage}.v1`, row.schemaSha, result.evidence.offer_version ?? null, result.evidence.offer_sha256, JSON.stringify(row.value), result.analysis.decision],
        );
      }

      const selected = result.contact.selected;
      const recipientHmac = recipientFingerprint(selected.email, this.suppressionHmacKey);
      const [attachmentFilename, attachmentMime, attachmentSha, attachmentBytes] = attachmentColumns(result.draft.attachment);
      await client.query(
        `INSERT INTO workoutreach.drafts(
           job_id,draft_version,recipient_email,recipient_hmac,subject,body_text,body_html,
           template_version,template_sha256,sendable,attachment_filename,attachment_mime_type,attachment_sha256,attachment_bytes
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [result.job_id, version, selected.email, recipientHmac, result.draft.subject, result.draft.body_text, result.draft.body_html,
          result.draft.template_version, result.draft.template_sha256, result.draft.sendable === true, attachmentFilename, attachmentMime, attachmentSha, attachmentBytes],
      );
      await client.query("UPDATE workoutreach.jobs SET status='DRAFT_READY',error_code=NULL WHERE job_id=$1", [result.job_id]);

      const callbacks = {};
      const sendAction = this.mailEnabled ? 'smtp_send' : 'mock_send';
      for (const action of [sendAction, 'regenerate', 'reject']) {
        const token = await client.query(
          'SELECT callback_data,expires_at FROM workoutreach.issue_local_review_token($1,$2,$3,$4,$5)',
          [result.job_id, version, action, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
        );
        callbacks[action] = token.rows[0].callback_data;
      }
      await client.query(
        "UPDATE workoutreach.telegram_updates SET result_code='DRAFT_READY' WHERE job_id=$1 AND update_id=(SELECT max(update_id) FROM workoutreach.telegram_updates WHERE job_id=$1)",
        [result.job_id],
      );
      if (result.evidence.model_attempted === true) {
        const completedRun = await client.query(
          `UPDATE workoutreach.model_runs
           SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,usage=$3::jsonb
           WHERE job_id=$1 AND draft_version=$2 AND status='RESERVED'`,
          [result.job_id, version, JSON.stringify({
            fact: result.evidence.fact_model?.usage ?? null,
            phrase: result.evidence.phrase_model?.usage ?? null,
          })],
        );
        if (completedRun.rowCount !== 1) throw new SafeStop('MODEL_BUDGET_RESERVATION_MISSING', 'Attempted personalization requires one reserved model-budget row');
      }
      await client.query(
        `INSERT INTO workoutreach.audit_log(job_id,event_type,actor_type,safe_metadata)
         VALUES($1,'DRAFT_PERSONALIZATION_RESULT','system',jsonb_build_object(
           'mode',$2::text,'failure_code',$3::text,'model_call_count',$4::integer
         ))`,
        [result.job_id, result.analysis.personalization_mode, result.evidence.personalization_failure_code ?? null, result.evidence.model_call_count ?? 0],
      );
      await client.query('COMMIT');
      return { callbacks: { send: callbacks[sendAction], regenerate: callbacks.regenerate, reject: callbacks.reject }, draftVersion: version, mailEnabled: this.mailEnabled };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async persistContactReview(result, { userId, chatId } = {}) {
    if (!['NEEDS_CONTACT', 'NEEDS_REVIEW'].includes(result.status)) throw new SafeStop('CONTACT_REVIEW_STATE_INVALID', 'Contact review payload has an invalid status');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM workoutreach.jobs WHERE job_id=$1 FOR UPDATE', [result.job_id]);
      const job = locked.rows[0];
      if (!job || String(job.telegram_user_id) !== String(userId) || String(job.telegram_chat_id) !== String(chatId) || job.status !== 'ANALYZING') {
        throw new SafeStop('DATABASE_JOB_STATE_INVALID', 'Persisted job is not owned or not ready for contact review');
      }

      await client.query('DELETE FROM workoutreach.pages WHERE job_id=$1', [result.job_id]);
      await client.query('DELETE FROM workoutreach.contact_candidates WHERE job_id=$1', [result.job_id]);
      await client.query('DELETE FROM workoutreach.phone_candidates WHERE job_id=$1', [result.job_id]);
      for (const page of result.crawl.pages) {
        await client.query(
          `INSERT INTO workoutreach.pages(job_id,source_id,source_url,source_type,title,content_sha256,normalized_text)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [result.job_id, page.source_id, page.source_url, page.source_type, page.title || null, page.content_sha256, page.text],
        );
      }
      const candidates = [];
      for (const contact of result.contact.candidates) {
        const inserted = await client.query(
          `INSERT INTO workoutreach.contact_candidates(job_id,email,normalized_email,category,source_id,source_url,source_excerpt,automatic_selection_allowed,provenance)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id,email,category,source_url,provenance,automatic_selection_allowed`,
          [result.job_id, contact.email, contact.normalized_email, contact.category, contact.source_id, contact.source_url, contact.source_excerpt, contact.automatic_selection_allowed, contact.provenance ?? 'published'],
        );
        candidates.push(inserted.rows[0]);
      }
      for (const phone of result.phone?.candidates ?? []) {
        await client.query(
          `INSERT INTO workoutreach.phone_candidates(job_id,phone,normalized_phone,source_id,source_url,source_excerpt,decision)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [result.job_id, phone.phone, phone.normalized_phone, phone.source_id, phone.source_url, phone.source_excerpt, result.phone.decision],
        );
      }

      await client.query('UPDATE workoutreach.jobs SET status=$2,error_code=NULL WHERE job_id=$1', [result.job_id, result.status]);
      await client.query('UPDATE workoutreach.contact_review_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE job_id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL', [result.job_id]);
      let nonce = null;
      if (result.status === 'NEEDS_REVIEW' && candidates.length > 0) {
        nonce = randomBytes(16).toString('base64url');
        await client.query(
          `INSERT INTO workoutreach.contact_review_tokens(job_id,nonce_sha256,telegram_user_id,telegram_chat_id,expires_at)
           VALUES($1,$2,$3,$4,LEAST(CURRENT_TIMESTAMP + interval '24 hours',$5))`,
          [result.job_id, sha256(nonce), asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id'), job.expires_at],
        );
      }
      await client.query(
        "UPDATE workoutreach.telegram_updates SET result_code=$2 WHERE job_id=$1 AND update_id=(SELECT max(update_id) FROM workoutreach.telegram_updates WHERE job_id=$1)",
        [result.job_id, result.status],
      );
      await client.query('COMMIT');
      return {
        status: result.status,
        candidates: candidates.map((candidate) => ({
          ...candidate,
          callbackData: nonce ? `contact:${result.job_id}:${candidate.id}:${nonce}` : null,
        })),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async selectPublishedContact({ callbackData, userId, chatId, updateId }) {
    const parts = String(callbackData).match(/^contact:(WO-[A-Z0-9]{6}):([1-9][0-9]*):([A-Za-z0-9_-]{22,43})$/u);
    if (!parts) return { result_code: 'CALLBACK_INVALID' };
    const [, jobId, candidateId, nonce] = parts;
    const actionKey = `tg:${asInteger(updateId, 'update_id')}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const jobResult = await client.query('SELECT * FROM workoutreach.jobs WHERE job_id=$1 FOR UPDATE', [jobId]);
      const job = jobResult.rows[0];
      if (!job || String(job.telegram_user_id) !== String(userId) || String(job.telegram_chat_id) !== String(chatId)) {
        await client.query('ROLLBACK');
        return { result_code: 'APPROVAL_NOT_AUTHORIZED' };
      }
      const replay = await client.query('SELECT result_code FROM workoutreach.operator_actions WHERE action_key=$1', [actionKey]);
      if (replay.rowCount === 1) {
        await client.query('COMMIT');
        return { result_code: replay.rows[0].result_code, job_id: jobId, replay: true };
      }
      const tokenResult = await client.query(
        `SELECT * FROM workoutreach.contact_review_tokens
         WHERE job_id=$1 AND nonce_sha256=$2 FOR UPDATE`,
        [jobId, sha256(nonce)],
      );
      const token = tokenResult.rows[0];
      if (!token || String(token.telegram_user_id) !== String(userId) || String(token.telegram_chat_id) !== String(chatId)
          || token.consumed_at || token.invalidated_at || new Date(token.expires_at) <= new Date() || job.status !== 'NEEDS_REVIEW') {
        await client.query('ROLLBACK');
        return { result_code: 'CONTACT_TOKEN_INVALID', job_id: jobId };
      }
      const candidateResult = await client.query(
        `SELECT id,email,category,source_url,provenance FROM workoutreach.contact_candidates
         WHERE id=$1 AND job_id=$2 AND provenance='published' AND automatic_selection_allowed=true`,
        [asInteger(candidateId, 'candidate_id'), jobId],
      );
      const candidate = candidateResult.rows[0];
      if (!candidate) {
        await client.query('ROLLBACK');
        return { result_code: 'CONTACT_CANDIDATE_INVALID', job_id: jobId };
      }
      await client.query('UPDATE workoutreach.contact_review_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE id=$1', [token.id]);
      await client.query("UPDATE workoutreach.jobs SET status='ANALYZING' WHERE job_id=$1", [jobId]);
      await client.query(
        `INSERT INTO workoutreach.operator_actions(action_key,job_id,action,result_code,telegram_user_id,telegram_chat_id)
         VALUES($1,$2,'select_recipient','CONTACT_SELECTED',$3,$4)`,
        [actionKey, jobId, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
      );
      await client.query(
        `INSERT INTO workoutreach.audit_log(job_id,event_type,actor_type,safe_metadata)
         VALUES($1,'CONTACT_SELECTED','operator',jsonb_build_object('candidate_id',$2::bigint,'provenance','published'))`,
        [jobId, candidate.id],
      );
      await client.query('COMMIT');
      return { result_code: 'CONTACT_SELECTED', job_id: jobId, canonical_url: job.canonical_url, contact: candidate, selection: { type: 'published', email: candidate.email } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async selectManualContact({ jobId, email: rawEmail, userId, chatId, updateId }) {
    let email;
    try { email = normalizeExplicitEmail(rawEmail); } catch { throw new SafeStop('MANUAL_EMAIL_INVALID', 'Manual email address is invalid'); }
    const actionKey = `tg:${asInteger(updateId, 'update_id')}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const jobResult = await client.query('SELECT * FROM workoutreach.jobs WHERE job_id=$1 FOR UPDATE', [jobId]);
      const job = jobResult.rows[0];
      if (!job || String(job.telegram_user_id) !== String(userId) || String(job.telegram_chat_id) !== String(chatId)) throw new SafeStop('APPROVAL_NOT_AUTHORIZED', 'Job is not owned by this operator');
      const replay = await client.query('SELECT result_code FROM workoutreach.operator_actions WHERE action_key=$1', [actionKey]);
      if (replay.rowCount === 1) {
        await client.query('COMMIT');
        return { result_code: replay.rows[0].result_code, job_id: jobId, replay: true };
      }
      if (!['NEEDS_CONTACT', 'NEEDS_REVIEW'].includes(job.status) || new Date(job.expires_at) <= new Date()) throw new SafeStop('MANUAL_EMAIL_STATE_INVALID', 'Manual email can only resolve an active contact review');
      const existing = await client.query('SELECT id,email,provenance FROM workoutreach.contact_candidates WHERE job_id=$1 AND normalized_email=$2', [jobId, email]);
      let provenance = 'manual';
      if (existing.rowCount === 0) {
        await client.query(
          `INSERT INTO workoutreach.contact_candidates(job_id,email,normalized_email,category,source_id,source_url,source_excerpt,automatic_selection_allowed,provenance)
           VALUES($1,$2,$2,'manual','manual',$3,'Known address supplied explicitly by the owner in Telegram.',false,'manual')`,
          [jobId, email, job.canonical_url],
        );
      } else {
        provenance = existing.rows[0].provenance;
      }
      await client.query('UPDATE workoutreach.contact_review_tokens SET invalidated_at=CURRENT_TIMESTAMP WHERE job_id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL', [jobId]);
      await client.query("UPDATE workoutreach.jobs SET status='ANALYZING' WHERE job_id=$1", [jobId]);
      await client.query(
        `INSERT INTO workoutreach.operator_actions(action_key,job_id,action,result_code,telegram_user_id,telegram_chat_id)
         VALUES($1,$2,'select_recipient','MANUAL_CONTACT_SELECTED',$3,$4)`,
        [actionKey, jobId, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
      );
      await client.query(
        `INSERT INTO workoutreach.audit_log(job_id,event_type,actor_type,safe_metadata)
         VALUES($1,'MANUAL_CONTACT_SELECTED','operator',jsonb_build_object('provenance',$2::text))`,
        [jobId, provenance],
      );
      await client.query('COMMIT');
      return { result_code: 'MANUAL_CONTACT_SELECTED', job_id: jobId, canonical_url: job.canonical_url, selection: { type: provenance === 'manual' ? 'manual' : 'published', email }, provenance };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async failJob(jobId, errorCode) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE workoutreach.jobs SET status='FAILED',error_code=$2 WHERE job_id=$1 AND status IN ('RECEIVED','FETCHING','ANALYZING')",
        [jobId, String(errorCode ?? 'UNKNOWN').slice(0, 120)],
      );
      await client.query("UPDATE workoutreach.model_runs SET status='FAILED' WHERE job_id=$1 AND status='RESERVED'", [jobId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getResumeFact(jobId, userId, chatId) {
    const result = await this.pool.query(
      `SELECT a.result
       FROM workoutreach.jobs j
       JOIN LATERAL (
         SELECT result
         FROM workoutreach.analyses
         WHERE job_id=j.job_id AND stage='fact' AND result->>'fact' IS NOT NULL
         ORDER BY version DESC LIMIT 1
       ) a ON true
       WHERE j.job_id=$1 AND j.telegram_user_id=$2 AND j.telegram_chat_id=$3`,
      [jobId, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
    );
    const fact = result.rows[0]?.result;
    if (!fact) return null;
    return {
      ...fact,
      decision: fact.decision ?? 'READY_FOR_REVIEW',
      warnings: Array.isArray(fact.warnings) ? fact.warnings : [],
    };
  }

  async prepareRetry({ jobId, userId, chatId, updateId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await client.query('SELECT job_id,result_code FROM workoutreach.telegram_updates WHERE update_id=$1', [asInteger(updateId, 'update_id')]);
      if (replay.rowCount === 1) {
        await client.query('COMMIT');
        return { replay: true, result_code: replay.rows[0].result_code, job_id: replay.rows[0].job_id };
      }
      const locked = await client.query(
        `SELECT job_id,canonical_url,status,expires_at
         FROM workoutreach.jobs
         WHERE job_id=$1 AND telegram_user_id=$2 AND telegram_chat_id=$3
         FOR UPDATE`,
        [jobId, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
      );
      const job = locked.rows[0];
      if (!job) throw new SafeStop('RETRY_NOT_AUTHORIZED', 'Retry target is unavailable');
      if (job.status !== 'FAILED') throw new SafeStop('RETRY_STATE_INVALID', 'Only a failed job can be retried with /retry');
      if (new Date(job.expires_at).getTime() <= Date.now()) throw new SafeStop('RETRY_EXPIRED', 'Failed job is expired');
      const versions = await client.query(
        `SELECT GREATEST(
           COALESCE((SELECT max(draft_version) FROM workoutreach.drafts WHERE job_id=$1),0),
           COALESCE((SELECT max(draft_version) FROM workoutreach.model_runs WHERE job_id=$1),0)
         )::integer AS latest`,
        [jobId],
      );
      const draftVersion = Number(versions.rows[0]?.latest ?? 0) + 1;
      if (draftVersion > 3) throw new SafeStop('RETRY_LIMIT', 'Job retry limit is exhausted');
      await client.query("UPDATE workoutreach.jobs SET status='ANALYZING',error_code=NULL WHERE job_id=$1", [jobId]);
      await client.query(
        "INSERT INTO workoutreach.telegram_updates(update_id,telegram_user_id,telegram_chat_id,job_id,result_code) VALUES($1,$2,$3,$4,'RETRY_STARTED')",
        [asInteger(updateId, 'update_id'), asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id'), jobId],
      );
      await client.query(
        "INSERT INTO workoutreach.audit_log(job_id,event_type,actor_type,safe_metadata) VALUES($1,'RETRY_STARTED','operator',jsonb_build_object('draft_version',$2::integer))",
        [jobId, draftVersion],
      );
      await client.query('COMMIT');
      return { replay: false, result_code: 'RETRY_STARTED', job_id: jobId, canonical_url: job.canonical_url, draft_version: draftVersion };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reserveAnalysis(jobId, draftVersion, dailyLimit = 2) {
    const result = await this.pool.query(
      'SELECT workoutreach.reserve_local_model_run($1,$2,$3) AS reserved',
      [jobId, asInteger(draftVersion, 'draft_version'), asInteger(dailyLimit, 'daily_analysis_limit')],
    );
    if (result.rows[0]?.reserved !== true) throw new SafeStop('DAILY_ANALYSIS_LIMIT', 'Daily live-analysis budget is exhausted');
    return true;
  }

  async approveMock({ callbackData, userId, chatId, updateId }) {
    const result = await this.pool.query(
      'SELECT result_code,outbox_id,job_status FROM workoutreach.handle_mock_send_callback($1,$2,$3,$4)',
      [callbackData, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id'), `tg:${asInteger(updateId, 'update_id')}`],
    );
    return result.rows[0] ?? { result_code: 'APPROVAL_FAILED' };
  }

  async approveSmtp({ callbackData, userId, chatId, updateId }) {
    const result = await this.pool.query(
      'SELECT result_code,outbox_id,job_status FROM workoutreach.handle_smtp_send_callback($1,$2,$3,$4)',
      [callbackData, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id'), `tg:${asInteger(updateId, 'update_id')}`],
    );
    return result.rows[0] ?? { result_code: 'APPROVAL_FAILED' };
  }

  async claimNextSmtp(workerId) {
    const result = await this.pool.query('SELECT * FROM workoutreach.claim_next_smtp_outbox($1)', [String(workerId)]);
    return result.rows[0] ?? null;
  }

  async completeSmtp(outboxId, workerId, providerMessageId) {
    const result = await this.pool.query('SELECT workoutreach.complete_smtp_outbox($1,$2,$3) AS completed', [asInteger(outboxId, 'outbox_id'), String(workerId), String(providerMessageId)]);
    return result.rows[0]?.completed === true;
  }

  async failSmtp(outboxId, workerId, safeCode) {
    const result = await this.pool.query('SELECT workoutreach.fail_smtp_outbox($1,$2,$3) AS failed', [asInteger(outboxId, 'outbox_id'), String(workerId), String(safeCode)]);
    return result.rows[0]?.failed === true;
  }

  async applyReviewAction({ callbackData, userId, chatId, updateId }) {
    const result = await this.pool.query(
      'SELECT result_code,job_id,draft_version,canonical_url,job_status FROM workoutreach.handle_local_review_action($1,$2,$3,$4)',
      [callbackData, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id'), `tg:${asInteger(updateId, 'update_id')}`],
    );
    return result.rows[0] ?? { result_code: 'APPROVAL_FAILED' };
  }

  async getAuthorizedJob(jobId, userId, chatId) {
    const result = await this.pool.query(
      `SELECT j.job_id,j.canonical_url,j.status,j.error_code,j.created_at,j.updated_at,j.expires_at,
              d.draft_version,o.status AS outbox_status,o.transport AS outbox_transport
       FROM workoutreach.jobs j
       LEFT JOIN LATERAL (SELECT draft_version FROM workoutreach.drafts WHERE job_id=j.job_id ORDER BY draft_version DESC LIMIT 1) d ON true
       LEFT JOIN LATERAL (SELECT status,transport FROM workoutreach.outbox WHERE job_id=j.job_id ORDER BY id DESC LIMIT 1) o ON true
       WHERE j.job_id=$1 AND j.telegram_user_id=$2 AND j.telegram_chat_id=$3`,
      [jobId, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
    );
    return result.rows[0] ?? null;
  }

  async getQueueSummary(userId, chatId, limit = 10) {
    const params = [asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id'), asInteger(limit, 'queue_limit')];
    const [counts, jobs] = await Promise.all([
      this.pool.query(
        `SELECT status,count(*)::integer AS count
         FROM workoutreach.jobs
         WHERE telegram_user_id=$1 AND telegram_chat_id=$2
           AND status IN ('NEEDS_CONTACT','NEEDS_REVIEW','DRAFT_READY','APPROVED','SENDING','FAILED')
         GROUP BY status ORDER BY status`,
        params.slice(0, 2),
      ),
      this.pool.query(
        `SELECT job_id,hostname,status,error_code,created_at
         FROM workoutreach.jobs
         WHERE telegram_user_id=$1 AND telegram_chat_id=$2
           AND status IN ('NEEDS_CONTACT','NEEDS_REVIEW','DRAFT_READY','APPROVED','SENDING','FAILED')
         ORDER BY CASE status
           WHEN 'NEEDS_CONTACT' THEN 1 WHEN 'NEEDS_REVIEW' THEN 2 WHEN 'DRAFT_READY' THEN 3
           WHEN 'APPROVED' THEN 4 WHEN 'SENDING' THEN 5 ELSE 6 END, created_at
         LIMIT $3`,
        params,
      ),
    ]);
    return { counts: counts.rows, jobs: jobs.rows };
  }

  async getNextActionable(userId, chatId) {
    const result = await this.pool.query(
      `SELECT job_id,hostname,canonical_url,status,error_code
       FROM workoutreach.jobs
       WHERE telegram_user_id=$1 AND telegram_chat_id=$2
         AND status IN ('NEEDS_CONTACT','NEEDS_REVIEW','DRAFT_READY')
       ORDER BY CASE status WHEN 'NEEDS_CONTACT' THEN 1 WHEN 'NEEDS_REVIEW' THEN 2 ELSE 3 END, created_at
       LIMIT 1`,
      [asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
    );
    return result.rows[0] ?? null;
  }

  async getUsageSummary() {
    const result = await this.pool.query(
      `SELECT
         (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date::text AS usage_date,
         count(m.*)::integer AS analyses_reserved,
         count(m.*) FILTER (WHERE m.status='COMPLETED')::integer AS analyses_completed,
         count(m.*) FILTER (WHERE m.status='FAILED')::integer AS analyses_failed,
         COALESCE(sum(COALESCE((m.usage#>>'{fact,input_tokens}')::bigint,0) + COALESCE((m.usage#>>'{phrase,input_tokens}')::bigint,0)),0)::bigint AS input_tokens,
         COALESCE(sum(COALESCE((m.usage#>>'{fact,output_tokens}')::bigint,0) + COALESCE((m.usage#>>'{phrase,output_tokens}')::bigint,0)),0)::bigint AS output_tokens,
         (SELECT daily_send_limit FROM workoutreach.mail_runtime_controls WHERE singleton=true)::integer AS send_limit,
         (SELECT count(*) FROM workoutreach.outbox WHERE transport='smtp' AND created_at >= date_trunc('day',CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS smtp_queued,
         (SELECT count(*) FROM workoutreach.outbox WHERE transport='smtp' AND status='SMTP_ACCEPTED' AND created_at >= date_trunc('day',CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS smtp_accepted
       FROM workoutreach.model_runs m
       WHERE m.run_date=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`,
    );
    return result.rows[0];
  }

  async issueExistingSmtpApproval(jobId, userId, chatId) {
    if (!this.mailEnabled) throw new SafeStop('LIVE_SEND_BLOCKED', 'SMTP runtime is disabled');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const draft = await client.query(
        `SELECT j.job_id,j.status,d.draft_version,d.recipient_email,d.subject,d.sendable
         FROM workoutreach.jobs j JOIN LATERAL (
           SELECT draft_version,recipient_email,subject,sendable FROM workoutreach.drafts WHERE job_id=j.job_id ORDER BY draft_version DESC LIMIT 1
         ) d ON true
         WHERE j.job_id=$1 AND j.telegram_user_id=$2 AND j.telegram_chat_id=$3 FOR UPDATE OF j`,
        [jobId, asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')],
      );
      const row = draft.rows[0];
      if (!row || row.status !== 'DRAFT_READY') throw new SafeStop('APPROVAL_STATE_INVALID', 'Only an owned ready draft can receive a new SMTP approval');
      if (row.sendable !== true) throw new SafeStop('TEMPLATE_NOT_SENDABLE', 'A legacy non-sendable draft cannot be approved for SMTP');
      const token = await client.query('SELECT callback_data FROM workoutreach.issue_local_review_token($1,$2,$3,$4,$5)', [jobId, row.draft_version, 'smtp_send', asInteger(userId, 'telegram_user_id'), asInteger(chatId, 'telegram_chat_id')]);
      await client.query('COMMIT');
      return { ...row, callbackData: token.rows[0].callback_data };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() { await this.pool.end(); }
}
