// Lumen's opening for a brief (docs/info/88 「简报的对话」「攒着问」): written at
// assembly, said once when the issue is opened, the questions as cards.

import { describe, expect, test } from "bun:test";
import { buildSectionedEpub } from "../../../src/workshop/bindery/build-article";
import { assembleIssue, type IssueDeps } from "../../../src/info/issue/assemble";
import { openingPrompt, openingRecord, pickIssueQuestions, returnUnasked, type OpeningQuestion } from "../../../src/info/issue/opening-record";
import { openingText, parseSpoken, speakOpening, SPOKEN_FILE, type OpeningDeps } from "../../../src/info/issue/opening";
import { cardAwaitingWords, issueAnswerNote, questionCard, questionWords, type IssueQuestionCard } from "../../../src/info/issue/question-card";
import { planIssue } from "../../../src/info/issue/plan";
import { INFO_SHELF_FILE, parseShelf } from "../../../src/info/issue/types";
import { QUESTIONS_FILE, parseQuestionsFile, type PendingQuestion } from "../../../src/info/topic-search/questions";
import type { ResultQuestion, TopicSearchResult, TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import { headingPage } from "../../../src/reading/issue";
import type { ThreadMessage } from "../../../src/platform/app/threads";

function item(id: string, score: number): TopicSearchResultItem {
  return {
    id,
    key: `url:https://example.org/${id}-${score}`,
    keys: [],
    kind: "repo",
    subtopic: null,
    title: `A tool for ${id} at ${score}`,
    titleFrom: "original",
    summary: `Conclusion of ${id}.`,
    body: [`What happened with ${id}.`],
    unknown: null,
    facts: { kind: "repo", fullName: `acme/${id}`, lookedUp: true, stars: 1, forks: 0, lastCommitAt: "2026-10-13", release: null, license: "MIT" },
    links: { original: `https://github.com/acme/${id}`, posts: [] },
    materials: [],
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score,
  } as TopicSearchResultItem;
}

const q = (id: string, text: string, template: ResultQuestion["template"] = null): ResultQuestion => ({ id, text, source: template ? "metric" : "model", template });

function result(searchId: string, name: string, items: TopicSearchResultItem[], questions: ResultQuestion[]): TopicSearchResult {
  return {
    version: 1,
    id: `topic-search-${searchId}-2026-10-15`,
    searchId,
    name,
    kind: "daily",
    date: "2026-10-15",
    createdAt: 0,
    window: { since: 0, until: 0 },
    empty: items.length === 0,
    writeup: "model",
    overview: null,
    groups: [],
    quiet: [],
    items,
    materials: [],
    questions,
    stats: {} as TopicSearchResult["stats"],
    runDir: "topic-search-runs/r",
  } as TopicSearchResult;
}

const TOPICS = [
  { searchId: "ts-0000aaaa", name: "AI for science", subtopics: [] },
  { searchId: "ts-0000bbbb", name: "AI for engineering", subtopics: [] },
];

function night(): TopicSearchResult[] {
  return [
    result("ts-0000aaaa", "AI for science", [item("E1", 90), item("E2", 70)], [q("q-a1", "Funding news: want it?"), q("q-a2", "Preprints only?"), q("q-a3", "Protein design too?")]),
    result("ts-0000bbbb", "AI for engineering", [item("E1", 80)], [q("q-b1", "Nothing under EDA for 7 days.", { code: "subtopic-quiet", params: { subtopic: "EDA", days: 7 } })]),
  ];
}

test("an issue asks at most three questions, a topic at a time; the rest wait again", () => {
  const { asked, left } = pickIssueQuestions(night(), (_id, name) => name);
  expect(asked.map((a) => a.id)).toEqual(["q-a1", "q-b1", "q-a2"]);
  expect(left).toEqual([{ searchId: "ts-0000aaaa", id: "q-a3" }]);
  const pending = (id: string): PendingQuestion => ({ id, text: id, source: "model", template: null, about: [], raisedAt: 0, askedIn: "r", askedAt: 1 });
  const back = returnUnasked({ version: 1, topics: { "ts-0000aaaa": { questions: [pending("q-a2"), pending("q-a3")] } } }, left);
  expect(back.topics["ts-0000aaaa"].questions.map((p) => `${p.id} ${p.askedIn}`)).toEqual(["q-a2 r", "q-a3 null"]);
  // One result that already carries a single question (its topic past its third issue) keeps it.
  expect(pickIssueQuestions([night()[1]], (_id, name) => name).asked.map((a) => a.id)).toEqual(["q-b1"]);
});

test("the prompt carries the language it is given, and no fallback of its own", () => {
  const plan = planIssue(night(), TOPICS)!;
  expect(openingPrompt(plan, [], "Respond in Deutsch.").system).toContain("Respond in Deutsch.");
  expect(openingPrompt(plan, [], "Respond in Deutsch.").system).not.toContain("the language the items");
});

test("the record: the model's numbers past the items dropped, quick answers kept for its own questions only", () => {
  const plan = planIssue(night(), TOPICS)!;
  const { asked } = pickIssueQuestions(night(), (_id, name) => name);
  const reply = JSON.stringify({
    opening: "Start with [1]; [9] is noise. [3] is worth a look.",
    quick: { Q1: ["Yes, keep funding", "  No funding  ", "x".repeat(80), "fourth", "fifth"], Q2: ["ignored"] },
  });
  const record = openingRecord(plan, asked, `Sure:\n${reply}`);
  expect(record.text).toBe("Start with [1]; is noise. [3] is worth a look.");
  expect(record.items.map((i) => i.n)).toEqual([1, 2, 3]);
  expect(record.questions[0].quick).toEqual(["Yes, keep funding", "No funding", "fourth"]);
  expect(record.questions[1].quick).toEqual([]);
  expect(openingRecord(plan, asked, "not json").text).toBeNull();
  expect(openingRecord(plan, asked, null).questions.length).toBe(3);
});

function world(model: IssueDeps["writeOpening"]) {
  const files = new Map<string, string>();
  const deps: IssueDeps = {
    files: { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) },
    topics: async () => TOPICS,
    activeSearchIds: async () => TOPICS.map((t) => t.searchId),
    buildEpub: buildSectionedEpub,
    importBook: async () => ({ hash: "h0123456789" }),
    attachOriginal: async () => false,
    putBox: async () => {},
    newBoxItemId: () => "box-1",
    ...(model ? { writeOpening: model } : {}),
    locale: async () => "en" as const,
    nightEndAt: () => Number.MAX_SAFE_INTEGER,
    now: () => 5,
    today: () => "2026-10-15",
  };
  for (const r of night()) files.set(`${r.id}.json`, JSON.stringify(r));
  return { files, deps };
}

