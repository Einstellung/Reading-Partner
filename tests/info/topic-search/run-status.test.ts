// What background_status says about topic-search runs (run-status.ts), from
// synthetic progress files, result files, shelf rows and claims.

import { expect, test } from "bun:test";
import { backgroundStatusText, type StatusInput } from "../../../src/legion/status/describe";
import type { DeviceClaim } from "../../../src/legion/claim";
import type { Run } from "../../../src/legion/run";
import type { ArxivRead } from "../../../src/info/topic-search/arxiv-read";
import type { SourceHealthFile } from "../../../src/info/topic-search/build-result";
import type { TopicSearchResult } from "../../../src/info/topic-search/result-types";
import { encodeBrief, TOPIC_SEARCH_KIND, type TopicSearchBrief } from "../../../src/info/topic-search/run";
import {
  aboutTopicSearchRun,
  issueLine,
  localXLine,
  remoteXLine,
  resultLine,
  topicSearchDescriber,
  type ShelfIssue,
  type TopicSearchStatusDeps,
} from "../../../src/info/topic-search/run-status";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { tallySteps, type XStep } from "../../../src/info/topic-search/x-progress";

const NOW = new Date(2026, 9, 17, 10, 46).getTime();
const MIN = 60_000;

const SEARCH: TopicSearch = {
  id: "ts-7a7a7a7a",
  name: "Mechanism discovery",
  concernId: null,
  scope: "How a system designs its own experiments.",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [
    { id: "q1", subtopic: null, x: "q1 x", arxiv: "autonomous experiment", ranking: "", weight: 1 },
    { id: "q2", subtopic: null, x: "q2 x", arxiv: null, ranking: "", weight: 1 },
  ],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: 1,
};

const post = (id: string) => ({ id }) as never;
let n = 0;
const step = (s: Record<string, unknown>) => ({ n: ++n, at: NOW, activeMs: 0, ...s }) as unknown as XStep;

/** Two lines, the first read to its end, the second on its second screen; one post seen twice. */
const STEPS: XStep[] = [
  step({ kind: "start", order: ["ts-7a7a7a7a:q1", "ts-7a7a7a7a:q2"] }),
  step({ kind: "open", line: "ts-7a7a7a7a:q1", url: "u", status: "ok", landed: null, ms: 1 }),
  step({ kind: "read", line: "ts-7a7a7a7a:q1", screen: 1, ids: [], fresh: [post("1"), post("2")], dropped: 0, textChars: 0, scrollY: 0, height: 0 }),
  step({ kind: "scroll", line: "ts-7a7a7a7a:q1", asked: 1, moved: 1 }),
  step({ kind: "read", line: "ts-7a7a7a7a:q1", screen: 2, ids: [], fresh: [post("2"), post("3")], dropped: 0, textChars: 0, scrollY: 0, height: 0 }),
  step({ kind: "line-end", line: "ts-7a7a7a7a:q1", why: "exhausted", screens: 2, kept: 3, topId: "3" }),
  step({ kind: "open", line: "ts-7a7a7a7a:q2", url: "u", status: "ok", landed: null, ms: 1 }),
  step({ kind: "read", line: "ts-7a7a7a7a:q2", screen: 1, ids: [], fresh: [post("4")], dropped: 0, textChars: 0, scrollY: 0, height: 0 }),
];

function tsRun(brief: TopicSearchBrief, over: Partial<Run> = {}): Run {
  return {
    id: "r-retry",
    kind: TOPIC_SEARCH_KIND,
    tier: "synced",
    delegator: { kind: "program", name: "topic-search retry" },
    brief: encodeBrief(brief),
    state: "running",
    attempts: 1,
    claimant: { deviceId: "dev-desk", startedAt: NOW - 4 * MIN },
    createdAt: NOW - 4 * MIN,
    startedAt: NOW - 4 * MIN,
    lastProgressAt: NOW - 30_000,
    progress: "reading X: query 2 of 2, 3 screens read, 4 distinct posts found so far",
    revision: 3,
    ...over,
  };
}

