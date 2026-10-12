#!/usr/bin/env python3
"""List the devices and bundle ids registered on the App Store Connect team.

Read-only: it never registers a device (each registration burns one of the
yearly 100 slots and cannot be undone). Reuses the ES256 client from
scripts/testflight-distribute.py and the same environment variables:
APPLE_API_ISSUER, APPLE_API_KEY_ID, APPLE_API_KEY_P8_BASE64 (or
APPLE_API_KEY_PATH).

    python3 scripts/ios-linux/asc-devices.py [--expect UDID ...]

--expect fails the run when one of the given UDIDs is not registered and
enabled, since a development profile only covers registered devices.
"""
import argparse
import base64
import importlib.util
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("tfd", HERE.parent / "testflight-distribute.py")
tfd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tfd)


def load_key() -> bytes:
    b64 = os.environ.get("APPLE_API_KEY_P8_BASE64")
    if b64:
        return base64.b64decode(b64)
    path = os.environ.get("APPLE_API_KEY_PATH")
    if not path:
        sys.exit("set APPLE_API_KEY_P8_BASE64 or APPLE_API_KEY_PATH")
    return Path(path).read_bytes()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect", nargs="*", default=[])
    args = parser.parse_args()
    client = tfd.Client(os.environ["APPLE_API_KEY_ID"], os.environ["APPLE_API_ISSUER"], load_key())

    devices, _ = client.get_all("/v1/devices")
    print(f"{len(devices)} registered devices:")
    enabled = set()
    for d in devices:
        a = d["attributes"]
        print(f"  {a.get('udid')}  {a.get('status'):8}  {a.get('deviceClass'):8}  {a.get('model') or ''}  {a.get('name')}")
        if a.get("status") == "ENABLED":
            enabled.add(a.get("udid"))

    bundles, _ = client.get_all("/v1/bundleIds")
    print("bundle ids under com.xinyuan:")
    for b in bundles:
        a = b["attributes"]
        if a.get("identifier", "").startswith("com.xinyuan"):
            print(f"  {b['id']}  {a.get('identifier')}  {a.get('name')}")

    missing = [u for u in args.expect if u not in enabled]
    if missing:
        print(f"::error::not registered/enabled: {' '.join(missing)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
