#!/usr/bin/env python3
"""One-command iOS sideload for local development.

Pulls the latest unsigned ipa from GitHub Actions (or uses a local file), then
drives the Sideloader CLI to sign and install it onto a USB-connected device with
a free Apple ID. Credentials come from a gitignored .env so no secrets live in
the repo or in shell history.

Two-factor codes cannot be automated (Apple pushes a one-time code to your other
devices); the script hands the terminal back to you only when Apple asks for one,
which is occasional because the machine identity is cached under ~/.config/Sideloader.

When it fetches from CI it first waits out any queued/running build, then prints
the run, commit and commit title it is about to install, and warns when that
commit is not the tip of the default branch. Otherwise running the script right
after a push silently installs the previous build.

Two signing accounts can coexist. The default is the free Apple ID (7-day
profile); --dev picks the paid Developer Program one (1-year profile). They are
different team IDs, so iOS will not upgrade one over the other in place — the
device copy has to be deleted before switching, which wipes on-device data.

.env keys (see .env.example):
  SIDELOAD_APPLE_ID          Apple ID email used for signing
  SIDELOAD_APPLE_PASSWORD    its password (app-specific password if 2FA is on)
  SIDELOAD_DEV_APPLE_ID      Developer Program Apple ID, used by --dev
  SIDELOAD_DEV_APPLE_PASSWORD  its app-specific password
  SIDELOAD_SIDELOADER_BIN    path to the sideloader-cli binary
  SIDELOAD_IPA               optional: local ipa path; omit to fetch latest from CI
  SIDELOAD_REPO              GitHub repo for the fetch (default Einstellung/Reading-Partner)

Usage:
  python3 scripts/sideload-ios.py            # fetch latest ipa from CI and install
  python3 scripts/sideload-ios.py path.ipa   # install a specific local ipa
  python3 scripts/sideload-ios.py --dev      # sign with the Developer Program account
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    import pexpect
except ImportError:
    sys.exit("pexpect is required: pip install pexpect (or apt install python3-pexpect)")

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = "ios-sideload-ipa.yml"
ARTIFACT = "ios-sideload-ipa"

# Statuses gh reports for a run that has not finished yet. queued/in_progress
# are the common two; the rest are the approval/scheduling states.
ACTIVE_STATUSES = {"queued", "in_progress", "requested", "waiting", "pending"}
POLL_SECONDS = 15
WAIT_TIMEOUT_SECONDS = 15 * 60


def load_env() -> dict:
    env = dict(os.environ)
    envfile = REPO_ROOT / ".env"
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env.setdefault(key.strip(), val.strip().strip('"').strip("'"))
    return env


def short_sha(sha) -> str:
    return sha[:7] if sha else "unknown"


def gh_output(args: list) -> str:
    try:
        return subprocess.check_output(["gh"] + args, text=True).strip()
    except FileNotFoundError:
        sys.exit("gh (GitHub CLI) is required to fetch the ipa from CI.")
    except subprocess.CalledProcessError as exc:
        sys.exit(f"gh {' '.join(args)} failed with code {exc.returncode}.")


def list_runs(repo: str, limit: int = 20) -> list:
    """Recent ios-sideload-ipa runs, newest first."""
    raw = gh_output(
        ["run", "list", "--workflow", WORKFLOW, "-R", repo, "--limit", str(limit),
         "--json", "databaseId,status,conclusion,headSha,headBranch,createdAt,url"]
    )
    runs = json.loads(raw or "[]")
    runs.sort(key=lambda r: r.get("createdAt", ""), reverse=True)
    return runs


def commit_subject(repo: str, sha: str) -> str:
    """First line of a commit message, best effort (empty when GitHub is unreachable)."""
    try:
        message = subprocess.check_output(
            ["gh", "api", f"repos/{repo}/commits/{sha}", "--jq", ".commit.message"],
            text=True, stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        return ""
    return message.strip().splitlines()[0] if message.strip() else ""


def default_branch_tip(repo: str) -> tuple:
    """(sha, subject) of the tip of the repo's default branch, or (None, "")."""
    try:
        raw = subprocess.check_output(
            ["gh", "api", f"repos/{repo}/commits?per_page=1"],
            text=True, stderr=subprocess.DEVNULL,
        )
        head = json.loads(raw)[0]
    except (OSError, subprocess.CalledProcessError, ValueError, IndexError, KeyError):
        return None, ""
    subject = (head.get("commit", {}).get("message") or "").strip().splitlines()
    return head.get("sha"), subject[0] if subject else ""


def wait_for_running_builds(repo: str) -> None:
    """Block until no ios-sideload-ipa run is queued or running.

    Without this, fetching right after a push grabs the previous build's
    artifact. Exits non-zero if the build we waited for did not succeed.
    """
    started = time.monotonic()
    announced = set()
    waited = False
    while True:
        runs = list_runs(repo)
        active = [r for r in runs if r.get("status") in ACTIVE_STATUSES]
        if not active:
            break
        waited = True
        for run in active:
            if run["databaseId"] not in announced:
                announced.add(run["databaseId"])
                print(f"Build in flight: run {run['databaseId']} ({run['status']}) "
                      f"on {short_sha(run.get('headSha'))} — {run.get('url', '')}")
        elapsed = int(time.monotonic() - started)
        if elapsed >= WAIT_TIMEOUT_SECONDS:
            sys.exit(f"Still {active[0]['status']} after {elapsed // 60} minutes. "
                     f"Check CI yourself: {active[0].get('url', '')}")
        print(f"  {active[0]['status']} for {elapsed}s, waiting {POLL_SECONDS}s "
              f"(gives up after {WAIT_TIMEOUT_SECONDS // 60} min)...", flush=True)
        time.sleep(POLL_SECONDS)

    if not waited:
        return
    newest = runs[0] if runs else None
    if newest and newest["databaseId"] in announced and newest.get("conclusion") != "success":
        sys.exit(f"Run {newest['databaseId']} finished as {newest.get('conclusion')}, "
                 f"so there is no new ipa: {newest.get('url', '')}")
    print("Build finished.")


