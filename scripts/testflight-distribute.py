#!/usr/bin/env python3
"""Hand an uploaded build to the TestFlight testers.

`xcrun altool --upload-app` only ingests the ipa. App Store Connect processes it
and then stops: a build that is not linked to a beta group reaches nobody, which
is why a successful upload can sit there while every tester still sees the
previous version. This script does the second half of a release:

  1. find the app by bundle id, and the build by CFBundleVersion (our CI stamps
     the workflow run number there, so "build 178" means "run 178");
  2. wait out Apple's processing until the build is VALID;
  3. add it to every internal beta group and every external beta group;
  4. for external groups, write the What's New text and submit the build for
     beta review, which external distribution requires and internal does not.

Every step is idempotent: a build already in a group is left alone, a
localization that already has text is kept, a build that already has a review
submission is not submitted again. So the same script is both the last step of
the build workflow and the manual rescue for a build uploaded before that step
existed.

Endpoints and payload shapes below were read off Apple's documentation on
2026-08-10 (developer.apple.com/documentation/appstoreconnectapi/<slug>):

  GET  /v1/apps                                    get-v1-apps
       filter[bundleId] is a documented filter.
  GET  /v1/builds                                  get-v1-builds
       filter[app], filter[version] (the CFBundleVersion string),
       sort=-uploadedDate, include=preReleaseVersion.
       Build.attributes.processingState is one of PROCESSING/FAILED/INVALID/VALID.
  GET  /v1/apps/{id}/betaGroups                    get-v1-apps-_id_-betagroups
       BetaGroup.attributes: name, isInternalGroup, hasAccessToAllBuilds,
       publicLinkEnabled, createdDate.
  GET  /v1/betaGroups/{id}/builds                  get-v1-betagroups-_id_-builds
  POST /v1/betaGroups/{id}/relationships/builds    post-v1-betagroups-_id_-relationships-builds
       body BetaGroupBuildsLinkagesRequest: {"data":[{"type":"builds","id":...}]}, 204 on success.
  GET  /v1/builds/{id}/betaBuildLocalizations      get-v1-builds-_id_-betabuildlocalizations
       BetaBuildLocalization.attributes: whatsNew, locale.
  POST /v1/betaBuildLocalizations                  post-v1-betabuildlocalizations
       body BetaBuildLocalizationCreateRequest: data.type "betaBuildLocalizations",
       attributes {whatsNew, locale}, relationships.build -> {"type":"builds","id":...}.
  PATCH /v1/betaBuildLocalizations/{id}            patch-v1-betabuildlocalizations-_id_
       body BetaBuildLocalizationUpdateRequest: data {type, id, attributes:{whatsNew}}.
  GET  /v1/betaAppReviewSubmissions                get-v1-betaappreviewsubmissions
       filter[build] is required on this endpoint.
  POST /v1/betaAppReviewSubmissions                post-v1-betaappreviewsubmissions
       body BetaAppReviewSubmissionCreateRequest: data.type "betaAppReviewSubmissions",
       relationships.build -> {"type":"builds","id":...}.

Auth is a JWT the caller signs itself (generating-tokens-for-api-requests):
ES256, header {alg, kid, typ}, payload {iss, iat, exp, aud "appstoreconnect-v1"},
lifetime at most 20 minutes — so the token is re-minted while polling.

Environment:
  APPLE_API_ISSUER          issuer id (UUID from Users and Access > Integrations)
  APPLE_API_KEY_ID          key id, e.g. 2X9R4HXF34
  APPLE_API_KEY_P8_BASE64   base64 of AuthKey_<key id>.p8, or
  APPLE_API_KEY_PATH        path to the .p8 file (also read from
                            ~/private_keys/AuthKey_<key id>.p8 when neither is set)

Usage:
  python3 scripts/testflight-distribute.py                 # newest build
  python3 scripts/testflight-distribute.py --build 178     # that CFBundleVersion
  python3 scripts/testflight-distribute.py --build 178 --dry-run

Needs the `cryptography` package (pip install cryptography); nothing else
outside the standard library.

The pure decision functions in the DECISIONS section are unit tested by
scripts/test_testflight_distribute.py:
  python3 -m unittest discover -s scripts -t scripts
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_ROOT = "https://api.appstoreconnect.apple.com"
DEFAULT_BUNDLE_ID = "com.xinyuan.readingpartner"
DEFAULT_LOCALE = "en-US"

# Apple caps a token at 20 minutes; stay under it and re-mint as needed.
TOKEN_LIFETIME_SECONDS = 15 * 60
POLL_SECONDS = 30
DEFAULT_WAIT_MINUTES = 40

# Beta review needs one-time metadata on the app, not on the build. When it is
# missing Apple answers the POST with an error naming the field; this is the
# map from that error back to the page in App Store Connect.
REVIEW_METADATA_HINT = """Beta review needs the app's Test Information filled in once, in
App Store Connect > Reading Partner > TestFlight > Test Information:
  - Beta App Description and Feedback Email (the betaAppLocalizations resource)
  - Contact first name, last name, email, phone (the betaAppReviewDetail resource)
  - A sign-in demo account, if the app requires an account
