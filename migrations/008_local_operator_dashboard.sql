BEGIN;

SET search_path TO workoutreach, public;

CREATE TABLE IF NOT EXISTS companies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_hostname text NOT NULL UNIQUE,
  canonical_url text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (canonical_hostname = lower(trim(both '.' FROM canonical_hostname))),
  CHECK (canonical_hostname <> ''),
  CHECK (last_seen_at >= first_seen_at)
);

INSERT INTO companies(canonical_hostname, canonical_url, first_seen_at, last_seen_at)
SELECT
  lower(trim(both '.' FROM hostname)),
  (array_agg(canonical_url ORDER BY created_at DESC, id DESC))[1],
  min(created_at),
  max(updated_at)
FROM jobs
GROUP BY lower(trim(both '.' FROM hostname))
ON CONFLICT (canonical_hostname) DO UPDATE SET
  canonical_url = EXCLUDED.canonical_url,
  first_seen_at = LEAST(companies.first_seen_at, EXCLUDED.first_seen_at),
  last_seen_at = GREATEST(companies.last_seen_at, EXCLUDED.last_seen_at),
  updated_at = CURRENT_TIMESTAMP;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_id bigint;

UPDATE jobs AS j
SET company_id = c.id
FROM companies AS c
WHERE j.company_id IS NULL
  AND c.canonical_hostname = lower(trim(both '.' FROM j.hostname));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM jobs WHERE company_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DASHBOARD_COMPANY_BACKFILL_INCOMPLETE';
  END IF;
END;
$$;

