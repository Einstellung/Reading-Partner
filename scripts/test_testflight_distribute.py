#!/usr/bin/env python3
"""Unit tests for the decision functions of scripts/testflight-distribute.py.

They feed fake App Store Connect payloads to the pure functions; nothing here
touches the network or needs credentials.

  python3 -m unittest discover -s scripts -t scripts
"""

import importlib.util
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "testflight-distribute.py"
_spec = importlib.util.spec_from_file_location("testflight_distribute", SCRIPT)
td = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(td)


def build(bid, version, uploaded="2026-08-10T00:00:00Z", state="VALID"):
    return {"type": "builds", "id": bid,
            "attributes": {"version": version, "uploadedDate": uploaded, "processingState": state}}


def group(gid, name, internal, all_builds=False):
    return {"type": "betaGroups", "id": gid,
            "attributes": {"name": name, "isInternalGroup": internal, "hasAccessToAllBuilds": all_builds}}


def localization(lid, locale, whats_new):
    return {"type": "betaBuildLocalizations", "id": lid,
            "attributes": {"locale": locale, "whatsNew": whats_new}}


class SelectBuild(unittest.TestCase):
    def test_exact_version_match(self):
        builds = [build("a", "177"), build("b", "178")]
        self.assertEqual(td.select_build(builds, "178")["id"], "b")

    def test_version_is_compared_as_a_string_not_a_prefix(self):
        builds = [build("a", "1780"), build("b", "178")]
        self.assertEqual(td.select_build(builds, "178")["id"], "b")

    def test_missing_version_yields_nothing(self):
        self.assertIsNone(td.select_build([build("a", "177")], "999"))

    def test_no_version_takes_the_newest_upload(self):
        builds = [build("a", "177", "2026-08-01T10:00:00Z"), build("b", "178", "2026-08-09T10:00:00Z")]
        self.assertEqual(td.select_build(builds, None)["id"], "b")

    def test_same_build_number_under_two_marketing_versions_breaks_the_tie_by_date(self):
        builds = [build("old", "178", "2026-07-01T10:00:00Z"), build("new", "178", "2026-08-09T10:00:00Z")]
        self.assertEqual(td.select_build(builds, "178")["id"], "new")

    def test_empty_version_string_behaves_like_no_version(self):
        builds = [build("a", "177", "2026-08-01T10:00:00Z"), build("b", "178", "2026-08-09T10:00:00Z")]
        self.assertEqual(td.select_build(builds, "")["id"], "b")

    def test_no_builds_at_all(self):
        self.assertIsNone(td.select_build([], None))


class ProcessingVerdict(unittest.TestCase):
    def test_valid_is_ready(self):
        self.assertEqual(td.processing_verdict(build("a", "1", state="VALID")), (td.READY, "VALID"))

    def test_processing_waits(self):
        self.assertEqual(td.processing_verdict(build("a", "1", state="PROCESSING")), (td.WAIT, "PROCESSING"))

    def test_failed_and_invalid_are_terminal(self):
        self.assertEqual(td.processing_verdict(build("a", "1", state="FAILED"))[0], td.DEAD)
        self.assertEqual(td.processing_verdict(build("a", "1", state="INVALID"))[0], td.DEAD)

    def test_a_missing_state_is_treated_as_still_processing(self):
        self.assertEqual(td.processing_verdict({"id": "a"}), (td.WAIT, "UNKNOWN"))


class SplitGroups(unittest.TestCase):
    def test_split_and_sort(self):
        groups = [group("2", "Zeta", False), group("1", "alpha", True), group("3", "Beta", False)]
        internal, external = td.split_groups(groups)
        self.assertEqual([g["id"] for g in internal], ["1"])
        self.assertEqual([g["id"] for g in external], ["3", "2"])

    def test_a_missing_flag_counts_as_external(self):
        internal, external = td.split_groups([{"id": "x", "attributes": {"name": "n"}}])
        self.assertEqual(internal, [])
        self.assertEqual([g["id"] for g in external], ["x"])


class GroupAddPlan(unittest.TestCase):
    def test_adds_a_group_that_does_not_have_the_build(self):
        groups = [group("g1", "internal", True)]
        plan = td.group_add_plan(groups, {"g1": {"other"}}, "b1")
        self.assertEqual([(g["id"], action) for g, action, _ in plan], [("g1", "add")])

    def test_idempotent_when_the_build_is_already_linked(self):
        groups = [group("g1", "internal", True)]
        plan = td.group_add_plan(groups, {"g1": {"b1"}}, "b1")
        self.assertEqual(plan[0][1], "skip")
        self.assertIn("already", plan[0][2])

    def test_a_group_that_takes_every_build_is_left_alone(self):
        groups = [group("g1", "internal", True, all_builds=True)]
        plan = td.group_add_plan(groups, {"g1": set()}, "b1")
        self.assertEqual(plan[0][1], "skip")

    def test_a_group_with_no_membership_entry_still_gets_added(self):
        plan = td.group_add_plan([group("g1", "internal", True)], {}, "b1")
        self.assertEqual(plan[0][1], "add")