Fill in whatever Apple named above and re-run this workflow. Internal testers
already have the build; only the external groups wait on review."""


# --------------------------------------------------------------------------
# DECISIONS — pure functions over API payloads, unit tested without network.
# --------------------------------------------------------------------------

READY = "ready"
WAIT = "wait"
DEAD = "dead"


def attrs(resource):
    """The attributes dict of a JSON:API resource, never None."""
    return (resource or {}).get("attributes") or {}


def select_build(builds, version=None):
    """Pick the build to distribute.

    With a version (CFBundleVersion, i.e. our run number) keep only exact
    matches — the same number can appear under two marketing versions, so ties
    are broken by upload date. Without one, take the most recently uploaded.
    """
    candidates = list(builds or [])
    if version is not None and str(version).strip() != "":
        want = str(version).strip()
        candidates = [b for b in candidates if str(attrs(b).get("version", "")).strip() == want]
    if not candidates:
        return None
    return max(candidates, key=lambda b: (attrs(b).get("uploadedDate") or "", b.get("id") or ""))


def processing_verdict(build):
    """(verdict, state) for a build: READY to distribute, WAIT, or DEAD.

    A build fresh off altool is PROCESSING for a few minutes; FAILED and INVALID
    are terminal and mean the ipa never becomes testable.
    """
    state = attrs(build).get("processingState") or "UNKNOWN"
    if state == "VALID":
        return READY, state
    if state in ("FAILED", "INVALID"):
        return DEAD, state
    return WAIT, state


def split_groups(groups):
    """(internal, external) beta groups, each sorted by name.

    isInternalGroup is the only thing separating the two: internal groups take a
    build as soon as it is processed, external groups additionally need What's
    New text and a passed beta review.
    """
    def name(group):
        return (attrs(group).get("name") or "").lower()

    internal = sorted((g for g in groups or [] if attrs(g).get("isInternalGroup")), key=name)
    external = sorted((g for g in groups or [] if not attrs(g).get("isInternalGroup")), key=name)
    return internal, external


def group_add_plan(groups, membership, build_id):
    """[(group, action, reason)] where action is "add" or "skip".

    membership maps a group id to the set of build ids already in that group.
    Two reasons to skip, both of which make a POST pointless rather than wrong:
    the build is already linked, or the group is set to take every build.
    """
    plan = []
    for group in groups or []:
        gid = group.get("id")
        if build_id in (membership.get(gid) or set()):
            plan.append((group, "skip", "already in the group"))
        elif attrs(group).get("hasAccessToAllBuilds"):
            plan.append((group, "skip", "group takes every build automatically"))
        else:
            plan.append((group, "add", ""))
    return plan


def localization_plan(localizations, whats_new, override=False, locale=DEFAULT_LOCALE):
    """(action, target, text) with action "keep", "update" or "create".

    target is a localization id for keep/update and a locale for create.
    Existing non-empty text is left alone unless the caller passed its own text
    (override), because a re-run must not overwrite what a human wrote.
    """
    existing = list(localizations or [])
    if not existing:
        return "create", locale, whats_new

    preferred = next((l for l in existing if attrs(l).get("locale") == locale), existing[0])
    filled = [l for l in existing if (attrs(l).get("whatsNew") or "").strip()]
    if override:
        target = preferred
        return "update", target.get("id"), whats_new
    if filled:
        return "keep", filled[0].get("id"), (attrs(filled[0]).get("whatsNew") or "").strip()
    return "update", preferred.get("id"), whats_new


def review_plan(submissions):
    """(action, state) with action "submit" or "skip".

    One submission per build is all Apple accepts; re-submitting an existing one
    is an error, so any existing submission means there is nothing to do. A
    REJECTED build is reported and left alone — that needs a human.
    """
    existing = list(submissions or [])
    if not existing:
        return "submit", None
    return "skip", attrs(existing[0]).get("betaReviewState") or "UNKNOWN"


def default_whats_new(marketing_version, build_version):
    """What's New text used when nobody wrote any for this build."""
    if marketing_version:
        return f"Reading Partner {marketing_version}, build {build_version}."
    return f"Build {build_version}."


