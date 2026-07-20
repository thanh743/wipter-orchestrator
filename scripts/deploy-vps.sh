#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wipter-orchestrator}"

if [ ! -f ".env" ]; then
  cp .env.example .env
fi

docker compose --profile build-sidecar --profile build-wipter build sidecar-builder wipter-builder
docker compose up -d --build postgres redis backend frontend

echo "Wipter Orchestrator is running."
echo "Frontend: http://SERVER_IP:5173"
echo "Backend:  http://SERVER_IP:4000"
