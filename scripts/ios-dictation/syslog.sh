#!/bin/bash
# Capture the device console, filtered to our own RP-DICT lines plus anything
# from the app or the inspector daemon. Runs detached; kill with `pkill -f
# idevicesyslog`.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin"
UDID=00008140-000C31641EEB001C
OUT=${1:-/tmp/rp-dict.log}
pkill -f idevicesyslog 2>/dev/null || true
sleep 1
: > "$OUT"
# Filtered to our own prefix. Unfiltered the device writes about half a
# megabyte a second and idevicesyslog silently drops what it cannot keep up
# with: one run produced a 127 MB log carrying thirteen RP-DICT lines.
( nohup idevicesyslog -u "$UDID" -m RP-DICT > "$OUT" 2>&1 < /dev/null & )
sleep 2
pgrep -fl idevicesyslog | head -2
echo "logging to $OUT"