def format_api_errors(payload):
    """Apple's error body rendered one error per line, code/title/detail intact."""
    errors = (payload or {}).get("errors")
    if not errors:
        if payload in (None, {}, ""):
            return "(no response body)"
        return json.dumps(payload)[:2000]
    lines = []
    for error in errors:
        text = " - ".join(p for p in (error.get("title"), error.get("detail")) if p)
        code = error.get("code")
        if code:
            text = f"[{code}] {text}"
        source = error.get("source") or {}
        where = source.get("pointer") or source.get("parameter")
        if where:
            text = f"{text} (source: {where})"
        lines.append(text)
    return "\n".join(lines)


# --------------------------------------------------------------------------
# API client
# --------------------------------------------------------------------------

def fail(message):
    """Stop with a GitHub-annotated error.

    On stdout: Actions only parses workflow commands (::error::) from a step's
    stdout, and sys.exit(str) would write to stderr.
    """
    print(f"::error::{message}", flush=True)
    sys.exit(1)


class ApiError(Exception):
    def __init__(self, method, url, status, payload):
        self.method = method
        self.url = url
        self.status = status
        self.payload = payload
        super().__init__(f"{method} {url} -> HTTP {status}\n{format_api_errors(payload)}")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


class Client:
    """Minimal App Store Connect client: ES256 JWT, JSON:API, cursor paging."""

    def __init__(self, key_id: str, issuer_id: str, private_key_pem: bytes):
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import ec, utils
        except ImportError:
            sys.exit("cryptography is required: pip install cryptography")
        self._hashes = hashes
        self._ec = ec
        self._utils = utils
        self._key = serialization.load_pem_private_key(private_key_pem, password=None)
        self._key_id = key_id
        self._issuer_id = issuer_id
        self._token = None
        self._token_expiry = 0

    def token(self) -> str:
        now = int(time.time())
        if self._token and now < self._token_expiry - 60:
            return self._token
        header = {"alg": "ES256", "kid": self._key_id, "typ": "JWT"}
        expiry = now + TOKEN_LIFETIME_SECONDS
        payload = {
            "iss": self._issuer_id,
            "iat": now,
            "exp": expiry,
            "aud": "appstoreconnect-v1",
        }
        signing_input = ".".join(
            _b64url(json.dumps(part, separators=(",", ":")).encode()) for part in (header, payload)
        ).encode("ascii")
        # ES256 signatures on the wire are raw r||s, 32 bytes each; cryptography
        # hands back DER, so unpack and re-pack.
        der = self._key.sign(signing_input, self._ec.ECDSA(self._hashes.SHA256()))
        r, s = self._utils.decode_dss_signature(der)
        raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
        self._token = f"{signing_input.decode('ascii')}.{_b64url(raw)}"
        self._token_expiry = expiry
        return self._token

    def request(self, method, path, body=None, query=None, attempts=4):
        url = path if path.startswith("http") else API_ROOT + path
        if query:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query, doseq=True)
        data = json.dumps(body).encode() if body is not None else None
        last = None
        for attempt in range(1, attempts + 1):
            request = urllib.request.Request(url, data=data, method=method)
            request.add_header("Authorization", f"Bearer {self.token()}")
            request.add_header("Accept", "application/json")
            if data is not None:
                request.add_header("Content-Type", "application/json")
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    raw = response.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                raw = exc.read()
                try:
                    payload = json.loads(raw) if raw else {}
                except ValueError:
                    payload = {"errors": [{"title": "Unparseable response", "detail": raw[:500].decode("utf-8", "replace")}]}
                last = ApiError(method, url, exc.code, payload)
                # 429 is Apple's rate limit, 5xx its own hiccup; anything else
                # is our request being wrong and retrying will not fix it.
                if exc.code not in (429, 500, 502, 503, 504) or attempt == attempts:
                    raise last
            except urllib.error.URLError as exc:
                last = ApiError(method, url, 0, {"errors": [{"title": "Network error", "detail": str(exc.reason)}]})
                if attempt == attempts:
                    raise last
            wait = 5 * attempt
            print(f"  {method} {url} failed ({last.status}); retrying in {wait}s", flush=True)
            time.sleep(wait)
        raise last

    def get_all(self, path, query=None):
        """Every page of a collection: (data, included)."""
        data, included = [], []
        payload = self.request("GET", path, query=dict(query or {}, limit=200))
        while True:
            data.extend(payload.get("data") or [])
            included.extend(payload.get("included") or [])
            nxt = ((payload.get("links") or {}).get("next"))
            if not nxt:
                return data, included
            payload = self.request("GET", nxt)


