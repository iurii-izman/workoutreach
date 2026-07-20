#!/bin/sh
set -eu

admin_password="$(cat /run/secrets/postgres_admin_password)"
dashboard_password="$(cat /run/secrets/dashboard_db_password)"
export PGPASSWORD="$admin_password"

psql --set=ON_ERROR_STOP=1 \
  --host=workoutreach-postgres \
  --username=workoutreach_admin \
  --dbname=postgres \
  --set=dashboard_password="$dashboard_password" <<'SQL'
SELECT format(
  'CREATE ROLE workoutreach_dashboard LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
  :'dashboard_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workoutreach_dashboard') \gexec

SELECT format('ALTER ROLE workoutreach_dashboard PASSWORD %L', :'dashboard_password') \gexec
ALTER ROLE workoutreach_dashboard NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
GRANT CONNECT ON DATABASE workoutreach_business TO workoutreach_dashboard;
SQL

unset PGPASSWORD admin_password dashboard_password
