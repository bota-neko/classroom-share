#!/usr/bin/env python3
"""Temporarily disable new signups on the source Supabase project."""

import argparse
import json
import os
import subprocess
import urllib.request
from pathlib import Path

REF = "lxruzejczxwksgljxmpw"
URL = f"https://api.supabase.com/v1/projects/{REF}/config/auth"
STATE = Path("/tmp/classroom-source-signup-20261125.json")


def credential():
    result = subprocess.run(
        ["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def config(token, value=None):
    body = json.dumps({"disable_signup": value}).encode() if value is not None else None
    request = urllib.request.Request(
        URL, data=body, method="PATCH" if body is not None else "GET",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--unfreeze", action="store_true")
    parser.add_argument("--confirm-source-ref")
    args = parser.parse_args()
    if args.apply and args.confirm_source_ref != REF:
        parser.error("--apply requires the exact --confirm-source-ref")
    token = credential()
    current = bool(config(token).get("disable_signup"))
    if args.unfreeze:
        if not STATE.exists() or STATE.stat().st_mode & 0o077:
            parser.error("Private state file is required for unfreeze")
        original = json.loads(STATE.read_text())
        if original.get("ref") != REF or not current:
            raise RuntimeError("Source signup state changed; review before restoring")
        print("Restore disable_signup to", original["disable_signup"])
        if args.apply:
            config(token, original["disable_signup"])
            if bool(config(token).get("disable_signup")) != original["disable_signup"]:
                raise RuntimeError("Signup restore verification failed")
            STATE.unlink()
        return
    if STATE.exists():
        parser.error("Freeze state already exists")
    print("Current disable_signup:", current, "-> True")
    if not args.apply:
        print("DRY RUN: no setting changed")
        return
    descriptor = os.open(STATE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump({"ref": REF, "disable_signup": current}, output)
    try:
        config(token, True)
        if not bool(config(token).get("disable_signup")):
            raise RuntimeError("Signup freeze verification failed")
    except Exception:
        STATE.unlink(missing_ok=True)
        raise
    print("Source signup frozen")


if __name__ == "__main__":
    main()