ALTER TABLE jobs ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_company_id_fkey'
      AND conrelid = 'workoutreach.jobs'::regclass
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS jobs_company_created_idx
  ON jobs(company_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION assign_company_to_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = workoutreach, pg_catalog
AS $$
DECLARE
  v_hostname text;
BEGIN
  v_hostname := lower(trim(both '.' FROM NEW.hostname));
  IF v_hostname = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'JOB_HOSTNAME_INVALID';
  END IF;
  INSERT INTO companies(canonical_hostname, canonical_url, first_seen_at, last_seen_at)
  VALUES (v_hostname, NEW.canonical_url, COALESCE(NEW.created_at, CURRENT_TIMESTAMP), COALESCE(NEW.updated_at, CURRENT_TIMESTAMP))
  ON CONFLICT (canonical_hostname) DO UPDATE SET
    canonical_url = EXCLUDED.canonical_url,
    last_seen_at = GREATEST(companies.last_seen_at, EXCLUDED.last_seen_at),
    updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO NEW.company_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_assign_company ON jobs;
CREATE TRIGGER jobs_assign_company
BEFORE INSERT OR UPDATE OF hostname, canonical_url ON jobs
FOR EACH ROW EXECUTE FUNCTION assign_company_to_job();

CREATE TABLE IF NOT EXISTS company_campaign_state (
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  campaign_type text NOT NULL,
  engagement_status text NOT NULL CHECK (engagement_status IN (
    'NOT_CONTACTED', 'SENT_WAITING', 'REPLIED', 'INTERESTED',
    'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DO_NOT_CONTACT'
  )),
  safe_note text,
  next_action_at timestamptz,
  sent_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, campaign_type),
  CHECK (char_length(campaign_type) BETWEEN 1 AND 80),
  CHECK (safe_note IS NULL OR char_length(safe_note) <= 500),
  CHECK ((engagement_status = 'FOLLOW_UP_LATER') = (next_action_at IS NOT NULL)),
  CHECK (engagement_status <> 'SENT_WAITING' OR sent_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS company_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  campaign_type text NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN (
    'NOT_CONTACTED', 'SENT_WAITING', 'REPLIED', 'INTERESTED',
    'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DO_NOT_CONTACT'
  )),
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'operator')),
  action_key text NOT NULL UNIQUE CHECK (char_length(action_key) BETWEEN 1 AND 128),
  next_action_at timestamptz,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (from_status IS NULL OR from_status IN (
    'NOT_CONTACTED', 'SENT_WAITING', 'REPLIED', 'INTERESTED',
    'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DO_NOT_CONTACT'
  )),
  CHECK (jsonb_typeof(safe_metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS company_status_history_timeline_idx
  ON company_status_history(company_id, campaign_type, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION reject_company_status_history_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'COMPANY_STATUS_HISTORY_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS company_status_history_immutable ON company_status_history;
CREATE TRIGGER company_status_history_immutable
BEFORE UPDATE ON company_status_history
FOR EACH ROW EXECUTE FUNCTION reject_company_status_history_update();

CREATE OR REPLACE FUNCTION ensure_company_campaign_state_for_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = workoutreach, pg_catalog
AS $$
BEGIN
  INSERT INTO company_campaign_state(company_id, campaign_type, engagement_status)
  VALUES (NEW.company_id, NEW.campaign_type, 'NOT_CONTACTED')
  ON CONFLICT (company_id, campaign_type) DO NOTHING;

  INSERT INTO company_status_history(
    company_id, campaign_type, from_status, to_status, actor_type, action_key, safe_metadata
  )
  SELECT NEW.company_id, NEW.campaign_type, NULL, 'NOT_CONTACTED', 'system',
    'company-seen:' || NEW.job_id, jsonb_build_object('source', 'job')
  WHERE NOT EXISTS (
    SELECT 1 FROM company_status_history
    WHERE company_id = NEW.company_id AND campaign_type = NEW.campaign_type
  )
  ON CONFLICT (action_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_ensure_company_campaign_state ON jobs;
CREATE TRIGGER jobs_ensure_company_campaign_state
AFTER INSERT ON jobs
FOR EACH ROW EXECUTE FUNCTION ensure_company_campaign_state_for_job();

WITH campaign AS (
  SELECT DISTINCT company_id, campaign_type FROM jobs
), accepted AS (
  SELECT j.company_id, j.campaign_type, min(o.updated_at) AS sent_at
  FROM jobs AS j
  JOIN outbox AS o ON o.job_id = j.job_id
  WHERE o.transport = 'smtp' AND o.status = 'SMTP_ACCEPTED'
  GROUP BY j.company_id, j.campaign_type
)
INSERT INTO company_campaign_state(company_id, campaign_type, engagement_status, sent_at)
SELECT
  campaign.company_id,
  campaign.campaign_type,
  CASE WHEN accepted.sent_at IS NULL THEN 'NOT_CONTACTED' ELSE 'SENT_WAITING' END,
  accepted.sent_at
FROM campaign
LEFT JOIN accepted USING (company_id, campaign_type)
ON CONFLICT (company_id, campaign_type) DO NOTHING;

INSERT INTO company_status_history(
  company_id, campaign_type, from_status, to_status, actor_type, action_key, safe_metadata, created_at
)
SELECT
  state.company_id,
  state.campaign_type,
  NULL,
  state.engagement_status,
  'system',
  'dashboard-backfill:' || state.company_id::text || ':' || state.campaign_type,
  jsonb_build_object('source', 'migration-008'),
  state.created_at
FROM company_campaign_state AS state
ON CONFLICT (action_key) DO NOTHING;

CREATE OR REPLACE FUNCTION sync_company_state_after_smtp_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = workoutreach, pg_catalog
AS $$
DECLARE
  v_company_id bigint;
  v_campaign_type text;
  v_state company_campaign_state%ROWTYPE;
  v_sent_at timestamptz;
BEGIN
  IF NEW.transport <> 'smtp' OR NEW.status <> 'SMTP_ACCEPTED'
     OR (TG_OP = 'UPDATE' AND OLD.transport = 'smtp' AND OLD.status = 'SMTP_ACCEPTED') THEN
    RETURN NEW;
  END IF;

  SELECT company_id, campaign_type
  INTO v_company_id, v_campaign_type
  FROM jobs
  WHERE job_id = NEW.job_id;

  v_sent_at := COALESCE(NEW.updated_at, CURRENT_TIMESTAMP);
  SELECT * INTO v_state
  FROM company_campaign_state
  WHERE company_id = v_company_id AND campaign_type = v_campaign_type
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO company_campaign_state(company_id, campaign_type, engagement_status, sent_at)
    VALUES (v_company_id, v_campaign_type, 'SENT_WAITING', v_sent_at)
    RETURNING * INTO v_state;
    INSERT INTO company_status_history(
      company_id, campaign_type, from_status, to_status, actor_type, action_key, safe_metadata
    ) VALUES (
      v_company_id, v_campaign_type, NULL, 'SENT_WAITING', 'system',
      'smtp-accepted:' || NEW.id::text,
      jsonb_build_object('source', 'outbox')
    );
  ELSE
    UPDATE company_campaign_state
    SET
      engagement_status = CASE WHEN engagement_status = 'NOT_CONTACTED' THEN 'SENT_WAITING' ELSE engagement_status END,
      sent_at = COALESCE(sent_at, v_sent_at),
      version = version + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE company_id = v_company_id AND campaign_type = v_campaign_type;

    IF v_state.engagement_status = 'NOT_CONTACTED' THEN
      INSERT INTO company_status_history(
        company_id, campaign_type, from_status, to_status, actor_type, action_key, safe_metadata
      ) VALUES (
        v_company_id, v_campaign_type, 'NOT_CONTACTED', 'SENT_WAITING', 'system',
        'smtp-accepted:' || NEW.id::text,
        jsonb_build_object('source', 'outbox')
      ) ON CONFLICT (action_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outbox_dashboard_smtp_acceptance ON outbox;
CREATE TRIGGER outbox_dashboard_smtp_acceptance
AFTER INSERT OR UPDATE OF transport, status ON outbox
FOR EACH ROW EXECUTE FUNCTION sync_company_state_after_smtp_acceptance();

CREATE OR REPLACE FUNCTION block_outbox_for_do_not_contact_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = workoutreach, pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM jobs AS j
    JOIN company_campaign_state AS state
      ON state.company_id = j.company_id AND state.campaign_type = j.campaign_type
    WHERE j.job_id = NEW.job_id AND state.engagement_status = 'DO_NOT_CONTACT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'COMPANY_DO_NOT_CONTACT';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outbox_company_do_not_contact ON outbox;
CREATE TRIGGER outbox_company_do_not_contact
BEFORE INSERT ON outbox
FOR EACH ROW EXECUTE FUNCTION block_outbox_for_do_not_contact_company();

CREATE OR REPLACE VIEW dashboard_company_summary_v1
WITH (security_barrier = true) AS
SELECT
  state.company_id,
  state.campaign_type,
  COALESCE(analysis.company_name, company.canonical_hostname) AS company_name,
  company.canonical_hostname,
  company.canonical_url,
  analysis.fact,
  CASE
    WHEN sent.recipient_email IS NULL THEN NULL
    WHEN position('@' IN sent.recipient_email) <= 1 THEN '***'
    ELSE left(sent.recipient_email, 1) || '***@' || split_part(sent.recipient_email, '@', 2)
  END AS masked_recipient_email,
  accepted.last_smtp_accepted_at,
  CASE
    WHEN accepted.send_count > 0 THEN 'SMTP_ACCEPTED'
    WHEN latest_outbox.status IN ('MOCK_PENDING', 'MOCK_CLAIMED', 'MOCK_ACCEPTED') THEN 'MOCK'
    WHEN latest_outbox.status = 'SMTP_FAILED' OR latest_job.error_code IS NOT NULL THEN 'ERROR'
    WHEN latest_outbox.status IN ('SMTP_PENDING', 'SMTP_CLAIMED') THEN latest_outbox.status
    ELSE 'NOT_SENT'
  END AS delivery_status,
  state.engagement_status,
  state.safe_note,
  state.next_action_at,
  state.sent_at,
  COALESCE(accepted.send_count, 0)::integer AS send_count,
  state.version,
  latest_job.job_id AS last_job_id,
  latest_job.status AS job_status,
  latest_job.error_code,
  state.updated_at,
  (state.engagement_status = 'DO_NOT_CONTACT') AS outreach_blocked
FROM company_campaign_state AS state
JOIN companies AS company ON company.id = state.company_id
LEFT JOIN LATERAL (
  SELECT j.job_id, j.status, j.error_code
  FROM jobs AS j
  WHERE j.company_id = state.company_id AND j.campaign_type = state.campaign_type
  ORDER BY j.created_at DESC, j.id DESC
  LIMIT 1
) AS latest_job ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(a.result #>> '{analysis,company_name}', a.result ->> 'company_name') AS company_name,
    COALESCE(a.result #>> '{analysis,fact}', a.result ->> 'fact') AS fact
  FROM analyses AS a
  JOIN jobs AS j ON j.job_id = a.job_id
  WHERE j.company_id = state.company_id
    AND j.campaign_type = state.campaign_type
    AND a.stage = 'aggregate'
    AND a.decision = 'READY_FOR_REVIEW'
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 1
) AS analysis ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS send_count, max(o.updated_at) AS last_smtp_accepted_at
  FROM outbox AS o
  JOIN jobs AS j ON j.job_id = o.job_id
  WHERE j.company_id = state.company_id
    AND j.campaign_type = state.campaign_type
    AND o.transport = 'smtp'
    AND o.status = 'SMTP_ACCEPTED'
) AS accepted ON true
LEFT JOIN LATERAL (
  SELECT o.status
  FROM outbox AS o
  JOIN jobs AS j ON j.job_id = o.job_id
  WHERE j.company_id = state.company_id AND j.campaign_type = state.campaign_type
  ORDER BY o.updated_at DESC, o.id DESC
  LIMIT 1
) AS latest_outbox ON true
LEFT JOIN LATERAL (
  SELECT d.recipient_email
  FROM outbox AS o
  JOIN jobs AS j ON j.job_id = o.job_id
  JOIN drafts AS d ON d.job_id = o.job_id AND d.draft_version = o.draft_version
  WHERE j.company_id = state.company_id
    AND j.campaign_type = state.campaign_type
    AND o.transport = 'smtp'
    AND o.status = 'SMTP_ACCEPTED'
  ORDER BY o.updated_at DESC, o.id DESC
  LIMIT 1
) AS sent ON true;

CREATE OR REPLACE VIEW dashboard_company_detail_v1
WITH (security_barrier = true) AS
SELECT
  summary.*,
  sent.recipient_email,
  sent.subject,
  sent.body_text,
  sent.draft_version AS sent_draft_version,
  sent.job_id AS sent_job_id,
  sent.contact_source_url,
  sent.contact_source_excerpt,
  evidence.source_url AS evidence_source_url,
  evidence.source_excerpt AS evidence_excerpt,
  evidence.personalization_phrase
FROM dashboard_company_summary_v1 AS summary
LEFT JOIN LATERAL (
  SELECT
    d.recipient_email,
    d.subject,
    d.body_text,
    d.draft_version,
    d.job_id,
    contact.source_url AS contact_source_url,
    contact.source_excerpt AS contact_source_excerpt
  FROM outbox AS o
  JOIN jobs AS j ON j.job_id = o.job_id
  JOIN drafts AS d ON d.job_id = o.job_id AND d.draft_version = o.draft_version
  LEFT JOIN LATERAL (
    SELECT c.source_url, c.source_excerpt
    FROM contact_candidates AS c
    WHERE c.job_id = d.job_id AND c.normalized_email = lower(d.recipient_email)
    ORDER BY c.id DESC
    LIMIT 1
  ) AS contact ON true
  WHERE j.company_id = summary.company_id
    AND j.campaign_type = summary.campaign_type
    AND o.transport = 'smtp'
    AND o.status = 'SMTP_ACCEPTED'
  ORDER BY o.updated_at DESC, o.id DESC
  LIMIT 1
) AS sent ON true
LEFT JOIN LATERAL (
  SELECT
    p.source_url,
    COALESCE(a.result #>> '{analysis,source_excerpt}', a.result ->> 'source_excerpt') AS source_excerpt,
    COALESCE(a.result #>> '{analysis,personalization_phrase}', a.result ->> 'personalization_phrase') AS personalization_phrase
  FROM analyses AS a
  JOIN jobs AS j ON j.job_id = a.job_id
  LEFT JOIN pages AS p
    ON p.job_id = a.job_id
    AND p.source_id = COALESCE(a.result #>> '{analysis,source_id}', a.result ->> 'source_id')
  WHERE j.company_id = summary.company_id
    AND j.campaign_type = summary.campaign_type
    AND a.stage = 'aggregate'
    AND a.decision = 'READY_FOR_REVIEW'
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 1
) AS evidence ON true;

CREATE OR REPLACE VIEW dashboard_company_timeline_v1
WITH (security_barrier = true) AS
SELECT
  h.company_id,
  h.campaign_type,
  h.created_at,
  'ENGAGEMENT_STATUS'::text AS event_group,
  h.to_status AS event_type,
  h.actor_type,
  h.from_status,
  h.to_status,
  h.next_action_at,
  h.safe_metadata
FROM company_status_history AS h
UNION ALL
SELECT
  j.company_id,
  j.campaign_type,
  a.created_at,
  'TECHNICAL'::text,
  a.event_type,
  a.actor_type,
  NULL::text,
  NULL::text,
  NULL::timestamptz,
  a.safe_metadata - 'provider_message_id' - 'telegram_user_id' - 'telegram_chat_id'
FROM audit_log AS a
JOIN jobs AS j ON j.job_id = a.job_id
UNION ALL
SELECT
  j.company_id,
  j.campaign_type,
  e.occurred_at,
  'PROVIDER_EVENT'::text,
  e.event_type,
  'system'::text,
  NULL::text,
  NULL::text,
  NULL::timestamptz,
  '{}'::jsonb
FROM message_events AS e
JOIN jobs AS j ON j.job_id = e.job_id;

CREATE OR REPLACE FUNCTION dashboard_stats_v1()
RETURNS TABLE(
  company_count bigint,
  smtp_accepted_count bigint,
  sent_waiting_count bigint,
  replied_count bigint,
  interested_count bigint,
  attention_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = workoutreach, pg_catalog
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE delivery_status = 'SMTP_ACCEPTED'),
    count(*) FILTER (WHERE engagement_status = 'SENT_WAITING'),
    count(*) FILTER (WHERE engagement_status = 'REPLIED'),
    count(*) FILTER (WHERE engagement_status = 'INTERESTED'),
    count(*) FILTER (WHERE delivery_status = 'ERROR' OR (next_action_at IS NOT NULL AND next_action_at <= CURRENT_TIMESTAMP))
  FROM dashboard_company_summary_v1;
$$;

CREATE OR REPLACE FUNCTION dashboard_set_company_status_v1(
  p_company_id bigint,
  p_campaign_type text,
  p_engagement_status text,
  p_expected_version integer,
  p_safe_note text,
  p_next_action_at timestamptz,
  p_action_key text,
  p_confirm_do_not_contact boolean DEFAULT false,
  p_do_not_contact_reason text DEFAULT NULL
)
RETURNS SETOF dashboard_company_detail_v1
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = workoutreach, pg_catalog
AS $$
DECLARE
  v_state company_campaign_state%ROWTYPE;
  v_existing company_status_history%ROWTYPE;
  v_note text;
  v_recipient_hmac char(64);
BEGIN
  IF p_engagement_status IS NULL OR p_engagement_status NOT IN (
    'NOT_CONTACTED', 'SENT_WAITING', 'REPLIED', 'INTERESTED',
    'FOLLOW_UP_LATER', 'NOT_INTERESTED', 'DO_NOT_CONTACT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ENGAGEMENT_STATUS_INVALID';
  END IF;
  IF p_action_key IS NULL OR char_length(p_action_key) NOT BETWEEN 16 AND 128
     OR p_action_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTION_KEY_INVALID';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EXPECTED_VERSION_INVALID';
  END IF;
  v_note := NULLIF(btrim(p_safe_note), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SAFE_NOTE_TOO_LONG';
  END IF;
  IF v_note IS NOT NULL AND v_note ~* 'https?://|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SAFE_NOTE_CONTAINS_PII';
  END IF;
  IF p_engagement_status = 'FOLLOW_UP_LATER' AND p_next_action_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NEXT_ACTION_REQUIRED';
  END IF;
  IF p_engagement_status <> 'FOLLOW_UP_LATER' AND p_next_action_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NEXT_ACTION_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_existing FROM company_status_history WHERE action_key = p_action_key;
  IF FOUND THEN
    IF v_existing.company_id <> p_company_id
       OR v_existing.campaign_type <> p_campaign_type
       OR v_existing.to_status <> p_engagement_status THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTION_KEY_REUSED';
    END IF;
    RETURN QUERY SELECT * FROM dashboard_company_detail_v1
      WHERE company_id = p_company_id AND campaign_type = p_campaign_type;
    RETURN;
  END IF;

  SELECT * INTO v_state
  FROM company_campaign_state
  WHERE company_id = p_company_id AND campaign_type = p_campaign_type
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'COMPANY_CAMPAIGN_NOT_FOUND';
  END IF;

  SELECT * INTO v_existing FROM company_status_history WHERE action_key = p_action_key;
  IF FOUND THEN
    IF v_existing.company_id <> p_company_id
       OR v_existing.campaign_type <> p_campaign_type
       OR v_existing.to_status <> p_engagement_status THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACTION_KEY_REUSED';
    END IF;
    RETURN QUERY SELECT * FROM dashboard_company_detail_v1
      WHERE company_id = p_company_id AND campaign_type = p_campaign_type;
    RETURN;
  END IF;

  IF v_state.version <> p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VERSION_CONFLICT';
  END IF;
  IF v_state.engagement_status = 'DO_NOT_CONTACT' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DO_NOT_CONTACT_TERMINAL';
  END IF;
  IF p_engagement_status = 'SENT_WAITING' AND v_state.engagement_status <> 'SENT_WAITING' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SENT_WAITING_SYSTEM_MANAGED';
  END IF;
  IF p_engagement_status = 'NOT_CONTACTED' AND v_state.sent_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SMTP_ACCEPTANCE_IMMUTABLE';
  END IF;
  IF p_engagement_status = 'DO_NOT_CONTACT' THEN
    IF p_confirm_do_not_contact IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DO_NOT_CONTACT_CONFIRMATION_REQUIRED';
    END IF;
    IF p_do_not_contact_reason IS NULL OR p_do_not_contact_reason NOT IN ('OWNER_BLOCK', 'RECIPIENT_REQUEST') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DO_NOT_CONTACT_REASON_INVALID';
    END IF;
    IF p_do_not_contact_reason = 'RECIPIENT_REQUEST' THEN
      SELECT o.recipient_hmac INTO v_recipient_hmac
      FROM outbox AS o
      JOIN jobs AS j ON j.job_id = o.job_id
      WHERE j.company_id = p_company_id
        AND j.campaign_type = p_campaign_type
        AND o.transport = 'smtp'
        AND o.status = 'SMTP_ACCEPTED'
      ORDER BY o.updated_at DESC, o.id DESC
      LIMIT 1;
      IF v_recipient_hmac IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCEPTED_RECIPIENT_REQUIRED';
      END IF;
      INSERT INTO suppression(recipient_hmac, reason, source)
      VALUES (v_recipient_hmac, 'RECIPIENT_REQUEST', 'operator')
      ON CONFLICT (recipient_hmac) DO UPDATE SET
        reason = 'RECIPIENT_REQUEST', source = 'operator', updated_at = CURRENT_TIMESTAMP;
    ELSE
      INSERT INTO suppression(recipient_hmac, reason, source)
      SELECT DISTINCT d.recipient_hmac, 'OWNER_BLOCK', 'operator'
      FROM drafts AS d
      JOIN jobs AS j ON j.job_id = d.job_id
      WHERE j.company_id = p_company_id
        AND j.campaign_type = p_campaign_type
        AND d.recipient_hmac IS NOT NULL
      ON CONFLICT (recipient_hmac) DO UPDATE SET
        reason = 'OWNER_BLOCK', source = 'operator', updated_at = CURRENT_TIMESTAMP;
    END IF;
  END IF;

  UPDATE company_campaign_state
  SET engagement_status = p_engagement_status,
      safe_note = v_note,
      next_action_at = p_next_action_at,
      version = version + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE company_id = p_company_id AND campaign_type = p_campaign_type;

  INSERT INTO company_status_history(
    company_id, campaign_type, from_status, to_status, actor_type,
    action_key, next_action_at, safe_metadata
  ) VALUES (
    p_company_id, p_campaign_type, v_state.engagement_status, p_engagement_status,
    'operator', p_action_key, p_next_action_at,
    CASE WHEN p_engagement_status = 'DO_NOT_CONTACT'
      THEN jsonb_build_object('reason', p_do_not_contact_reason)
      ELSE '{}'::jsonb
    END
  );

  INSERT INTO audit_log(job_id, event_type, actor_type, safe_metadata)
  SELECT j.job_id, 'DASHBOARD_ENGAGEMENT_UPDATED', 'operator',
    jsonb_build_object('company_id', p_company_id, 'campaign_type', p_campaign_type,
      'to_status', p_engagement_status, 'version', v_state.version + 1)
  FROM jobs AS j
  WHERE j.company_id = p_company_id AND j.campaign_type = p_campaign_type
  ORDER BY j.created_at DESC, j.id DESC
  LIMIT 1;

  RETURN QUERY SELECT * FROM dashboard_company_detail_v1
    WHERE company_id = p_company_id AND campaign_type = p_campaign_type;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA workoutreach FROM workoutreach_dashboard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workoutreach FROM workoutreach_dashboard;
REVOKE ALL ON FUNCTION dashboard_stats_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_set_company_status_v1(bigint,text,text,integer,text,timestamptz,text,boolean,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA workoutreach TO workoutreach_dashboard;
GRANT SELECT ON dashboard_company_summary_v1, dashboard_company_detail_v1, dashboard_company_timeline_v1
  TO workoutreach_dashboard;
GRANT EXECUTE ON FUNCTION dashboard_stats_v1() TO workoutreach_dashboard;
GRANT EXECUTE ON FUNCTION dashboard_set_company_status_v1(bigint,text,text,integer,text,timestamptz,text,boolean,text)
  TO workoutreach_dashboard;

INSERT INTO schema_migrations(version) VALUES ('008_local_operator_dashboard')
ON CONFLICT DO NOTHING;

COMMIT;
