#!/usr/bin/env bash
# Build libvoice_engine.so (plugins/voice-engine, docs/companion/89) for
# arm64-v8a and put it where AGP picks it up with the voice plugin's Android
# module: plugins/voice/android/src/main/jniLibs/arm64-v8a/ (gitignored).
#
# CI only (android-voice-engine.yml, android-apk.yml): needs NDK r28c, found
# through ANDROID_NDK_ROOT, NDK_HOME or $ANDROID_HOME/ndk/$NDK_VERSION.
# ONNX Runtime (pyke's static prebuilt, fetched by ort-sys) and llama.cpp
# (built from source by llama-cpp-sys-2's cmake) both link libc++ statically.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
NDK_VERSION=${NDK_VERSION:-28.2.13676358}
API=31
TARGET=aarch64-linux-android

NDK=${ANDROID_NDK_ROOT:-${NDK_HOME:-${ANDROID_HOME:-}/ndk/$NDK_VERSION}}
if [ ! -f "$NDK/build/cmake/android.toolchain.cmake" ]; then
  echo "android-voice-engine: no NDK at '$NDK'" >&2
  exit 1
fi
BIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin

export ANDROID_NDK=$NDK
export ANDROID_API_LEVEL=$API
export CC_aarch64_linux_android=$BIN/$TARGET$API-clang
export CXX_aarch64_linux_android=$BIN/$TARGET$API-clang++
export AR_aarch64_linux_android=$BIN/llvm-ar
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$BIN/$TARGET$API-clang
# Unset, ort-sys links c++_shared on Android.
export ORT_CXX_STDLIB=c++_static

cargo build --release --target "$TARGET" \
  --manifest-path "$ROOT/plugins/voice-engine/Cargo.toml" -p voice-engine

TARGET_DIR=${CARGO_TARGET_DIR:-$ROOT/plugins/voice-engine/target}
OUT=$ROOT/plugins/voice/android/src/main/jniLibs/arm64-v8a
mkdir -p "$OUT"
"$BIN/llvm-strip" --strip-unneeded -o "$OUT/libvoice_engine.so" \
  "$TARGET_DIR/$TARGET/release/libvoice_engine.so"
echo "android-voice-engine: $OUT/libvoice_engine.so $(stat -c %s "$OUT/libvoice_engine.so") bytes"
