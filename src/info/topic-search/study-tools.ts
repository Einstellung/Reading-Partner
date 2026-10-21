// propose_study_lines, update_study_brief and end_study (docs/info/91 对话里改,
// 结束): the door's tools for revising a study's brief in conversation and
// ending it. None of them writes: propose_study_lines and end_study draw a card,
// and update_study_brief does what the confirm card's button does, through the
// door chat (ui/components/companion/use-door-chat.ts), the way
// confirm_topic_search does for the drafting card. What the card writes is in
// study-lines.ts.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/durable/contract";
import { asString } from "../../platform/std/json";
import { t } from "../../i18n";
import type { StudyLinesCardData, StudyMoveCardData } from "./cards";
import { searchLabelName } from "./edit-tools";
import { QUERY_SCHEMA, draftQueries, type ReaderLine } from "./propose-tool";
import { briefItemLines, draftStudyLines, STUDY_LINE_KINDS, suggestedTopic, type SendResult, type StudyBrief } from "./study-lines";
import { resolveTopicSearch } from "./topic-searches";
import type { TopicSearch } from "./types";
import { UPDATE_QUERIES_MAX } from "./update";

/** What the tools say of a study the reader named that is not one they can revise; null when it is. */
function notOpenStudy(raw: string, search: TopicSearch | null, searches: readonly TopicSearch[]): string | null {
  if (!search) {
    const studies = searches.filter((s) => s.once);
    return (
      `"${raw}" is not one of the reader's studies, so nothing was drawn.` +
      (studies.length ? `\nTheir studies:\n${studies.map((s) => `- ${s.name} (id: ${s.id}, ${s.status})`).join("\n")}` : " They have none.")
    );
  }
  if (!search.once) return `"${search.name}" is a topic followed nightly, not a study; its brief is not revised in conversation.`;
  if (search.status !== "active") return `"${search.name}" is a study that has ended; it is no longer revised.`;
  return null;
}

export interface StudyLinesToolDeps {
  threadId: string;
  readerLines(): readonly ReaderLine[];
  searches(): Promise<TopicSearch[]>;
  known(): readonly TopicSearch[];
  /** The study's brief as the reader sees it (study-lines.ts studyBrief). */
  brief(searchId: string): Promise<StudyBrief>;
  now(): number;
  raiseCard(card: StudyLinesCardData): void;
}

const LINE_SCHEMA = Type.Object({
  kind: Type.String({
    description:
      "avoid: what the reader does not want in this topic (goes into its config). judgment: how they read the topic, " +
      "what counts and what weighs more (goes into its config). pin: an item kept at the front of the brief. demote: an " +
      "item moved to the Notes. rewrite: an item whose write-up is to be written again, the line saying what is wrong.",
    enum: [...STUDY_LINE_KINDS],
  }),
  text: Type.String({ description: "The line as it will be recorded, one sentence, in the reader's language." }),
  said: Type.String({ description: "The reader's own words it came from, copied exactly from their message." }),
  item: Type.Optional(
    Type.String({ description: "For pin, demote and rewrite: the item's id in the brief (\"E3\") or its exact title." }),
  ),
});

export function buildProposeStudyLinesTool(deps: StudyLinesToolDeps): AgentTool {
  return {
    name: "propose_study_lines",
    label: (args) => t("info.tool.proposingStudyLines", { name: searchLabelName(args.study, deps.known()) }),
    effect: "read",
    description:
      "While the reader talks a study's brief over, put what is worth recording on a confirm card: things to leave " +
      "out, how to read the topic, items to pin, demote or rewrite, each with the reader's words. Say your " +
      "understanding in one sentence first. Writes nothing: the reader marks each line right, changed or not to " +
      "note, and only their press of the card's update button (or update_study_brief) records them and updates the brief.",
    parameters: Type.Object({
      study: Type.String({ description: "The study's id (ts-…) or name." }),
      lines: Type.Array(LINE_SCHEMA, { description: "One entry per line, at most a handful." }),
    }),
    execute: async (args) => {
      const raw = asString(args.study).trim();
      const searches = await deps.searches();
      const search = resolveTopicSearch(raw, searches);
      const closed = notOpenStudy(raw, search, searches);
      if (closed || !search) return { text: closed ?? "", receipt: null };
      const brief = await deps.brief(search.id);
      const { lines, problems } = draftStudyLines(args.lines, brief, deps.readerLines(), deps.threadId);
      if (problems.length || lines.length === 0) {
        const items = briefItemLines(brief);
        return {
          text: [
            "No card was drawn.",
            ...(lines.length === 0 && problems.length === 0 ? ["The call carried no line."] : problems),
            items.length ? `The brief's items (version ${brief.version ?? "?"}):\n${items.join("\n")}` : "The study has no brief yet.",
          ].join("\n"),
          receipt: null,
        };
      }
      deps.raiseCard({
        kind: "study-lines",
        threadId: deps.threadId,
        searchId: search.id,
        name: search.name,
        at: deps.now(),
        lines,
        phase: "open",
      });
      return {
        text:
          `Drew the confirm card for "${search.name}" with ${lines.length} line${lines.length === 1 ? "" : "s"}. Nothing is ` +
          "recorded yet: the reader marks each line, and the brief is updated only when they press the card's button or " +
          "tell you to go ahead (then call update_study_brief). Do not say anything was noted or changed.",
        receipt: null,
      };
    },
  };
}

