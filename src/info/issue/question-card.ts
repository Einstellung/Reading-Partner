// A question the companion asks when a brief is opened (docs/info/88 「攒着问」「记忆回写」),
// drawn as a card in the door conversation: the question, two or three quick
// answers, and "in my own words". A quick answer is said as the reader's line;
// "in my own words" leaves the card waiting for the next line typed. Either
// way the line goes to the model with a note naming the question and the
// topic it came from, so the turn writes the answer back where it belongs and
// its receipt says where.
//
// A study's label question (docs/info/91 「攒着问」) is answered by the program,
// not the model: the card shows the item's title and its one line, and the
// quick answers on the mark / off it / hard to say are said as the reader's
// line and written into the topic's labels (topic-search/labels.ts) with
// the brief's version and the item's place then; no turn runs. Off the mark
// then waits for an optional reason, the next line typed, kept word for word
// as a second label that outranks the first. "In my own words" holds the line
// typed and asks which of the three to file it as. A typed line still goes to
// the model, with a note that the app has filed it.
//
// Payload and pure helpers here; the door chat does the saying
// (ui/components/companion/use-door-chat.ts), the card component the drawing
// (ui/components/companion/IssueQuestionCard.tsx).

import { t } from "../../i18n";
import { messageAnchor } from "../../memory";
import { addTopicLabels, newTopicLabelId, type TopicLabel, type TopicLabelKind, type TopicLabelsIo } from "../topic-search/labels";
import type { StudyPlace } from "../topic-search/result-types";
import type { OpeningQuestion } from "./opening-record";

/** A quick answer pressed; the arg is the answer. */
export const ISSUE_ANSWER_OP = "issue-answer";
/** "In my own words" pressed: the next line typed answers the question. */
export const ISSUE_OWN_OP = "issue-own";
/** A label question's answer pressed; the arg is the label ("yes", "no", "borderline"). */
export const ISSUE_LABEL_OP = "issue-label";
/** No reason given for an item off the mark. */
export const ISSUE_SKIP_OP = "issue-skip";

/** The labels a label question offers, in the card's order. */
export const LABEL_ANSWERS = ["yes", "no", "borderline"] as const;
export type LabelAnswer = (typeof LABEL_ANSWERS)[number];

/** What a label question is about, and where the item stood when it was asked. */
export interface LabelAsk {
  /** The item's key ("arxiv:…"). */
  item: string;
  title: string;
  /** The item's one-sentence conclusion; "" when it has none. */
  line: string;
  brief: { version: number; place: StudyPlace | "absent"; rank: number | null; score: number | null };
  /** The search's revision when the question was made. */
  criteria: number;
  /** "In my own words": the line typed, waiting to be filed. */
  said?: string;
  saidTs?: number;
  /** The label written. */
  recorded?: LabelAnswer;
}

export interface IssueQuestionCard {
  kind: "issue-question";
  bookId: string;
  questionId: string;
  searchId: string;
  topic: string;
  text: string;
  quick: string[];
  /** "reason": filed off the mark, the next line typed is why; "file": own words typed, which label is not yet said. */
  phase: "open" | "own" | "reason" | "file" | "answered";
  answer?: string;
  /** The reader's line that answered it (for a label question, the last line it took). */
  answerTs?: number;
  /** A study's label question. Absent on every other. */
  label?: LabelAsk;
}

/** The question as the reader is asked it: a metric question in their language, the model's as written. */
export function questionWords(q: Pick<OpeningQuestion, "text" | "template" | "quick">): { text: string; quick: string[] } {
  const tpl = q.template;
  if (tpl?.code === "subtopic-quiet") {
    return {
      text: t("info.issue.q.subtopicQuiet", { subtopic: String(tpl.params.subtopic ?? ""), days: String(tpl.params.days ?? "") }),
      quick: [t("info.issue.quick.keep"), t("info.issue.quick.drop")],
    };
  }
  if (tpl?.code === "anchor-miss") {
    return {
      text: t("info.issue.q.anchorMiss", { anchors: String(tpl.params.anchors ?? "") }),
      quick: [t("info.issue.quick.wordsRight"), t("info.issue.quick.wordsWrong")],
    };
  }
  if (tpl?.code === "avoid-blocks") {
    return {
      text: t("info.issue.q.avoidBlocks", {
        avoid: String(tpl.params.avoid ?? ""),
        least: String(tpl.params.least ?? ""),
        runs: String(tpl.params.runs ?? ""),
      }),
      quick: [t("info.issue.quick.keepOut"), t("info.issue.quick.letIn")],
    };
  }
  if (tpl?.code === "label-item") {
    return { text: t("info.issue.q.labelItem"), quick: LABEL_ANSWERS.map(labelWords) };
  }
  return { text: q.text, quick: q.quick.length > 0 ? q.quick : [t("info.issue.quick.yes"), t("info.issue.quick.no")] };
}

/** A label as the reader says it. */
export function labelWords(label: LabelAnswer): string {
  return t(`info.issue.label.${label}`);
}

const PLACES: readonly string[] = ["pinned", "main", "note", "absent"];

function labelAsk(q: Pick<OpeningQuestion, "template">): LabelAsk | undefined {
  const tpl = q.template;
  if (tpl?.code !== "label-item") return undefined;
  const p = tpl.params;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const place = typeof p.place === "string" && PLACES.includes(p.place) ? (p.place as LabelAsk["brief"]["place"]) : "absent";
  return {
    item: String(p.item ?? ""),
    title: String(p.title ?? ""),
    line: String(p.line ?? ""),
    brief: { version: num(p.version) ?? 1, place, rank: num(p.rank) || null, score: num(p.score) },
    criteria: num(p.criteria) ?? 0,
  };
}

