#!/usr/bin/env bash
# Fail unless the given .app is signed with the certificate import-dev-cert.sh
# imported. A different signer means Xcode created a new certificate again
# (docs/pitfall/ios-build/602).
#
#   check-dev-cert.sh path/to/Some.app
set -euo pipefail
APP="$1"
: "${IOS_DEV_CERT_SHA1:?run import-dev-cert.sh first}"
OUT=$(mktemp -d)
codesign -d --extract-certificates="$OUT/signer" "$APP" 2> /dev/null
GOT=$(shasum -a 1 "$OUT/signer0" | awk '{print toupper($1)}')
rm -rf "$OUT"
echo "signing certificate SHA-1: $GOT"
[ "$GOT" = "$IOS_DEV_CERT_SHA1" ] || { echo "::error::signed with $GOT, not the CI certificate $IOS_DEV_CERT_SHA1"; exit 1; }