const RETRY: TopicSearchBrief = { searchId: SEARCH.id, kind: "retry", night: null, n: 1 };
const FIRST: TopicSearchBrief = { searchId: SEARCH.id, kind: "first", night: null };
const DAILY: TopicSearchBrief = { searchId: SEARCH.id, kind: "daily", night: "2026-10-17" };

function result(over: Partial<TopicSearchResult>): TopicSearchResult {
  return {
    version: 1,
    id: "topic-search-ts-7a7a7a7a-2026-10-16",
    searchId: SEARCH.id,
    name: SEARCH.name,
    kind: "first",
    date: "2026-10-16",
    createdAt: NOW - 24 * 60 * MIN,
    items: [{ id: "E1" }, { id: "E2" }] as never,
    empty: false,
    ...over,
  } as TopicSearchResult;
}

const desk = {
  deviceId: "dev-desk",
  deviceName: "kestrel",
  platform: "linux",
  claimedAt: NOW - 300 * MIN,
  heartbeatAt: NOW - 20 * MIN,
  capabilities: ["webview-fetch"],
  sites: { "x.com": true },
  halt: null,
  sources: {
    "topic-search:ts-7a7a7a7a:q1:arxiv": {
      topicSearch: { searchId: SEARCH.id, name: SEARCH.name, query: "q1", label: "autonomous experiment", source: "arxiv", status: "ok", read: 12, fresh: 5, passedFloor: 3, ladder: { outcome: "widened", steps: [] } },
    },
  },
} as unknown as DeviceClaim;

function deps(over: Partial<TopicSearchStatusDeps> = {}) {
  const asked: string[] = [];
  const d: TopicSearchStatusDeps = {
    searches: async () => [SEARCH],
    steps: async (id) => {
      asked.push(`steps:${id}`);
      return STEPS;
    },
    arxivRead: async (id) => {
      asked.push(`arxiv:${id}`);
      return null;
    },
    runHealth: async (id) => {
      asked.push(`health:${id}`);
      return null;
    },
    results: async () => [],
    issues: async () => [],
    localX: async () => ({ halt: null, signedIn: true }),
    ...over,
  };
  return { d, asked };
}

function input(runs: Run[], d: TopicSearchStatusDeps, over: Partial<StatusInput> = {}): StatusInput {
  const describer = topicSearchDescriber(d);
  return {
    runs,
    claims: [desk],
    deviceId: "dev-desk",
    now: NOW,
    lastSyncAt: NOW - MIN,
    syncing: true,
    describer: (k) => (k === TOPIC_SEARCH_KIND ? describer : null),
    requires: () => ["webview-fetch"],
    ...over,
  };
}

test("the progress file folds into the query, screens and distinct posts, no text", () => {
  expect(tallySteps(STEPS).line()).toBe("query 2 of 2, 3 screens read, 4 distinct posts found so far");
  const ended = tallySteps([...STEPS, step({ kind: "halt", halt: { kind: "signed-out", detail: "" } }), step({ kind: "end", status: "halted", why: "signed out" })]);
  expect(ended.line()).toBe("finished (halted: signed out): 1 of 2 queries read to their end, 3 screens read, 4 distinct posts found; X stopped it (signed-out)");
});

test("a run's headline names the search and the kind, and a done line starting skipped: is a skip", () => {
  expect(aboutTopicSearchRun(tsRun(RETRY), [SEARCH]).title).toBe('topic search "Mechanism discovery": retry #1 of the first look');
  expect(aboutTopicSearchRun(tsRun(DAILY), [SEARCH]).title).toContain("nightly run for the night of 2026-10-17");
  expect(aboutTopicSearchRun(tsRun(FIRST), []).subjects).toEqual([SEARCH.id]);
  const skipped = aboutTopicSearchRun(tsRun(RETRY, { state: "done", progress: "skipped: signed out of X" }), [SEARCH]);
  expect(skipped.skipped).toBe("signed out of X");
});

