// Slice F of docs/info/91 (对话里改, 更新, 结束): the confirm-lines card, what its
// send writes and in which order, the update run as the card shows it, the end,
// and the three door tools.

import { describe, expect, test } from "bun:test";
import type { AgentTool } from "../../../src/legion/durable/contract";
import type { StudyLinesCardData, StudyMoveCardData } from "../../../src/info/topic-search/cards";
import type { TopicLabel } from "../../../src/info/topic-search/labels";
import type { StudyVersion, TopicSearchResult, TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import { emptyStudyFile, type StudyFile, type StudyLine } from "../../../src/info/topic-search/study";
import {
  draftStudyLines,
  endStudy,
  keptCounts,
  parseMoveTarget,
  resolveBriefItem,
  sendStudyLines,
  studyBrief,
  studyRunStatus,
  suggestedTopic,
  undecidedLines,
  withLineEdit,
  withLineVerdict,
  type EndPorts,
  type SendLinesPorts,
  type StudyAsk,
  type StudyBrief,
} from "../../../src/info/topic-search/study-lines";
import {
  buildEndStudyTool,
  buildProposeStudyLinesTool,
  buildUpdateStudyBriefTool,
  sentText,
} from "../../../src/info/topic-search/study-tools";
import type { TopicSearch } from "../../../src/info/topic-search/types";

type ToolResult = Awaited<ReturnType<AgentTool["execute"]>>;
const textOf = (r: ToolResult) => (typeof r === "string" ? r : r.text);
const receiptOf = (r: ToolResult) => (typeof r === "string" ? undefined : r.receipt);

const ID = "ts-5a5a5a5a";
const STUDY: TopicSearch = {
  id: ID,
  name: "Mechanism discovery",
  concernId: "st-1",
  scope: "AI that finds mechanisms and designs its next experiment.",
  subtopics: [],
  want: [],
  avoid: ["Benchmarks only"],
  judgments: [],
  anchors: [],
  queries: [{ id: "q2", subtopic: null, x: "equation discovery", arxiv: "equation discovery", ranking: "r", weight: 1 }],
  answers: [],
  status: "active",
  revision: 4,
  createdAt: 0,
  lastRunAt: null,
  once: true,
  sources: ["arxiv", "huggingface"],
};

const item = (id: string, key: string, title: string, score: number) => ({ id, key, title, score }) as unknown as TopicSearchResultItem;
const version = (n: number, at: number, entries: StudyVersion["entries"]): StudyVersion => ({
  n,
  at,
  runId: `r${n}`,
  base: n === 1 ? null : n - 1,
  entries,
  removed: [],
  changes: [],
  lines: [],
  overview: null,
});
// E4 is E2's paper rewritten in version 2; E5 is in no version.
const RESULT = {
  kind: "first",
  items: [
    item("E1", "arxiv:2601.00001", "KeplerAgent", 80),
    item("E2", "arxiv:2601.00002", "The AI Scientist", 60),
    item("E3", "arxiv:2601.00003", "LLM-SR", 40),
    item("E4", "arxiv:2601.00002", "The AI Scientist", 61),
    item("E5", "arxiv:2601.00005", "LLM-IDEA", 30),
  ],
  study: {
    versions: [
      version(1, 100, [
        { item: "E1", place: "pinned", tag: "pinned" },
        { item: "E2", place: "main", tag: null },
        { item: "E3", place: "note", tag: null },
      ]),
      version(2, 200, [
        { item: "E1", place: "pinned", tag: null },
        { item: "E4", place: "main", tag: "rewritten" },
        { item: "E3", place: "note", tag: null },
      ]),
    ],
  },
} as unknown as TopicSearchResult;

const BRIEF = studyBrief(RESULT, []);
const READER = [
  { id: "m1", ts: 10, text: "I don't want plain curve fitting that never designs the next experiment." },
  { id: "m2", ts: 20, text: "Keep LLM-IDEA, it is the one I care about" },
];

function card(over: Partial<StudyLinesCardData> = {}): StudyLinesCardData {
  return {
    kind: "study-lines",
    threadId: "th",
    searchId: ID,
    name: STUDY.name,
    at: 1,
    phase: "open",
    lines: [
      { kind: "avoid", text: "Curve fitting that never designs an experiment", said: READER[0].text, evidence: "door:th:10", item: null, itemTitle: null, verdict: "ok" },
      { kind: "pin", text: "LLM-IDEA", said: READER[1].text, evidence: "door:th:20", item: "arxiv:2601.00005", itemTitle: "LLM-IDEA", verdict: "edit" },
      { kind: "demote", text: "The AI Scientist to the Notes", said: "it writes papers, not experiments", evidence: "", item: "arxiv:2601.00002", itemTitle: "The AI Scientist", verdict: "ok" },
      { kind: "judgment", text: "Priors matter most", said: "priors are the point", evidence: "", item: null, itemTitle: null, verdict: "drop" },
    ],
    ...over,
  };
}

describe("the brief the lines are about", () => {
  test("places come from the version the reader has; a rollback moves it", () => {
    expect(BRIEF.version).toBe(2);
    const sci = BRIEF.items.find((i) => i.key === "arxiv:2601.00002")!;
    expect(sci).toMatchObject({ id: "E4", place: "main", rank: 2, score: 61 });
    expect(BRIEF.items.find((i) => i.key === "arxiv:2601.00005")).toMatchObject({ place: null, rank: null, score: null });
    const back = studyBrief(RESULT, [{ to: 1, at: 300 }]);
    expect(back.version).toBe(1);
    expect(back.items.find((i) => i.key === "arxiv:2601.00002")).toMatchObject({ id: "E2", score: 60 });
    expect(studyBrief(null, [])).toEqual({ version: null, items: [] });
  });

  test("an item is named by id, key, arXiv id, title, or a title part only one has", () => {
    expect(resolveBriefItem("E4", BRIEF)?.key).toBe("arxiv:2601.00002");
    expect(resolveBriefItem("arxiv:2601.00003", BRIEF)?.title).toBe("LLM-SR");
    expect(resolveBriefItem("2601.00001", BRIEF)?.title).toBe("KeplerAgent");
    expect(resolveBriefItem("the ai scientist", BRIEF)?.id).toBe("E4");
    expect(resolveBriefItem("IDEA", BRIEF)?.id).toBe("E5");
    expect(resolveBriefItem("LLM", BRIEF)).toBeNull();
    expect(resolveBriefItem("", BRIEF)).toBeNull();
  });
});

describe("propose_study_lines' lines", () => {
  test("lines are drawn with the item's key and title and the reader's message as evidence", () => {
    const { lines, problems } = draftStudyLines(
      [
        { kind: "avoid", text: "No curve fitting", said: READER[0].text },
        { kind: "pin", text: "LLM-IDEA", said: READER[1].text, item: "LLM-IDEA" },
      ],
      BRIEF,
      READER,
      "th",
    );
    expect(problems).toEqual([]);
    expect(lines[0]).toMatchObject({ kind: "avoid", item: null, verdict: null });
    expect(lines[0].evidence).toContain("10");
    expect(lines[1]).toMatchObject({ kind: "pin", item: "arxiv:2601.00005", itemTitle: "LLM-IDEA" });
  });

  test("a line that cannot be drawn says why", () => {
    const { lines, problems } = draftStudyLines(
      [
        { kind: "wish", text: "x", said: "y" },
        { kind: "avoid", text: "x", said: "" },
        { kind: "pin", text: "x", said: "y", item: "Nonexistent" },
        { kind: "demote", text: "x", said: "y", item: "E5" },
      ],
      BRIEF,
      READER,
      "th",
    );
    expect(lines).toEqual([]);
    expect(problems.join("\n")).toContain("kind must be one of");
    expect(problems.join("\n")).toContain("no said");
    expect(problems.join("\n")).toContain("names no item");
    expect(problems.join("\n")).toContain("not in the version");
  });
});

describe("the reader's marks", () => {
  test("对 and 别记 toggle; 改一下 rewords and counts as confirmed; a sent card does not change", () => {
    const open = card({ lines: card().lines.map((l) => ({ ...l, verdict: null })) });
    expect(undecidedLines(open)).toEqual([0, 1, 2, 3]);
    const ok = withLineVerdict(open, "0:ok");
    expect(ok.lines[0].verdict).toBe("ok");
    expect(withLineVerdict(ok, "0:ok").lines[0].verdict).toBeNull();
    expect(withLineVerdict(ok, "9:ok")).toBe(ok);
    expect(withLineVerdict(ok, "1:maybe")).toBe(ok);
    const edited = withLineEdit(ok, "1:LLM-IDEA, pinned: it closes the loop");
    expect(edited.lines[1]).toMatchObject({ text: "LLM-IDEA, pinned: it closes the loop", verdict: "edit" });
    expect(withLineEdit(ok, "1:   ")).toBe(ok);
    expect(undecidedLines(edited)).toEqual([2, 3]);
    const sent = { ...edited, phase: "asked" as const };
    expect(withLineVerdict(sent, "2:ok")).toBe(sent);
  });
});

function ports(over: Partial<SendLinesPorts> = {}) {
  const calls: string[] = [];
  let search = STUDY;
  let study: StudyFile = { ...emptyStudyFile(ID), lines: [{ id: "L2", kind: "avoid", text: "old", said: "old", evidence: "", item: null, state: "confirmed", at: 1, usedIn: 2 }] };
  const labels: TopicLabel[] = [];
  const asks: { lines: readonly string[]; queries: readonly string[] }[] = [];
  const p: SendLinesPorts = {
    searches: async () => [search],
    change: async (_id, change) => {
      calls.push("config");
      search = change(search);
      return search;
    },
    study: async () => study,
    putLines: async (_id, lines) => {
      calls.push("lines");
      study = { ...study, lines: [...study.lines, ...lines] };
    },
    addLabels: async (_id, add) => {
      calls.push("labels");
      labels.push(...add);
    },
    brief: async () => BRIEF,
    ask: async (_id, ask): Promise<StudyAsk> => {
      calls.push("ask");
      asks.push(ask);
      return { status: "asked", runId: "run-9", n: 2 };
    },
    now: () => 500,
    random: () => 0.5,
    ...over,
  };
  return { p, calls, asks, labels, get search() { return search; }, get study() { return study; } };
}

describe("the send", () => {
  test("nothing is written while a line is undecided, or once the study ended", async () => {
    const h = ports();
    const undecided = card({ lines: card().lines.map((l, i) => (i === 2 ? { ...l, verdict: null } : l)) });
    expect(await sendStudyLines(undecided, [], h.p)).toEqual({ ok: false, why: "undecided", undecided: [2] });
    const ended = ports({ searches: async () => [{ ...STUDY, status: "stopped" }] });
    expect(await sendStudyLines(card(), [], ended.p)).toEqual({ ok: false, why: "ended" });
    expect([...h.calls, ...ended.calls]).toEqual([]);
  });

  test("config, then lines, then labels, then the ask; dropped lines write nothing", async () => {
    const h = ports();
    const result = await sendStudyLines(card(), [{ subtopic: "", x: "", arxiv: "closed loop discovery", ranking: "loop?" }, { subtopic: "", x: "x only", arxiv: "", ranking: "" }], h.p);
    expect(h.calls).toEqual(["config", "lines", "labels", "ask"]);
    // The config: 不要 added with the reader's words in the answers, the judgment dropped, one extra query numbered on.
    expect(h.search.avoid).toEqual(["Benchmarks only", "Curve fitting that never designs an experiment"]);
    expect(h.search.judgments).toEqual([]);
    expect(h.search.answers).toEqual([{ asked: "Curve fitting that never designs an experiment", answer: READER[0].text, at: 500 }]);
    expect(h.search.queries.map((q) => q.id)).toEqual(["q2", "q3"]);
    expect(h.search.revision).toBe(5);
    // The record: three lines, numbered on from L2; the reworded pin keeps its new text.
    const written = h.study.lines.slice(1);
    expect(written.map((l) => [l.id, l.kind, l.state, l.usedIn])).toEqual([
      ["L3", "avoid", "confirmed", null],
      ["L4", "pin", "confirmed", null],
      ["L5", "demote", "confirmed", null],
    ]);
    // The labels: pinned and borderline, with where each stood and the revision the config now has.
    expect(h.labels.map((l) => [l.item, l.label, l.source, l.reason])).toEqual([
      ["arxiv:2601.00005", "pinned", "line", READER[1].text],
      ["arxiv:2601.00002", "borderline", "line", "it writes papers, not experiments"],
    ]);
    expect(h.labels[0].brief).toEqual({ version: 2, place: "absent", rank: null, score: null });
    expect(h.labels[1].brief).toEqual({ version: 2, place: "main", rank: 2, score: 61 });
    expect(h.labels.every((l) => l.criteria === 5)).toBe(true);
    expect(h.asks).toEqual([{ lines: ["L3", "L4", "L5"], queries: ["q3"] }]);
    expect(result.ok && result.card).toMatchObject({ phase: "asked", ids: ["L3", "L4", "L5", null], ask: { status: "asked", runId: "run-9" } });
  });

  test("lines with nothing for the config leave it alone", async () => {
    const h = ports();
    const pinOnly = card({ lines: card().lines.map((l, i) => (i === 0 ? { ...l, verdict: "drop" } : l)) });
    await sendStudyLines(pinOnly, [], h.p);
    expect(h.calls).toEqual(["lines", "labels", "ask"]);
    expect(h.search.revision).toBe(4);
  });

  test("a busy update leaves the card recorded; pressing again only asks, with the same lines", async () => {
    let busy = true;
    const h = ports({
      ask: async (_id, ask) => {
        h.asks.push(ask);
        return busy ? { status: "busy" } : { status: "asked", runId: "run-10", n: 3 };
      },
    });
    const first = await sendStudyLines(card(), [], h.p);
    expect(first.ok && first.card.phase).toBe("recorded");
    busy = false;
    const again = await sendStudyLines((first as { card: StudyLinesCardData }).card, [], h.p);
    expect(h.calls.filter((c) => c === "lines")).toHaveLength(1);
    expect(h.asks[1]).toEqual(h.asks[0]);
    expect(again.ok && again.card).toMatchObject({ phase: "asked", ask: { runId: "run-10" } });
    expect(await sendStudyLines((again as { card: StudyLinesCardData }).card, [], h.p)).toEqual({ ok: false, why: "asked" });
  });
});

test("the update run as the card says it, the cooldown wait read off run.ts's progress line", () => {
  expect(studyRunStatus(null)).toBeNull();
  expect(studyRunStatus({ state: "pending" })).toEqual({ kind: "waiting" });
  expect(studyRunStatus({ state: "running", progress: "searching arXiv" })).toEqual({ kind: "running" });
  expect(studyRunStatus({ state: "running", progress: "arXiv rate-limit cooldown; searching again in about 12 minutes" })).toEqual({ kind: "cooling", minutes: 12 });
  expect(studyRunStatus({ state: "running", progress: "arXiv rate-limit cooldown, about 90 minutes: this version is made without 2 queries" })).toEqual({ kind: "running" });
  expect(studyRunStatus({ state: "done" })).toEqual({ kind: "done" });
  expect(studyRunStatus({ state: "cancelled" })).toEqual({ kind: "failed" });
});

describe("the end", () => {
  const MOVE: StudyMoveCardData = {
    kind: "study-move",
    threadId: "th",
    searchId: ID,
    name: STUDY.name,
    version: 2,
    bookId: "b2",
    topics: [{ id: "tp-1", name: "AI for science" }],
    suggested: "tp-1",
    at: 1,
    phase: "open",
  };

  function endPorts(over: Partial<EndPorts> = {}) {
    const calls: string[] = [];
    const p: EndPorts = {
      makeTopic: async (name) => {
        calls.push(`make ${name}`);
        return { id: "tp-new", name };
      },
      fileBook: async (c, topic) => {
        calls.push(`file ${c.bookId} ${topic.id}`);
        return topic.id === "tp-filed" ? "Already there" : topic.name;
      },
      stop: async (id) => {
        calls.push(`stop ${id}`);
        return { ...STUDY, status: "stopped" };
      },
      oldBooks: async () => ["b1"],
      deleteBook: async (id) => void calls.push(`delete ${id}`),
      kept: async () => ({ pins: 2, marks: 3 }),
      ...over,
    };
    return { p, calls };
  }

  test("the book is filed first, then the study stopped and the older versions deleted", async () => {
    const h = endPorts();
    const moved = await endStudy(MOVE, { topicId: "tp-1" }, h.p);
    expect(h.calls).toEqual(["file b2 tp-1", `stop ${ID}`, "delete b1"]);
    expect(moved).toMatchObject({ phase: "moved", moved: { topic: "AI for science", pins: 2, marks: 3 } });
    const fresh = endPorts();
    await endStudy(MOVE, { newName: "Mechanisms" }, fresh.p);
    expect(fresh.calls.slice(0, 2)).toEqual(["make Mechanisms", "file b2 tp-new"]);
    const filed = endPorts({ makeTopic: async (name) => ({ id: "tp-filed", name }) });
    expect((await endStudy(MOVE, { newName: "X" }, filed.p))?.moved?.topic).toBe("Already there");
  });

  test("a book that could not be filed stops nothing", async () => {
    const h = endPorts({
      fileBook: async () => {
        throw new Error("disk");
      },
    });
    expect(await endStudy(MOVE, { topicId: "tp-1" }, h.p)).toBeNull();
    expect(await endStudy(MOVE, { topicId: "tp-gone" }, h.p)).toBeNull();
    expect(h.calls).toEqual([]);
  });

  test("what is kept, the card's arg and the suggestion", () => {
    const at = (n: number) => n;
    const lbl = (item: string, label: TopicLabel["label"], t: number) => ({ item, label, at: at(t) }) as TopicLabel;
    const line = (kind: StudyLine["kind"], state: StudyLine["state"]) => ({ kind, state }) as StudyLine;
    expect(
      keptCounts(
        [lbl("a", "yes", 1), lbl("a", "pinned", 2), lbl("b", "pinned", 1), lbl("b", "borderline", 2)],
        [line("avoid", "confirmed"), line("judgment", "confirmed"), line("pin", "confirmed"), line("avoid", "dropped")],
      ),
    ).toEqual({ pins: 1, marks: 2 });
    expect(parseMoveTarget('{"topicId":"tp-1"}')).toEqual({ topicId: "tp-1" });
    expect(parseMoveTarget('{"newName":"  New  "}')).toEqual({ newName: "New" });
    expect(parseMoveTarget("{}")).toBeNull();
    expect(parseMoveTarget("nope")).toBeNull();
    expect(suggestedTopic("ai FOR science", MOVE.topics)).toBe("tp-1");
    expect(suggestedTopic("Biology", MOVE.topics)).toBeNull();
  });
});

describe("the door tools", () => {
  test("propose_study_lines draws the card and records nothing; a closed study or a bad line draws none", async () => {
    const raised: StudyLinesCardData[] = [];
    const deps = {
      threadId: "th",
      readerLines: () => READER,
      searches: async () => [STUDY, { ...STUDY, id: "ts-daily", name: "Daily", once: undefined }, { ...STUDY, id: "ts-old", name: "Old study", status: "stopped" as const }],
      known: () => [STUDY],
      brief: async (): Promise<StudyBrief> => BRIEF,
      now: () => 7,
      raiseCard: (c: StudyLinesCardData) => void raised.push(c),
    };
    const tool = buildProposeStudyLinesTool(deps);
    const done = await tool.execute({ study: STUDY.name, lines: [{ kind: "pin", text: "LLM-IDEA", said: READER[1].text, item: "E5" }] });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ searchId: ID, phase: "open", lines: [{ kind: "pin", item: "arxiv:2601.00005" }] });
    expect(textOf(done)).toContain("Nothing is recorded yet");
    expect(receiptOf(done)).toBeNull();

    expect(textOf(await tool.execute({ study: "Daily", lines: [] }))).toContain("not a study");
    expect(textOf(await tool.execute({ study: "Old study", lines: [] }))).toContain("has ended");
    const bad = await tool.execute({ study: ID, lines: [{ kind: "rewrite", text: "x", said: "y", item: "Nope" }] });
    expect(textOf(bad)).toContain("E4 — The AI Scientist (main)");
    expect(raised).toHaveLength(1);
  });

  test("update_study_brief does the button's send and says what happened", async () => {
    const latest = { cardId: "c1", card: card() };
    const sent: string[] = [];
    const tool = buildUpdateStudyBriefTool({
      latestCard: () => latest,
      send: async (cardId, queries) => {
        sent.push(`${cardId}:${queries.length}`);
        return { ok: true, card: { ...latest.card, phase: "asked" }, ask: { status: "asked", runId: "r", n: 1 } };
      },
    });
    const done = await tool.execute({ queries: [{ subtopic: "", x: "", arxiv: "closed loop", ranking: "" }] });
    expect(sent).toEqual(["c1:1"]);
    expect(textOf(done)).toContain("Recorded 3 lines");
    expect(textOf(done)).toContain("the reader dropped 1");
    expect(receiptOf(done)?.summary).toBe(STUDY.name);
    expect(textOf(await buildUpdateStudyBriefTool({ latestCard: () => null, send: async () => ({ ok: false, why: "asked" }) }).execute({}))).toContain("no confirm card");
    expect(sentText(card(), { ok: false, why: "undecided", undecided: [1] })).toContain('line 2 ("LLM-IDEA") on the card is not decided');
    expect(sentText(card(), { ok: true, card: card({ phase: "recorded" }), ask: { status: "busy" } })).toContain("still being made");
  });

  test("end_study draws the move card with the suggestion; with no brief it draws none", async () => {
    const raised: StudyMoveCardData[] = [];
    const deps = {
      threadId: "th",
      searches: async () => [STUDY],
      known: () => [STUDY],
      studyBook: async () => ({ version: 2, bookId: "b2" }),
      topics: async () => [{ id: "tp-1", name: "AI for science" }],
      now: () => 9,
      raiseCard: (c: StudyMoveCardData) => void raised.push(c),
    };
    const done = await buildEndStudyTool(deps).execute({ study: STUDY.id, topic: "AI for science" });
    expect(raised[0]).toMatchObject({ version: 2, bookId: "b2", suggested: "tp-1", phase: "open" });
    expect(textOf(done)).toContain("Nothing is moved or ended until the reader presses");
    const none = await buildEndStudyTool({ ...deps, studyBook: async () => null }).execute({ study: STUDY.id });
    expect(textOf(none)).toContain("nothing to move");
    expect(raised).toHaveLength(1);
  });
});
