#!/usr/bin/env bash
# scripts/isolate.sh — run every test file alone, in its own process, and check
# the four things a whole-suite run cannot check.
#
# ## Why this exists
#
# `bun test` runs the whole suite in ONE process, one file after another, in the
# order the filesystem enumerates the directories. That order is not a property
# of the commit: the same commit on ext4 and on tmpfs schedules 297 of 316 files
# differently, and `--seed` only shuffles whatever order the disk handed over
# (pitfall 174). So "green in my worktree" does not transfer to another tree, to
# CI, or to another machine, and neither does a seeded run — a seed is a
# permutation of a different starting deck in every tree.
#
# One process per file has no order to depend on. Its answer is the same in every
# tree, which makes it the one result worth quoting to someone else.
#
# ## What it asserts
#
#   1. Every file passes alone. A file that only passes because some earlier file
#      loaded a real module for it, or left a spy up, or wrote a fixture, fails
#      here and is named.
#   2. The per-file test counts add up to the single-process total. Failure
#      counts alone would miss the worst case: a file that dies at link time is
#      recorded by bun as `Ran 1 test`, not 0, and the summary still counts the
#      file, so a file whose 40 cases never ran can leave every visible number
#      looking ordinary. Both totals are computed here, in this tree, in this
#      run; nothing is hard-coded. (`tests/fulltext.test.ts` is skipped in a tree
#      without the untracked public/demo.pdf and passes in a tree with it, so any
#      expected number would be wrong in half the trees.)
#   3. Every single-file run reports "across 1 file". `bun test <path>` is a
#      substring filter, not a path: if one test file's path were a substring of
#      another's, that run would quietly execute both and the sum in 2 would be
#      inflated by tests that never ran alone.
#   4. bun discovers the same number of files as the sweep does. bun also accepts
#      `_test_`, `.spec.` and `_spec_` filenames; a file named that way would be
#      in the single-process total and absent from the sweep, and 2 would fail
#      with no indication why.
#   5. No file loads react-dom's client bundle without asking for a window. This
#      is the one cross-file leak the sweep can still see, and it needs an
#      instrument outside the suite: see scripts/isolate-probe.ts. react-dom
#      decides at module evaluation whether it is in a browser (pitfall 121), so
#      a file that pulls the bundle with no window in scope poisons every
#      useDom() file scheduled after it in a whole-suite run — while itself
#      staying green, alone and in most orders (pitfall 175).
#
# ## What it does not prove
#
# That the suite passes in any particular order. Every file here gets a clean
# process, so a file that LEAKS — a mock.module registration, a global left
# reassigned, a file written outside a temp dir — passes alone and takes its
# neighbour down only in a shared process. Check 5 is an instrument for one known
# leak of that kind, not a general one. `bash scripts/t.sh` and a couple of
# `--seed` runs are still what covers the rest, and their numbers are only
# comparable against earlier numbers from the same tree.
#
# Usage: bash scripts/isolate.sh
# Env:   JOBS=n              files in flight at once (default: nproc)
#        ISOLATE_OUT=dir     keep the per-file logs there instead of a temp dir
set -uo pipefail
# Run from the repo root whatever directory this was called from: bun resolves
# bunfig.toml against the working directory, and a run that misses it loads no
# preload and restores no spies, in silence (pitfall 172, tests/preload-gate).
cd "$(dirname "$0")/.." || exit 1

JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
OUTDIR="${ISOLATE_OUT:-}"
if [ -z "$OUTDIR" ]; then
  OUTDIR="$(mktemp -d "${TMPDIR:-/tmp}/bun-isolate.XXXXXXXX")" || exit 1
else
  mkdir -p "$OUTDIR" || exit 1
  # A reused directory must not answer for files this run did not execute: the
  # records are read back by glob, and a stale one from a deleted test file
  # would be counted as a result.
  rm -f "$OUTDIR"/*.rec
fi
export OUTDIR
started=$SECONDS

mapfile -t FILES < <(find src tests \( -name '*.test.ts' -o -name '*.test.tsx' \) -type f | LC_ALL=C sort)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "no test files found under src/ or tests/ — is this the repo root?"
  exit 2
fi

echo "isolate: ${#FILES[@]} files, $JOBS at a time, logs in $OUTDIR"

# --- the reference number ----------------------------------------------------
# The ordinary whole-suite run, without the probe preload: this is the total
# every other number in this repo is quoted against, and it has to stay the one
# bun prints for `bun test`.
single_log="$OUTDIR/00-single-process.log"
single_started=$SECONDS
NO_COLOR=1 bun test >"$single_log" 2>&1
single_elapsed=$((SECONDS - single_started))
ran_line() {
  sed -n 's/^Ran \([0-9]*\) tests\? across \([0-9]*\) files\?\..*/\1 \2/p' "$1" | tail -1
}
read -r single_tests single_files <<<"$(ran_line "$single_log")"
if [ -z "${single_tests:-}" ]; then
  echo "could not read a 'Ran N tests across M files' line from $single_log"
  exit 2
fi

