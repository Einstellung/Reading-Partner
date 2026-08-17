#!/bin/bash
# Continuous speech into the room for a long run, from the Mac's own speaker.
#
# Unlike speaker.sh this is not cued off the console: a twenty-minute hold is one
# `RP-DICT start` and then silence in the log, so there is nothing to react to.
# It simply talks until told to stop, alternating passages so the recogniser
# always has something to settle rather than a single sentence on a loop.
#
# Only run this when the room is empty. Kill with `pkill -f speaker-loop.sh`.
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
MINUTES=${1:-22}
VOICE=${2:-Samantha}

P1="The transformer replaced recurrence with self attention, so the model reads a whole sentence at once instead of one word after another."
P2="That single change is what made it possible to train on far more text than before, and it is why the same architecture now reads code, images and audio."
P3="Attention is all you need. The paper is short, and almost every model since has been a variation on the one idea in it."
P4="A rehearsal is different from a recording. The point is not the words that came out, it is where the speaker hesitated and what they skipped."

osascript -e 'set volume output volume 85' >/dev/null 2>&1 || true
echo "$(date +%H:%M:%S) speaking for ${MINUTES} minutes at volume $(osascript -e 'output volume of (get volume settings)')"

END=$(( $(date +%s) + MINUTES * 60 ))
i=0
while [ "$(date +%s)" -lt "$END" ]; do
  case $(( i % 4 )) in
    0) TEXT="$P1" ;;
    1) TEXT="$P2" ;;
    2) TEXT="$P3" ;;
    3) TEXT="$P4" ;;
  esac
  say -v "$VOICE" -r 170 "$TEXT"
  # A short gap, so the recogniser gets sentence boundaries to finalize on
  # rather than one unbroken twenty-minute utterance.
  sleep 1.5
  i=$(( i + 1 ))
done
echo "$(date +%H:%M:%S) done speaking"
