// A study's label question (docs/info/91 「攒着问」): which item it asks about,
// how it rides out with a result, where its item stands in the book, and how
// the card's answers become labels. Run: scripts/t.sh tests/info/topic-search/label-question

import { expect, test } from "bun:test";
import { createFakeAppData } from "../../support/guarded-appdata";
import {
  LABEL_BOUNDARY,
  labelQuestion,
  pickQuestions,
  waiting,
  withLabelQuestion,
  type PendingQuestion,
} from "../../../src/info/topic-search/questions";
import { loadTopicLabels } from "../../../src/info/topic-search/labels";
import type { TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import { NOTE_BELOW, type IssuePlan, type PlannedItem } from "../../../src/info/issue/plan";
import { placedQuestion, type OpeningQuestion } from "../../../src/info/issue/opening-record";
import {
  cardAwaitingWords,
  cardLabelled,
  cardWithWords,
  issueAnswerNote,
  labelReceipt,
  questionCard,
  recordLabelAnswer,
  topicLabelOf,
  type IssueQuestionCard,
} from "../../../src/info/issue/question-card";

const item = (key: string, score: number, summary: string | null = `${key} in one line`) => ({ key, title: `Title of ${key}`, summary, score });
const CONTEXT = { version: 1, criteria: 4 };

test("the item asked about: unlabelled, not asked before, in the band, nearest the line between entry and Note", () => {
  expect(LABEL_BOUNDARY).toBe(NOTE_BELOW);
  const items = [item("arxiv:1", 80), item("arxiv:2", 58), item("arxiv:3", 44), item("arxiv:4", 46), item("arxiv:5", 39)];
  const q = labelQuestion(items, new Set(), [], CONTEXT)!;
  // 44 and 46 are as near; the earlier in the file wins.
  expect(q.about).toEqual(["arxiv:3"]);
  expect(q.template).toEqual({
    code: "label-item",
    params: { item: "arxiv:3", title: "Title of arxiv:3", line: "arxiv:3 in one line", score: 44, version: 1, criteria: 4 },
  });
  expect(labelQuestion(items, new Set(["arxiv:3"]), [], CONTEXT)!.about).toEqual(["arxiv:4"]);
  const asked: PendingQuestion = { ...q, id: "q-1", raisedAt: 1, askedIn: "r-1", askedAt: 1 };
  expect(labelQuestion(items, new Set(["arxiv:4"]), [asked], CONTEXT)!.about).toEqual(["arxiv:2"]);
  // Nothing in the band: no question.
  expect(labelQuestion([item("arxiv:1", 80), item("arxiv:5", 39)], new Set(), [], CONTEXT)).toBeNull();
});

test("it goes out last among the result's questions, is in the queue as asked, and never waits there", () => {
  const model: PendingQuestion = { id: "q-m", text: "Runtime tools too?", source: "model", template: null, about: [], raisedAt: 1, askedIn: null, askedAt: null };
  const label = labelQuestion([item("arxiv:3", 50)], new Set(), [], CONTEXT)!;
  const picked = withLabelQuestion(pickQuestions([model], new Set(), 2, "r-1", 5), label, "r-1", 5);
  expect(picked.asked.map((q) => q.template?.code ?? q.text)).toEqual(["Runtime tools too?", "label-item"]);
  expect(picked.queue.find((q) => q.template?.code === "label-item")?.askedIn).toBe("r-1");
  // Returned by an issue with no room for it: it does not wait, and asking it again replaces it.
  const returned = picked.queue.map((q) => ({ ...q, askedIn: null, askedAt: null }));
  expect(waiting(returned).map((q) => q.id)).toEqual(["q-m"]);
  const again = labelQuestion([item("arxiv:3", 50)], new Set(), returned, CONTEXT)!;
  expect(withLabelQuestion({ asked: [], queue: returned }, again, "r-2", 9).queue.filter((q) => q.template?.code === "label-item")).toHaveLength(1);
  expect(withLabelQuestion(picked, null, "r-1", 5)).toBe(picked);
});

function planned(key: string, score: number): PlannedItem {
  return { searchId: "ts-1", topic: "Agents", subtopic: null, resultId: "r-1", item: { id: `E${score}`, key, score } as TopicSearchResultItem };
}

function opening(params: Record<string, string | number>): OpeningQuestion {
  return { id: "q-l", searchId: "ts-1", topic: "Agents", resultId: "r-1", text: "Is it?", template: { code: "label-item", params }, quick: [] };
}

test("the issue tells a label question where its item stands: entry or Note, and its number", () => {
  const plan = { entries: [planned("arxiv:1", 80), planned("arxiv:2", 50)], notes: [planned("arxiv:3", 44)] } as IssuePlan;
  expect(placedQuestion(plan, opening({ item: "arxiv:2" })).template!.params).toMatchObject({ place: "main", rank: 2 });
  expect(placedQuestion(plan, opening({ item: "arxiv:3" })).template!.params).toMatchObject({ place: "note", rank: 3 });
  expect(placedQuestion(plan, opening({ item: "arxiv:9" })).template!.params).toMatchObject({ place: "absent", rank: 0 });
  const other: OpeningQuestion = { ...opening({}), template: null };
  expect(placedQuestion(plan, other)).toBe(other);
});

const CARD_Q = opening({ item: "arxiv:3", title: "AutoSINDy", line: "Finds equations and designs the next run.", score: 44, version: 1, criteria: 4, place: "note", rank: 3 });

test("the card shows the item and three answers; a press is said, written, and receipted", async () => {
  const card = questionCard("book-1", CARD_Q);
  expect(card.quick).toEqual(["On the mark", "Off the mark", "Hard to say"]);
  expect(card.label).toEqual({
    item: "arxiv:3",
    title: "AutoSINDy",
    line: "Finds equations and designs the next run.",
    brief: { version: 1, place: "note", rank: 3, score: 44 },
    criteria: 4,
  });
  const yes = cardLabelled(card, "yes", 100)!;
  expect(yes).toMatchObject({ phase: "answered", answer: "On the mark", answerTs: 100 });
  expect(labelReceipt(yes)).toBe("Recorded in this topic's labels: On the mark.");

  const l = topicLabelOf(card, "yes", "On the mark", { ts: 100, threadId: "th-1" }, 123, "tl-0000000a")!;
  expect(l).toEqual({
    id: "tl-0000000a",
    searchId: "ts-1",
    item: "arxiv:3",
    title: "AutoSINDy",
    label: "yes",
    reason: "On the mark",
    source: "question",
    evidence: "th-1:100",
    at: 123,
    brief: { version: 1, place: "note", rank: 3, score: 44 },
    criteria: 4,
  });
  const io = createFakeAppData();
  await recordLabelAnswer(card, "borderline", "Hard to say", { ts: 100, threadId: "th-1" }, 123, io);
  const stored = await loadTopicLabels("ts-1", io);
  expect(stored.map((s) => [s.label, s.source, s.reason])).toEqual([["borderline", "question", "Hard to say"]]);
  // A card that is not a label question writes nothing.
  const plain = questionCard("book-1", { ...CARD_Q, template: null, text: "Runtime tools too?" });
  expect(plain.label).toBeUndefined();
  expect(cardLabelled(plain, "yes", 1)).toBeNull();
  expect(topicLabelOf(plain, "yes", "x", { ts: 1, threadId: "t" }, 1)).toBeNull();
});

test("off the mark waits for a reason, kept word for word; own words wait to be filed", () => {
  const card = questionCard("book-1", CARD_Q);
  const no = cardLabelled(card, "no", 100)!;
  expect(no.phase).toBe("reason");
  const rows = (c: IssueQuestionCard) => [{ cardId: "c-1", card: c }];
  expect(cardAwaitingWords(rows(no))).toBe("c-1");
  const reasoned = cardWithWords(no, "It only fits equations to old data.", 200)!;
  expect(reasoned).toMatchObject({ phase: "answered", answer: "It only fits equations to old data.", answerTs: 200 });
  expect(issueAnswerNote([reasoned], 200)).toContain("reader's reason for calling \"AutoSINDy\" in the topic search \"Agents\" (id: ts-1) off the mark");
  expect(issueAnswerNote([reasoned], 200)).not.toContain("update_topic_search");

  const own = cardWithWords({ ...card, phase: "own" }, "Close, but it never plans the next experiment", 300)!;
  expect(own.phase).toBe("file");
  expect(own.label).toMatchObject({ said: "Close, but it never plans the next experiment", saidTs: 300 });
  expect(cardAwaitingWords(rows(own))).toBeNull();
  expect(issueAnswerNote([own], 300)).toContain("in the reader's own words");
  const filed = cardLabelled(own, "borderline", 999)!;
  expect(filed).toMatchObject({ phase: "answered", answer: "Close, but it never plans the next experiment" });
  expect(filed.label?.recorded).toBe("borderline");
  // An answered card takes no more labels or words.
  expect(cardLabelled(filed, "yes", 1)).toBeNull();
  expect(cardWithWords(filed, "more", 1)).toBeNull();
});

test("a question that is not a label question is answered as before", () => {
  const plain = questionCard("book-1", { ...CARD_Q, template: null, text: "Runtime tools too?", quick: ["Yes"] });
  expect(cardWithWords({ ...plain, phase: "own" }, "words", 1)).toBeNull();
  const answered: IssueQuestionCard = { ...plain, phase: "answered", answer: "Yes", answerTs: 5 };
  expect(issueAnswerNote([answered], 5)).toContain("update_topic_search");
});
