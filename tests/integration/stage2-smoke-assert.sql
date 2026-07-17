\set ON_ERROR_STOP on
SET search_path TO workoutreach, public;

DO $$
DECLARE
  v_count integer;
  v_status text;
BEGIN
  SELECT count(*) INTO v_count FROM outbox WHERE job_id = 'WO-STG201';
  IF v_count <> 1 THEN RAISE EXCEPTION 'stage2 replay created % outbox rows', v_count; END IF;
  SELECT status INTO v_status FROM outbox WHERE job_id = 'WO-STG201';
  IF v_status <> 'MOCK_ACCEPTED' THEN RAISE EXCEPTION 'stage2 mock dispatch status is %', v_status; END IF;

  SELECT count(*) INTO v_count FROM outbox WHERE job_id = 'WO-STG202';
  IF v_count <> 0 THEN RAISE EXCEPTION 'suppressed job created an outbox row'; END IF;
  SELECT status INTO v_status FROM jobs WHERE job_id = 'WO-STG202';
  IF v_status <> 'DRAFT_READY' THEN RAISE EXCEPTION 'suppressed job changed to %', v_status; END IF;

  SELECT count(*) INTO v_count FROM outbox WHERE job_id = 'WO-STG203';
  IF v_count <> 1 THEN RAISE EXCEPTION 'concurrent approvals created % outbox rows', v_count; END IF;
  SELECT count(*) INTO v_count FROM operator_actions WHERE job_id = 'WO-STG203' AND action = 'mock_send';
  IF v_count <> 1 THEN RAISE EXCEPTION 'concurrent approvals created % action rows', v_count; END IF;
  SELECT status INTO v_status FROM outbox WHERE job_id = 'WO-STG203';
  IF v_status <> 'SUPPRESSION_BLOCKED' THEN RAISE EXCEPTION 'dispatch-time suppression status is %', v_status; END IF;

  IF EXISTS (SELECT 1 FROM outbox WHERE provider_message_id IS NOT NULL OR transport <> 'mock') THEN
    RAISE EXCEPTION 'stage2 outbox escaped physical mock constraints';
  END IF;
  IF EXISTS (
    SELECT 1 FROM stage2_safety_controls
    WHERE live_send_enabled OR mail_transport <> 'disabled' OR daily_send_limit <> 0 OR NOT kill_switch_enabled
  ) THEN RAISE EXCEPTION 'stage2 safety controls changed'; END IF;
END;
$$;

SELECT json_build_object(
  'ok', true,
  'replay_outbox_rows', (SELECT count(*) FROM outbox WHERE job_id = 'WO-STG201'),
  'suppressed_outbox_rows', (SELECT count(*) FROM outbox WHERE job_id = 'WO-STG202'),
  'concurrent_outbox_rows', (SELECT count(*) FROM outbox WHERE job_id = 'WO-STG203'),
  'dispatch_suppression_status', (SELECT status FROM outbox WHERE job_id = 'WO-STG203'),
  'transport', 'mock',
  'mail_transmitted', false
) AS stage2_smoke;
