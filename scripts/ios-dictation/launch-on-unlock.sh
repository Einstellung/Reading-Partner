#!/bin/bash
# Wait for the phone to be unlocked and launch the smoke the instant it is.
# SpringBoard refuses to launch on a locked, passcode-protected device, and the
# screen auto-locks again on its own, so the window is short and has to be taken
# the moment it opens.
#
# The previous instance is killed first. Installing over an app does not stop
# it: the old process stays alive in the background holding the audio session,
# the new one's configureSession() fails, and the old one's
# finalizeAndFinishThroughEndOfInput() was measured taking 89 seconds to return
# while the two fought over the microphone.
#
# The console is filtered to our own lines. Unfiltered, the device produces
# about half a megabyte a second and idevicesyslog drops what it cannot keep up
# with — a 127 MB log carrying thirteen of our lines.
#
# APP is the .dev bundle id, not the shipping one: this only launches whatever
# is already installed, and the build scripts that install it (bench-run.sh,
# smoke-run.sh, guided-run.sh, long-run.sh) all refuse to install anything but
# the .dev build, so there is nothing here for that build's TestFlight sibling
# to collide with.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DEVICE=00008140-000C31641EEB001C
APP=com.xinyuan.readingpartner.dev
DEV_NAME="Reading Partner"

for i in $(seq 1 900); do
  if xcrun devicectl device info lockState --device "$DEVICE" 2>&1 | grep -q 'passcodeRequired: false'; then
    echo "$(date +%H:%M:%S) unlocked after $i polls"
    xcrun devicectl device process terminate --device "$DEVICE" --console "$APP" > /dev/null 2>&1 || true
    for pid in $(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null \
                 | grep "$DEV_NAME.app" | awk '{print $1}'); do
      echo "terminating stale pid $pid"
      xcrun devicectl device process signal --device "$DEVICE" --pid "$pid" --signal SIGKILL > /dev/null 2>&1 || true
    done
    sleep 2
    bash /tmp/syslog.sh /tmp/rp-dict.log
    pkill -f 'speaker.sh' 2>/dev/null || true
    if [ "${1:-}" = "--no-speaker" ]; then
      echo "speaker suppressed: this run wants a human voice, not a loudspeaker"
    else
      ( nohup bash /tmp/speaker.sh /tmp/rp-dict.log > /tmp/speaker.log 2>&1 < /dev/null & )
    fi
    sleep 1
    xcrun devicectl device process launch --device "$DEVICE" "$APP" 2>&1 | tail -2
    echo "$(date +%H:%M:%S) launched"
    exit 0
  fi
  sleep 3
done
echo "still locked"
exit 1
