// The drafting card (docs/info/88 起草：来回问): what propose_topic_search drew
// in the door conversation. The tool writes nothing; the card's Apply writes
// the config and the concern (apply.ts). Everything the runs need rides on the
// card, the queries included, but only what the reader agrees to is drawn:
// the search words are never shown.

import { t } from "../../i18n";
import { ALL_SOURCES, SOURCE_NAME, topicSources, type RunSource } from "./pace";
import type { StudyLineKind } from "./study";
import type { TopicQuery, TopicSeed, TopicSubtopic } from "./types";

/** The card's Apply, as a mutate op the door chat answers. */
export const TOPIC_SEARCH_APPLY_OP = "apply-topic-search";

/** When the first result can be expected, from the desktop's claim heartbeat (eta.ts). */
export type FirstRunEta = "soon" | "tonight";

export interface TopicSearchProposalCardData {
  kind: "topic-search-proposal";
  threadId: string;
  // A stopped search this re-drafts. Apply then follows it again under the
  // same id and concern instead of starting a second one.
  searchId: string | null;
  name: string;
  scope: string;
  subtopics: TopicSubtopic[];
  want: string[];
  avoid: string[];
  judgments: string[];
  eta: FirstRunEta;
  // A study (docs/info/91): one brief revised in conversation, not a daily follow.
  once?: boolean;
  // The sources the runs read, when not every one (docs/info/91 来源开关).
  sources?: RunSource[];
  // Why X is left out, said on the card: the model judged the topic academic.
  academic?: boolean;
  // Papers the reader confirmed on a seed card (seed-tool.ts), pinned first in
  // the brief; only on a study.
  seeds?: ProposedSeed[];
  // Not drawn.
  anchors: string[];
  queries: TopicQuery[];
  answers: { asked: string; answer: string }[];
  concern: {
    // One sentence: the reader is following this.
    text: string;
    // A concern already saying the same thing, as the model pointed it out.
    existingId: string | null;
    // The anchor of the message the reader opened with, resolved by the program.
    evidence: string | null;
  };
  phase: "draft" | "applied";
}

/** A seed as the drafting card carries it: what the config keeps, and what the card shows and the label cites. */
export interface ProposedSeed extends TopicSeed {
  authors: string[];
  // The day or year the library gave, "" when none.
  date: string;
  // The anchor of the reader's message that named it.
  evidence: string | null;
}

/** The seed card's 「是这篇」/「不是」, as a mutate op whose arg is "<candidate index>:yes" or ":no". */
export const STUDY_SEED_VERDICT_OP = "study-seed-verdict";

export type SeedVerdict = "yes" | "no";

/** One paper a lookup found for a name. Every field is the program's, from the library. */
export interface StudySeedCandidate {
  // "arxiv:<id>" or "doi:<doi>", the link-identity key.
  key: string;
  // How the card names the handle: "arXiv 2401.12345", "DOI 10.1038/…".
  handle: string;
  title: string;
  authors: string[];
  date: string;
  url: string;
  verdict: SeedVerdict | null;
}

/** find_seed_paper's card (docs/info/91 起草与种子): the candidates for one name, each confirmed or not by the reader. */
export interface StudySeedsCardData {
  kind: "study-seeds";
  threadId: string;
  // The name the reader gave, word for word.
  said: string;
  // The anchor of the reader's message that named it.
  evidence: string | null;
  at: number;
  candidates: StudySeedCandidate[];
}

/** A line's 对 or 别记 on the confirm card, as a mutate op whose arg is "<line index>:ok" or ":drop". */
export const STUDY_LINE_VERDICT_OP = "study-line-verdict";
/** A line's 改一下 saved, as a mutate op whose arg is "<line index>:<the new text>". */
export const STUDY_LINE_EDIT_OP = "study-line-edit";
/** The confirm card's 「按这几条更新简报」, as a mutate op. */
export const STUDY_LINES_SEND_OP = "study-lines-send";

export type StudyLineVerdict = "ok" | "edit" | "drop";

