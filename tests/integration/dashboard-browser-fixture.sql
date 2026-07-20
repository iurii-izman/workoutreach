\set ON_ERROR_STOP on
\set QUIET on
SET search_path TO workoutreach, public;

INSERT INTO jobs(job_id,canonical_url,hostname,telegram_user_id,telegram_chat_id,status,expires_at)
VALUES
  ('WO-VIS001','https://visual-smoke.example/','visual-smoke.example',83001,84001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour'),
  ('WO-VIS002','https://mock-visual.example/','mock-visual.example',83001,84001,'DRAFT_READY',CURRENT_TIMESTAMP+interval '1 hour');
INSERT INTO pages(job_id,source_id,source_url,source_type,title,content_sha256,normalized_text)
VALUES ('WO-VIS001','p01','https://visual-smoke.example/about','about','Синтетика Сервис',repeat('1',64),'Синтетика Сервис опубликовала проверяемый учебный кейс автоматизации CRM.');
INSERT INTO contact_candidates(job_id,email,normalized_email,category,source_id,source_url,source_excerpt,automatic_selection_allowed)
VALUES ('WO-VIS001','hello@visual-smoke.example','hello@visual-smoke.example','general','p01','https://visual-smoke.example/about','Опубликованный синтетический контакт',true);
INSERT INTO analyses(job_id,stage,version,model_id,prompt_version,prompt_sha256,schema_version,schema_sha256,offer_version,offer_sha256,result,decision)
VALUES ('WO-VIS001','aggregate',1,'stub+stub','synthetic',repeat('2',64),'aggregate.v1',repeat('3',64),'synthetic',repeat('4',64),
  '{"analysis":{"company_name":"Синтетика Сервис","fact":"Компания опубликовала проверяемый учебный кейс автоматизации CRM.","source_id":"p01","source_excerpt":"Синтетика Сервис опубликовала проверяемый учебный кейс автоматизации CRM.","personalization_phrase":"Ваш синтетический кейс автоматизации CRM пересекается с проверяемым опытом проектирования и сопровождения решений для команд интеграторов."}}'::jsonb,'READY_FOR_REVIEW');
INSERT INTO drafts(job_id,draft_version,recipient_email,recipient_hmac,subject,body_text,body_html,template_version,template_sha256,sendable)
VALUES
  ('WO-VIS001',1,'hello@visual-smoke.example',repeat('a',64),'Синтетическая тема',E'Здравствуйте!\n\nЭто синтетическое письмо для visual QA.','<p>Синтетическое письмо для visual QA.</p>','synthetic',repeat('5',64),true),
  ('WO-VIS002',1,'hello@mock-visual.example',repeat('b',64),'Mock тема','Mock body','<p>Mock body</p>','synthetic',repeat('6',64),true);
INSERT INTO operator_actions(action_key,job_id,draft_version,action,result_code,telegram_user_id,telegram_chat_id)
VALUES
  ('visual-smoke-accepted','WO-VIS001',1,'smtp_send','SMTP_OUTBOX_CREATED',83001,84001),
  ('visual-smoke-mock','WO-VIS002',1,'mock_send','MOCK_OUTBOX_CREATED',83001,84001);
INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status,provider_message_id,attempt_count,claimed_by,claimed_at)
SELECT 'visual-smoke-accepted',id,'WO-VIS001',1,repeat('a',64),'smtp','SMTP_ACCEPTED','synthetic-visual-provider',1,'synthetic-worker',CURRENT_TIMESTAMP FROM operator_actions WHERE action_key='visual-smoke-accepted';
INSERT INTO outbox(command_key,operator_action_id,job_id,draft_version,recipient_hmac,transport,status,mock_accepted_at,attempt_count)
SELECT 'visual-smoke-mock',id,'WO-VIS002',1,repeat('b',64),'mock','MOCK_ACCEPTED',CURRENT_TIMESTAMP,1 FROM operator_actions WHERE action_key='visual-smoke-mock';
