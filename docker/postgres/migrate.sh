#!/bin/sh
set -eu

export PGPASSWORD="$(cat /run/secrets/business_db_password)"

for migration in /workoutreach/migrations/*.sql; do
  psql --set=ON_ERROR_STOP=1 \
    --host=workoutreach-postgres \
    --username=workoutreach_app \
    --dbname=workoutreach_business \
    --file="$migration"
done