export function questionCard(bookId: string, q: OpeningQuestion): IssueQuestionCard {
  const words = questionWords(q);
  const label = labelAsk(q);
  return {
    kind: "issue-question",
    bookId,
    questionId: q.id,
    searchId: q.searchId,
    topic: q.topic,
    text: words.text,
    quick: words.quick,
    phase: "open",
    ...(label ? { label } : {}),
  };
}

/** The card a typed line answers: the one waiting for the reader's own words or a reason, latest first. */
export function cardAwaitingWords(cards: readonly { cardId: string; card: IssueQuestionCard }[]): string | null {
  for (let i = cards.length - 1; i >= 0; i--) if (cards[i].card.phase === "own" || cards[i].card.phase === "reason") return cards[i].cardId;
  return null;
}

/**
 * A label question's card after a label is pressed: on an open card the
 * pressed words are the reader's line at `ts`; on one holding own words those
 * words are. Off the mark from an open card waits for a reason. Null when the
 * card takes no label now.
 */
export function cardLabelled(card: IssueQuestionCard, label: LabelAnswer, ts: number): IssueQuestionCard | null {
  if (!card.label) return null;
  if (card.phase === "open") {
    return {
      ...card,
      phase: label === "no" ? "reason" : "answered",
      answer: labelWords(label),
      answerTs: ts,
      label: { ...card.label, recorded: label },
    };
  }
  if (card.phase === "file" && card.label.said !== undefined) {
    return { ...card, phase: "answered", answer: card.label.said, label: { ...card.label, recorded: label } };
  }
  return null;
}

/**
 * A label question's card after a line typed at `ts`: a reason for off the
 * mark answers it; own words wait to be filed. Null for any other card.
 */
export function cardWithWords(card: IssueQuestionCard, words: string, ts: number): IssueQuestionCard | null {
  if (!card.label) return null;
  if (card.phase === "reason") return { ...card, phase: "answered", answer: words, answerTs: ts };
  if (card.phase === "own") return { ...card, phase: "file", answerTs: ts, label: { ...card.label, said: words, saidTs: ts } };
  return null;
}

/** The label a card's answer writes: the reader's words verbatim, anchored on the line they said them in. */
export function topicLabelOf(
  card: IssueQuestionCard,
  label: LabelAnswer,
  reason: string,
  line: { ts: number; threadId: string },
  at: number,
  id: string = newTopicLabelId(),
): TopicLabel | null {
  if (!card.label) return null;
  return {
    id,
    searchId: card.searchId,
    item: card.label.item,
    title: card.label.title,
    label: label satisfies TopicLabelKind,
    reason,
    source: "question",
    evidence: messageAnchor({ ts: line.ts }, line.threadId),
    at,
    brief: card.label.brief,
    criteria: card.label.criteria,
  };
}

/** Write a card's answer into its topic's labels. */
export async function recordLabelAnswer(
  card: IssueQuestionCard,
  label: LabelAnswer,
  reason: string,
  line: { ts: number; threadId: string },
  at: number,
  io?: TopicLabelsIo,
): Promise<void> {
  const l = topicLabelOf(card, label, reason, line, at);
  if (l) await addTopicLabels(card.searchId, [l], io);
}

/** The receipt a label question shows once a label is written: where it went. */
export function labelReceipt(card: IssueQuestionCard): string | null {
  return card.label?.recorded ? t("info.issue.labelRecorded", { label: labelWords(card.label.recorded) }) : null;
}

/**
 * The app note on a line that answers a question, for the model only (as the
 * door's other notes, issue-context.ts). Empty when the line answers none.
 */
export function issueAnswerNote(cards: readonly IssueQuestionCard[], lineTs: number): string {
  const labelled = cards.find((c) => c.label && c.answerTs === lineTs);
  if (labelled) return labelAnswerNote(labelled);
  const card = cards.find((c) => c.phase === "answered" && c.answerTs === lineTs);
  if (!card) return "";
  return (
    `\n\n[App note, not the reader's words. This line answers the question you asked when the brief opened, ` +
    `about the topic search "${card.topic}" (id: ${card.searchId}): "${card.text}". Write the answer back now: ` +
    `what holds only for this topic goes to update_topic_search, with the question and the reader's answer ` +
    `word for word in answers; what holds for the reader whatever the topic goes to statement_write as a ` +
    `profile; a line with both goes to both. Then say in one short sentence where it went.]`
  );
}

function labelAnswerNote(card: IssueQuestionCard): string {
  const about = `"${card.label!.title}" in the topic search "${card.topic}" (id: ${card.searchId})`;
  const pressed = card.label!.recorded && card.label!.said === undefined && card.answer === labelWords(card.label!.recorded);
  const what =
    card.phase === "file"
      ? `This line answers, in the reader's own words, whether ${about} is on the mark. The card asks them to file it ` +
        `as on the mark, off it, or hard to say, and the app writes it into the topic's labels then.`
      : pressed
        ? `This line is the reader's answer, pressed on the card, to whether ${about} is on the mark; the app has written it into the topic's labels.`
        : `This line is the reader's reason for calling ${about} off the mark; the app has written it into the topic's labels.`;
  return (
    `\n\n[App note, not the reader's words. ${what} Do not write it anywhere else. Reply in one short sentence; ` +
    `if the line also asks or says something else, answer that.]`
  );
}
