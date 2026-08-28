#!/bin/bash
# Capture the device console for the app. Runs detached; kill with `pkill -f
# idevicesyslog`.
#
#   syslog.sh [output file] [process name]
#
# Filtered by process rather than by the RP-DICT prefix, because the question it
# has to answer is usually "the app went away and left no crash report, why" —
# and the lines that say why belong to the runtime, not to us. RP-SPEECH, the
# probe's own prefix, is not an RP-DICT line either, so a prefix match misses
# every playback run.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin"
UDID=00008140-000C31641EEB001C
OUT=${1:-/tmp/rp-dict.log}
PROC=${2:-Reading Partner}
pkill -f idevicesyslog 2>/dev/null || true
sleep 1
: > "$OUT"
# Filtered, always. Unfiltered the device writes about half a megabyte a second
# and idevicesyslog silently drops what it cannot keep up with: one run produced
# a 127 MB log carrying thirteen RP-DICT lines.
( nohup idevicesyslog -u "$UDID" -p "$PROC" > "$OUT" 2>&1 < /dev/null & )
sleep 2
pgrep -fl idevicesyslog | head -2
echo "logging to $OUT"