# --------------------------------------------------------------------------
# Credentials
# --------------------------------------------------------------------------

def load_credentials():
    key_id = os.environ.get("APPLE_API_KEY_ID") or os.environ.get("APPLE_API_KEY")
    issuer = os.environ.get("APPLE_API_ISSUER")
    if not key_id:
        fail("APPLE_API_KEY_ID is not set")
    if not issuer:
        fail("APPLE_API_ISSUER is not set")

    encoded = os.environ.get("APPLE_API_KEY_P8_BASE64")
    if encoded:
        try:
            pem = base64.b64decode(encoded)
        except Exception:
            fail("APPLE_API_KEY_P8_BASE64 is not valid base64")
    else:
        raw_path = os.environ.get("APPLE_API_KEY_PATH") or os.environ.get("APPLE_API_KEY_P8")
        path = Path(raw_path).expanduser() if raw_path else Path.home() / "private_keys" / f"AuthKey_{key_id}.p8"
        if not path.exists():
            fail(f"App Store Connect private key not found at {path}. "
                     "Set APPLE_API_KEY_P8_BASE64 or APPLE_API_KEY_PATH.")
        pem = path.read_bytes()
    if b"PRIVATE KEY" not in pem:
        fail("the App Store Connect key does not look like a PEM .p8 file")
    return key_id, issuer, pem


# --------------------------------------------------------------------------
# Steps
# --------------------------------------------------------------------------

def find_app(client, bundle_id):
    data, _ = client.get_all("/v1/apps", {"filter[bundleId]": bundle_id, "fields[apps]": "name,bundleId"})
    if not data:
        fail(f"no app with bundle id {bundle_id} is visible to this API key")
    app = data[0]
    print(f"App: {attrs(app).get('name')} ({bundle_id}) id={app['id']}")
    return app


