#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

bun tauri android init --ci "$@"

# Tauri CLI 2.11.4 generates Kotlin 1.9.25. RevenueCat uses Kotlin 2.2.21.
perl -pi -e 's/kotlin-gradle-plugin:1\.9\.25/kotlin-gradle-plugin:2.2.21/' \
  src-tauri/gen/android/build.gradle.kts
