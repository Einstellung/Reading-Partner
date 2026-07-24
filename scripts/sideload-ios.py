#!/usr/bin/env python3
"""One-command iOS sideload for local development.

Pulls the latest unsigned ipa from GitHub Actions (or uses a local file), then
drives the Sideloader CLI to sign and install it onto a USB-connected device with
a free Apple ID. Credentials come from a gitignored .env so no secrets live in
the repo or in shell history.

Two-factor codes cannot be automated (Apple pushes a one-time code to your other
devices); the script hands the terminal back to you only when Apple asks for one,
which is occasional because the machine identity is cached under ~/.config/Sideloader.

.env keys (see .env.example):
  SIDELOAD_APPLE_ID          Apple ID email used for signing
  SIDELOAD_APPLE_PASSWORD    its password (app-specific password if 2FA is on)
  SIDELOAD_SIDELOADER_BIN    path to the sideloader-cli binary
  SIDELOAD_IPA               optional: local ipa path; omit to fetch latest from CI
  SIDELOAD_REPO              GitHub repo for the fetch (default Einstellung/Reading-Partner)

Usage:
  python3 scripts/sideload-ios.py            # fetch latest ipa from CI and install
  python3 scripts/sideload-ios.py path.ipa   # install a specific local ipa
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import pexpect
except ImportError:
    sys.exit("pexpect is required: pip install pexpect (or apt install python3-pexpect)")

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = "ios-sideload-ipa.yml"
ARTIFACT = "ios-sideload-ipa"


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


def fetch_latest_ipa(repo: str, dest: Path) -> Path:
    print(f"Fetching latest ipa from {repo} ({WORKFLOW})...")
    run_id = subprocess.check_output(
        ["gh", "run", "list", "--workflow", WORKFLOW, "-R", repo,
         "--status", "success", "--limit", "1", "--json", "databaseId",
         "--jq", ".[0].databaseId"],
        text=True,
    ).strip()
    if not run_id:
        sys.exit("No successful ios-sideload-ipa run found on GitHub.")
    subprocess.check_call(
        ["gh", "run", "download", run_id, "-n", ARTIFACT, "-R", repo, "--dir", str(dest)]
    )
    ipas = list(dest.glob("*.ipa"))
    if not ipas:
        sys.exit("Downloaded artifact contained no ipa.")
    print(f"Downloaded {ipas[0].name} (run {run_id}).")
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
    env = load_env()
    apple_id = env.get("SIDELOAD_APPLE_ID")
    password = env.get("SIDELOAD_APPLE_PASSWORD")
    sideloader = env.get("SIDELOAD_SIDELOADER_BIN")
    if not (apple_id and password and sideloader):
        sys.exit("Set SIDELOAD_APPLE_ID, SIDELOAD_APPLE_PASSWORD, SIDELOAD_SIDELOADER_BIN in .env")
    if not Path(sideloader).exists():
        sys.exit(f"Sideloader binary not found: {sideloader}")

    if len(sys.argv) > 1:
        ipa = Path(sys.argv[1])
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
