# ADR-0009: локальная операторская панель

- Статус: принято
- Дата: 2026-07-20

## Контекст

Владелец должен видеть обработанные компании, отличать реальное SMTP acceptance от mock/approval-состояний и вручную фиксировать результат взаимоотношений. Исходный MVP исключал CRM, поэтому новый интерфейс должен оставаться узкой локальной read-mostly витриной и не становиться вторым approval- или send-контуром.

## Решение

Добавляется отдельный сервис `workoutreach-dashboard` на Node.js 24, `pg`, HTML/CSS и vanilla JavaScript. Он доступен только через Caddy по `https://dashboard.workoutreach.localhost`, подключён только к внутренней сети и не получает Telegram, OpenAI, SMTP или suppression-HMAC secrets.

PostgreSQL хранит каноническую компанию по нормализованному hostname и отдельное состояние `(company_id, campaign_type)`. Delivery status вычисляется только из технических таблиц и недоступен для изменения. Единственная текущая истина реальной отправки — `outbox.transport='smtp' AND outbox.status='SMTP_ACCEPTED'`. Это отображается как «Отправлено — принято Gmail SMTP» с оговоркой, что acceptance не подтверждает попадание во входящие или прочтение. Mock никогда не считается отправкой.

Engagement status имеет отдельные значения `NOT_CONTACTED`, `SENT_WAITING`, `REPLIED`, `INTERESTED`, `FOLLOW_UP_LATER`, `NOT_INTERESTED`, `DO_NOT_CONTACT`. `SENT_WAITING` создаётся системой после первого SMTP acceptance; оператор не может назначить его произвольно. `DO_NOT_CONTACT` терминален в UI и блокирует создание будущей outbox-команды на уровне БД. Для просьбы адресата серверная транзакция добавляет в suppression HMAC именно адресата последнего принятого SMTP-письма, не раскрывая ключ панели.

Роль `workoutreach_dashboard` имеет `SELECT` только на три dashboard view и `EXECUTE` на ограниченные функции. Изменение engagement status выполняется одной `SECURITY DEFINER` функцией с фиксированным `search_path`, row lock, optimistic version, идемпотентным action key, append-only history и безопасным audit event.

## Последствия

- Панель не отправляет, не повторяет, не подтверждает и не изменяет письма, анализы, jobs или outbox.
- Telegram остаётся единственным approval-контуром отправки.
- Панель не является CRM: нет sequences, follow-up automation, удаления, редактирования контента или внешних интеграций.
- Появляются отдельные локальные secrets для DB-пароля, scrypt password hash и session signing key.
- Существующие PostgreSQL volumes требуют отдельного идемпотентного provisioning роли; один только `docker-entrypoint-initdb.d` недостаточен.