test("on the collector, a running retry reports its own X progress and that arXiv has no outcome yet", async () => {
  const { d } = deps();
  const text = await backgroundStatusText(input([tsRun(RETRY)], d), { about: "Mechanism discovery" });
  expect(text).toContain('- topic search "Mechanism discovery": retry #1 of the first look [topic-search]');
  expect(text).toContain("running on this device (kestrel), started 4 min ago (today 10:42)");
  expect(text).toContain("X: query 2 of 2, 3 screens read, 4 distinct posts found so far.");
  expect(text).toContain("arXiv: searched beside X while X is read; nothing on file yet.");
  expect(text).toContain("Result: nothing added yet");
  expect(text).toContain("Brief issue: not yet");
  expect(text).toContain("X on this device: signed in, not paused.");
  expect(text).not.toContain("cannot see");
});

test("on the collector, arXiv done while X is still being read says so, query by query", async () => {
  const step = { terms: ["autonomous", "experiment"], since: "2025-10-17", until: "2026-10-17" };
  const done: ArxivRead = {
    version: 1,
    window: { since: "2025-10-17", until: "2026-10-17" },
    planned: ["q1"],
    found: [{ query: "q1", items: [{ id: "a" }, { id: "b" }] as never, error: null, ladder: { outcome: "widened", steps: [{ ...step, hits: 2 }] } }],
    done: true,
  };
  const { d } = deps({ arxivRead: async () => done });
  const text = await backgroundStatusText(input([tsRun(FIRST)], d), { about: "Mechanism discovery" });
  expect(text).toContain("X: query 2 of 2, 3 screens read, 4 distinct posts found so far.");
  expect(text).toContain("arXiv done: 1 query searched (1 widened), 2 papers; the result is built once X has been read.");
  expect(text).toContain('arXiv per query: "autonomous experiment" widened, 2 papers.');

  const limited: ArxivRead = {
    ...done,
    planned: ["q1", "q3"],
    found: [{ query: "q1", items: [], error: "rate limited (HTTP 429 from export.arxiv.org)", ladder: { outcome: "rate_limited", steps: [{ ...step, hits: null }] } }],
    done: false,
  };
  const half = await backgroundStatusText(input([tsRun(FIRST)], deps({ arxivRead: async () => limited }).d), { about: "Mechanism discovery" });
  expect(half).toContain("arXiv: 1 of 2 queries searched (1 rate limited), 0 papers.");
  expect(half).toContain('arXiv per query: "autonomous experiment" failed (rate limited (HTTP 429 from export.arxiv.org)).');
});

test("on the collector, a done run gives its per-query outcomes, result growth and issue", async () => {
  const health: SourceHealthFile = {
    version: 1,
    searchId: SEARCH.id,
    kind: "first",
    at: NOW,
    entries: [
      { searchId: SEARCH.id, query: "q1", source: "x", status: "ok", why: null, fetchedAt: NOW, read: 20, fresh: 6, passedFloor: 4 },
      { searchId: SEARCH.id, query: "q2", source: "x", status: "failed", why: "signed-out", fetchedAt: null, read: 0, fresh: 0, passedFloor: 0 },
      { searchId: SEARCH.id, query: "q1", source: "arxiv", status: "empty", why: null, fetchedAt: NOW, read: 0, fresh: 0, passedFloor: 0, ladder: { outcome: "exhausted", steps: [] } },
    ],
  };
  const merged = result({ items: [{ id: "E1" }, { id: "E2" }, { id: "E3" }] as never, retries: [{ runId: "r-retry", at: NOW, items: ["E3"], overview: null, writeup: "model", questions: [], stats: {} as never }] });
  const issues: ShelfIssue[] = [{ key: `first:${SEARCH.id}#r-retry`, number: 12, date: "2026-10-17", topics: [{ searchId: SEARCH.id }] }];
  const { d } = deps({ runHealth: async () => health, results: async () => [merged], issues: async () => issues });
  const done = tsRun(RETRY, { state: "done", endedAt: NOW - 2 * MIN, progress: "4 posts read (done); 1 items delivered" });
  const text = await backgroundStatusText(input([done], d), { about: SEARCH.id });
  expect(text).toContain('X per query: "q1 x" 20 read, 6 new; "q2 x" failed (signed-out).');
  expect(text).toContain('arXiv per query: "autonomous experiment" exhausted, 0 read, 0 new.');
  expect(text).toContain("Result: this retry added 1 item to the first look's result (now 3).");
  expect(text).toContain("Brief issue: No. 12 (2026-10-17) is on the shelf.");
  expect(text).not.toContain("X on this device");
});

