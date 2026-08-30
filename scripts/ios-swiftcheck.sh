#!/usr/bin/env bash
# Compile the iOS voice plugin's Swift on the Mac and bring the errors back.
#
# This machine has no Swift toolchain, so every line under plugins/voice/ios is
# written blind. The only check that existed before this script was a full
# `tauri ios build` — a quarter of an hour, and it wants the phone. This one
# compiles the same sources against the same iPhoneOS SDK and answers in
# seconds, because it stops at the object file: no app, no signing, no device.
#
#   scripts/ios-swiftcheck.sh                 # HEAD of the current worktree
#   scripts/ios-swiftcheck.sh integration     # a branch
#   scripts/ios-swiftcheck.sh 1c076658        # a commit
#   scripts/ios-swiftcheck.sh --dirty         # HEAD plus uncommitted edits
#   scripts/ios-swiftcheck.sh --warnings      # the warnings too, not just errors
#   scripts/ios-swiftcheck.sh --verbose       # the whole xcodebuild log
#
# The Mac cannot reach this machine, so the commits travel as a git bundle over
# scp. Only what the Mac is missing goes into the bundle, which is normally tens
# of kilobytes.
#
# What it catches: anything the type checker sees — a method that does not
# exist, an argument that is not in the signature, a protocol that is not
# conformed to, an availability floor that is too low. That is the whole reason
# it exists: the iOS 26 speech API is guessed here and confirmed there.
#
# What it does not catch: runtime behaviour, the Rust side, the linked app,
# resources, entitlements, signing. A green run means the Swift is well typed,
# not that the feature works.

set -euo pipefail

MAC="${RP_MAC:-macmini}"
REMOTE_ROOT="rp-swiftcheck"   # relative to the Mac's home directory
PKG="plugins/voice/ios"

ref=""
dirty=0
verbose=0
clean=0
warnings=0

while [ $# -gt 0 ]; do
    case "$1" in
        --dirty) dirty=1 ;;
        --verbose | -v) verbose=1 ;;
        --warnings | -w) warnings=1 ;;
        --clean) clean=1 ;;
        -h | --help)
            sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        -*)
            echo "unknown option: $1" >&2
            exit 2
            ;;
        *)
            if [ -n "$ref" ]; then
                echo "give at most one ref" >&2
                exit 2
            fi
            ref="$1"
            ;;
    esac
    shift
done

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
ref="${ref:-HEAD}"

if ! sha=$(git rev-parse --verify --quiet "${ref}^{commit}"); then
    echo "not a commit in this worktree: $ref" >&2
    exit 2
fi

say() { printf '%s\n' "$*" >&2; }

# --- The Mac side, made from nothing if it is not there yet -----------------
#
# Three things have to exist over there and none of them are in git: the
# checkout, the Tauri Swift API that `tauri ios init` generates, and SwiftRs.
# The Mac's route to github.com fails on this network, so SwiftRs is vendored
# from a checkout an earlier build already made and the generated manifest is
# pointed at that copy. Every step below is a no-op the second time.

say "==> preparing $MAC:~/$REMOTE_ROOT"
ssh "$MAC" REMOTE_ROOT="$REMOTE_ROOT" 'bash -s' <<'REMOTE_SETUP'
set -euo pipefail
root="$HOME/$REMOTE_ROOT"
deps="$root-deps"

if [ ! -d "$root/.git" ]; then
    # Any existing clone will do as a source of history; the bundle only has to
    # carry what it is missing. Without one the first bundle is the whole repo,
    # which still works, only slower.
    if [ -d "$HOME/Reading-Partner/.git" ]; then
        echo "cloning history from ~/Reading-Partner"
        git clone --quiet "$HOME/Reading-Partner" "$root"
    else
        echo "starting an empty repository"
        git init --quiet "$root"
    fi
fi

api="$root/plugins/voice/.tauri/tauri-api"
if [ ! -f "$api/Package.swift" ]; then
    src="$HOME/Reading-Partner/plugins/voice/.tauri/tauri-api"
    if [ ! -f "$src/Package.swift" ]; then
        echo "no Tauri Swift API to copy from." >&2
        echo "Run a tauri ios build once in ~/Reading-Partner so that" >&2
        echo "plugins/voice/.tauri/tauri-api exists, then try again." >&2
        exit 1
    fi
    mkdir -p "$root/plugins/voice/.tauri"
    cp -R "$src" "$api"
    echo "copied the generated Tauri Swift API"
fi

