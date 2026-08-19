// Assembly of one turn of a talk's rehearsal conversation (docs/31).
//
// The counterpart of reading/turn.ts, and deliberately not a branch of it: that
// one assembles a conversation about the page the reader is on, out of the book
// the reader has open. This one assembles a conversation about a talk, out of
// materials read from disk, with no reader mounted. The two share the pieces
// that are the same (the reading tools, observations, the budget ladder) and
// nothing else.
//
// Pure assembly plus reads. It never touches React state and never starts the
// stream; the caller owns runAgentTurn.

import type { AgentTool } from "../../ai/agent";
import { modelSupportsImages, type ProviderId } from "../../ai/aiClient";
import { toPiMessages } from "../../ai/providers";
import { fitToBudget } from "../../budget";
import { configuredModel, HISTORY_KEEP, HISTORY_KEEP_TIGHT } from "../turn";
import { TALK_LADDER, type TalkReductionId } from "./ladder";
import { languageInstruction, type Settings } from "../../platform/app/settings";
import type { TopicMaterial } from "../../fulltext/format";
import {
  buildObservationSnapshot,
  buildObservationTools,
  getObservationAdapter,
  observationPromptSection,
  notifyObservationChange,
  trimObservations,
  type Observation,
  type ObservationType,
} from "../../observation";
import { buildReadingTools } from "../context";
import { buildFigureCatalog } from "../figures/catalog";
import { buildFigureTools } from "../figures/tools";
import { renderFigure } from "../figures/render";
import type { Figure } from "../figures/types";
import { readChapterSpine } from "../prep/chapters/store";
import {
  buildRehearsalSystemPrompt,
  buildRehearsalTools,
  nextChapter,
  REHEARSAL_KICKOFF,
  type RehearsalDecision,
  type RehearsalDecisionCardData,
  type RehearsalNote,
} from "../rehearsal";
import { readMaterialBytes, type LoadedMaterial } from "./material";
import {
  bucketTalkMarks,
  combineChapters,
  combinedSource,
  slotAt,
  toRehearsalPlan,
  toTalkDecision,
  type TalkSlot,
} from "./outline";
import type { Talk, TalkDecision } from "./types";

// The replay cap and its tight form come from the reading turn, not a second
// pair of constants: a rehearsal is the same kind of conversation, and two
// copies of a cap are two things to keep in step.
const OBSERVATION_KEEP_TIGHT = 3;
// Which observations survive that cut here. The rehearsal sources a chapter's
// first question from where this reader got stuck and pitches its language at
// what they turn out to know (reading/rehearsal/prompt.ts), so those two types
// go first; reading position is last because the book is finished.
// cannot-explain rides directly behind stuck-point: a chapter the reader read
// but could not give out loud last time is the strongest candidate there is for
// this rehearsal's next question, and with three lines to spend it has to be one
// of them. can-explain earns its place further down — it says where not to
// spend a question, which is worth less than knowing where to.
export const OBSERVATION_ORDER_TIGHT: ObservationType[] = [
  "stuck-point",
  "cannot-explain",
  "belief",
  "understood-concept",
  "can-explain",
  "correction",
  "reading-position",
];

export interface TalkTurnMessage {
  role: "user" | "ai";
  text: string;
  images?: { data: string; mediaType: string }[];
}

export interface TalkTurnInput {
  talk: Talk;
  // The talk's materials, already read from disk (material.ts).
  materials: LoadedMaterial[];
  topicName: string;
  settings: Settings;
  // The conversation so far, oldest first.
  history: TalkTurnMessage[];
  // Write one decision to the talk. The tool calls this; the caller owns the
  // file and the outline the reader is looking at, so it also owns the write.
  record(decision: TalkDecision): Promise<void>;
  // The talk as it stands right now, asked for rather than closed over:
  // read_talk_outline has to answer "what does my talk look like now" including
  // the entry recorded a moment ago in this same turn and the one the reader
  // just moved in the outline pane. Defaults to the snapshot this turn was built
  // from, which is only right in a test that records nothing.
  readTalk?(): Talk | null | Promise<Talk | null>;
  // Raised when a decision is recorded, so the shell can put the card in the
  // conversation. Absent = the decision is still written, it just is not shown.
  onDecisionCard?(card: RehearsalDecisionCardData): void;
  now?(): number;
  // Injected for tests: the book's bytes and the figure rasterizer.
  readBytes?: (bookId: string) => Promise<ArrayBuffer | null>;
  render?: typeof renderFigure;
}

