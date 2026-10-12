#!/bin/bash
# Serve the frontend to the .dev build on the phone: Vite on the address the
# app was built against, the Linux box's end of its own Wi-Fi hotspot
# (NetworkManager connection rp-dev-hotspot, wlx90de80086e79, 10.42.0.1/24). Run from any directory of the checkout or worktree
# whose code you want on the phone.
#
#   scripts/ios-linux/dev-server.sh          # foreground
#   RP_DEV_PORT=1437 RP_LAN_HOST=10.42.0.1 scripts/ios-linux/dev-server.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST=${RP_LAN_HOST:-10.42.0.1}
PORT=${RP_DEV_PORT:-1437}
export RP_LAN_HOST=$HOST RP_DEV_PORT=$PORT

ip -4 -o addr show | grep -q " inet $HOST/" || {
  echo "this machine does not have $HOST; the .dev app was built to load http://$HOST:$PORT" >&2
  echo "rebuild it with DEV_HOST set to the current address (ios-linux-loop.yml)" >&2
  exit 1
}
# The phone connects in over the hotspot; ufw's default input policy drops that
# silently (the app then shows "did you grant local network permissions?").
if systemctl is-active --quiet ufw; then
  dev=$(ip -4 -o addr show | awk -v h="$HOST" '$4 ~ "^"h"/" {print $2; exit}')
  echo "ufw is active: the device can only reach $HOST:$PORT/$((PORT+1)) if the hotspot interface is allowed:" >&2
  echo "  sudo ufw allow in on $dev && sudo ufw route allow in on $dev" >&2
fi
[ -e node_modules ] || { echo "no node_modules here: bun install (or link the main checkout's)" >&2; exit 1; }
[ -f public/pdfium.wasm ] || bun run wasm

exec ./node_modules/.bin/vite --config scripts/ios-linux/vite.lan.config.ts
