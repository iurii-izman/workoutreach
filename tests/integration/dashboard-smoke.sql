\set ON_ERROR_STOP on
\set QUIET on
BEGIN;
SET search_path TO workoutreach, public;

INSERT INTO jobs(job_id,canonical_url,hostname,telegram_user_id,telegram_chat_id,status,expires_at)
VALUES
  ('WO-DASH01','https://dashboard-smoke.example/','dashboard-smoke.example',81001,82001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour'),
  ('WO-DASH02','https://dashboard-smoke.example/about','DASHBOARD-SMOKE.EXAMPLE.',81001,82001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour'),
  ('WO-DASH03','https://dashboard-smoke.example/pending','dashboard-smoke.example',81001,82001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour'),
  ('WO-DASH04','https://dashboard-smoke.example/failed','dashboard-smoke.example',81001,82001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour'),
  ('WO-DASH05','https://dashboard-smoke.example/claimed','dashboard-smoke.example',81001,82001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour');

DO $$
BEGIN
  IF (SELECT count(DISTINCT company_id) FROM jobs WHERE job_id LIKE 'WO-DASH0%') <> 1 THEN
    RAISE EXCEPTION 'duplicate company aggregation failed';
  END IF;
END;
$$;

INSERT INTO pages(job_id,source_id,source_url,source_type,title,content_sha256,normalized_text)
VALUES ('WO-DASH01','p01','https://dashboard-smoke.example/about','about','Synthetic Dashboard',repeat('1',64),'Synthetic Dashboard publishes a verifiable fact.');
INSERT INTO contact_candidates(job_id,email,normalized_email,category,source_id,source_url,source_excerpt,automatic_selection_allowed)
VALUES ('WO-DASH01','recipient@dashboard-smoke.example','recipient@dashboard-smoke.example','general','p01','https://dashboard-smoke.example/about','Published synthetic contact',true);
INSERT INTO analyses(job_id,stage,version,model_id,prompt_version,prompt_sha256,schema_version,schema_sha256,offer_version,offer_sha256,result,decision)
VALUES ('WO-DASH01','aggregate',1,'stub+stub','synthetic',repeat('2',64),'aggregate.v1',repeat('3',64),'synthetic',repeat('4',64),
  '{"analysis":{"company_name":"Synthetic Dashboard","fact":"Synthetic Dashboard publishes a verifiable fact.","source_id":"p01","source_excerpt":"Synthetic Dashboard publishes a verifiable fact.","personalization_phrase":"Synthetic personalization phrase."}}'::jsonb,'READY_FOR_REVIEW');

INSERT INTO drafts(job_id,draft_version,recipient_email,recipient_hmac,subject,body_text,body_html,template_version,template_sha256,sendable)
VALUES
  ('WO-DASH01',1,'recipient@dashboard-smoke.example',repeat('a',64),'Actually sent subject','Actually sent body','<p>Actually sent body</p>','synthetic',repeat('5',64),true),
  ('WO-DASH01',2,'other@dashboard-smoke.example',repeat('b',64),'Later unsent subject','Later unsent body','<p>Later unsent body</p>','synthetic',repeat('6',64),true),
  ('WO-DASH02',1,'mock@dashboard-smoke.example',repeat('c',64),'Mock','Mock body','<p>Mock body</p>','synthetic',repeat('7',64),true),
  ('WO-DASH03',1,'pending@dashboard-smoke.example',repeat('d',64),'Pending','Pending body','<p>Pending body</p>','synthetic',repeat('8',64),true),
  ('WO-DASH04',1,'failed@dashboard-smoke.example',repeat('e',64),'Failed','Failed body','<p>Failed body</p>','synthetic',repeat('9',64),true),
  ('WO-DASH05',1,'claimed@dashboard-smoke.example',repeat('f',64),'Claimed','Claimed body','<p>Claimed body</p>','synthetic',repeat('0',64),true);

INSERT INTO operator_actions(action_key,job_id,draft_version,action,result_code,telegram_user_id,telegram_chat_id)
VALUES
  ('dashboard-smoke-accepted','WO-DASH01',1,'smtp_send','SMTP_OUTBOX_CREATED',81001,82001),
  ('dashboard-smoke-mock','WO-DASH02',1,'mock_send','MOCK_OUTBOX_CREATED',81001,82001),
  ('dashboard-smoke-pending','WO-DASH03',1,'smtp_send','SMTP_OUTBOX_CREATED',81001,82001),
  ('dashboard-smoke-failed','WO-DASH04',1,'smtp_send','SMTP_OUTBOX_CREATED',81001,82001),
  ('dashboard-smoke-claimed','WO-DASH05',1,'smtp_send','SMTP_OUTBOX_CREATED',81001,82001);

INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status,provider_message_id,mock_accepted_at,attempt_count,claimed_by,claimed_at)
SELECT 'dashboard-smoke-accepted',id,'WO-DASH01',1,repeat('a',64),'smtp','SMTP_ACCEPTED','synthetic-provider-id',NULL,1,'synthetic-worker',CURRENT_TIMESTAMP FROM operator_actions WHERE action_key='dashboard-smoke-accepted';
INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status,mock_accepted_at,attempt_count)
SELECT 'dashboard-smoke-mock',id,'WO-DASH02',1,repeat('c',64),'mock','MOCK_ACCEPTED',CURRENT_TIMESTAMP,1 FROM operator_actions WHERE action_key='dashboard-smoke-mock';
INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status)
SELECT 'dashboard-smoke-pending',id,'WO-DASH03',1,repeat('d',64),'smtp','SMTP_PENDING' FROM operator_actions WHERE action_key='dashboard-smoke-pending';
INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status,attempt_count)
SELECT 'dashboard-smoke-failed',id,'WO-DASH04',1,repeat('e',64),'smtp','SMTP_FAILED',1 FROM operator_actions WHERE action_key='dashboard-smoke-failed';
INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status,attempt_count,claimed_by,claimed_at)
SELECT 'dashboard-smoke-claimed',id,'WO-DASH05',1,repeat('f',64),'smtp','SMTP_CLAIMED',1,'synthetic-worker',CURRENT_TIMESTAMP FROM operator_actions WHERE action_key='dashboard-smoke-claimed';

