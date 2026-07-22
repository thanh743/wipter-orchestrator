#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/wipter-orchestrator}"
RESET_WIPTER="${RESET_WIPTER:-false}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please login VPS as root, then run this script again." >&2
  exit 1
fi

if [ "$RESET_WIPTER" != "true" ]; then
  cat >&2 <<EOF
This will remove the current Wipter dashboard, database volume, imported proxies and node mappings.

Run again with:
  RESET_WIPTER=true bash scripts/quick-reinstall.sh

Or remote one-line:
  curl -fsSL https://raw.githubusercontent.com/thanh743/wipter-orchestrator/main/scripts/quick-reinstall.sh -o /tmp/reinstall-wipter.sh
  RESET_WIPTER=true DASHBOARD_PASSWORD='routerProxy' bash /tmp/reinstall-wipter.sh
EOF
  exit 1
fi

if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  docker compose down -v --remove-orphans || true
fi

docker ps -a --format '{{.Names}}' | grep -E '^(wipter-|eo-wipter-|eo-sidecar-)' | xargs -r docker rm -f
docker volume ls --format '{{.Name}}' | grep -E 'wipter.*postgres|wipter-orchestrator_postgres-data' | xargs -r docker volume rm -f
rm -rf "$APP_DIR"

curl -fsSL https://raw.githubusercontent.com/thanh743/wipter-orchestrator/main/scripts/quick-install.sh -o /tmp/quick-install-wipter.sh
chmod +x /tmp/quick-install-wipter.sh
bash /tmp/quick-install-wipter.sh

