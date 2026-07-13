#!/usr/bin/env bash
# Memory-capped dev launcher (see docs/pitfall/14): a full Rust rebuild with
# default settings (one rustc per core + debug linking) can starve the whole
# desktop session and get it killed by systemd-oomd.
#
# Two caps:
#   1. CARGO_BUILD_JOBS = half the cores — halves peak compiler memory,
#      barely affects incremental builds (they have few crates to compile).
#   2. When systemd is available, the build runs in its own cgroup scope with
#      MemoryHigh=60%: the kernel throttles/reclaims THIS scope first, so the
#      rest of the session stays responsive, and if oomd ever does act, the
#      victim is the build scope — not your login session.
set -e
cd "$(dirname "$0")/.."

JOBS=$(($(nproc) / 2))
[ "$JOBS" -lt 2 ] && JOBS=2
export CARGO_BUILD_JOBS="$JOBS"

if command -v systemd-run >/dev/null 2>&1; then
  exec systemd-run --user --scope --quiet \
    -p MemoryHigh=60% \
    bun run tauri dev "$@"
else
  exec bun run tauri dev "$@"
fi
