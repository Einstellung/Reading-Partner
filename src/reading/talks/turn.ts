// Assembly of one turn of a talk's rehearsal conversation (docs/31).
//
// The counterpart of reading/turn.ts, and deliberately not a branch of it: that
// one assembles a conversation about the page the reader is on, out of the book
// the reader has open. This one assembles a conversation about a talk, out of
// materials read from disk, with no reader mounted. The two share the pieces
// that are the same (the reading tools, memory, the budget ladder) and nothing
// else.
//
// Pure assembly plus reads. It never touches React state and never starts the
// stream; the caller owns runAgentTurn.

import type { Api, Context as PiContext, Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import { modelSupportsImages, type ProviderId } from "../../ai/aiClient";
import { providers, toPiMessages } from "../../ai/providers";
import {
  contextBudget,
  estimateContextTokens,
  estimateTextTokens,
  fitsBudget,
  planReductions,
  type ReductionId,
} from "../../budget";
import { languageInstruction, type Settings } from "../../platform/app/settings";
import type { TopicMaterial } from "../../fulltext/format";
import {
  buildMemorySnapshot,
  buildMemoryTools,
  getMemoryAdapter,
  memoryPromptSection,
  notifyMemoryChange,
  type MemoryEntry,
} from "../../memory";
import { buildReadingTools } from "../context";
import { buildFigureCatalog } from "../figures/catalog";
import { buildFigureTools } from "../figures/tools";
import { renderFigure } from "../figures/render";
import type { Figure } from "../figures/types";
import { readChapterNote } from "../notes/store";
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

// Replayed history, and the tight form the budget ladder falls back to. Same
// numbers as the reading turn: a rehearsal is the same kind of conversation.
export const HISTORY_KEEP = 40;
export const HISTORY_KEEP_TIGHT = 6;
const MEMORY_KEEP_TIGHT = 3;

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

function configuredModel(s: Settings): Model<Api> | null {
  const provider = providers[s.defaultProviderId as ProviderId];
  if (!provider) return null;
  return provider.getModels().find((m) => m.id === s.defaultModelId) ?? null;
}

function piContext(
  systemPrompt: string,
  messages: TalkTurnMessage[],
  tools: AgentTool[],
): PiContext {
  return {
    systemPrompt,
    messages: toPiMessages(messages),
    tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  };
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

  // Per-topic memory (docs/02, docs/31: the rehearsal opens by handing the
  // reader their own trail back).
  let memorySection = "";
  let memorySectionTight = "";
  if (talk.topicId) {
    const memory = getMemoryAdapter(talk.topicId);
    const observations = await memory.listObservations().catch((): MemoryEntry[] => []);
    tools = [
      ...tools,
      ...buildMemoryTools(memory, { onWrite: () => notifyMemoryChange(talk.topicId) }),
    ];
    memorySection = memoryPromptSection(buildMemorySnapshot(observations), true);
    const recent = [...observations]
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, MEMORY_KEEP_TIGHT);
    memorySectionTight = memoryPromptSection(buildMemorySnapshot(recent), true);
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
    return readChapterNote(slot.bookId, slot.chapter).catch(() => null);
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

  function composePrompt(dropped: ReadonlySet<ReductionId>): string {
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
    const memory = dropped.has("memory-trim") ? memorySectionTight : memorySection;
    if (memory) prompt += "\n\n" + memory;
    return prompt;
  }

  function composeMessages(dropped: ReadonlySet<ReductionId>): TalkTurnMessage[] {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    const tail = history.length > keep ? history.slice(history.length - keep) : history;
    return [{ role: "user" as const, text: REHEARSAL_KICKOFF }, ...tail];
  }

  const none: ReadonlySet<ReductionId> = new Set();
  let systemPrompt = composePrompt(none);
  let messages = composeMessages(none);
  let notice = "";
  let refusal = "";

  // Fit the call to the model's window before it is sent. A whole book's
  // highlights is exactly the payload the ladder exists for: left unchecked, an
  // over-full request comes back one token long with a normal `done` and no
  // error (docs/pitfall/65).
  const model = configuredModel(s);
  if (model) {
    const budget = contextBudget(model, piContext(systemPrompt, messages, tools));
    if (!fitsBudget(budget, "chat")) {
      // The two bulk rungs are held out of the base and priced as the difference,
      // so the small rungs are measured against a prompt carrying neither.
      const bulk: ReductionId[] = ["rehearsal-marks", "rehearsal-notes"];
      const withoutBulk: ReadonlySet<ReductionId> = new Set<ReductionId>(bulk);
      const baseTokens = estimateTextTokens(composePrompt(withoutBulk));
      const priceOf = (id: ReductionId): number =>
        Math.max(0, baseTokens - estimateTextTokens(composePrompt(new Set([...withoutBulk, id]))));
      const priceBulk = (id: ReductionId): number =>
        Math.max(
          0,
          estimateTextTokens(systemPrompt) - estimateTextTokens(composePrompt(new Set([id]))),
        );
      const tightMessages = composeMessages(new Set<ReductionId>(["history-trim"]));
      // Dropping the catalog while a [fig:N] is in play would leave the reference
      // dangling.
      const figuresInPlay = messages.some((m) => m.text.includes("[fig:"));
      const savings: Partial<Record<ReductionId, number>> = {
        "figure-catalog": figuresInPlay ? 0 : priceOf("figure-catalog"),
        "memory-trim": priceOf("memory-trim"),
        "rehearsal-notes": priceBulk("rehearsal-notes"),
        "rehearsal-marks": priceBulk("rehearsal-marks"),
        "history-trim": Math.max(
          0,
          estimateContextTokens({ messages: toPiMessages(messages) }) -
            estimateContextTokens({ messages: toPiMessages(tightMessages) }),
        ),
      };
      const total = Object.values(savings).reduce((n, v) => n + (v ?? 0), 0);
      const reductions = planReductions({
        contextWindow: budget.contextWindow,
        purpose: "chat",
        used: budget.used,
        floorTokens: budget.used - total,
        savings,
      });
      if (reductions.apply.length > 0) {
        const dropped = new Set(reductions.apply);
        systemPrompt = composePrompt(dropped);
        messages = composeMessages(dropped);
      }
      notice = reductions.notice;
      refusal = reductions.refusal;
    }
  }

  return { systemPrompt, tools, messages, notice, refusal };
}

export type { TalkSlot };