/** One line on the confirm card (docs/info/91 对话里改). */
export interface StudyLineDraft {
  kind: StudyLineKind;
  // The line as Lumen put it; the reader's wording once they changed it.
  text: string;
  // The reader's words it came from.
  said: string;
  // The anchor of that message, found by the program; null when no line of theirs matched.
  evidence: string | null;
  // The item key a pin, a demotion or a rewrite is about, and its title (the program's); null otherwise.
  item: string | null;
  itemTitle: string | null;
  verdict: StudyLineVerdict | null;
}

/**
 * propose_study_lines' card. `open` while the reader decides each line;
 * `recorded` once the confirmed lines are written but the update was not
 * asked (one still running, or the ask refused); `asked` once it was.
 */
export interface StudyLinesCardData {
  kind: "study-lines";
  threadId: string;
  searchId: string;
  name: string;
  at: number;
  lines: StudyLineDraft[];
  phase: "open" | "recorded" | "asked";
  // From `recorded` on: the study line id each line was written under, null for a dropped one,
  // and the extra query ids the update searches.
  ids?: (string | null)[];
  queries?: string[];
  // The last ask: still busy, refused, or asked as run `runId`.
  ask?: { status: "busy" } | { status: "refused"; reason: string } | { status: "asked"; runId: string; n: number };
}

/** The move card's 「移进阅读，结束调研」, as a mutate op whose arg is `{"topicId": …}` or `{"newName": …}`. */
export const STUDY_MOVE_OP = "study-move";
/** The move card's 「再看看」. */
export const STUDY_MOVE_LATER_OP = "study-move-later";

/** end_study's card (docs/info/91 结束): the current version's book, and the reading topic it goes to. */
export interface StudyMoveCardData {
  kind: "study-move";
  threadId: string;
  searchId: string;
  name: string;
  version: number;
  bookId: string;
  // The reading topics as they stood when drawn; the suggested one's id, or null.
  topics: { id: string; name: string }[];
  suggested: string | null;
  at: number;
  phase: "open" | "later" | "moved";
  // After the move: where it went, and what is kept.
  moved?: { topic: string; pins: number; marks: number };
  // The last press failed: nothing was stopped.
  failed?: boolean;
}

export type TopicSearchCard = TopicSearchProposalCardData | StudySeedsCardData | StudyLinesCardData | StudyMoveCardData;

/** A seed card with one candidate's verdict set; the same card when the index or the verdict is not one. */
export function withSeedVerdict(card: StudySeedsCardData, arg: string): StudySeedsCardData {
  const [index, verdict] = arg.split(":");
  const at = Number(index);
  if (!Number.isInteger(at) || !card.candidates[at] || (verdict !== "yes" && verdict !== "no")) return card;
  return { ...card, candidates: card.candidates.map((c, i) => (i === at ? { ...c, verdict } : c)) };
}

/** The line a verdict leaves in the conversation, so the next turn knows. */
export function seedVerdictNote(card: StudySeedsCardData, arg: string): string | null {
  const [index, verdict] = arg.split(":");
  const c = card.candidates[Number(index)];
  if (!c || (verdict !== "yes" && verdict !== "no")) return null;
  return t(verdict === "yes" ? "info.call.note.studySeedYes" : "info.call.note.studySeedNo", { title: c.title, handle: c.handle });
}

/** The drafting card's sources line: what is read, and what is not and why (docs/info/91 来源开关). */
export function draftingSourcesLine(card: Pick<TopicSearchProposalCardData, "sources" | "academic">): string {
  const reads = topicSources(card);
  const skipped = ALL_SOURCES.filter((s) => !reads.includes(s));
  const names = (list: readonly RunSource[]) => list.map((s) => SOURCE_NAME[s]).join(", ");
  const head = t("info.cards.topicSearchSources", { names: names(reads) });
  if (skipped.length === 0) return head;
  const key = card.academic ? "info.cards.topicSearchSkippedAcademic" : "info.cards.topicSearchSkipped";
  return `${head} ${t(key, { names: names(skipped) })}`;
}

/** The line left in the conversation once the card is applied. */
export function topicSearchAppliedNote(card: TopicSearchProposalCardData): string {
  return t("info.call.note.topicSearchApplied", { name: card.name });
}
