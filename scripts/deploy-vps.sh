#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wipter-orchestrator}"

if [ ! -f ".env" ]; then
  echo ".env is missing. Run scripts/install-vps.sh first so secrets are generated safely." >&2
  exit 1
fi

docker compose --profile build-sidecar --profile build-wipter build sidecar-builder wipter-builder
docker compose up -d --build postgres redis backend frontend

echo "Wipter Orchestrator is running."
echo "Frontend: http://SERVER_IP:5173"
echo "Backend is bound to 127.0.0.1 and is available through /api on the frontend."