test("on a phone, a running run is told from its synced record; the computer's files are not read", async () => {
  const { d, asked } = deps();
  const text = await backgroundStatusText(input([tsRun(RETRY)], d, { deviceId: "dev-phone" }), { about: SEARCH.name });
  expect(asked).toEqual([]);
  expect(text).toContain('running on "kestrel"');
  expect(text).toContain('Last report, just now: "reading X: query 2 of 2, 3 screens read, 4 distinct posts found so far".');
  expect(text).toContain("This device cannot see \"kestrel\"'s progress directly");
  expect(text).toContain('Its X progress file and per-query outcomes are kept on "kestrel"');
  expect(text).toContain('X on "kestrel", as it last reported 20 min ago: signed in.');
});

test("on a phone, a done run gives the outcomes the computer's claim last carried", async () => {
  const { d } = deps({ results: async () => [result({ createdAt: NOW - 3 * MIN })] });
  const done = tsRun(FIRST, { id: "r-first", state: "done", endedAt: NOW - 2 * MIN, progress: "done" });
  const text = await backgroundStatusText(input([done], d, { deviceId: "dev-phone" }), { about: SEARCH.name });
  expect(text).toContain('as "kestrel" last reported 20 min ago (from the last run that read each query)');
  expect(text).toContain('arXiv per query: "autonomous experiment" widened, 12 read, 5 new.');
  expect(text).toContain("Result: 2 items.");
  expect(text).toContain("Brief issue: not on this device's shelf yet");
});

test("a queued run with no collector up says so, and X state comes from the last claim that said", async () => {
  const { d } = deps();
  const queued = tsRun(RETRY, { state: "pending", claimant: undefined, startedAt: undefined, lastProgressAt: undefined, progress: undefined, attempts: 0 });
  const off = { ...desk, heartbeatAt: NOW - 300 * MIN, sites: { "x.com": false }, halt: "X topic search stopped (signed-out): no session" } as unknown as DeviceClaim;
  const text = await backgroundStatusText(input([queued], d, { deviceId: "dev-phone", claims: [off] }));
  expect(text).toContain("no device that can run it has checked in in the last 2 hours");
  expect(text).toContain('X on "kestrel", as it last reported 5 h ago: signed out; its last halt: X topic search stopped (signed-out): no session.');
});

test("result, issue and X lines for each kind and state", () => {
  const running = tsRun(DAILY);
  expect(resultLine(running, DAILY, [])).toContain("not written yet");
  const night = result({ kind: "daily", id: "topic-search-ts-7a7a7a7a-2026-10-17", createdAt: NOW, items: [], empty: true });
  expect(resultLine({ ...running, state: "done" }, DAILY, [night])).toBe("Result: written, nothing new in it.");
  const without: ShelfIssue = { key: "night:2026-10-17", number: 13, date: "2026-10-17", topics: [{ searchId: "ts-other" }] };
  expect(issueLine({ ...running, state: "done" }, DAILY, [without], [night])).toContain("came out without this topic");
  expect(issueLine(tsRun(RETRY, { state: "done" }), RETRY, [], [])).toBe("Brief issue: none, since this retry added nothing.");
  const ago = (at: number) => `${Math.round((NOW - at) / MIN)} min ago`;
  expect(localXLine({ halt: { kind: "signed-out", detail: "", at: NOW - 5 * MIN, night: "", strikes: 0, paused: false }, signedIn: false }, { ago })).toContain("signed out (found 5 min ago)");
  expect(localXLine({ halt: { kind: "challenge", detail: "", at: NOW, night: "", strikes: 2, paused: true }, signedIn: true }, { ago })).toContain("paused after a second challenge");
  expect(remoteXLine(null, { ago })).toBe("X's sign-in and pauses are known only on the computer that reads X.");
});
