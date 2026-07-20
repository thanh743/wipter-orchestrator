#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/root}"
export DISPLAY="${DISPLAY:-:99}"
VNC_PASSWORD="${VNC_PASSWORD:-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)}"

log() {
  printf '[wipter] %s\n' "$*"
}

cleanup() {
  pkill -TERM -P $$ 2>/dev/null || true
}
trap cleanup TERM INT

Xvfb "$DISPLAY" -screen 0 1280x900x24 -nolisten tcp &
sleep 1
openbox >/tmp/openbox.log 2>&1 &
x11vnc -display "$DISPLAY" -localhost -passwd "$VNC_PASSWORD" -forever -shared >/tmp/x11vnc.log 2>&1 &

log "Xvfb ready on ${DISPLAY}"
log "Wipter app launching"

/opt/wipter/wipter-app --no-sandbox --disable-dev-shm-usage >/tmp/wipter-app.log 2>&1 &
app_pid=$!

if [ -n "${WIPTER_EMAIL:-}" ] && [ -n "${WIPTER_PASSWORD:-}" ]; then
  (
    sleep 12
    log "Attempting first-run credential fill"
    xdotool search --sync --onlyvisible --class wipter windowactivate 2>/dev/null || true
    xdotool type --delay 25 "$WIPTER_EMAIL" 2>/dev/null || true
    xdotool key Tab 2>/dev/null || true
    xdotool type --delay 25 "$WIPTER_PASSWORD" 2>/dev/null || true
    xdotool key Return 2>/dev/null || true
  ) &
fi

tail -F /tmp/wipter-app.log /tmp/openbox.log /tmp/x11vnc.log &
wait "$app_pid"
