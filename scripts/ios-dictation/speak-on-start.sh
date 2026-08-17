#!/bin/bash
# Wait for the long run's hold to actually open the microphone, then talk for as
# long as it lasts.
#
# The tap that starts the run comes from a person at an unknown moment, and
# speaking into a phone that is not yet recording wastes the front of the run.
# `RP-DICT running` is the line the plugin writes when the engine is up, so that
# is the cue.
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
LOG=${1:-/tmp/rp-long.log}
MINUTES=${2:-21}

echo "$(date +%H:%M:%S) waiting for the hold to start"
for _ in $(seq 1 2400); do
  if grep -q "RP-DICT running" "$LOG" 2>/dev/null; then
    echo "$(date +%H:%M:%S) hold is up, speaking for ${MINUTES} minutes"
    exec bash /tmp/speaker-loop.sh "$MINUTES"
  fi
  sleep 2
done
echo "$(date +%H:%M:%S) nobody tapped; not speaking"
