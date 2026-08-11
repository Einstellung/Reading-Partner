#!/usr/bin/env python3
"""Unit tests for the decision functions of scripts/testflight-distribute.py.

They feed fake App Store Connect payloads to the pure functions; nothing here
touches the network or needs credentials.

  python3 -m unittest discover -s scripts -t scripts
"""

import contextlib
import importlib.util
import io
import time
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent / "testflight-distribute.py"
_spec = importlib.util.spec_from_file_location("testflight_distribute", SCRIPT)
td = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(td)


def build(bid, version, uploaded="2026-08-10T00:00:00Z", state="VALID", audience=None, prerelease=None):
    payload = {"type": "builds", "id": bid,
               "attributes": {"version": version, "uploadedDate": uploaded, "processingState": state}}
    if audience is not None:
        payload["attributes"]["buildAudienceType"] = audience
    if prerelease is not None:
        payload["relationships"] = {
            "preReleaseVersion": {"data": {"type": "preReleaseVersions", "id": prerelease}}
        }
    return payload


def prerelease(pid, version):
    return {"type": "preReleaseVersions", "id": pid, "attributes": {"version": version}}


def beta_detail(external, internal="READY_FOR_BETA_TESTING"):
    return {"type": "buildBetaDetails", "id": "d1",
            "attributes": {"internalBuildState": internal, "externalBuildState": external}}


def group(gid, name, internal, all_builds=False):
    return {"type": "betaGroups", "id": gid,
            "attributes": {"name": name, "isInternalGroup": internal, "hasAccessToAllBuilds": all_builds}}


def localization(lid, locale, whats_new):
    return {"type": "betaBuildLocalizations", "id": lid,
            "attributes": {"locale": locale, "whatsNew": whats_new}}


class QuietCase(unittest.TestCase):
    """Swallows the progress lines the step functions print as they run.

    self.output holds them, so a test can still assert on what was printed.
    """

    def setUp(self):
        self.output = io.StringIO()
        redirect = contextlib.redirect_stdout(self.output)
        redirect.__enter__()
        self.addCleanup(redirect.__exit__, None, None, None)


def api_error(status, detail, method="POST", url="https://api.example/x"):
    return td.ApiError(method, url, status, {"errors": [{"code": "NOT_FOUND", "detail": detail}]})


class Answers:
    """A different answer each time the same call is made; the last one sticks.

    Polling only means anything against an API whose answer changes, which is
    what "the build is not there, not there, there" needs.
    """

    def __init__(self, *answers):
        self.answers = list(answers)

    def take(self):
        return self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]


class FakeClient:
    """Enough of Client to drive the linking code without a network.

    `answers` maps a (method, path) pair to a response dict, an Answers
    sequence, or an exception to raise; every call is recorded in `calls`.
    """

    def __init__(self, answers=None, collections=None):
        self.answers = dict(answers or {})
        self.collections = dict(collections or {})
        self.calls = []

    @staticmethod
    def _unwrap(answer):
        if isinstance(answer, Answers):
            answer = answer.take()
        if isinstance(answer, Exception):
            raise answer
        return answer

    def request(self, method, path, body=None, query=None, attempts=4):
        self.calls.append((method, path, body))
        return self._unwrap(self.answers.get((method, path), {}))

    def get_all(self, path, query=None):
        self.calls.append(("GET", path, None))
        return self._unwrap(self.collections.get(path, ([], [])))


class Clock:
    """A monotonic clock that only moves when the code under test sleeps."""

    def __init__(self):
        self.t = 0.0
        self.slept = []

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += seconds


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


