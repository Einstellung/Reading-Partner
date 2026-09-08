// The retell on the desk (docs/31, docs/61).
//
// Everything a retell's material contributes to one call: the reading tools over
// the chosen books rather than the topic's, the figures, the chapter note the
// pass is heading into, the prep notes behind the materials, the tools that
// record a decision and write the talk, and the prompt those come out in. What
// it does not do is assemble a call — the desk hands this item to
// src/ai/assemble, the one place a turn is put together whatever is lying on it.
//
// Deliberately not a branch of the book's item (reading/desk.ts): that one is
// assembled out of the book the reader has open and the page they are on, this
// one out of materials read from disk with no reader mounted. They share the
// pieces that are the same — the reading tools, the memory paragraph, the budget
// ladder — and nothing else.

import { modelSupportsImages, type ProviderId } from "../../ai";
import {
  registerDeskItemKind,
  type DeskEnv,
  type DeskItem,
  type DeskItemKind,
  type DeskPromptView,
} from "../../desk";
import { languageInstruction } from "../../platform/app/settings";
import type { TopicMaterial } from "../../fulltext/format";
import {
  buildObservationSnapshot,
  getObservationAdapter,
  trimObservations,
  type Observation,
  type ObservationType,
} from "../../memory";
import { buildReadingTools } from "../context";
import { buildFigureCatalog } from "../figures/catalog";
import { buildFigureTools } from "../figures/tools";
import { renderFigure } from "../figures/render";
import type { Figure } from "../figures/types";
import { readChapterSpine } from "../prep/chapters/store";
import {
  CLASSROOM_NOTE_BUDGET_TIGHT,
  prepNotesSection,
  type ClassroomNote,
} from "../prep/papers/classroom";
import { buildClassroomTools } from "../prep/papers/tools";
import type { PrepState } from "../prep/papers/types";
import { HISTORY_KEEP, HISTORY_KEEP_TIGHT } from "../desk";
import { RETELL_LADDER, type RetellReductionId } from "./ladder";
import { retellPrepStatus, selectRetellPrepNotes } from "./prep-notes";
import { buildArrangeTools, type TalkOutline } from "../talk";
import { buildRetellSystemPrompt, RETELL_KICKOFF, type RetellNote } from "./prompt";
import { buildRetellTools } from "./tools";
import { nextChapter } from "./plan";
import type { RetellDecisionCardData, TalkArrangementCardData } from "./cards";
import type { PlanDecision } from "./types";
import { readMaterialBytes, type LoadedMaterial } from "./material";
import {
  bucketRetellMarks,
  combineChapters,
  combinedSource,
  slotAt,
  toRetellPlan,
  toRetellDecision,
} from "./outline";
import type { Retell, RetellDecision } from "./types";

// The kind name is the palace row's (src/palace/kinds.ts): retell-<id>.json is
// the material, and this is how it is opened.
export const RETELL_KIND = "retell";

// How many of the topic's observations survive the ladder's observation-trim
// rung here.
const OBSERVATION_KEEP_TIGHT = 3;
// Which ones survive that cut. The retell sources a chapter's first question
// from where this reader got stuck and pitches its language at what they turn
// out to know (reading/retell/prompt.ts), so those two types go first; reading
// position is last because the book is finished.
// cannot-explain rides directly behind stuck-point: a chapter the reader read
// but could not give out loud last time is the strongest candidate there is for
// this retell's next question, and with three lines to spend it has to be one
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

export interface RetellTurnMessage {
  role: "user" | "ai";
  text: string;
  images?: { data: string; mediaType: string }[];
}

// How a turn reaches the talk outline. Two calls rather than the outline itself:
// the retell writes the talk as it goes, so what the tools work on has to be the
// file as it stands and not a snapshot taken when the turn was assembled — the
// same reason readRetell is a call. `edit` makes the outline on first write;
// `read` does not, so a retell that never gets as far as a spine leaves no empty
// talk behind.
export interface RetellTalkAccess {
  read(): Promise<TalkOutline | null>;
  edit(change: (outline: TalkOutline) => TalkOutline): Promise<TalkOutline | null>;
}

// What has to be handed over to put a retell on the desk. The settings are the
// turn's rather than this item's and ride in the DeskEnv (src/desk).
export interface RetellDeskRef {
  retell: Retell;
  // The retell's materials, already read from disk (material.ts).
  materials: LoadedMaterial[];
  topicName: string;
  // The conversation so far, oldest first.
  history: RetellTurnMessage[];
  // Write one decision to the retell. The tool calls this; the caller owns the
  // file and the outline the reader is looking at, so it also owns the write.
  record(decision: RetellDecision): Promise<void>;
  // The retell as it stands right now, asked for rather than closed over:
  // read_retell_outline has to answer "what does my retell look like now" including
  // the entry recorded a moment ago in this same turn and the one the reader
  // just moved in the outline pane. Defaults to the snapshot this turn was built
  // from, which is only right in a test that records nothing.
  readRetell?(): Retell | null | Promise<Retell | null>;
  // The talk this retell writes as it goes (docs/44). Required rather than
  // optional: it is also where the stage is read from, and a retell with nowhere
  // to write would hold the whole conversation and keep none of it.
  talk: RetellTalkAccess;
  // Raised when a decision is recorded, so the shell can put the card in the
  // conversation. Absent = the decision is still written, it just is not shown.
  onDecisionCard?(card: RetellDecisionCardData): void;
  // The same, for a write to the talk outline.
  onArrangeCard?(card: TalkArrangementCardData): void;
  now?(): number;
  // Injected for tests: the book's bytes and the figure rasterizer.
  readBytes?: (bookId: string) => Promise<ArrayBuffer | null>;
  render?: typeof renderFigure;
}

