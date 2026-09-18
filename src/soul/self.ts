// What the soul carries into every turn, whatever lies on the desk (docs/48,
// docs/61): what is known about the reader, and the tools that write it down.
// It is about the reader and not about the material — the same statements pitch
// an explanation of a book, of a briefing, of a talk being rehearsed.
//
// Kept apart from turn.ts so that "what the soul contributes" can be read
// without reading how a call is fitted to a window.

import {
  OBSERVATION_WRITE_TOOL,
  assembleStatements,
  buildObservationTools,
  buildStatementTools,
  getObservationAdapter,
  latestReaderMessage,
  listOtherTopicObservations,
  filingTools,
  memorySection,
  memorySectionWithIds,
  notifyObservationChange,
  statementStore,
  type MemorySectionInput,
  type Statement,
  type TopicProposalSurface,
} from "../memory";
import { buildConversationTools } from "../conversations";
import { buildCatalogueTools, type CatalogueIo } from "./catalogue";
import { buildPlaceTools } from "./places";
import { roleOf } from "./roles";
import type { DeskEnv, DeskMemory } from "../desk";
import { getThread } from "../platform/app/threads";
import type { AgentTool } from "../legion/execute/turn";
import { UNSEEN, appBox, type BoxOrigin, type BoxStore } from "../box";
import { buildDelegateTools } from "./delegate";
import { originLabel, parseOrigin } from "./delivery";
import { appRunner } from "../legion/execute/runner";
import type { Run } from "../legion/run";
import { appData } from "../platform/app/appdata";

export interface Soul {
  // statement_write, the conversation tools, the catalogue tools, the
  // observation tools — all three where there is a topic to file a new one
  // under, the two that only read where there is not — and propose_topic
  // wherever the conversation is filed under no topic and the caller can draw
  // the card the proposal ends in. Last of all go_to, wherever a shell has
  // registered places to take the reader to.
  tools: AgentTool[];
  // Every statement there is. Which of them ride the prompt is the ladder's
  // call, one pass at a time, so they are read once and filtered per pass.
  statements: readonly Statement[];
  // Whether this turn has a topic to file an observation under. It decides
  // whether the memory paragraph explains the observation tools: that paragraph
  // is written around observation_update, and a turn that cannot write one would
  // be told how to use a tool it was not given.
  writesObservations: boolean;
  // What the capabilities the soul mounted publish into the system prompt —
  // today the topic roster filing prints beside propose_topic, and nothing else.
  // Empty where nothing was mounted. The soul says nothing in its own name: it
  // belongs to no topic and to no material, so it has no paragraph of its own.
  // It belongs to no item on the desk either, so the assembly prints it
  // (turn.ts).
  prompt: string;
  // The role this turn was assembled with (roles.ts), with the tools it brought
  // already among `tools`. Null where no role was loaded: the door, a book, a
  // legion errand. It is kept whole so the assembly can print the duty ahead of
  // the desk, and name the role when one of its tools collides with an item's.
  role: LoadedRole | null;
}

/** How many unopened items the soul is told about. Beyond ten it is a list, not a reminder. */
export const BOX_COVER_CAP = 10;

/** What the soul is told about the box it has not been through (docs/68). */
export interface SoulExtras {
  // Where this turn is being held. It fills a delegated run's deliverTo, so the
  // answer comes back to the place the question was asked.
  origin?: BoxOrigin;
  // The Red Box. The device's own unless a test hands one in.
  box?: BoxStore;
  // Every run this device knows of. The runner's own unless a test hands one in.
  runs?: () => Promise<readonly Run[]>;
  // The brief behind a run, by the path the run carries. AppData unless injected.
  readBrief?: (path: string) => Promise<string>;
}

/** A role as one turn holds it: what it is, and the tools it built for that turn. */
export interface LoadedRole {
  id: string;
  duty: string;
  tools: readonly AgentTool[];
}

/**
 * Read what the soul brings to this turn: the tools it mounts and the
 * statements it may print.
 *
 * The soul is under no topic. A topic is where data is filed, so what decides
 * the scope of a write is the material: `anchor` is the memory of the item that
 * anchors the retrieval, and the topic it lies under is the topic an observation
 * written this turn goes to. Failing that, the topic this conversation was filed
 * under. Failing both, memory still rides — recall reaches every topic — and
 * only the write tool stays behind, because there is nowhere to put what it
 * would write.
 *
 * `filing` is where a proposal for this conversation's topic would be drawn; a
 * caller that has nowhere to draw one is offered no way to propose.
 *
 * `role` names what this soul is here to do (roles.ts). A duty and a tool list
 * is all a role adds; everything above rides whether one is loaded or not.
 */