def find_build(client, app_id, version):
    query = {
        "filter[app]": app_id,
        "sort": "-uploadedDate",
        "include": "preReleaseVersion",
        "fields[builds]": "version,uploadedDate,processingState,expired,usesNonExemptEncryption",
    }
    if version:
        query["filter[version]"] = str(version)
    data, included = client.get_all("/v1/builds", query)
    build = select_build(data, version)
    if not build:
        if version:
            fail(f"no build with CFBundleVersion {version} under this app. "
                     "Check that the upload finished and that the number is the build workflow's run number.")
        fail("this app has no builds at all")

    marketing = None
    prerelease_id = (((build.get("relationships") or {}).get("preReleaseVersion") or {}).get("data") or {}).get("id")
    for resource in included:
        if resource.get("type") == "preReleaseVersions" and resource.get("id") == prerelease_id:
            marketing = attrs(resource).get("version")
    print(f"Build: {marketing or '?'} ({attrs(build).get('version')}) id={build['id']} "
          f"uploaded {attrs(build).get('uploadedDate')} state {attrs(build).get('processingState')}")
    return build, marketing


def wait_until_valid(client, build, wait_minutes, poll_seconds=POLL_SECONDS):
    deadline = time.monotonic() + wait_minutes * 60
    while True:
        verdict, state = processing_verdict(build)
        if verdict == READY:
            print(f"Processing: {state}")
            return build
        if verdict == DEAD:
            fail(f"build {attrs(build).get('version')} is {state}; App Store Connect "
                     "rejected it during processing and it can never be distributed. "
                     "Look at the build in TestFlight for Apple's reason and upload a new one.")
        if time.monotonic() >= deadline:
            fail(f"build {attrs(build).get('version')} is still {state} after "
                     f"{wait_minutes} minutes. Processing usually takes a few minutes; re-run the "
                     "iOS TestFlight Distribute workflow with this build number once it settles.")
        left = int(deadline - time.monotonic())
        print(f"  processing state {state}; polling again in {poll_seconds}s ({left // 60}m left)", flush=True)
        time.sleep(poll_seconds)
        build = client.request("GET", f"/v1/builds/{build['id']}").get("data") or build


def group_membership(client, groups):
    """{group id: set of build ids} for the groups we are about to touch.

    Only the target build matters, but the API has no "is this build in this
    group" call, so read the group's builds and keep the ids.
    """
    membership = {}
    for group in groups:
        data, _ = client.get_all(f"/v1/betaGroups/{group['id']}/builds", {"fields[builds]": "version"})
        membership[group["id"]] = {b.get("id") for b in data}
    return membership


def add_to_groups(client, groups, build_id, label, dry_run):
    if not groups:
        print(f"{label} groups: none configured")
        return 0
    membership = group_membership(client, groups)
    added = 0
    for group, action, reason in group_add_plan(groups, membership, build_id):
        name = attrs(group).get("name")
        if action == "skip":
            print(f"  {label} group '{name}': skipped ({reason})")
            continue
        if dry_run:
            print(f"  {label} group '{name}': would add the build")
            continue
        try:
            client.request(
                "POST",
                f"/v1/betaGroups/{group['id']}/relationships/builds",
                body={"data": [{"type": "builds", "id": build_id}]},
            )
        except ApiError as exc:
            # 409 is Apple's answer to a link that already exists; a re-run must
            # not fail on it.
            if exc.status == 409:
                print(f"  {label} group '{name}': already linked (409)")
                continue
            raise
        added += 1
        print(f"  {label} group '{name}': added")
    return added


