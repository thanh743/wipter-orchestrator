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
    sleep 10
    for attempt in 1 2 3 4 5; do
      log "Attempting first-run credential fill (${attempt}/5)"
      wid="$(xdotool search --onlyvisible --name Wipter 2>/dev/null | head -n 1 || true)"
      if [ -z "$wid" ]; then
        wid="$(xdotool search --onlyvisible --class wipter 2>/dev/null | head -n 1 || true)"
      fi
      if [ -z "$wid" ]; then
        sleep 8
        continue
      fi

      xdotool windowactivate "$wid" 2>/dev/null || true
      sleep 1
      eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null || true)"
      width="${WIDTH:-640}"
      x="${X:-320}"
      y="${Y:-80}"

      email_x=$((x + width / 2 - 80))
      email_y=$((y + 258))
      password_x="$email_x"
      password_y=$((y + 353))
      submit_x=$((x + width - 115))
      submit_y=$((y + 447))

      xdotool mousemove "$email_x" "$email_y" click 1 2>/dev/null || true
      xdotool key ctrl+a BackSpace 2>/dev/null || true
      xdotool type --delay 25 "$WIPTER_EMAIL" 2>/dev/null || true
      sleep 0.2
      xdotool mousemove "$password_x" "$password_y" click 1 2>/dev/null || true
      xdotool key ctrl+a BackSpace 2>/dev/null || true
      xdotool type --delay 25 "$WIPTER_PASSWORD" 2>/dev/null || true
      sleep 0.2
      xdotool mousemove "$submit_x" "$submit_y" click 1 2>/dev/null || true
      sleep 20
    done
  ) &
fi

tail -F /tmp/wipter-app.log /tmp/openbox.log /tmp/x11vnc.log &
wait "$app_pid"