export interface UpdateBriefToolDeps {
  /** The newest confirm card in this conversation, or null. */
  latestCard(): { cardId: string; card: StudyLinesCardData } | null;
  /** The card's button, as the door chat answers it: the card is redrawn with what happened. */
  send(cardId: string, queries: ReturnType<typeof draftQueries>): Promise<SendResult>;
}

/** What update_study_brief tells the model after the send. Exported for the tests. */
export function sentText(card: StudyLinesCardData, result: SendResult): string {
  if (!result.ok) {
    if (result.why === "undecided") {
      const which = result.undecided.map((i) => `${i + 1} ("${card.lines[i].text}")`).join(", ");
      return `Nothing was recorded: line${result.undecided.length === 1 ? "" : "s"} ${which} on the card ${result.undecided.length === 1 ? "is" : "are"} not decided. Ask the reader about ${result.undecided.length === 1 ? "it" : "them"}; they decide on the card.`;
    }
    if (result.why === "ended") return `Nothing was recorded: "${card.name}" has ended or is gone.`;
    return `The update for this card was asked already. Call background_status to see how it is going.`;
  }
  const kept = result.card.lines.filter((l) => l.verdict !== "drop").length;
  const recorded = `Recorded ${kept} line${kept === 1 ? "" : "s"} of "${card.name}"${kept < card.lines.length ? ` (the reader dropped ${card.lines.length - kept})` : ""}.`;
  if (result.ask.status === "busy") {
    return `${recorded} The previous update of this study is still being made, so no new one was asked; the card's button asks again once it is done. Tell the reader in one line.`;
  }
  if (result.ask.status === "refused") return `${recorded} The update could not be asked: ${result.ask.reason}`;
  return (
    `${recorded} The update is asked: it runs on the desktop collector, and the new version of the brief comes into the ` +
    "box when it is done; the current one stays readable meanwhile. Tell the reader in one line. Do not say when it " +
    "will finish; when they ask, call background_status."
  );
}

export function buildUpdateStudyBriefTool(deps: UpdateBriefToolDeps): AgentTool {
  return {
    name: "update_study_brief",
    label: () => t("info.tool.updatingStudyBrief"),
    effect: "write",
    gate: "instruction",
    description:
      "Update a study's brief by the confirm card you drew last, when the reader says so in words ('对，更新吧', " +
      "'go ahead'). Same as the card's button: the lines they confirmed are recorded and the next version is asked. " +
      "Refused while lines on the card are undecided. Never on your own initiative.",
    parameters: Type.Object({
      queries: Type.Optional(
        Type.Array(QUERY_SCHEMA, {
          maxItems: UPDATE_QUERIES_MAX,
          description: `Only when the reader asked to look further: up to ${UPDATE_QUERIES_MAX} extra searches on arXiv and Hugging Face for this update, arxiv words required.`,
        }),
      ),
    }),
    execute: async (args) => {
      const latest = deps.latestCard();
      if (!latest) return { text: "There is no confirm card in this conversation. Propose the lines first.", receipt: null };
      const result = await deps.send(latest.cardId, draftQueries(args.queries));
      return {
        text: sentText(latest.card, result),
        receipt: result.ok ? { label: t("info.tool.updatedStudyBrief"), summary: latest.card.name } : null,
      };
    },
  };
}

export interface EndStudyToolDeps {
  threadId: string;
  searches(): Promise<TopicSearch[]>;
  known(): readonly TopicSearch[];
  /** The study's current version and its book on the info shelf; null when no version is out. */
  studyBook(searchId: string): Promise<{ version: number; bookId: string } | null>;
  /** The reading topics. */
  topics(): Promise<{ id: string; name: string }[]>;
  now(): number;
  raiseCard(card: StudyMoveCardData): void;
}

export function buildEndStudyTool(deps: EndStudyToolDeps): AgentTool {
  return {
    name: "end_study",
    label: (args) => t("info.tool.endingStudy", { name: searchLabelName(args.study, deps.known()) }),
    effect: "read",
    description:
      "When the reader says a study's brief is good as it is ('可以了', '就这样'), offer to move it into reading and end " +
      "the study: draws a card with the reading topics, the one you suggest marked. Writes nothing: only the reader's " +
      "press on the card moves the book and ends the study.",
    parameters: Type.Object({
      study: Type.String({ description: "The study's id (ts-…) or name." }),
      topic: Type.Optional(Type.String({ description: "The reading topic (id or name) you suggest it goes to, if one fits." })),
    }),
    execute: async (args) => {
      const raw = asString(args.study).trim();
      const searches = await deps.searches();
      const search = resolveTopicSearch(raw, searches);
      const closed = notOpenStudy(raw, search, searches);
      if (closed || !search) return { text: closed ?? "", receipt: null };
      const book = await deps.studyBook(search.id);
      if (!book) return { text: `"${search.name}" has no brief on this device yet, so there is nothing to move.`, receipt: null };
      const topics = await deps.topics();
      const suggested = suggestedTopic(asString(args.topic), topics);
      deps.raiseCard({
        kind: "study-move",
        threadId: deps.threadId,
        searchId: search.id,
        name: search.name,
        version: book.version,
        bookId: book.bookId,
        topics,
        suggested,
        at: deps.now(),
        phase: "open",
      });
      return {
        text:
          `Drew the move card for "${search.name}", version ${book.version}${suggested ? "" : asString(args.topic) ? `; "${asString(args.topic)}" is not a reading topic, so none is suggested` : ""}. ` +
          "Nothing is moved or ended until the reader presses its button; do not say it was.",
        receipt: null,
      };
    },
  };
}