def pick_run(repo: str) -> dict:
    wait_for_running_builds(repo)
    runs = list_runs(repo)
    if not runs:
        sys.exit(f"No {WORKFLOW} runs found in {repo}.")
    successes = [r for r in runs if r.get("conclusion") == "success"]
    if not successes:
        sys.exit(f"No successful {WORKFLOW} run found in {repo}.")
    chosen = successes[0]
    if chosen["databaseId"] != runs[0]["databaseId"]:
        newer = [r for r in runs if r.get("createdAt", "") > chosen.get("createdAt", "")]
        print(f"\n!! {len(newer)} newer run(s) did not succeed "
              f"({', '.join(str(r.get('conclusion')) for r in newer)}); "
              f"falling back to the last successful build.")
    return chosen


def describe_run(repo: str, run: dict) -> None:
    sha = run.get("headSha")
    subject = commit_subject(repo, sha)
    print("\nInstalling the ipa from:")
    print(f"  run     {run['databaseId']}  ({run.get('createdAt', '')})  {run.get('url', '')}")
    print(f"  commit  {short_sha(sha)} on {run.get('headBranch', '?')}"
          + (f"  {subject}" if subject else ""))

    tip_sha, tip_subject = default_branch_tip(repo)
    if tip_sha and sha and tip_sha != sha:
        print("\n!! This build is NOT the tip of the default branch.")
        print(f"!!   built:  {short_sha(sha)} {subject}")
        print(f"!!   tip:    {short_sha(tip_sha)} {tip_subject}")
        print("!! Installing it anyway.")
    print()


def fetch_latest_ipa(repo: str, dest: Path) -> Path:
    print(f"Fetching the ipa from {repo} ({WORKFLOW})...")
    run = pick_run(repo)
    describe_run(repo, run)
    subprocess.check_call(
        ["gh", "run", "download", str(run["databaseId"]), "-n", ARTIFACT,
         "-R", repo, "--dir", str(dest)]
    )
    ipas = list(dest.glob("*.ipa"))
    if not ipas:
        sys.exit("Downloaded artifact contained no ipa.")
    print(f"Downloaded {ipas[0].name} (run {run['databaseId']}).")
    return ipas[0]


def install(sideloader: str, ipa: Path, apple_id: str, password: str) -> int:
    child = pexpect.spawn(sideloader, ["install", "-i", str(ipa)], encoding="utf-8", timeout=600)
    child.logfile_read = sys.stdout
    while True:
        i = child.expect([
            r"(?i)apple id:",
            r"(?i)password:",
            r"(?i)type it here",   # 2FA code prompt
            pexpect.EOF,
        ])
        if i == 0:
            child.sendline(apple_id)
        elif i == 1:
            child.sendline(password)
        elif i == 2:
            # Apple wants a 2FA code — hand the terminal to the user.
            print("\n>>> Enter the 2FA code Apple just sent to your devices:")
            child.sendline(input().strip())
        else:
            child.close()
            return child.exitstatus or 0


def main() -> None:
    args = sys.argv[1:]
    dev = "--dev" in args
    args = [a for a in args if a != "--dev"]

    env = load_env()
    prefix = "SIDELOAD_DEV_" if dev else "SIDELOAD_"
    apple_id = env.get(prefix + "APPLE_ID")
    password = env.get(prefix + "APPLE_PASSWORD")
    sideloader = env.get("SIDELOAD_SIDELOADER_BIN")
    if not (apple_id and password):
        sys.exit(f"Set {prefix}APPLE_ID and {prefix}APPLE_PASSWORD in .env")
    if not sideloader:
        sys.exit("Set SIDELOAD_SIDELOADER_BIN in .env")
    if not Path(sideloader).exists():
        sys.exit(f"Sideloader binary not found: {sideloader}")
    if dev:
        print(
            "Signing with the Developer Program account. Its team ID differs from the\n"
            "free one, so iOS refuses to install over an app signed by the other\n"
            "account: delete Reading Partner on the device first (on-device data goes\n"
            "with it; Drive sync restores what is in sync range)."
        )

    if args:
        ipa = Path(args[0])
    elif env.get("SIDELOAD_IPA"):
        ipa = Path(env["SIDELOAD_IPA"])
    else:
        tmp = Path(tempfile.mkdtemp(prefix="rp-ipa-"))
        ipa = fetch_latest_ipa(env.get("SIDELOAD_REPO", "Einstellung/Reading-Partner"), tmp)
    if not ipa.exists():
        sys.exit(f"ipa not found: {ipa}")

    print(f"Installing {ipa} as {apple_id}...")
    code = install(sideloader, ipa, apple_id, password)
    print("\nDone." if code == 0 else f"\nSideloader exited with code {code}.")
    sys.exit(code)


if __name__ == "__main__":
    main()
