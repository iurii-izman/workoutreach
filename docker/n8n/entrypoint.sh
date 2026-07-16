#!/bin/sh
set -eu

export DB_POSTGRESDB_PASSWORD="$(cat /run/secrets/n8n_db_password)"
export N8N_ENCRYPTION_KEY="$(cat /run/secrets/n8n_encryption_key)"

exec tini -- /docker-entrypoint.sh "$@"