describe("assembling an issue writes its opening onto the shelf row", () => {
  test("with the model's words, and the questions that did not fit back in their queue", async () => {
    let prompt = "";
    const w = world(async (p) => {
      prompt = p.user;
      return JSON.stringify({ opening: "Read [1] first.", quick: { Q1: ["Yes", "No"] } });
    });
    const queued = (id: string): PendingQuestion => ({ id, text: id, source: "model", template: null, about: [], raisedAt: 0, askedIn: "x", askedAt: 1 });
    w.files.set(QUESTIONS_FILE, JSON.stringify({ version: 1, topics: { "ts-0000aaaa": { questions: [queued("q-a3")] } } }));
    const out = await assembleIssue(w.deps, "night:2026-10-15", "2026-10-15", night().map((r) => `${r.id}.json`));
    expect(prompt).toContain("[1] AI for science: A tool for E1 at 90");
    expect(prompt).toContain("Q2 (AI for engineering): Nothing under EDA for 7 days. [fixed replies; give none]");
    const row = parseShelf(w.files.get(INFO_SHELF_FILE) ?? null).issues[0];
    expect(row.opening?.text).toBe("Read [1] first.");
    expect(row.opening?.questions.map((x) => `${x.id} ${x.quick.join("/")}`)).toEqual(["q-a1 Yes/No", "q-b1 ", "q-a2 "]);
    expect(out.issue?.opening).toEqual(row.opening);
    expect(parseQuestionsFile(w.files.get(QUESTIONS_FILE) ?? null).topics["ts-0000aaaa"].questions[0].askedIn).toBeNull();
  });

  test("the book and the opening are in one language: the locale the deps give", async () => {
    let system = "";
    const w = world(async (p) => {
      system = p.system;
      return "{}";
    });
    const names: string[] = [];
    w.deps.locale = async () => "zh-CN";
    w.deps.importBook = async (_bytes, _file, meta) => {
      names.push(meta.filename);
      return { hash: "h0123456789" };
    };
    const boxed: string[] = [];
    w.deps.putBox = async (item) => void boxed.push(item.cover);
    await assembleIssue(w.deps, "night:2026-10-15", "2026-10-15", night().map((r) => `${r.id}.json`));
    expect(system).toContain("简体中文");
    expect(names).toEqual(["每日简报第 1 期 · 10月15日"]);
    expect(boxed).toEqual(["10月15日简报 · 3 条"]);
  });

  test("a model that fails leaves the program's line and the questions", async () => {
    const w = world(async () => {
      throw new Error("no provider");
    });
    const out = await assembleIssue(w.deps, "night:2026-10-15", "2026-10-15", night().map((r) => `${r.id}.json`));
    expect(out.issue?.opening?.text).toBeNull();
    expect(out.issue?.opening?.questions.length).toBe(3);
    expect(openingText(out.issue!, out.issue!.opening)).toBe("Oct 15 brief: 3 items.");
  });
});