DO $$
DECLARE v_summary dashboard_company_summary_v1%ROWTYPE; v_detail dashboard_company_detail_v1%ROWTYPE; v_version integer;
BEGIN
  SELECT * INTO v_summary FROM dashboard_company_summary_v1 WHERE canonical_hostname='dashboard-smoke.example';
  IF v_summary.send_count <> 1 OR v_summary.delivery_status <> 'SMTP_ACCEPTED' OR v_summary.engagement_status <> 'SENT_WAITING' OR v_summary.sent_at IS NULL THEN
    RAISE EXCEPTION 'SMTP truth model failed';
  END IF;
  SELECT * INTO v_detail FROM dashboard_company_detail_v1 WHERE company_id=v_summary.company_id AND campaign_type=v_summary.campaign_type;
  IF v_detail.subject <> 'Actually sent subject' OR v_detail.body_text <> 'Actually sent body' OR v_detail.sent_draft_version <> 1 THEN
    RAISE EXCEPTION 'exact sent draft selection failed';
  END IF;
  v_version := v_summary.version;
  PERFORM dashboard_set_company_status_v1(v_summary.company_id,v_summary.campaign_type,'REPLIED',v_version,'Synthetic safe note',NULL,'dashboard:smoke:reply:0001',false,NULL);
  PERFORM dashboard_set_company_status_v1(v_summary.company_id,v_summary.campaign_type,'REPLIED',v_version,'Synthetic safe note',NULL,'dashboard:smoke:reply:0001',false,NULL);
  IF (SELECT count(*) FROM company_status_history WHERE action_key='dashboard:smoke:reply:0001') <> 1 THEN RAISE EXCEPTION 'idempotent history failed'; END IF;
  BEGIN
    PERFORM dashboard_set_company_status_v1(v_summary.company_id,v_summary.campaign_type,'INTERESTED',v_version,NULL,NULL,'dashboard:smoke:conflict:01',false,NULL);
    RAISE EXCEPTION 'optimistic conflict was not raised';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'VERSION_CONFLICT' THEN RAISE; END IF;
  END;
  SELECT version INTO v_version FROM company_campaign_state WHERE company_id=v_summary.company_id AND campaign_type=v_summary.campaign_type;
  PERFORM dashboard_set_company_status_v1(v_summary.company_id,v_summary.campaign_type,'DO_NOT_CONTACT',v_version,NULL,NULL,'dashboard:smoke:dnc:000001',true,'RECIPIENT_REQUEST');
  IF NOT EXISTS (SELECT 1 FROM suppression WHERE recipient_hmac=repeat('a',64) AND reason='RECIPIENT_REQUEST') THEN RAISE EXCEPTION 'recipient suppression failed'; END IF;
  IF EXISTS (SELECT 1 FROM suppression WHERE recipient_hmac=repeat('b',64) AND reason='RECIPIENT_REQUEST') THEN RAISE EXCEPTION 'wrong draft recipient suppressed'; END IF;
  IF (SELECT status FROM jobs WHERE job_id='WO-DASH01') <> 'DRAFT_READY' OR (SELECT status FROM outbox WHERE job_id='WO-DASH01') <> 'SMTP_ACCEPTED' OR (SELECT subject FROM drafts WHERE job_id='WO-DASH01' AND draft_version=1) <> 'Actually sent subject' THEN
    RAISE EXCEPTION 'engagement update mutated delivery records';
  END IF;
  BEGIN
    UPDATE company_status_history SET safe_metadata='{}'::jsonb WHERE action_key='dashboard:smoke:reply:0001';
    RAISE EXCEPTION 'history update was not blocked';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'COMPANY_STATUS_HISTORY_IMMUTABLE' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO jobs(job_id,canonical_url,hostname,telegram_user_id,telegram_chat_id,status,expires_at)