export interface TalkTurn {
  systemPrompt: string;
  tools: AgentTool[];
  messages: TalkTurnMessage[];
  // What this turn had to leave out, or "" when nothing the reader has a stake
  // in was dropped.
  notice: string;
  // Set when the turn cannot be made small enough to leave the model room to
  // answer. Show this instead of sending; retrying changes nothing.
  refusal: string;
}

// The talk's materials named in one phrase, for the line the prompt opens with.
function materialsLabel(materials: readonly LoadedMaterial[]): string {
  const titles = materials.map((m) => m.title);
  if (titles.length === 0) return "(no materials)";
  if (titles.length === 1) return titles[0];
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

// The figure catalog for a talk. One book's catalog is the book's; several get a
// heading each, because "[fig:3]" means a different picture in each of them.
function talkFigureCatalog(materials: readonly LoadedMaterial[]): string {
  const withFigures = materials.filter((m) => m.figures.length > 0);
  if (withFigures.length === 0) return "";
  if (withFigures.length === 1) return buildFigureCatalog(withFigures[0].figures);
  return withFigures
    .map((m) => `In "${m.title}":\n${buildFigureCatalog(m.figures)}`)
    .join("\n\n");
}

// Which book each figure came from, so view_figure can read the right file.
function figureOwners(materials: readonly LoadedMaterial[]): {
  figures: Figure[];
  owner: Map<Figure, string>;
} {
  const figures: Figure[] = [];
  const owner = new Map<Figure, string>();
  for (const m of materials) {
    for (const f of m.figures) {
      figures.push(f);
      owner.set(f, m.bookId);
    }
  }
  return { figures, owner };
}

export async function buildTalkTurn(input: TalkTurnInput): Promise<TalkTurn> {
  const {
    talk,
    materials,
    topicName,
    settings: s,
    history,
    record,
    readTalk = () => talk,
    onDecisionCard,
    now = () => Date.now(),
    readBytes = readMaterialBytes,
    render = renderFigure,
  } = input;

  const { chapters, slots } = combineChapters(materials);
  const skeleton = { source: combinedSource(materials), chapters };
  const marks = bucketTalkMarks(materials, slots);
  const plan = toRehearsalPlan(talk, slots);

  // The reading tools, over the talk's materials rather than the topic's: a talk
  // is a chosen set, and searching a book the reader left out would answer with
  // material the talk is not about. read_pages names "the book the user is
  // currently in", so it is only mounted when the talk has exactly one material;
  // with several, search_topic is the way in and it tags every hit with its book.
  const topicMaterials: TopicMaterial[] = materials.map((m) => ({
    label: m.title,
    fulltext: m.fulltext,
    annotations: m.annotations,
  }));
  const single = materials.length === 1 ? materials[0] : null;
  let tools = buildReadingTools({
    currentFulltext: single?.fulltext ?? null,
    materials: topicMaterials,
  });
  const hasReadingTools = tools.length > 0;

  // Per-topic AI observations (docs/02, docs/31: the rehearsal opens by handing
  // the reader their own trail back).
  let observationSection = "";
  let observationSectionTight = "";
  if (talk.topicId) {
    const observationsAdapter = getObservationAdapter(talk.topicId);
    const observations = await observationsAdapter.listObservations().catch((): Observation[] => []);
    tools = [
      ...tools,
      ...buildObservationTools(observationsAdapter, {
        onWrite: () => notifyObservationChange(talk.topicId),
      }),
    ];
    observationSection = observationPromptSection(buildObservationSnapshot(observations), true);
    const kept = trimObservations(observations, OBSERVATION_KEEP_TIGHT, OBSERVATION_ORDER_TIGHT);
    observationSectionTight = observationPromptSection(buildObservationSnapshot(kept), true);
  }

  // Figures. Judging whether a figure can carry a point is the whole reason a
  // decision names one, and that judgement cannot be made from a caption — so
  // view_figure is mounted here exactly as it is in the reader. The crop comes
  // from the library copy of the book, read only when the tool is actually
  // called (figures/render.ts uses pdf.js, so no reader and no engine).
  const { figures, owner } = figureOwners(materials);
  const figureCatalog = talkFigureCatalog(materials);
  if (figures.length > 0) {
    tools = [
      ...tools,
      ...buildFigureTools({
        figures,
        modelSupportsImages: modelSupportsImages(
          s.defaultProviderId as ProviderId,
          s.defaultModelId as string,
        ),
        renderImage: async (fig) => {
          const bookId = owner.get(fig);
          if (!bookId) return null;
          const buffer = await readBytes(bookId);
          if (!buffer) return null;
          const r = await render(bookId, buffer, fig, "view");
          return r ? { base64: r.base64, mimeType: r.mimeType } : null;
        },
      }),
    ];
  }

  // The chapter coming up, inlined. Only that one: every other chapter's note is
  // a read_chapter_note away, and twelve of them would be fifty thousand words
  // the reader has already stopped reading (docs/31).
  const noteFor = async (index: number): Promise<string | null> => {
    const slot = slotAt(slots, index);
    if (!slot) return null;
    return readChapterSpine(slot.bookId, slot.chapter).catch(() => null);
  };
  let notes: RehearsalNote[] = [];
  const upcoming = nextChapter(chapters, plan) ?? chapters[0]?.index;
  const chapter = chapters.find((c) => c.index === upcoming);
  if (chapter?.hasNote) {
    const body = await noteFor(chapter.index);
    if (body) notes = [{ chapter: chapter.index, title: chapter.title, body }];
  }

  tools = [
    ...tools,
    ...buildRehearsalTools({
      chapters,
      record: async (decision: RehearsalDecision) => {
        const entry = toTalkDecision(slots, decision);
        if (entry) await record(entry);
      },
      readNote: noteFor,
      // Re-projected from the talk as it stands, not from the copy above: the
      // combined numbering is this turn's, but what it is applied to has to be
      // current.
      readPlan: async () => toRehearsalPlan((await readTalk()) ?? talk, slots),
      onCard: onDecisionCard,
      now,
    }),
  ];

  function composePrompt(dropped: ReadonlySet<TalkReductionId>): string {
    let prompt = buildRehearsalSystemPrompt({
      topicName,
      bookName: materialsLabel(materials),
      // The rehearsal happens away from the reader, so there is no open page to
      // report; the record below is the only "where we are" there is.
      pageLabel: null,
      skeleton,
      marks,
      notes: dropped.has("rehearsal-notes") ? [] : notes,
      plan,
      figureCatalog: dropped.has("figure-catalog") ? "" : figureCatalog,
      hasReadingTools,
      fullMarks: !dropped.has("rehearsal-marks"),
    });
    const lang = languageInstruction(s.aiLanguage);
    if (lang) prompt += "\n\n" + lang;
    const observed = dropped.has("observation-trim") ? observationSectionTight : observationSection;
    if (observed) prompt += "\n\n" + observed;
    return prompt;
  }

  function composeMessages(dropped: ReadonlySet<TalkReductionId>): TalkTurnMessage[] {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    const tail = history.length > keep ? history.slice(history.length - keep) : history;
    return [{ role: "user" as const, text: REHEARSAL_KICKOFF }, ...tail];
  }

  // Fit the call to the model's window before it is sent. A whole book's
  // highlights is exactly the payload the ladder exists for: left unchecked, an
  // over-full request comes back one token long with a normal `done` and no
  // error (docs/pitfall/65).
  const model = configuredModel(s);
  if (!model) {
    return {
      systemPrompt: composePrompt(new Set()),
      tools,
      messages: composeMessages(new Set()),
      notice: "",
      refusal: "",
    };
  }
  // Dropping the catalog while a [fig:N] is in play would leave the reference
  // dangling.
  const skip = new Set<TalkReductionId>();
  if (composeMessages(new Set()).some((m) => m.text.includes("[fig:"))) skip.add("figure-catalog");

  const fitted = fitToBudget<TalkReductionId, TalkTurnMessage>({
    model,
    tools,
    composePrompt,
    composeMessages,
    toPi: toPiMessages,
    rungs: TALK_LADDER,
    purpose: "chat",
    skip,
  });
  return {
    systemPrompt: fitted.systemPrompt,
    tools,
    messages: fitted.messages,
    notice: fitted.notice,
    refusal: fitted.refusal,
  };
}


export type { TalkSlot };
