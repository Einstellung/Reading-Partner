// A question Lumen asks when a brief is opened (docs/info/88 「攒着问」「记忆回写」),
// drawn as a card in the door conversation: the question, two or three quick
// answers, and "in my own words". A quick answer is said as the reader's line;
// "in my own words" leaves the card waiting for the next line typed. Either
// way the line goes to the model with a note naming the question and the
// topic it came from, so the turn writes the answer back where it belongs and
// its receipt says where.
//
// Payload and pure helpers only; the door chat does the saying
// (ui/components/companion/use-door-chat.ts), the card component the drawing
// (ui/components/companion/IssueQuestionCard.tsx).

import { t } from "../../i18n";
import type { OpeningQuestion } from "./opening-record";

/** A quick answer pressed; the arg is the answer. */
export const ISSUE_ANSWER_OP = "issue-answer";
/** "In my own words" pressed: the next line typed answers the question. */
export const ISSUE_OWN_OP = "issue-own";

export interface IssueQuestionCard {
  kind: "issue-question";
  bookId: string;
  questionId: string;
  searchId: string;
  topic: string;
  text: string;
  quick: string[];
  phase: "open" | "own" | "answered";
  answer?: string;
  /** The reader's line that answered it. */
  answerTs?: number;
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
  return { text: q.text, quick: q.quick.length > 0 ? q.quick : [t("info.issue.quick.yes"), t("info.issue.quick.no")] };
}

export function questionCard(bookId: string, q: OpeningQuestion): IssueQuestionCard {
  const words = questionWords(q);
  return {
    kind: "issue-question",
    bookId,
    questionId: q.id,
    searchId: q.searchId,
    topic: q.topic,
    text: words.text,
    quick: words.quick,
    phase: "open",
  };
}

/** The card a typed line answers: the one waiting for the reader's own words, latest first. */
export function cardAwaitingWords(cards: readonly { cardId: string; card: IssueQuestionCard }[]): string | null {
  for (let i = cards.length - 1; i >= 0; i--) if (cards[i].card.phase === "own") return cards[i].cardId;
  return null;
}

/**
 * The app note on a line that answers a question, for the model only (as the
 * door's other notes, issue-context.ts). Empty when the line answers none.
 */
export function issueAnswerNote(cards: readonly IssueQuestionCard[], lineTs: number): string {
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
