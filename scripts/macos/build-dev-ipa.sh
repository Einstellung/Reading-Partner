#!/bin/bash
# On the Mac, from an SSH session: build the .dev bundle for a physical device,
# cloud-signed with the App Store Connect key, and refuse anything that is not
# com.xinyuan.readingpartner.dev. It only builds; install with
# scripts/ios-dictation/ios-dev.sh (iPhone, devicectl) or scripts/macos/device.sh
# (a device newer than Xcode, docs/pitfall/521).
#
#   REPO=~/rp-ipad scripts/macos/build-dev-ipa.sh [tauri config json]
#   OUT=/tmp/x.ipa ...                 where the ipa is copied (default /tmp/rp-dev.ipa)
#
# Needs ~/.asc-env (APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH,
# APPLE_DEVELOPMENT_TEAM) and ~/.askpass.sh for sudo -A.
#
# The build runs inside the graphical login session: from plain SSH codesign has
# no keychain (docs/pitfall/179), and `launchctl asuser` alone runs as root
# (docs/pitfall/180), hence the inner `sudo -u`. The identifier can only be
# changed through the CLI's --config merge, and the ipa's own Info.plist is the
# only proof that it was.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
export SUDO_ASKPASS="$HOME/.askpass.sh"
REPO="${REPO:-$HOME/Reading-Partner}"
GUI_UID=$(id -u)
GUI_USER=$(id -un)
. "$HOME/.asc-env"
DEV_ID=com.xinyuan.readingpartner.dev
DEV_CONFIG=${1:-/tmp/rp-dev-id.json}
[ -f "$DEV_CONFIG" ] || printf '{"identifier": "%s"}\n' "$DEV_ID" > "$DEV_CONFIG"
cd "$REPO"
# gen/apple is regenerated whenever it was made for another identifier.
if ! grep -q "PRODUCT_BUNDLE_IDENTIFIER: $DEV_ID\$" src-tauri/gen/apple/project.yml 2>/dev/null; then
  rm -rf src-tauri/gen/apple
  bun run tauri ios init --ci --config "$DEV_CONFIG" 2>&1 | tail -2
fi
# A stale gen/apple/build fails with "Directory not empty (os error 66)".
rm -rf src-tauri/gen/apple/build
sudo -A launchctl asuser "$GUI_UID" sudo -u "$GUI_USER" \
  /bin/bash -lc "cd '$REPO' && export PATH='$PATH' APPLE_DEVELOPMENT_TEAM=$APPLE_DEVELOPMENT_TEAM \
    APPLE_API_KEY=$APPLE_API_KEY APPLE_API_ISSUER=$APPLE_API_ISSUER \
    APPLE_API_KEY_PATH=$APPLE_API_KEY_PATH && \
    bun run tauri ios build --debug --target aarch64 --export-method debugging \
      --config '$DEV_CONFIG'" > /tmp/rp-dev-build.log 2>&1 || { tail -30 /tmp/rp-dev-build.log; exit 1; }
IPA=$(find src-tauri/gen/apple/build -name '*.ipa' -type f | head -1)
BUILT_ID=$(unzip -p "$IPA" "Payload/Reading Partner.app/Info.plist" | plutil -extract CFBundleIdentifier raw -)
echo "ipa: $IPA id: $BUILT_ID"
[ "$BUILT_ID" = "$DEV_ID" ] || { echo "REFUSING: $BUILT_ID would replace the TestFlight app"; exit 1; }
unzip -p "$IPA" "Payload/Reading Partner.app/embedded.mobileprovision" | security cms -D > /tmp/rp-dev-prov.plist
echo "provisioned devices:"; plutil -extract ProvisionedDevices json -o - /tmp/rp-dev-prov.plist; echo
cp "$IPA" "${OUT:-/tmp/rp-dev.ipa}"
echo "copied to ${OUT:-/tmp/rp-dev.ipa}"