class SelectVersion(unittest.TestCase):
    """Without a build number, guessing is refused rather than risked.

    While Apple ingests a fresh upload the newest build the API can see is the
    previous one, so "distribute the newest" run straight after an upload would
    hand the testers the build that was just replaced — and report success.
    """

    def test_a_build_number_is_taken_as_given(self):
        self.assertEqual(td.select_version("43"), "43")

    def test_surrounding_whitespace_is_stripped(self):
        self.assertEqual(td.select_version(" 43 "), "43")

    def test_no_number_and_no_newest_is_refused(self):
        with self.assertRaises(td.StepFailed) as caught:
            td.select_version(None)
        self.assertIn("--build", caught.exception.detail)
        self.assertIn("--newest", caught.exception.detail)

    def test_an_empty_string_is_refused_like_a_missing_one(self):
        # The workflow passes "" when the dispatch field is left blank.
        for empty in ("", "   ", None):
            with self.assertRaises(td.StepFailed):
                td.select_version(empty)

    def test_newest_is_the_explicit_way_to_ask_for_a_guess(self):
        self.assertIsNone(td.select_version(None, newest=True))
        self.assertIsNone(td.select_version("", newest=True))

    def test_an_explicit_number_wins_over_newest(self):
        self.assertEqual(td.select_version("43", newest=True), "43")