def ensure_whats_new(client, build_id, text, override, dry_run):
    data, _ = client.get_all(f"/v1/builds/{build_id}/betaBuildLocalizations",
                             {"fields[betaBuildLocalizations]": "whatsNew,locale"})
    action, target, value = localization_plan(data, text, override=override)
    if action == "keep":
        print(f"  What's New: kept the existing text ({value[:60]!r})")
        return
    if dry_run:
        print(f"  What's New: would {action} ({value!r})")
        return
    if action == "create":
        client.request("POST", "/v1/betaBuildLocalizations", body={
            "data": {
                "type": "betaBuildLocalizations",
                "attributes": {"whatsNew": value, "locale": target},
                "relationships": {"build": {"data": {"type": "builds", "id": build_id}}},
            }
        })
        print(f"  What's New: created for {target} ({value!r})")
    else:
        client.request("PATCH", f"/v1/betaBuildLocalizations/{target}", body={
            "data": {"type": "betaBuildLocalizations", "id": target, "attributes": {"whatsNew": value}}
        })
        print(f"  What's New: updated ({value!r})")


def submit_for_review(client, build_id, dry_run):
    data, _ = client.get_all("/v1/betaAppReviewSubmissions", {
        "filter[build]": build_id,
        "fields[betaAppReviewSubmissions]": "betaReviewState,submittedDate",
    })
    action, state = review_plan(data)
    if action == "skip":
        print(f"  Beta review: already submitted, state {state}")
        if state == "REJECTED":
            print("  ::warning::Apple rejected this build's beta review; external testers will not "
                  "get it until that is resolved in App Store Connect.")
        return
    if dry_run:
        print("  Beta review: would submit")
        return
    try:
        client.request("POST", "/v1/betaAppReviewSubmissions", body={
            "data": {
                "type": "betaAppReviewSubmissions",
                "relationships": {"build": {"data": {"type": "builds", "id": build_id}}},
            }
        })
    except ApiError as exc:
        print(f"::error::beta review submission refused by Apple (HTTP {exc.status}):")
        print(format_api_errors(exc.payload))
        print(REVIEW_METADATA_HINT)
        raise SystemExit(1)
    print("  Beta review: submitted (external testers get the build once Apple approves it)")


# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Distribute a TestFlight build to every beta group.")
    parser.add_argument("--build", default=None,
                        help="CFBundleVersion to distribute (the build workflow's run number). "
                             "Omit to take the most recently uploaded build.")
    parser.add_argument("--bundle-id", default=DEFAULT_BUNDLE_ID)
    parser.add_argument("--whats-new", default=None,
                        help="What's New text for external testers. Overwrites whatever is there.")
    parser.add_argument("--wait-minutes", type=int, default=DEFAULT_WAIT_MINUTES,
                        help="how long to wait for Apple to finish processing the build")
    parser.add_argument("--poll-seconds", type=int, default=POLL_SECONDS)
    parser.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    args = parser.parse_args()

    version = (args.build or "").strip() or None
    key_id, issuer, pem = load_credentials()
    client = Client(key_id, issuer, pem)

    app = find_app(client, args.bundle_id)
    build, marketing = find_build(client, app["id"], version)
    build = wait_until_valid(client, build, args.wait_minutes, args.poll_seconds)
    build_id = build["id"]

    groups, _ = client.get_all(f"/v1/apps/{app['id']}/betaGroups", {
        "fields[betaGroups]": "name,isInternalGroup,hasAccessToAllBuilds,publicLinkEnabled",
    })
    internal, external = split_groups(groups)
    print(f"Beta groups: {len(internal)} internal, {len(external)} external")

    add_to_groups(client, internal, build_id, "internal", args.dry_run)

    if external:
        text = args.whats_new or default_whats_new(marketing, attrs(build).get("version"))
        print("External testing:")
        ensure_whats_new(client, build_id, text, override=bool(args.whats_new), dry_run=args.dry_run)
        add_to_groups(client, external, build_id, "external", args.dry_run)
        submit_for_review(client, build_id, args.dry_run)
    else:
        print("External testing: no external groups, nothing to review")

    print(f"Done. Build {attrs(build).get('version')} "
          f"({marketing or '?'}) is with the testers"
          + (" (external ones after Apple's beta review)." if external else "."))


if __name__ == "__main__":
    try:
        main()
    except ApiError as exc:
        print(f"::error::{exc}")
        sys.exit(1)
