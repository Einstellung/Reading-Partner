#!/usr/bin/env bash
# Android engine smoke gate, run inside the booted emulator by
# .github/workflows/android-engine-smoke.yml. It lives in its own file because
# reactivecircus/android-emulator-runner executes its inline `script` line by
# line under dash, which breaks multi-line shell constructs (for/if) — invoking
# one bash file sidesteps that entirely.
#
# Installs the smoke APK, launches it, reads back src/smoke's machine verdict
# from the app's private data dir via `adb run-as` (debuggable APK), and exits
# non-zero unless the verdict says ok:true. Writes smoke-result.json and
# smoke-screenshot.png into the workspace for the artifact upload.
#
# Expects in the environment: SMOKE_APK (path), BUNDLE_ID (package id).
set -eu

adb install -r "$SMOKE_APK"

# Launch the launcher activity by package (class name is not assumed).
adb shell monkey -p "$BUNDLE_ID" -c android.intent.category.LAUNCHER 1 >/dev/null

# result.json appears only after the app writes it (wasm compile + open +
# render). run-as reads the app's private data dir; the file is located by name,
# not by an assumed AppData subpath.
RESULT=""
for _ in $(seq 1 90); do
  RESULT=$(adb shell run-as "$BUNDLE_ID" find . -name smoke-result.json 2>/dev/null | tr -d '\r' | head -1 || true)
  [ -n "$RESULT" ] && break
  sleep 2
done

adb exec-out screencap -p > smoke-screenshot.png || true

if [ -z "$RESULT" ]; then
  echo "::error::smoke-result.json never appeared within ~180s (app crashed or hung before writing a verdict)"
  adb logcat -d | tail -120 || true
  exit 1
fi

adb shell run-as "$BUNDLE_ID" cat "$RESULT" | tr -d '\r' > smoke-result.json
echo "=== smoke-result.json ==="
cat smoke-result.json
echo

OK=$(jq -r '.ok' smoke-result.json)
if [ "$OK" != "true" ]; then
  echo "::error::Android engine gate RED at layer: $(jq -r '.failLayer // .stage' smoke-result.json)"
  exit 1
fi
echo "Android engine gate GREEN — PDFium rendered a page in the Android WebView"
