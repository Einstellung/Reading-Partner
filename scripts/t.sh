#!/usr/bin/env bash
# scripts/t.sh — run `bun test` so the verdict survives.
#
# Bun prints its "N pass / N fail" summary last, after every line the code
# under test wrote to stdout/stderr (React SSR warnings, the console.error
# that error-path tests trigger on purpose — ~230k chars on a green run).
# An agent reads tool output truncated to the first 30k chars, so on a green
# run the verdict is cut off and the run is unreadable. This wrapper prints
# bun's summary FIRST, then the failure detail, so nothing that gets truncated
# is anything you needed.
#
# Green: the summary and the log path. Red: the summary, a roster of every
# failing test, then each failure's code frame, assertion and stack.
# The raw log is always kept and its path always printed; re-read it whenever
# this filter looks like it dropped something.
#
# Usage: scripts/t.sh [bun test args]     e.g. scripts/t.sh tests/context.test.ts
# Env:   BUN_TEST_LOG=path   write the raw log there instead of a temp file.
set -uo pipefail
# Same as the other scripts here: run from the repo root, so bun discovers the
# whole suite whatever directory you called this from. Path arguments are
# therefore relative to the repo root, not to your shell's cwd.
cd "$(dirname "$0")/.." || exit 1

# Per-process log: two agents running this in one worktree must not clobber
# each other. mktemp also keeps it out of the repo; an in-repo *.log would be
# covered by .gitignore, but out of the tree is one less way to commit it.
LOG="${BUN_TEST_LOG:-}"
if [ -z "$LOG" ]; then
  LOG="$(mktemp "${TMPDIR:-/tmp}/bun-test.XXXXXXXX.log")" || exit 1
fi

NO_COLOR=1 bun test "$@" >"$LOG" 2>&1
status=$?

# Bun's own summary block, verbatim, from the last "N pass" line to the end of
# the log. Parsed independently of the failure detail below, so a reporter
# change in a future bun release can degrade one without silently losing the
# other. If the anchor ever stops matching, fall back to the tail rather than
# printing nothing.
awk '
  /^[[:space:]]*[0-9]+ pass$/ { start = NR }
  { line[NR] = $0 }
  END {
    if (start) { for (i = start; i <= NR; i++) print line[i]; exit }
    print "(no bun summary line matched; last 12 lines of the log follow)"
    for (i = (NR > 12 ? NR - 12 : 1); i <= NR; i++) print line[i]
  }
' "$LOG"
echo "full log: $LOG"

[ "$status" -eq 0 ] && exit 0

# A short failing log is printed whole: no filter can drop what an import
# error, a crashed process or a single failing file needed to say.
if [ "$(wc -c <"$LOG")" -le 20000 ]; then
  echo
  echo "--- full output ---"
  cat "$LOG"
  exit "$status"
fi

# Every failing test, one line each. Cheap enough to always print in full, so
# the names and the count survive even if the detail below is truncated.
echo
echo "--- failing tests ---"
awk '
  /^[^ ].*\.tsx?:$/ { file = $0; sub(/:$/, "", file); next }
  /^\(fail\)/       { printf "%s  %s\n", (file == "" ? "?" : file), $0 }
' "$LOG"

# Detail per failure: the window of log leading up to each (fail) line.
# CAP bounds how much console noise rides along; MAXDETAIL bounds the whole
# section, because a run with 50 failures would otherwise push its own tail
# past the point where anything is still read.
echo
echo "--- detail ---"
awk -v CAP=120 -v MIN=25 -v MAXDETAIL=12 '
  function reset() { n = 0; frameStart = -1; errLine = -1; inFrame = 0 }
  function emit(  i, lo, start) {
    # Bun writes the error block ("code frame, caret, error:, diff, stack")
    # immediately before the (fail) line, so the last code frame and the last
    # "error:" in the window are almost always the real ones. Take whichever
    # comes first. Both patterns also occur as console noise in this repo
    # (180 frame lines and 26 error: lines in a fully green log), which is why
    # the window is never trusted to be tight: MIN always keeps context before
    # the anchor, CAP always bounds it.
    # Neither anchor found means there is no error block to show at all (a
    # timeout is the usual case, its reason comes after the (fail) line), so a
    # short tail is all that can be worth printing.
    start = frameStart
    if (errLine >= 0 && (start < 0 || errLine < start)) start = errLine
    if (start < 0 || n - start < MIN) start = (n > MIN) ? n - MIN : 0
    lo = (n - CAP > start) ? n - CAP : start
    if (lo > 0) print "  [... " lo " line(s) of preceding output elided; see full log]"
    for (i = lo; i < n; i++) print ring[i % CAP]
  }

  # A test-file header ends the previous file window.
  /^[^ ].*\.tsx?:$/ { file = $0; reset(); after = 0; next }

  /^\(fail\)/ {
    shown++
    if (shown > MAXDETAIL) { over++; reset(); after = 0; next }
    if (file != "") { print file; file = "" }
    emit()
    print $0
    reset(); after = 1; tail = 0
    next
  }

  # A timeout has no code frame; its reason is on the line after (fail).
  after && tail < 5 && /^[[:space:]]/ && /[^[:space:]]/ { print; tail++; next }
  after { print ""; after = 0 }

  # Load-time and unhandled errors are their own delimited block.
  /^# Unhandled error/ { unh = 1; if (file != "") { print file; file = "" } print; next }
  unh && /^-+$/ { print; if (++dash == 2) { unh = 0; dash = 0; print "" } next }
  unh { print; next }

  {
    if ($0 ~ /^[[:space:]]*[0-9]+ \|/) {
      if (!inFrame) { frameStart = n; inFrame = 1 }
    } else {
      inFrame = 0
      if ($0 ~ /^error:/) errLine = n
    }
    ring[n++ % CAP] = $0
  }

  END {
    if (over) print "\n  [... " over " more failure(s) not detailed; names are listed above, full log has all of it]"
  }
' "$LOG"

exit "$status"
