#!/bin/sh
set -eu

n8n_password="$(cat /run/secrets/n8n_db_password)"
business_password="$(cat /run/secrets/business_db_password)"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=n8n_password="$n8n_password" --set=business_password="$business_password" <<'SQL'
SELECT format('CREATE ROLE workoutreach_n8n LOGIN PASSWORD %L', :'n8n_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workoutreach_n8n') \gexec

SELECT format('CREATE ROLE workoutreach_app LOGIN PASSWORD %L', :'business_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workoutreach_app') \gexec

SELECT 'CREATE DATABASE workoutreach_n8n OWNER workoutreach_n8n'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'workoutreach_n8n') \gexec

SELECT 'CREATE DATABASE workoutreach_business OWNER workoutreach_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'workoutreach_business') \gexec
SQL
