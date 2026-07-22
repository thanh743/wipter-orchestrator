#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/thanh743/wipter-orchestrator.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/wipter-orchestrator}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-4000}"
DASHBOARD_USER="${DASHBOARD_USER:-admin}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-routerProxy}"
PROVISION_CONCURRENCY="${PROVISION_CONCURRENCY:-2}"

INSTALL_URL="${INSTALL_URL:-https://raw.githubusercontent.com/thanh743/wipter-orchestrator/${BRANCH}/scripts/install-vps.sh}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please login VPS as root, then run this script again." >&2
  exit 1
fi

tmp_script="/tmp/install-wipter-vps.sh"
curl -fsSL "$INSTALL_URL" -o "$tmp_script"
chmod +x "$tmp_script"

APP_DIR="$APP_DIR" \
REPO_URL="$REPO_URL" \
BRANCH="$BRANCH" \
FRONTEND_PORT="$FRONTEND_PORT" \
BACKEND_HOST_PORT="$BACKEND_HOST_PORT" \
DASHBOARD_USER="$DASHBOARD_USER" \
DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
PROVISION_CONCURRENCY="$PROVISION_CONCURRENCY" \
bash "$tmp_script"

