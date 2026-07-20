# Локальная операторская панель

## Назначение и граница безопасности

Панель — read-mostly витрина компаний и истории. Она не является CRM и не умеет отправлять или повторять письма, подтверждать Telegram draft, запускать OpenAI, менять `jobs`/`outbox`, редактировать drafts/analyses или снимать suppression. Реальная отправка означает только `smtp + SMTP_ACCEPTED`.

## Первый запуск и пароль

Docker Desktop должен быть запущен. Выполните в интерактивном PowerShell:

```powershell
npm run dashboard:setup
```

Команда скрыто запросит пароль длиной не менее 12 символов, сохранит только его scrypt hash, создаст отдельные DB/session secrets, поднимет PostgreSQL, сделает локальный owner-only custom-format backup до миграции существующей базы, provision роль, применит миграции и запустит панель. Секреты находятся только в игнорируемой `.secrets/`; backup — в игнорируемой `.runtime/backups/`. Их значения и содержимое БД не печатаются.

Откройте `https://dashboard.workoutreach.localhost`. Внутренний сертификат Caddy может потребовать локального доверия к Caddy CA. Cookie host-only, `Secure`, `HttpOnly`, `SameSite=Strict`; сессия ограничена восемью часами.

## Обычные команды

```powershell
npm run dashboard:start
npm run dashboard:status
npm run dashboard:stop
```

`dashboard:stop` останавливает только dashboard-контейнер и не удаляет volumes. Для смены пароля повторите `npm run dashboard:setup`: DB/session secrets переиспользуются, password hash заменяется, роль provisionится идемпотентно.

## Backup и restore

Перед первым применением миграции 008 setup создаёт `.runtime/backups/pre-dashboard-008-<timestamp>.dump` с owner-only permissions. Не коммитьте и не пересылайте файл: он может содержать PII. Для восстановления остановите локальный stack, создайте отдельную проверочную БД и используйте pinned PostgreSQL image/`pg_restore`; не восстанавливайте поверх рабочей БД без отдельного окна и сверки row counts.

Общий квартальный restore-процесс и требования к шифрованию остаются в [backup-restore.md](backup-restore.md). Dashboard backup не заменяет полный backup обеих БД, n8n volume и encryption material.

## Проверка

```powershell
npm run smoke:dashboard-db
npm run smoke:docker
```

Smoke использует только synthetic строки внутри транзакции с `ROLLBACK`: реальные engagement statuses не меняются, а OpenAI, Telegram и email не вызываются.

## Troubleshooting

- `HOST_INVALID`/HTTP 421: используйте ровно `https://dashboard.workoutreach.localhost`, не IP и не альтернативный hostname.
- `ORIGIN_INVALID` или `REQUEST_FORBIDDEN`: не открывайте панель через прокси/порт вне Caddy; обновите страницу после долгой паузы.
- `SESSION_EXPIRED`: войдите снова; незаписанные поля формы не применялись.
- `VERSION_CONFLICT`: другой update уже изменил компанию; UI перечитает карточку, после проверки повторите действие.
- `SAFE_NOTE_CONTAINS_PII`: удалите email или URL. Safe note предназначена только для короткой операционной пометки.
- `ACCEPTED_RECIPIENT_REQUIRED`: «просьба адресата» допустима только при наличии фактически принятого SMTP-письма. Для превентивного запрета выберите «решение владельца».
- Контейнер unhealthy: проверьте `npm run dashboard:status`, наличие трёх dashboard secret files и применение pending migrations; не выводите secret files или DB rows в консоль. Checksum mismatch требует восстановления неизменённого migration file или перехода на checkout, соответствующий версии БД — не редактируйте применённую миграцию.