describe("opening an issue: said once, into the day's conversation", () => {
  const opening = {
    text: "Start with [1], then [2].",
    items: [
      { n: 1, heading: "A tool for E1 at 90" },
      { n: 2, heading: 'The "quoted" one' },
    ],
    questions: [
      { id: "q-a1", searchId: "ts-0000aaaa", topic: "AI for science", resultId: "r", text: "Funding news: want it?", template: null, quick: ["Yes", "No"] },
      { id: "q-b1", searchId: "ts-0000bbbb", topic: "AI for engineering", resultId: "r", text: "x", template: { code: "subtopic-quiet", params: { subtopic: "EDA", days: 7 } }, quick: [] },
    ] as OpeningQuestion[],
  };
  const shelf = JSON.stringify({
    version: 1,
    issues: [{ key: "night:2026-10-15", number: 1, date: "2026-10-15", topics: [], results: [], items: 4, bookId: "hbook0001", boxItemId: "b", createdAt: 0, opening }],
    volumes: [],
  });
  const files = new Map<string, string>([[INFO_SHELF_FILE, shelf]]);
  const appended: { date: string; threadId: string; message: ThreadMessage }[] = [];
  const deps: OpeningDeps = {
    readShelf: async () => files.get(INFO_SHELF_FILE) ?? null,
    readSpoken: async () => files.get(SPOKEN_FILE) ?? null,
    writeSpoken: async (text) => void files.set(SPOKEN_FILE, text),
    append: (date, threadId, message) => void appended.push({ date, threadId, message }),
    now: () => 1000,
  };

  test("the first opening adds Lumen's words, items cited by page, and a card per question", async () => {
    const pages = (h: string) => (h.startsWith("A tool") ? 3 : null);
    expect(await speakOpening(deps, { bookId: "hbook0001", date: "2026-10-16", threadId: "t1", pageOf: pages })).toBe(true);
    expect(appended.map((a) => `${a.date} ${a.threadId} ${a.message.ts}`)).toEqual(["2026-10-16 t1 1000", "2026-10-16 t1 1001", "2026-10-16 t1 1002"]);
    expect(appended[0].message).toMatchObject({ role: "ai", text: 'Oct 15 brief: 4 items. Start with [p.3 "A tool for E1 at 90"], then “The "quoted" one”.' });
    const cards = appended.slice(1).map((a) => (a.message.parts?.[0] as unknown as { card: IssueQuestionCard }).card);
    expect(cards.map((c) => `${c.kind} ${c.phase} ${c.quick.join("/")}`)).toEqual(["issue-question open Yes/No", "issue-question open Keep it/Drop it"]);
    expect(cards[1].text).toContain("“EDA” for 7 days");
    expect(parseSpoken(files.get(SPOKEN_FILE) ?? null).issues.hbook0001).toEqual({ at: 1000, date: "2026-10-16", threadId: "t1" });
  });

  test("opening it again, here or on a device the record synced to, says nothing", async () => {
    expect(await speakOpening(deps, { bookId: "hbook0001", date: "2026-10-16", threadId: "t1" })).toBe(false);
    expect(await speakOpening(deps, { bookId: "hbook0001", date: "2026-10-17", threadId: "t2" })).toBe(false);
    expect(appended.length).toBe(3);
  });

  test("a book that is no issue on the shelf says nothing and records nothing", async () => {
    expect(await speakOpening(deps, { bookId: "other", date: "2026-10-16", threadId: "t1" })).toBe(false);
    expect(parseSpoken(files.get(SPOKEN_FILE) ?? null).issues.other).toBeUndefined();
  });
});

test("an answer goes to the model with the question and the topic; own words wait for the next line", () => {
  const card = questionCard("hbook0001", { id: "q-a1", searchId: "ts-0000aaaa", topic: "AI for science", resultId: "r", text: "Funding news: want it?", template: null, quick: [] });
  expect(card.quick).toEqual(["Yes, more like this", "No, leave these out"]);
  expect(issueAnswerNote([card], 7)).toBe("");
  const note = issueAnswerNote([{ ...card, phase: "answered", answer: "No", answerTs: 7 }], 7);
  expect(note).toContain('topic search "AI for science" (id: ts-0000aaaa): "Funding news: want it?"');
  expect(note).toContain("update_topic_search");
  expect(note).toContain("statement_write");
  expect(cardAwaitingWords([{ cardId: "a", card }, { cardId: "b", card: { ...card, phase: "own" } }])).toBe("b");
  expect(cardAwaitingWords([{ cardId: "a", card }])).toBeNull();
  expect(questionWords({ text: "", template: { code: "avoid-blocks", params: { avoid: "funding", runs: 3, least: 12 } }, quick: [] }).quick).toEqual([
    "Keep leaving it out",
    "Let those through",
  ]);
});

test("an item's page in the open brief: the page that opens with its heading, else the first past the contents", () => {
  const text = {
    pages: ["Contents AI for science: A tool for E1 at 90; Notes: Small thing", "A tool for E1 at 90 What happened.", "Notes AI: Small thing. More."],
  };
  expect(headingPage(text, "A tool for E1 at 90")).toBe(2);
  expect(headingPage(text, "Small thing")).toBe(3);
  expect(headingPage(text, "Absent heading here")).toBeNull();
  expect(headingPage(null, "x")).toBeNull();
});
