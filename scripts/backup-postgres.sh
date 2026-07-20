#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wipter-orchestrator}"
BACKUP_DIR="${BACKUP_DIR:-/opt/wipter-orchestrator/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
outfile="$BACKUP_DIR/wipter_orchestrator_${timestamp}.sql.gz"

docker exec wipter-postgres pg_dump -U "${POSTGRES_USER:-wipter}" "${POSTGRES_DB:-wipter_orchestrator}" | gzip > "$outfile"
find "$BACKUP_DIR" -type f -name '*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "$outfile"