VALUES ('WO-DASH06','https://dashboard-smoke.example/blocked','dashboard-smoke.example',81001,82001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour');
INSERT INTO drafts(job_id,draft_version,recipient_email,recipient_hmac,subject,body_text,body_html,template_version,template_sha256,sendable)
VALUES ('WO-DASH06',1,'blocked@dashboard-smoke.example',repeat('1',64),'Blocked','Blocked','<p>Blocked</p>','synthetic',repeat('2',64),true);
INSERT INTO operator_actions(action_key,job_id,draft_version,action,result_code,telegram_user_id,telegram_chat_id)
VALUES ('dashboard-smoke-blocked','WO-DASH06',1,'smtp_send','SMTP_OUTBOX_CREATED',81001,82001);
DO $$
BEGIN
  BEGIN
    INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status)
    SELECT 'dashboard-smoke-blocked',id,'WO-DASH06',1,repeat('1',64),'smtp','SMTP_PENDING' FROM operator_actions WHERE action_key='dashboard-smoke-blocked';
    RAISE EXCEPTION 'do-not-contact outbox was not blocked';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'COMPANY_DO_NOT_CONTACT' THEN RAISE; END IF;
  END;
END;
$$;

SET LOCAL ROLE workoutreach_dashboard;
SELECT count(*) FROM dashboard_company_summary_v1;
SELECT * FROM dashboard_stats_v1();
DO $$
BEGIN
  BEGIN PERFORM count(*) FROM jobs; RAISE EXCEPTION 'base select unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM count(*) FROM suppression; RAISE EXCEPTION 'suppression select unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE p.proname IN ('dashboard_stats_v1', 'dashboard_set_company_status_v1')
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'dashboard function is executable by public';
  END IF;
END;
$$;

ROLLBACK;