const retellKind: DeskItemKind<RetellDeskRef> = { kind: RETELL_KIND, open: openRetell };

/**
 * Register what a retell can put on the desk. Called once at startup by the
 * shell (useShellBootstrap), and by the tests that lay a desk of their own.
 */
export function registerRetellDesk(): () => void {
  return registerDeskItemKind(retellKind);
}

// The retell's materials named in one phrase, for the line the prompt opens with.
function materialsLabel(materials: readonly LoadedMaterial[]): string {
  const titles = materials.map((m) => m.title);
  if (titles.length === 0) return "(no materials)";
  if (titles.length === 1) return titles[0];
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

// The figure catalog for a retell. One book's catalog is the book's; several get a
// heading each, because "[fig:3]" means a different picture in each of them.
function retellFigureCatalog(materials: readonly LoadedMaterial[]): string {
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

// Open the retell: read its materials into the blocks a turn is written from and
// mount the tools that work on them. Never null — the materials were read before
// the desk was laid, and there is no disk read here a missing file could sink.
async function openRetell(ref: RetellDeskRef, env: DeskEnv): Promise<DeskItem | null> {
  const {
    retell,
    materials,
    topicName,
    history,
    record,
    readRetell = () => retell,
    talk,
    onDecisionCard,
    onArrangeCard,
    now = () => Date.now(),
    readBytes = readMaterialBytes,
    render = renderFigure,
  } = ref;
  const s = env.settings;

  const { chapters, slots } = combineChapters(materials);
  const skeleton = { source: combinedSource(materials), chapters };
  const marks = bucketRetellMarks(materials, slots);
  const plan = toRetellPlan(retell, slots);

  // The reading tools, over the retell's materials rather than the topic's: a retell
  // is a chosen set, and searching a book the reader left out would answer with
  // material the retell is not about. read_pages names "the book the user is
  // currently in", so it is only mounted when the retell has exactly one material;
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

  // The topic's observations (docs/02, docs/31: the retell opens by handing the
  // reader their own trail back). The tools that write them are the brain's and
  // ride whatever is on the desk (ai/assemble/memory.ts); what is read here is
  // the material the memory paragraph is built out of.
  let topicObservations: Observation[] = [];
  let observationSnapshot = "";
  let observationSnapshotTight = "";
  if (retell.topicId) {
    const observations = await getObservationAdapter(retell.topicId)
      .listObservations()
      .catch((): Observation[] => []);
    topicObservations = observations;
    observationSnapshot = buildObservationSnapshot(observations);
    observationSnapshotTight = buildObservationSnapshot(
      trimObservations(observations, OBSERVATION_KEEP_TIGHT, OBSERVATION_ORDER_TIGHT),
    );
  }

  // Figures. Judging whether a figure can carry a point is the whole reason a
  // decision names one, and that judgement cannot be made from a caption — so
  // view_figure is mounted here exactly as it is in the reader. The crop comes
  // from the library copy of the book, read only when the tool is actually
  // called (figures/render.ts uses pdf.js, so no reader and no engine).
  const { figures, owner } = figureOwners(materials);
  const figureCatalog = retellFigureCatalog(materials);
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

  // One chapter note inlined unasked: the first chapter no decision has consumed
  // yet. A guess, not a queue — the retell goes where the macro pass showed a
  // hole — but the cheapest one there is, and every other chapter's note is a
  // read_chapter_note away. Twelve of them would be fifty thousand words the
  // reader has already stopped reading (docs/31).
  const noteFor = async (index: number): Promise<string | null> => {
    const slot = slotAt(slots, index);
    if (!slot) return null;
    return readChapterSpine(slot.bookId, slot.chapter).catch(() => null);
  };
  let notes: RetellNote[] = [];
  const upcoming = nextChapter(chapters, plan) ?? chapters[0]?.index;
  const chapter = chapters.find((c) => c.index === upcoming);
  if (chapter?.hasNote) {
    const body = await noteFor(chapter.index);
    if (body) notes = [{ chapter: chapter.index, title: chapter.title, body }];
  }

  // The prep runs behind these materials (docs/09): read_paper / read_note over
  // whatever each one produced. Mounted wherever there is a prep state to read,
  // which is what "by data" means here — the tools follow the material, not the
  // mode. A survey's value is the papers it strings together, so a retell of one
  // that could not reach them would be a retell of the joins.
  const prepStates = materials.map((m) => m.prep).filter((p): p is PrepState => p !== null);
  if (prepStates.length > 0) {
    tools = [...tools, ...buildClassroomTools(() => prepStates)];
  }

  // Every prep note the materials have, under one budget across all of them, and
  // the same list under a quarter of it for the "prep-notes-trim" rung.
  //
  // The ordering position is the chapter this turn is heading into, in that
  // material's own page numbers: a retell has no reader parked anywhere, and the
  // combined chapter list the retell walks is not the table the prep run indexed
  // its papers against. It only decides which notes are given up first, and only
  // once the budget bites.
  const focusSlot = chapter ? slotAt(slots, chapter.index) : undefined;
  const prepFocus =
    chapter && focusSlot ? { bookId: focusSlot.bookId, startPage: chapter.startPage } : null;
  const prepNotes: ClassroomNote[] = selectRetellPrepNotes(materials, prepFocus);
  const prepNotesTight: ClassroomNote[] = selectRetellPrepNotes(
    materials,
    prepFocus,
    CLASSROOM_NOTE_BUDGET_TIGHT,
  );

  tools = [
    ...tools,
    ...buildRetellTools({
      chapters,
      record: async (decision: PlanDecision) => {
        const entry = toRetellDecision(slots, decision);
        if (entry) await record(entry);
      },
      readNote: noteFor,
      // Re-projected from the retell as it stands, not from the copy above: the
      // combined numbering is this turn's, but what it is applied to has to be
      // current.
      readPlan: async () => toRetellPlan((await readRetell()) ?? retell, slots),
      onCard: onDecisionCard,
      now,
    }),
  ];

  // The talk's tools, mounted from the first turn (docs/44). They used to wait
  // until every chapter had a decision, which meant the through-line could not be
  // written until seventeen chapters had been dispositioned one at a time. The
  // note is written as the retell goes, so what stops a premature write is the
  // prompt saying the reader has to give a rib first, not a missing tool. The
  // outline is read once here rather than inside composePrompt, which the budget
  // ladder calls several times.
  const talkOutline: TalkOutline | null = await talk.read();
  tools = [
    ...tools,
    ...buildArrangeTools({
      readOutline: () => talk.read(),
      editOutline: (change) => talk.edit(change),
      onCard: onArrangeCard,
      now,
    }),
  ];

  function composePrompt(view: DeskPromptView): string {
    const dropped = view.dropped as ReadonlySet<RetellReductionId>;
    const prepped = dropped.has("prep-notes-trim") ? prepNotesTight : prepNotes;
    let prompt = buildRetellSystemPrompt({
      topicName,
      bookName: materialsLabel(materials),
      // The retell happens away from the reader, so there is no open page to
      // report; the record below is the only "where we are" there is.
      pageLabel: null,
      skeleton,
      marks,
      notes: dropped.has("retell-notes") ? [] : notes,
      prepNotes: prepNotesSection(prepped),
      // Built from the notes this prompt actually carries, so a status line
      // cannot claim a note is below when the rung above took it.
      prepStatus: retellPrepStatus(materials, new Set(prepped.map((n) => n.slug))),
      hasPrepTools: prepStates.length > 0,
      plan,
      talkOutline,
      figureCatalog: dropped.has("figure-catalog") ? "" : figureCatalog,
      hasReadingTools,
      fullMarks: !dropped.has("retell-marks"),
    });
    const lang = languageInstruction(s.aiLanguage);
    if (lang) prompt += "\n\n" + lang;
    // Memory, as one paragraph built by the assembly out of what this item
    // anchors (docs/48). The retell reads the standing statements here for the
    // first time: how this reader wants things explained is as true of a retell
    // as of a lesson.
    if (view.memory) prompt += "\n\n" + view.memory;
    return prompt;
  }

  function composeMessages(dropped: ReadonlySet<string>): RetellTurnMessage[] {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    const tail = history.length > keep ? history.slice(history.length - keep) : history;
    return [{ role: "user" as const, text: RETELL_KICKOFF }, ...tail];
  }

  // Dropping the catalog while a [fig:N] is in play would leave the reference
  // dangling. Composing the prompt to price a block that is not there is a full
  // re-render for nothing.
  const skip = new Set<RetellReductionId>();
  if (composeMessages(new Set()).some((m) => m.text.includes("[fig:"))) skip.add("figure-catalog");
  if (prepNotes.length === 0) skip.add("prep-notes-trim");

  return {
    kind: RETELL_KIND,
    label: materialsLabel(materials),
    tools,
    toolPrompts: [],
    rungs: RETELL_LADDER,
    skip,
    prompt: composePrompt,
    memory: {
      // A retell is several books at once, so nothing here is "this book": what
      // is still open is scoped to one, and there is no one.
      bookId: "",
      observations: topicObservations,
      snapshot: (tight: boolean) => (tight ? observationSnapshotTight : observationSnapshot),
    },
    history: { compose: composeMessages },
  };
}
