#!/usr/bin/env bash
# Import the team's CI Apple Development certificate into a throwaway keychain
# on a macOS runner. With an identity already in the keychain, automatic
# signing (-allowProvisioningUpdates + the API key) reuses that certificate
# instead of creating a new one on every run, which used up the team's
# development certificate limit (docs/pitfall/ios-build/602).
#
# Needs IOS_DEV_CERT_P12_BASE64 and IOS_DEV_CERT_PASSWORD. Exports
# IOS_DEV_CERT_SHA1 to $GITHUB_ENV for check-dev-cert.sh.
set -euo pipefail
: "${IOS_DEV_CERT_P12_BASE64:?IOS_DEV_CERT_P12_BASE64 is not set}"
: "${IOS_DEV_CERT_PASSWORD:?IOS_DEV_CERT_PASSWORD is not set}"

KC="$RUNNER_TEMP/ci-dev.keychain-db"
KC_PW=$(openssl rand -hex 16)
P12="$RUNNER_TEMP/ci-dev.p12"
printf '%s' "$IOS_DEV_CERT_P12_BASE64" | base64 --decode > "$P12"

security create-keychain -p "$KC_PW" "$KC"
security set-keychain-settings -lut 21600 "$KC"
security unlock-keychain -p "$KC_PW" "$KC"
security import "$P12" -k "$KC" -P "$IOS_DEV_CERT_PASSWORD" -f pkcs12 -T /usr/bin/codesign -T /usr/bin/security
rm -f "$P12"
# Lets codesign use the key without a UI prompt.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PW" "$KC" > /dev/null
# shellcheck disable=SC2046
security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')

security find-identity -v -p codesigning "$KC"
SHA1=$(security find-identity -v -p codesigning "$KC" | awk '/Apple Development/ {print $2; exit}')
[ -n "$SHA1" ] || { echo "::error::no valid Apple Development identity after import"; exit 1; }
echo "IOS_DEV_CERT_SHA1=$SHA1" >> "$GITHUB_ENV"
