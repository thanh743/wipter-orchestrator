#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/wipter-orchestrator}"
REPO_URL="${REPO_URL:-https://github.com/thanh743/wipter-orchestrator.git}"
BRANCH="${BRANCH:-main}"
BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-4101}"
FRONTEND_PORT="${FRONTEND_PORT:-5174}"
DASHBOARD_USER="${DASHBOARD_USER:-admin}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-}"
PROVISION_CONCURRENCY="${PROVISION_CONCURRENCY:-5}"
INSTALL_FIREWALL="${INSTALL_FIREWALL:-true}"

log() {
  printf "\033[1;32m==>\033[0m %s\n" "$*"
}

warn() {
  printf "\033[1;33mWARN:\033[0m %s\n" "$*"
}

die() {
  printf "\033[1;31mERROR:\033[0m %s\n" "$*" >&2
  exit 1
}

random_hex() {
  openssl rand -hex "${1:-24}"
}

get_public_ip() {
  curl -4 -fsS --max-time 6 https://api.ipify.org 2>/dev/null \
    || curl -4 -fsS --max-time 6 https://checkip.amazonaws.com 2>/dev/null \
    || hostname -I | awk '{print $1}'
}

read_env_value() {
  local key="$1"
  local file="$2"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "Please login as root, or run: sudo bash scripts/install-vps.sh"
  fi
}

install_packages() {
  log "Installing system packages"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gnupg openssl ufw
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker is already installed"
    return
  fi

  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  docker --version
  docker compose version
}

download_source() {
  if [[ "$REPO_URL" == *"YOUR_USERNAME"* ]]; then
    die "Set REPO_URL first. Example: REPO_URL=https://github.com/yourname/wipter-orchestrator.git bash scripts/install-vps.sh"
  fi

  if [ -d "$APP_DIR/.git" ]; then
    log "Updating source in $APP_DIR"
    git -C "$APP_DIR" fetch --all --prune
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
    return
  fi

  if [ -e "$APP_DIR" ] && [ "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)" -gt 0 ]; then
    local backup="${APP_DIR}.backup-$(date +%Y%m%d-%H%M%S)"
    warn "$APP_DIR is not empty. Moving it to $backup"
    mv "$APP_DIR" "$backup"
  fi

  log "Cloning source to $APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
}

write_env() {
  cd "$APP_DIR"

  if [ -f .env ]; then
    log "Keeping existing .env"
    local saved_password
    saved_password="$(read_env_value BASIC_AUTH_PASSWORD .env)"
    if [ -z "$DASHBOARD_PASSWORD" ] && [ -n "$saved_password" ]; then
      DASHBOARD_PASSWORD="$saved_password"
    fi
  else
    log "Creating .env"
    DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-$(random_hex 9)}"
    cat > .env <<EOF
NODE_ENV=production
APP_PORT=4000
BACKEND_HOST_PORT=${BACKEND_HOST_PORT}
APP_HOST=0.0.0.0
FRONTEND_PORT=${FRONTEND_PORT}
CORS_ORIGIN=http://localhost:${FRONTEND_PORT}
VITE_API_BASE_URL=/api
BASIC_AUTH_USER=${DASHBOARD_USER}
BASIC_AUTH_PASSWORD=${DASHBOARD_PASSWORD}

POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=wipter_orchestrator
POSTGRES_USER=wipter
POSTGRES_PASSWORD=$(random_hex 18)
DB_SYNCHRONIZE=true

REDIS_HOST=redis
REDIS_PORT=6379

DOCKER_SOCKET=/var/run/docker.sock
WIPTER_IMAGE=earnapp-orchestrator/wipter-official:latest
WIPTER_EMAIL=
WIPTER_PASSWORD=
WIPTER_DEVICE_PREFIX=wipter
WIPTER_XVFB_SCREEN=1280x900x16
WIPTER_ENABLE_VNC=false
SIDECAR_IMAGE=earnapp-orchestrator/redsocks-sidecar:latest
SIDECAR_STRATEGY=redsocks
PROVISION_CONCURRENCY=${PROVISION_CONCURRENCY}
PROVISION_ATTEMPTS=3
PROVISION_BACKOFF_MS=30000
STRICT_PROXY_EGRESS_MATCH=false
LEAK_BLOCKED_IPS=
EARNER_MEMORY_MB=384
EARNER_SHM_MB=128
SIDECAR_MEMORY_MB=128
EARNER_NANO_CPUS=400000000
SIDECAR_NANO_CPUS=100000000
EARNER_PIDS_LIMIT=256
SIDECAR_PIDS_LIMIT=128
DOCKER_LOG_MAX_SIZE=10m
DOCKER_LOG_MAX_FILE=3
ALERT_DEDUPE_MS=600000
CAPACITY_MEMORY_RESERVE_MB=384
CAPACITY_DISK_RESERVE_GB=5
CAPACITY_NODE_DISK_MB=200
PROXY_SECRET_KEY=$(random_hex 32)

DRY_RUN_DOCKER=false

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF
    chmod 600 .env
  fi

  DASHBOARD_USER="$(read_env_value BASIC_AUTH_USER .env)"
  DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-$(read_env_value BASIC_AUTH_PASSWORD .env)}"
  [ -n "$DASHBOARD_USER" ] || DASHBOARD_USER=admin
  [ -n "$DASHBOARD_PASSWORD" ] || DASHBOARD_PASSWORD="$(random_hex 9)"

  log "Creating dashboard password file"
  mkdir -p frontend
  printf "%s:%s\n" "$DASHBOARD_USER" "$(openssl passwd -apr1 "$DASHBOARD_PASSWORD")" > frontend/.htpasswd
  chmod 644 frontend/.htpasswd
}

configure_firewall() {
  if [ "$INSTALL_FIREWALL" != "true" ]; then
    warn "Skipping firewall setup"
    return
  fi

  log "Configuring firewall"
  ufw allow OpenSSH >/dev/null || true
  ufw allow "${FRONTEND_PORT}/tcp" >/dev/null || true
  ufw --force enable >/dev/null || true
}

start_stack() {
  cd "$APP_DIR"
  log "Building sidecar and Wipter images"
  docker compose --profile build-sidecar --profile build-wipter build sidecar-builder wipter-builder

  log "Starting dashboard, backend, database and queue"
  docker compose up -d --build postgres redis backend frontend

  log "Waiting for backend"
  for _ in $(seq 1 60); do
    if curl -u "${DASHBOARD_USER}:${DASHBOARD_PASSWORD}" -fsS "http://127.0.0.1:${FRONTEND_PORT}/api/health" >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  warn "Backend did not answer yet. Check logs with: docker logs -f wipter-backend"
}

print_result() {
  local ip
  ip="$(get_public_ip)"
  cat <<EOF

============================================================
Wipter Orchestrator is ready.

Open:
  http://${ip}:${FRONTEND_PORT}

Dashboard login:
  User:     ${DASHBOARD_USER}
  Password: ${DASHBOARD_PASSWORD}

Next steps:
  1. Open the dashboard.
  2. Enter your Wipter email/password in "Wipter Account".
  3. Paste proxies in "Proxy Import".
  4. Click "Provision All".

Useful commands:
  cd ${APP_DIR}
  docker compose ps
  docker logs -f wipter-backend
  docker compose down
============================================================

EOF
}

main() {
  require_root
  install_packages
  install_docker
  download_source
  write_env
  configure_firewall
  start_stack
  print_result
}

main "$@"