export async function openSoul(
  env: DeskEnv,
  anchor: DeskMemory | undefined,
  filing?: TopicProposalSurface,
  catalogueIo?: CatalogueIo,
  role?: string,
  extra: SoulExtras = {},
): Promise<Soul> {
  const thread = getThread(env.thread.key, env.thread.id);
  const messages = thread?.messages ?? [];
  // What this conversation is filed under, read per turn rather than when it
  // opened: filing is a gesture made mid-conversation, and the turn right after
  // it is the one that has to read the new topic's memory.
  const filedTopic = thread?.topicId ?? null;
  // The topic this turn's writes are filed under: the material's first, since an
  // observation is about what is being read, and the conversation's own where
  // nothing on the desk carries one.
  const scope = anchor?.topicId ?? filedTopic;
  // What the reader says about themselves, in their words (docs/48): evidenced
  // by the message they just sent, which the caller appended before assembling
  // this.
  //
  // What this person is here to do comes first: the role's tools ahead of the
  // ones the soul carries whatever it is doing. The order means nothing to the
  // model (turn.ts says why); it is the order a reader of the list expects.
  const tools: AgentTool[] = [];
  let loaded: LoadedRole | null = null;
  if (role) {
    const found = roleOf(role);
    const mounted = [...found.tools(env)];
    tools.push(...mounted);
    loaded = { id: found.id, duty: found.duty, tools: mounted };
  }
  tools.push(
    ...buildStatementTools({
      store: statementStore,
      message: latestReaderMessage(messages),
      threadId: env.thread.id,
    }),
  );
  // Its own past conversations, on every desk and whether or not a topic is
  // settled (src/conversations): what was said is the reader's, the same way
  // the statements are, and the desk it was said over is only where to look
  // first.
  tools.push(...buildConversationTools({ topicId: scope }));
  // And what the reader has, kind by kind (catalogue.ts): which books are on the
  // shelf, which topics they keep, what was kept from a briefing. The palace is
  // the same wherever the turn is held, so this rides every desk too.
  tools.push(...buildCatalogueTools(catalogueIo));
  // The one way work is handed off (docs/68). Beside the catalogue because the
  // judgement it exists for is the soul's wherever it is sitting: this is more
  // than a moment's work, so somebody else does it and the answer comes back to
  // where it was asked. The origin is filled in here and never by the model.
  tools.push(...buildDelegateTools(extra.origin === undefined ? {} : { origin: extra.origin }));
  // Nothing has said what this conversation is about, so the offer to say it
  // rides the turn (docs/21, memory/filing). Only where the caller can draw the
  // card, though — the tool writes nothing, the card is its whole effect, and
  // mounting it on a surface with nowhere to draw one leaves the model telling
  // the reader to confirm a card that was never shown.
  let prompt = "";
  if (filing) {
    const mounted = await filingTools({ ...filing, threadId: env.thread.id, filedTopic });
    tools.push(...mounted.tools);
    prompt = mounted.prompt;
  }
  // What is known about the reader rides every turn, because it is about the
  // reader and not about what they are reading. With no topic to file under, the
  // write tool is the one thing that cannot ride: recall still reaches every
  // topic the reader has, and a write would have nowhere to land.
  const observation = buildObservationTools(getObservationAdapter(scope ?? ""), {
    bookId: anchor?.bookId ?? "",
    // The reader keeps one book as a standing frame while reading another,
    // and a search scoped to the topic in hand cannot see it
    // (memory/observations/recall.ts). With no topic in hand at all, this is
    // every topic there is.
    otherTopics: () => listOtherTopicObservations(scope ?? ""),
    ...(scope ? { onWrite: () => notifyObservationChange(scope) } : {}),
  });
  tools.push(...(scope ? observation : observation.filter((t) => t.name !== OBSERVATION_WRITE_TOOL)));
  // Where the reader can be taken (docs/71). Last, because it is the one tool
  // that is about the app rather than about the reader or the material, and
  // absent wherever no shell has registered a place — a legion errand has
  // nobody to take anywhere.
  tools.push(...buildPlaceTools());
  // What is waiting in the box, one line each (docs/68). Covers only: a line
  // says something came back and where it came from, and reading it is the
  // reader opening the item, not the soul quoting it into every turn. A box
  // nobody has put anything in adds nothing at all, so a fresh install's call
  // is byte for byte what it was (docs/09).
  const covers = await openCovers(extra.box ?? appBox());
  if (covers) prompt = prompt === "" ? covers : `${prompt}\n\n${covers}`;
  // What this conversation has already sent away and is still waiting on
  // (docs/72). Beside the box because it is the other half of the same fact:
  // one is what came back, the other is what has not. Same rule as the box —
  // nothing to say adds not one byte.
  const runs = await openRuns(env.thread.id, anchor?.bookId, extra);
  if (runs) prompt = prompt === "" ? runs : `${prompt}\n\n${runs}`;
  return {
    tools,
    statements: await assembleStatements(),
    prompt,
    role: loaded,
    writesObservations: scope !== null,
  };
}

