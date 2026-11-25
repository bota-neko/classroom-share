#!/usr/bin/env python3
"""Add Classroom Share API schema and redirect URLs without replacing target settings."""

import argparse
import json
import subprocess
import urllib.request

REF = "fktqwohvwxlkscwyvlqh"
BASE = "https://api.supabase.com/v1/projects/" + REF
REDIRECTS = (
    "https://www.classshare.online/**",
    "https://classshare.online/**",
)


def token():
    result = subprocess.run(
        ["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def api(path, credential, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        BASE + path,
        data=body,
        method="PATCH" if payload is not None else "GET",
        headers={
            "Authorization": "Bearer " + credential,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-target-ref")
    args = parser.parse_args()
    if args.apply and args.confirm_target_ref != REF:
        parser.error("--apply requires the exact --confirm-target-ref")

    credential = token()
    rest = api("/postgrest", credential)
    auth = api("/config/auth", credential)
    schemas = [part.strip() for part in rest["db_schema"].split(",")]
    urls = [part.strip() for part in auth.get("uri_allow_list", "").split(",") if part.strip()]
    new_schemas = list(dict.fromkeys(schemas + ["classroom_share"]))
    new_urls = list(dict.fromkeys(urls + list(REDIRECTS)))
    print("Data API schemas:", ", ".join(schemas), "->", ", ".join(new_schemas))
    print("Redirect URL additions:", [url for url in REDIRECTS if url not in urls])
    print("Existing Auth site URL preserved:", auth.get("site_url"))
    if not args.apply:
        print("DRY RUN: no configuration changed")
        return

    if new_schemas != schemas:
        api("/postgrest", credential, {"db_schema": ",".join(new_schemas)})
    if new_urls != urls:
        api("/config/auth", credential, {"uri_allow_list": ",".join(new_urls)})
    updated_rest = api("/postgrest", credential)
    updated_auth = api("/config/auth", credential)
    if ("classroom_share" not in updated_rest["db_schema"].split(",")
            or not all(url in updated_auth.get("uri_allow_list", "").split(",") for url in REDIRECTS)):
        raise RuntimeError("Target configuration verification failed")
    print("Target configuration verified")


if __name__ == "__main__":
    main()
