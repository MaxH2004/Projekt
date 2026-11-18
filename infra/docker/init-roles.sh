#!/usr/bin/env bash
# Runs once when the database container starts with an empty volume: creates
# the roles of infra/scripts/create-roles.sql with passwords from the environment.
set -euo pipefail
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_password="$HV_OWNER_PASSWORD" \
  -v app_password="$HV_LOGIN_PASSWORD" \
  -v backup_password="$HV_BACKUP_PASSWORD" \
  -f /hv/create-roles.sql