# --- one process per file ----------------------------------------------------
run_one() {
  f=$1
  key=${f//\//_}
  log="$OUTDIR/$key.log"
  NO_COLOR=1 bun test "$f" --preload ./scripts/isolate-probe.ts >"$log" 2>&1
  status=$?
  read -r ran files <<<"$(sed -n 's/^Ran \([0-9]*\) tests\? across \([0-9]*\) files\?\..*/\1 \2/p' "$log" | tail -1)"
  probe=$(sed -n 's/^ISOLATE-PROBE bundle=\([01]\) window=\([01]\).*/\1 \2/p' "$log" | tail -1)
  read -r bundle window <<<"$probe"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$status" "${ran:--}" "${files:--}" "${bundle:--}" "${window:--}" "$f" >"$OUTDIR/$key.rec"
}
export -f run_one

sweep_started=$SECONDS
printf '%s\n' "${FILES[@]}" | xargs -P "$JOBS" -I{} bash -c 'run_one "$1"' _ {}
sweep_elapsed=$((SECONDS - sweep_started))

cat "$OUTDIR"/*.rec >"$OUTDIR/00-records.tsv" 2>/dev/null
records=$(wc -l <"$OUTDIR/00-records.tsv")

# --- read the records --------------------------------------------------------
sum=0
failed_alone=(); multi_file=(); no_count=(); no_probe=(); poisoners=(); loads_bundle=0; asks_window=0
while IFS=$'\t' read -r status ran files bundle window path; do
  case $ran in
    ''|*[!0-9]*) no_count+=("$path");;
    *) sum=$((sum + ran));;
  esac
  [ "$files" = 1 ] || multi_file+=("$path (across $files files)")
  [ "$status" = 0 ] || failed_alone+=("$path")
  case $bundle$window in
    10) poisoners+=("$path"); loads_bundle=$((loads_bundle + 1));;
    11) loads_bundle=$((loads_bundle + 1)); asks_window=$((asks_window + 1));;
    01) asks_window=$((asks_window + 1));;
    00) ;;
    *) no_probe+=("$path");;
  esac
done <"$OUTDIR/00-records.tsv"

# --- verdict, before any detail that could get truncated ---------------------
ok() { printf '  %-6s %s\n' "$1" "$2"; }
mark() { [ "$1" = 0 ] && echo "ok" || echo "FAIL"; }
elapsed=$((SECONDS - started))

bad=0
echo
echo "--- isolate ---"
c=$([ "$records" -eq "${#FILES[@]}" ] && echo 0 || echo 1)
ok "$(mark $c)" "$records of ${#FILES[@]} files reported a result"; bad=$((bad | c))
c=$([ "$single_files" -eq "${#FILES[@]}" ] && echo 0 || echo 1)
ok "$(mark $c)" "bun discovered $single_files files, the sweep ran ${#FILES[@]}"; bad=$((bad | c))
c=$([ "${#failed_alone[@]}" -eq 0 ] && echo 0 || echo 1)
ok "$(mark $c)" "${#failed_alone[@]} files failed when run alone"; bad=$((bad | c))
c=$([ "$sum" -eq "$single_tests" ] && echo 0 || echo 1)
ok "$(mark $c)" "per-file tests sum to $sum, single process ran $single_tests"; bad=$((bad | c))
c=$([ "${#multi_file[@]}" -eq 0 ] && echo 0 || echo 1)
ok "$(mark $c)" "${#multi_file[@]} single-file runs matched more than one file"; bad=$((bad | c))
c=$([ "${#no_count[@]}" -eq 0 ] && echo 0 || echo 1)
ok "$(mark $c)" "${#no_count[@]} runs printed no test count"; bad=$((bad | c))
c=$([ "${#no_probe[@]}" -eq 0 ] && echo 0 || echo 1)
ok "$(mark $c)" "${#no_probe[@]} runs printed no probe line"; bad=$((bad | c))
c=$([ "${#poisoners[@]}" -eq 0 ] && echo 0 || echo 1)
ok "$(mark $c)" "$loads_bundle files load react-dom's client bundle, $asks_window ask for a window"; bad=$((bad | c))

timing="${elapsed}s: ${single_elapsed}s for the whole-suite reference run, ${sweep_elapsed}s for ${#FILES[@]} one-file runs $JOBS at a time"
if [ "$bad" -eq 0 ]; then
  echo "GREEN in $timing"
else
  echo "RED in $timing"
fi
echo "logs: $OUTDIR"

[ "$bad" -eq 0 ] && exit 0

# --- detail ------------------------------------------------------------------
name_them() {
  local title=$1; shift
  [ "$#" -eq 0 ] && return
  echo
  echo "$title"
  printf '  %s\n' "$@"
}
name_them "failed alone (each one's log is in $OUTDIR):" "${failed_alone[@]}"
name_them "matched more than one file — 'bun test <path>' is a substring filter:" "${multi_file[@]}"
name_them "no 'Ran N tests' line — the process died before the summary:" "${no_count[@]}"
name_them "no probe line — the run ended before afterAll, so nothing was measured:" "${no_probe[@]}"
name_them "loads react-dom's client bundle and never asks for a window:" "${poisoners[@]}"
if [ "${#poisoners[@]}" -gt 0 ]; then
  cat <<'WHY'

  Each of those is green alone and green in most orders, and kills every
  useDom() file scheduled after it in the orders that put it first (pitfall
  175). Give the file `await useDom()` above the import that pulls the bundle,
  and bring that import in with `await import(...)` — a static import is
  evaluated before any top-level await, so moving the line down does nothing.
WHY
fi
if [ "$sum" -ne "$single_tests" ]; then
  cat <<WHY

  $sum vs $single_tests. A file that dies at module scope still contributes
  1 to the per-file sum, so the difference is not the number of tests that went
  missing. Read it as: something ran in one process and not in the other.
WHY
fi
exit 1