class WaitForBuild(QuietCase):
    """The wait that run 31455103859 did not have.

    altool returned, distribute started, GET /v1/builds had nothing yet, and
    the script called that a missing build instead of an unfinished ingestion.
    """

    def lookup_appearing_on(self, nth, value="build"):
        """A lookup that answers None until its nth call."""
        state = {"calls": 0}

        def lookup():
            state["calls"] += 1
            return value if state["calls"] >= nth else None

        lookup.state = state
        return lookup

    def test_a_build_that_is_already_there_is_returned_without_waiting(self):
        clock = Clock()
        lookup = self.lookup_appearing_on(1)
        found = td.wait_for_build(lookup, "43", 20, 30, now=clock.now, sleep=clock.sleep)
        self.assertEqual(found, "build")
        self.assertEqual(clock.slept, [])

    def test_a_build_that_appears_on_the_third_poll(self):
        clock = Clock()
        lookup = self.lookup_appearing_on(3)
        found = td.wait_for_build(lookup, "43", 20, 30, now=clock.now, sleep=clock.sleep)
        self.assertEqual(found, "build")
        self.assertEqual(lookup.state["calls"], 3)
        self.assertEqual(clock.slept, [30, 30])
        self.assertIn("appeared after", self.output.getvalue())

    def test_the_waiting_log_says_which_of_the_two_waits_this_is(self):
        clock = Clock()
        td.wait_for_build(self.lookup_appearing_on(2), "43", 20, 30,
                          now=clock.now, sleep=clock.sleep)
        text = self.output.getvalue()
        self.assertIn("build 43 is not in App Store Connect yet", text)
        self.assertNotIn("processing state", text)

    def test_it_gives_up_on_the_injected_clock_not_the_real_one(self):
        clock = Clock()
        lookup = self.lookup_appearing_on(99)
        with self.assertRaises(td.StepFailed):
            td.wait_for_build(lookup, "43", 1, 30, now=clock.now, sleep=clock.sleep)
        # t=0, t=30, t=60 -> the third lookup is the one past the deadline.
        self.assertEqual(lookup.state["calls"], 3)
        self.assertEqual(clock.t, 60)

    def test_the_default_wait_polls_for_twenty_minutes(self):
        clock = Clock()
        lookup = self.lookup_appearing_on(999)
        with self.assertRaises(td.StepFailed):
            td.wait_for_build(lookup, "43", td.DEFAULT_APPEAR_WAIT_MINUTES, td.POLL_SECONDS,
                              now=clock.now, sleep=clock.sleep)
        self.assertEqual(clock.t, td.DEFAULT_APPEAR_WAIT_MINUTES * 60)
        self.assertEqual(lookup.state["calls"], td.DEFAULT_APPEAR_WAIT_MINUTES * 60 // td.POLL_SECONDS + 1)

    def test_the_timeout_says_what_to_do_instead_of_building_again(self):
        clock = Clock()
        with self.assertRaises(td.StepFailed) as caught:
            td.wait_for_build(self.lookup_appearing_on(999), "43", 1, 30,
                              now=clock.now, sleep=clock.sleep)
        problem = caught.exception
        self.assertIn("43", problem.step)
        self.assertIn("CFBundleVersion 43", problem.detail)
        self.assertIn("Do not build again", problem.hint)
        self.assertIn("iOS TestFlight Distribute", problem.hint)
        self.assertIn("Actions tab", problem.hint)


class FindBuild(QuietCase):
    """find_build over a fake API: the two waits and the --newest semantics."""

    def builds_answer(self, *pages):
        return {"/v1/builds": Answers(*pages)}

    def a_build(self, version="43", state="PROCESSING"):
        return ([build("b1", version, state=state, prerelease="p1")], [prerelease("p1", "0.8.23")])

    def test_it_keeps_looking_until_apple_has_the_build(self):
        client = FakeClient(collections=self.builds_answer(([], []), ([], []), self.a_build()))
        found, marketing = td.find_build(client, "app1", "43", appear_wait_minutes=1, poll_seconds=0)
        self.assertEqual(found["id"], "b1")
        self.assertEqual(marketing, "0.8.23")
        self.assertEqual([p for _, p, _ in client.calls], ["/v1/builds"] * 3)

    def test_a_build_that_never_appears_ends_with_the_manual_workflow(self):
        client = FakeClient(collections={"/v1/builds": ([], [])})
        with self.assertRaises(SystemExit):
            td.find_build(client, "app1", "43", appear_wait_minutes=0, poll_seconds=0)
        text = self.output.getvalue()
        self.assertIn("never appeared in App Store Connect", text)
        self.assertIn("Do not build again", text)
        self.assertIn("iOS TestFlight Distribute", text)
        # The annotation Actions shows keeps the whole message, newlines escaped.
        self.assertIn("::error::", text)
        self.assertIn("%0A", text)

    def test_newest_takes_one_shot_and_warns_that_it_is_a_guess(self):
        client = FakeClient(collections={"/v1/builds": self.a_build(state="VALID")})
        found, _ = td.find_build(client, "app1", None, appear_wait_minutes=20, poll_seconds=0)
        self.assertEqual(found["id"], "b1")
        self.assertEqual(len(client.calls), 1)
        self.assertIn("still being ingested is invisible", self.output.getvalue())

    def test_newest_against_an_app_with_no_builds_at_all(self):
        client = FakeClient(collections={"/v1/builds": ([], [])})
        with self.assertRaises(SystemExit):
            td.find_build(client, "app1", None, appear_wait_minutes=20, poll_seconds=0)
        self.assertIn("no builds at all", self.output.getvalue())

    def test_appearing_late_and_still_processing_runs_both_waits_in_order(self):
        client = FakeClient(
            {("GET", "/v1/builds/b1"): {"data": build("b1", "43", state="VALID")}},
            self.builds_answer(([], []), self.a_build(state="PROCESSING")),
        )
        found, _ = td.find_build(client, "app1", "43", appear_wait_minutes=1, poll_seconds=0)
        self.assertEqual(td.attrs(found).get("processingState"), "PROCESSING")
        valid = td.wait_until_valid(client, found, wait_minutes=1, poll_seconds=0)
        self.assertEqual(td.attrs(valid).get("processingState"), "VALID")
        text = self.output.getvalue()
        self.assertIn("not in App Store Connect yet", text)
        self.assertIn("processing state PROCESSING", text)
        self.assertLess(text.index("not in App Store Connect yet"), text.index("processing state"))


class WaitUntilValid(QuietCase):
    def test_a_build_that_is_already_valid_returns_at_once(self):
        client = FakeClient()
        b = build("b1", "43", state="VALID")
        self.assertIs(td.wait_until_valid(client, b, 1, 0), b)
        self.assertEqual(client.calls, [])

    def test_a_rejected_build_stops_the_run(self):
        with self.assertRaises(SystemExit):
            td.wait_until_valid(FakeClient(), build("b1", "43", state="INVALID"), 1, 0)
        self.assertIn("can never be distributed", self.output.getvalue())

    def test_a_build_stuck_in_processing_points_at_the_manual_workflow(self):
        with self.assertRaises(SystemExit):
            td.wait_until_valid(FakeClient(), build("b1", "43", state="PROCESSING"), 0, 0)
        text = self.output.getvalue()
        self.assertIn("is in App Store Connect but is still PROCESSING", text)
        self.assertIn("Do not build again", text)
        self.assertIn("build = 43", text)


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


class PickIncluded(unittest.TestCase):
    """Regression: run 31390099873 logged the marketing version as '?'.

    fields[builds] left preReleaseVersion out, so the sparse fieldset dropped
    the relationship and there was no id to match the included resource by.
    """

    def test_matches_the_relationship_id(self):
        b = build("b1", "42", prerelease="pre-2")
        included = [prerelease("pre-1", "0.8.21"), prerelease("pre-2", "0.8.22")]
        found = td.pick_included(b, included, "preReleaseVersion", "preReleaseVersions")
        self.assertEqual(td.attrs(found).get("version"), "0.8.22")

    def test_falls_back_to_the_only_included_resource(self):
        b = build("b1", "42")  # relationship missing from the response
        found = td.pick_included(b, [prerelease("pre-1", "0.8.22")],
                                 "preReleaseVersion", "preReleaseVersions")
        self.assertEqual(td.attrs(found).get("version"), "0.8.22")

    def test_refuses_to_guess_between_several(self):
        b = build("b1", "42")
        included = [prerelease("pre-1", "0.8.21"), prerelease("pre-2", "0.8.22")]
        self.assertIsNone(td.pick_included(b, included, "preReleaseVersion", "preReleaseVersions"))

    def test_ignores_other_resource_types(self):
        b = build("b1", "42")
        self.assertIsNone(td.pick_included(b, [beta_detail("READY_FOR_BETA_SUBMISSION")],
                                           "preReleaseVersion", "preReleaseVersions"))

    def test_a_dangling_relationship_id_finds_nothing(self):
        b = build("b1", "42", prerelease="pre-9")
        self.assertIsNone(td.pick_included(b, [prerelease("pre-1", "0.8.22")],
                                           "preReleaseVersion", "preReleaseVersions"))

    def test_the_recovered_version_reaches_the_whats_new_text(self):
        b = build("b1", "42", prerelease="pre-1")
        found = td.pick_included(b, [prerelease("pre-1", "0.8.22")],
                                 "preReleaseVersion", "preReleaseVersions")
        self.assertEqual(td.default_whats_new(td.attrs(found).get("version"), "42"),
                         "Reading Partner 0.8.22, build 42.")


class ExternalVerdict(unittest.TestCase):
    def test_ready_to_submit_is_ready(self):
        self.assertEqual(td.external_verdict(beta_detail("READY_FOR_BETA_SUBMISSION")),
                         (td.READY, "READY_FOR_BETA_SUBMISSION"))

    def test_still_processing_externally_waits(self):
        self.assertEqual(td.external_verdict(beta_detail("PROCESSING")), (td.WAIT, "PROCESSING"))

    def test_export_compliance_review_waits(self):
        self.assertEqual(td.external_verdict(beta_detail("IN_EXPORT_COMPLIANCE_REVIEW"))[0], td.WAIT)

    def test_missing_export_compliance_blocks(self):
        self.assertEqual(td.external_verdict(beta_detail("MISSING_EXPORT_COMPLIANCE")),
                         (td.BLOCKED, "MISSING_EXPORT_COMPLIANCE"))

    def test_expired_and_processing_exception_block(self):
        self.assertEqual(td.external_verdict(beta_detail("EXPIRED"))[0], td.BLOCKED)
        self.assertEqual(td.external_verdict(beta_detail("PROCESSING_EXCEPTION"))[0], td.BLOCKED)

    def test_an_unknown_state_never_blocks_distribution(self):
        self.assertEqual(td.external_verdict(beta_detail("SOMETHING_NEW"))[0], td.READY)
        self.assertEqual(td.external_verdict({}), (td.READY, "UNKNOWN"))
        self.assertEqual(td.external_verdict(None), (td.READY, "UNKNOWN"))


class AudienceVerdict(unittest.TestCase):
    def test_internal_only_cannot_go_external(self):
        self.assertEqual(td.audience_verdict(build("b1", "42", audience="INTERNAL_ONLY")),
                         (td.BLOCKED, "INTERNAL_ONLY"))

    def test_app_store_eligible_is_fine(self):
        self.assertEqual(td.audience_verdict(build("b1", "42", audience="APP_STORE_ELIGIBLE")),
                         (td.READY, "APP_STORE_ELIGIBLE"))

    def test_an_absent_audience_is_not_treated_as_internal(self):
        self.assertEqual(td.audience_verdict(build("b1", "42")), (td.READY, "UNKNOWN"))


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

    def test_the_external_state_alone_can_show_it_was_already_submitted(self):
        for state in ("WAITING_FOR_BETA_REVIEW", "IN_BETA_REVIEW", "BETA_APPROVED",
                      "BETA_REJECTED", "READY_FOR_BETA_TESTING", "IN_BETA_TESTING"):
            self.assertEqual(td.review_plan([], state), ("skip", state), state)

    def test_ready_for_beta_submission_still_submits(self):
        self.assertEqual(td.review_plan([], "READY_FOR_BETA_SUBMISSION"), ("submit", None))

    def test_an_existing_submission_wins_over_the_external_state(self):
        submissions = [{"id": "s1", "attributes": {"betaReviewState": "APPROVED"}}]
        self.assertEqual(td.review_plan(submissions, "IN_BETA_REVIEW"), ("skip", "APPROVED"))


class LinkBuildToGroup(QuietCase):
    """The 404 from run 31390099873 came from the betaGroups-side endpoint.

    fastlane only ever uses the builds-side one, so that is what this tries
    first; the other direction is a single documented fallback.
    """

    PRIMARY = "/v1/builds/b1/relationships/betaGroups"
    FALLBACK = "/v1/betaGroups/g1/relationships/builds"

    def test_uses_the_builds_side_endpoint_first(self):
        client = FakeClient()
        self.assertEqual(td.link_build_to_group(client, "b1", "g1"), "linked")
        self.assertEqual([(m, p) for m, p, _ in client.calls], [("POST", self.PRIMARY)])
        self.assertEqual(client.calls[0][2], {"data": [{"type": "betaGroups", "id": "g1"}]})

    def test_falls_back_to_the_other_direction_on_404(self):
        client = FakeClient({("POST", self.PRIMARY): api_error(404, "no resource of type 'builds'")})
        result = td.link_build_to_group(client, "b1", "g1")
        self.assertIn("betaGroups endpoint", result)
        self.assertEqual([p for _, p, _ in client.calls], [self.PRIMARY, self.FALLBACK])
        self.assertEqual(client.calls[1][2], {"data": [{"type": "builds", "id": "b1"}]})

    def test_a_409_on_the_first_call_means_the_edge_is_already_there(self):
        client = FakeClient({("POST", self.PRIMARY): api_error(409, "already exists")})
        self.assertIn("already linked", td.link_build_to_group(client, "b1", "g1"))
        self.assertEqual(len(client.calls), 1)

    def test_a_409_on_the_fallback_also_means_already_linked(self):
        client = FakeClient({
            ("POST", self.PRIMARY): api_error(404, "gone"),
            ("POST", self.FALLBACK): api_error(409, "already exists"),
        })
        self.assertIn("already linked", td.link_build_to_group(client, "b1", "g1"))

    def test_both_answers_are_carried_into_the_failure(self):
        client = FakeClient({
            ("POST", self.PRIMARY): api_error(404, "no resource of type 'builds' with id 'b1'"),
            ("POST", self.FALLBACK): api_error(422, "TF_ASSIGN_MONOGRAMS_BUILD_GROUP_RESPONSE"),
        })
        with self.assertRaises(td.StepFailed) as caught:
            td.link_build_to_group(client, "b1", "g1")
        detail = caught.exception.detail
        self.assertIn("HTTP 404", detail)
        self.assertIn("no resource of type 'builds' with id 'b1'", detail)
        self.assertIn("HTTP 422", detail)
        self.assertIn("TF_ASSIGN_MONOGRAMS_BUILD_GROUP_RESPONSE", detail)


class AddToGroups(QuietCase):
    def test_skips_the_groups_that_need_nothing(self):
        client = FakeClient(collections={"/v1/betaGroups/g1/builds": ([{"id": "b1"}], [])})
        lines = td.add_to_groups(client, [group("g1", "Internal", True)], "b1", "internal", False)
        self.assertEqual(len(lines), 1)
        self.assertIn("already has the build", lines[0])
        self.assertNotIn("POST", [m for m, _, _ in client.calls])

    def test_dry_run_changes_nothing(self):
        client = FakeClient(collections={"/v1/betaGroups/g1/builds": ([], [])})
        lines = td.add_to_groups(client, [group("g1", "Friends", False)], "b1", "external", True)
        self.assertIn("dry run", lines[0])
        self.assertEqual([m for m, _, _ in client.calls], ["GET"])


class ExternalDistribution(QuietCase):
    """Failures in the external half must be reported, not thrown away."""

    def collections(self, submissions=()):
        return {
            "/v1/builds/b1/betaBuildLocalizations": ([], []),
            "/v1/betaAppReviewSubmissions": (list(submissions), []),
            "/v1/betaGroups/g1/builds": ([], []),
        }

    def test_an_internal_only_build_is_refused_before_anything_is_written(self):
        client = FakeClient(collections=self.collections())
        b = build("b1", "42", audience="INTERNAL_ONLY")
        lines, problems = td.distribute_external(
            client, b, "0.8.22", [group("g1", "Friends", False)], None, 1, 0, False)
        self.assertEqual(len(problems), 1)
        self.assertIn("INTERNAL_ONLY", problems[0].detail)
        self.assertIn("INTERNAL_ONLY", lines[0])
        self.assertEqual(client.calls, [])

    def test_missing_export_compliance_stops_with_an_actionable_hint(self):
        client = FakeClient(
            {("GET", "/v1/builds/b1/buildBetaDetail"): {"data": beta_detail("MISSING_EXPORT_COMPLIANCE")}},
            self.collections())
        lines, problems = td.distribute_external(
            client, build("b1", "42", audience="APP_STORE_ELIGIBLE"), "0.8.22",
            [group("g1", "Friends", False)], None, 1, 0, False)
        self.assertEqual(len(problems), 1)
        self.assertIn("MISSING_EXPORT_COMPLIANCE", problems[0].detail)
        self.assertIn("ITSAppUsesNonExemptEncryption", problems[0].hint)
        self.assertIn("stopped at", lines[-1])

    def test_the_happy_path_writes_notes_then_submits_then_links(self):
        client = FakeClient(
            {("GET", "/v1/builds/b1/buildBetaDetail"): {"data": beta_detail("READY_FOR_BETA_SUBMISSION")}},
            self.collections())
        lines, problems = td.distribute_external(
            client, build("b1", "42", audience="APP_STORE_ELIGIBLE"), "0.8.22",
            [group("g1", "Friends", False)], None, 1, 0, False)
        self.assertEqual(problems, [])
        writes = [(m, p) for m, p, _ in client.calls if m in ("POST", "PATCH")]
        self.assertEqual(writes, [
            ("POST", "/v1/betaBuildLocalizations"),
            ("POST", "/v1/betaAppReviewSubmissions"),
            ("POST", "/v1/builds/b1/relationships/betaGroups"),
        ])
        self.assertIn("Reading Partner 0.8.22, build 42.", " ".join(lines))

    def test_a_refused_review_submission_reports_the_test_information_hint(self):
        client = FakeClient(
            {
                ("GET", "/v1/builds/b1/buildBetaDetail"): {"data": beta_detail("READY_FOR_BETA_SUBMISSION")},
                ("POST", "/v1/betaAppReviewSubmissions"): api_error(409, "Missing Beta App Description"),
            },
            self.collections())
        lines, problems = td.distribute_external(
            client, build("b1", "42", audience="APP_STORE_ELIGIBLE"), "0.8.22",
            [group("g1", "Friends", False)], None, 1, 0, False)
        self.assertEqual(len(problems), 1)
        self.assertIn("Missing Beta App Description", problems[0].detail)
        self.assertIn("Test Information", problems[0].hint)
        # The group link is never attempted once the submission failed.
        self.assertNotIn("/v1/builds/b1/relationships/betaGroups", [p for _, p, _ in client.calls])

    def test_a_link_failure_still_leaves_the_earlier_steps_done(self):
        client = FakeClient(
            {
                ("GET", "/v1/builds/b1/buildBetaDetail"): {"data": beta_detail("READY_FOR_BETA_SUBMISSION")},
                ("POST", "/v1/builds/b1/relationships/betaGroups"): api_error(404, "no builds with that id"),
                ("POST", "/v1/betaGroups/g1/relationships/builds"): api_error(404, "no builds with that id"),
            },
            self.collections())
        lines, problems = td.distribute_external(
            client, build("b1", "42", audience="APP_STORE_ELIGIBLE"), "0.8.22",
            [group("g1", "Friends", False)], None, 1, 0, False)
        self.assertEqual(len(problems), 1)
        self.assertIn("What's New created", " ".join(lines))
        self.assertIn("beta review submitted", " ".join(lines))


class Summary(unittest.TestCase):
    def test_the_internal_result_survives_an_external_failure(self):
        problem = td.StepFailed("linking the build to a beta group",
                                "POST ... -> HTTP 404\n[NOT_FOUND] no such build",
                                "Add the build by hand.")
        text = td.format_summary(["'Internal': already has the build"],
                                 ["stopped at: linking the build to a beta group"], [problem])
        self.assertIn("'Internal': already has the build", text)
        self.assertIn("Needs a human", text)
        self.assertIn("[NOT_FOUND] no such build", text)
        self.assertIn("-> Add the build by hand.", text)

    def test_a_clean_run_says_so(self):
        text = td.format_summary(["'Internal': linked"], ["'Friends': linked"], [])
        self.assertIn("Nothing needs a human.", text)
        self.assertNotIn("Needs a human", text)


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

    def test_a_wait_longer_than_the_token_re_mints_it(self):
        """Both polling loops outlive a 15-minute token; every poll goes through
        Client.request, which asks for the token again, so this is the whole of
        what keeps a 20- or 40-minute wait authenticated."""
        client = td.Client("KEYID123", "issuer-uuid", self.pem)
        # Stand in for the time module inside the script only, so the wall
        # clock can jump a whole token's lifetime between the two calls.
        ticks = iter([1000, 1000 + td.TOKEN_LIFETIME_SECONDS])
        fake_time = mock.Mock(time=lambda: next(ticks, 1000 + td.TOKEN_LIFETIME_SECONDS),
                              monotonic=time.monotonic, sleep=lambda _s: None)
        with mock.patch.object(td, "time", fake_time):
            first = client.token()
            second = client.token()
        self.assertNotEqual(first, second)
        self.assertEqual(self.decode(first.split(".")[1])["iat"], 1000)
        claims = self.decode(second.split(".")[1])
        self.assertEqual(claims["iat"], 1000 + td.TOKEN_LIFETIME_SECONDS)
        self.assertGreater(claims["exp"], claims["iat"])


if __name__ == "__main__":
    unittest.main()