/**
 * The memory paragraph for one pass of the ladder: three blocks in a fixed
 * order (memory/live/memory-section.ts).
 *
 * The standing statements do not wait for an anchor. They are about the reader
 * and not about the material (docs/48), so they ride a turn with a book on the
 * desk, a turn with a briefing on it, and a turn with nothing on it at all. What
 * an anchor decides is the two blocks that are about material: what is still
 * open in this book, and the observations retrieval brought back.
 */
export function soulMemorySection(
  soul: Soul,
  anchor: DeskMemory | undefined,
  dropped: ReadonlySet<string>,
): string {
  return memorySection(sectionInput(soul, anchor, dropped));
}

/**
 * The statement and observation ids this pass prints — what the turn put in
 * front of the reader, for the usage log (docs/48). Composed the same way the
 * paragraph above is, from the same pass's dropped set: a pass that gave up the
 * statements shows none of them.
 */
export function soulShownIds(
  soul: Soul,
  anchor: DeskMemory | undefined,
  dropped: ReadonlySet<string>,
): readonly string[] {
  return memorySectionWithIds(sectionInput(soul, anchor, dropped)).shown;
}

function sectionInput(
  soul: Soul,
  anchor: DeskMemory | undefined,
  dropped: ReadonlySet<string>,
): MemorySectionInput {
  return {
    statements: dropped.has("reader-statements") ? [] : soul.statements,
    ...(anchor
      ? {
          anchor: {
            observations: anchor.observations,
            bookId: anchor.bookId,
            observationSnapshot: anchor.snapshot(dropped.has("observation-trim")),
          },
        }
      : {}),
    hasObservationTools: soul.writesObservations,
  };
}

// The items the reader has not got to, as the soul reads them: one they have
// already jumped to is `told` and wants no announcing. A store that will not
// answer is a soul with an empty box — a turn the reader is waiting on is not
// the place to raise a disk problem.
async function openCovers(box: BoxStore): Promise<string> {
  const items = await box.open(UNSEEN).catch(() => []);
  const lines = items
    .slice(0, BOX_COVER_CAP)
    .map((item) => `[box] ${item.cover} — ${originLabel(item.origin)}`);
  if (lines.length === 0) return "";
  return [
    "Waiting in the box, not yet opened by the reader. Mention one only where it bears on",
    "what is being said; they are not a list to read out.",
    ...lines,
  ].join("\n");
}

/** How many runs the soul is told about. Beyond this it is a list, not a reminder. */
export const OPEN_RUN_CAP = 10;

/**
 * The runs this conversation sent off and is still waiting on. A run is this
 * conversation's when it was delivered back to this thread; a turn held with no
 * thread of its own falls back to the book, which is what a bell rung against a
 * whole book delivers into.
 */
export function runsForHere(
  runs: readonly Run[],
  threadId: string,
  bookId?: string,
): Run[] {
  const here = runs.filter((run) => {
    if (run.state !== "pending" && run.state !== "running") return false;
    const origin = parseOrigin(run.deliverTo);
    if (!origin || origin.place !== "book") return false;
    return threadId ? origin.threadId === threadId : !!bookId && origin.bookId === bookId;
  });
  return here.sort((a, b) => a.createdAt - b.createdAt).slice(0, OPEN_RUN_CAP);
}

/** How long ago something was set going, in the words a person would use. */
function sentAgo(at: number, now: number): string {
  const mins = Math.floor(Math.max(0, now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The first line of a brief, which is the sentence it opens with. */
function briefLine(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

// What is still out, as the soul reads it (docs/72). The run record is the whole
// of it: what kind of work, what it was asked, how long it has been gone, and
// the one line the worker last wrote about itself. A conversation that has sent
// nothing away adds nothing at all, so a turn with no runs behind it is byte for
// byte what it was.
export async function openRuns(threadId: string, bookId: string | undefined, extra: SoulExtras): Promise<string> {
  const list = extra.runs ?? (() => appRunner().list());
  const read = extra.readBrief ?? ((path: string) => appData.readText(path));
  const runs = await list().catch(() => [] as Run[]);
  const mine = runsForHere(runs, threadId, bookId);
  if (mine.length === 0) return "";
  const now = Date.now();
  const lines: string[] = [];
  for (const run of mine) {
    const asked = await read(run.brief).then(briefLine).catch(() => "");
    const parts = [`[out] ${run.kind.replace(/[-_]/g, " ")}`];
    if (asked) parts.push(asked);
    parts.push(`sent ${sentAgo(run.startedAt ?? run.createdAt, now)}`);
    if (run.progress) parts.push(run.progress);
    lines.push(parts.join(" — "));
  }
  return [
    "Work this conversation has already handed off and is still waiting on. Each one answers",
    "here when it is done. Do not do its job over, and do not offer a second time what one of",
    "these is already doing.",
    ...lines,
  ].join("\n");
}