if [ ! -f "$deps/swift-rs/Package.swift" ]; then
    found=""
    for candidate in \
        "$HOME"/Library/Developer/Xcode/DerivedData/*/SourcePackages/checkouts/swift-rs \
        "$HOME"/rp-swiftcheck-spm/checkouts/swift-rs; do
        if [ -f "$candidate/Package.swift" ]; then found="$candidate"; break; fi
    done
    mkdir -p "$deps"
    if [ -n "$found" ]; then
        rm -rf "$deps/swift-rs"
        cp -R "$found" "$deps/swift-rs"
        rm -rf "$deps/swift-rs/.git"
        echo "vendored SwiftRs from $found"
    else
        # No local copy anywhere. Try the network; if this machine's route to
        # github.com is the one that fails on HTTP/2, the message below is the
        # whole diagnosis.
        if ! git clone --quiet --depth 1 https://github.com/Brendonovich/swift-rs "$deps/swift-rs"; then
            echo "no local SwiftRs checkout and github.com is unreachable." >&2
            echo "Build the iOS app once so that Xcode resolves swift-rs into" >&2
            echo "DerivedData, then try again." >&2
            exit 1
        fi
    fi
fi

# The manifest asks for SwiftRs by URL. Point it at the vendored copy so that
# resolution never touches the network. The file is a generated, gitignored
# copy, so rewriting it costs nothing and the check is offline from here on.
if grep -q 'url: "https://github.com/Brendonovich/swift-rs"' "$api/Package.swift"; then
    python3 - "$api/Package.swift" "$deps/swift-rs" <<'PATCH'
import sys
path, local = sys.argv[1], sys.argv[2]
text = open(path).read()
old = '.package(name: "SwiftRs", url: "https://github.com/Brendonovich/swift-rs", from: "1.0.0")'
new = '.package(name: "SwiftRs", path: "%s")' % local
assert old in text, "the SwiftRs dependency is not spelled the way this script expects"
open(path, "w").write(text.replace(old, new))
PATCH
    echo "pointed the Tauri manifest at the vendored SwiftRs"
fi
REMOTE_SETUP

# --- Send the commit -------------------------------------------------------
#
# Ask the Mac what it already has, bundle only the difference. A named ref has
# to go into the bundle, so the commit gets one in a namespace of this script's
# own, which keeps it out of `git branch`.

git update-ref refs/rp-swiftcheck/head "$sha"

base=$(
    ssh "$MAC" "git -C ~/$REMOTE_ROOT rev-list --all --max-count=400 2>/dev/null || true" |
        git cat-file --batch-check='%(objectname) %(objecttype)' --buffer 2>/dev/null |
        awk '$2 == "commit" && !seen { print $1; seen = 1 }' || true
)

bundle=$(mktemp)
trap 'rm -f "$bundle"' EXIT

if [ -n "$base" ]; then
    range="${base}..refs/rp-swiftcheck/head"
else
    say "==> the Mac shares no history; sending the whole repository once"
    range="refs/rp-swiftcheck/head"
fi

if ! git bundle create "$bundle" "$range" >/dev/null 2>&1; then
    # An empty range means the Mac is already on this commit.
    : >"$bundle"
fi

if [ -s "$bundle" ]; then
    say "==> sending $(du -h "$bundle" | cut -f1) for $(git log --oneline -1 "$sha")"
    scp -q "$bundle" "$MAC:~/$REMOTE_ROOT.bundle"
    ssh "$MAC" "git -C ~/$REMOTE_ROOT fetch --quiet ~/$REMOTE_ROOT.bundle \
        'refs/rp-swiftcheck/head:refs/heads/swiftcheck' --force"
else
    say "==> $MAC already has $(git log --oneline -1 "$sha")"
    ssh "$MAC" "git -C ~/$REMOTE_ROOT update-ref refs/heads/swiftcheck $sha"
fi

ssh "$MAC" "git -C ~/$REMOTE_ROOT checkout --quiet --force swiftcheck"

if [ "$dirty" -eq 1 ]; then
    say "==> overlaying uncommitted $PKG"
    tar -cf - -C "$repo_root" "$PKG/Sources" "$PKG/Package.swift" |
        ssh "$MAC" "tar -xf - -C ~/$REMOTE_ROOT"
fi

# --- Compile ---------------------------------------------------------------
#
# `generic/platform=iOS` is what makes this worth running: the sources are
# compiled arm64-apple-ios against the iPhoneOS SDK, so a Speech or AVFAudio
# symbol that only exists on macOS fails here the way it would fail in the app.
# Derived data is kept between runs, so a one-file edit rebuilds in seconds.

if [ "$clean" -eq 1 ]; then
    say "==> discarding derived data"
    ssh "$MAC" "rm -rf ~/$REMOTE_ROOT-dd"
fi

say "==> compiling for iOS"
set +e
ssh "$MAC" REMOTE_ROOT="$REMOTE_ROOT" PKG="$PKG" VERBOSE="$verbose" \
    WARNINGS="$warnings" 'bash -s' <<'REMOTE_BUILD'
set -uo pipefail
root="$HOME/$REMOTE_ROOT"
log="$root.log"

cd "$root/$PKG"
xcodebuild \
    -scheme tauri-plugin-voice \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$root-dd" \
    -clonedSourcePackagesDirPath "$root-spm" \
    build >"$log" 2>&1
status=$?

if [ "$VERBOSE" = "1" ]; then
    cat "$log"
    exit $status
fi

# A diagnostic is three lines: the message, the source line, the caret. The
# repository path in front of every one of them is the same and says nothing,
# so it comes off.
show() { grep -A2 -E "^/.*: $1: " "$log" | sed "s|$root/||g;/^--$/d"; }

show error
grep -E '^(error|xcodebuild: error): ' "$log"

warnings=$(grep -c -E '^/.*: warning: ' "$log" || true)
if [ "$WARNINGS" = "1" ]; then
    show warning
elif [ "$warnings" -gt 0 ]; then
    # Kept off the default output because the same dozen ride along with every
    # run and would bury the one line that changed. They are still the reason
    # this check is worth running twice, so the count stays.
    echo "$warnings warnings (pass --warnings to read them)"
fi

grep -E '\*\* BUILD (FAILED|SUCCEEDED) \*\*' "$log"
exit $status
REMOTE_BUILD
status=$?
set -e

if [ "$status" -ne 0 ] && [ "$verbose" -eq 0 ]; then
    say "==> the whole log is at $MAC:~/$REMOTE_ROOT.log (or pass --verbose)"
fi
exit $status