class LocalizationPlan(unittest.TestCase):
    def test_creates_when_the_build_has_none(self):
        self.assertEqual(td.localization_plan([], "notes"), ("create", "en-US", "notes"))

    def test_fills_in_an_empty_existing_localization(self):
        existing = [localization("l1", "en-US", "")]
        self.assertEqual(td.localization_plan(existing, "notes"), ("update", "l1", "notes"))

    def test_keeps_text_somebody_already_wrote(self):
        existing = [localization("l1", "en-US", "hand written")]
        action, target, text = td.localization_plan(existing, "notes")
        self.assertEqual((action, target, text), ("keep", "l1", "hand written"))

    def test_explicit_text_overwrites_the_existing_one(self):
        existing = [localization("l1", "en-US", "hand written")]
        self.assertEqual(td.localization_plan(existing, "notes", override=True), ("update", "l1", "notes"))

    def test_prefers_the_default_locale_when_several_exist(self):
        existing = [localization("l1", "zh-Hans", ""), localization("l2", "en-US", "")]
        self.assertEqual(td.localization_plan(existing, "notes")[1], "l2")

    def test_falls_back_to_the_only_locale_there_is(self):
        existing = [localization("l1", "zh-Hans", "")]
        self.assertEqual(td.localization_plan(existing, "notes")[1], "l1")

    def test_whitespace_only_text_counts_as_empty(self):
        existing = [localization("l1", "en-US", "   \n ")]
        self.assertEqual(td.localization_plan(existing, "notes")[0], "update")


class ReviewPlan(unittest.TestCase):
    def test_submits_when_there_is_no_submission(self):
        self.assertEqual(td.review_plan([]), ("submit", None))

    def test_does_not_submit_twice(self):
        submissions = [{"id": "s1", "attributes": {"betaReviewState": "WAITING_FOR_REVIEW"}}]
        self.assertEqual(td.review_plan(submissions), ("skip", "WAITING_FOR_REVIEW"))

    def test_a_rejected_submission_is_reported_not_resubmitted(self):
        submissions = [{"id": "s1", "attributes": {"betaReviewState": "REJECTED"}}]
        self.assertEqual(td.review_plan(submissions), ("skip", "REJECTED"))


class Messages(unittest.TestCase):
    def test_whats_new_carries_both_version_numbers(self):
        self.assertEqual(td.default_whats_new("0.8.22", "178"), "Reading Partner 0.8.22, build 178.")

    def test_whats_new_without_a_marketing_version(self):
        self.assertEqual(td.default_whats_new(None, "178"), "Build 178.")

    def test_apple_errors_keep_code_title_detail_and_source(self):
        payload = {"errors": [{
            "code": "ENTITY_ERROR.ATTRIBUTE.REQUIRED",
            "title": "A required attribute is missing",
            "detail": "You must provide a value for 'contactFirstName'",
            "source": {"pointer": "/data/attributes/contactFirstName"},
        }]}
        text = td.format_api_errors(payload)
        self.assertIn("ENTITY_ERROR.ATTRIBUTE.REQUIRED", text)
        self.assertIn("A required attribute is missing", text)
        self.assertIn("contactFirstName", text)
        self.assertIn("/data/attributes/contactFirstName", text)

    def test_a_body_without_errors_is_still_shown(self):
        self.assertIn("weird", td.format_api_errors({"weird": True}))

    def test_an_empty_body_says_so(self):
        self.assertEqual(td.format_api_errors(None), "(no response body)")


class Token(unittest.TestCase):
    """The JWT is signed locally, so its shape can be checked without Apple."""

    @classmethod
    def setUpClass(cls):
        try:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric import ec
        except ImportError:
            raise unittest.SkipTest("cryptography is not installed")
        key = ec.generate_private_key(ec.SECP256R1())
        cls.pem = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

    def decode(self, part):
        import base64
        import json
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))

    def test_header_and_payload_match_apples_requirements(self):
        client = td.Client("KEYID123", "issuer-uuid", self.pem)
        header, payload, signature = client.token().split(".")
        self.assertEqual(self.decode(header), {"alg": "ES256", "kid": "KEYID123", "typ": "JWT"})
        claims = self.decode(payload)
        self.assertEqual(claims["iss"], "issuer-uuid")
        self.assertEqual(claims["aud"], "appstoreconnect-v1")
        self.assertLessEqual(claims["exp"] - claims["iat"], 20 * 60)
        self.assertGreater(claims["exp"], int(time.time()))
        # ES256 signatures are raw r||s: 64 bytes, i.e. 86 base64url chars.
        self.assertEqual(len(signature), 86)

    def test_the_token_is_reused_until_it_nears_expiry(self):
        client = td.Client("KEYID123", "issuer-uuid", self.pem)
        self.assertEqual(client.token(), client.token())


if __name__ == "__main__":
    unittest.main()
