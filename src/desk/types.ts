// What can lie on the desk, and what one thing on it hands to a turn (docs/61).
//
// A desk item is one piece of material the reader has put in front of the AI: a
// book, an article they kept, a briefing, a talk being rehearsed. It is not the
// AI and it is not a mode — the same assembly runs over whatever is lying there
// (soul), and an item only says what its own material contributes:
// tools, a paragraph of prompt, the conversation it carries, the retrieval it
// anchors.
//
// Types only. The registry is in registry.ts, and every domain that has
// something to put on the desk registers an opener for it at startup.

import type { AgentTool } from "../ai/agent";
import type { Rung } from "../budget";
import type { Observation } from "../memory";
import type { Settings } from "../platform/app/settings";

// A message of the conversation, in the shape the send path takes
// (ai/providers.ts: ChatMessage). Repeated here rather than imported so that an
// item can be described without the send path's vocabulary; the two are checked
// against each other where the assembly hands them over.
export interface DeskMessage {
  role: "user" | "ai";
  text: string;
  images?: { data: string; mediaType: string }[];
}

/** What to put on the desk: a registered kind, and the material to open. */
export interface DeskRef<K extends string = string, R = unknown> {
  kind: K;
  ref: R;
}

// What is true of the turn rather than of any one item: who is being talked to,
// with what settings, in which conversation. Every opener gets the same one.
// A topic is not here on purpose. It is where data is filed — which topic a book
// is listed under, which topic an observation is written to — and an item that
// has one knows it off its own material (DeskMemory.topicId). The soul that sits
// at this desk is under no topic at all (docs/61).
export interface DeskEnv {
  settings: Settings;
  // Where the conversation is stored: the thread file's key
  // (threads-<key>.json) and the thread's own id.
  thread: { key: string; id: string };
  // Dropped when the reader has moved on. An opener that reads from disk should
  // check it and answer null.
  signal?: AbortSignal;
}

// What an item's prompt is written against. `dropped` is the budget ladder's
// verdict for this pass; the rest is what the item could not know on its own,
// because it belongs to the whole desk.
export interface DeskPromptView {
  dropped: ReadonlySet<string>;
  // The memory paragraph the assembly built (docs/48), handed to the one item
  // that anchors the retrieval and to no other. Empty for every other item.
  memory: string;
  // Every tool mounted this turn, the soul's included: an item that renders a
  // frame naming the tools has to name all of them.
  toolNames: readonly string[];
  // The paragraphs the other items' tools brought, in desk order. An item that
  // renders the frame splices them in where tool paragraphs go; an item that
  // renders no frame publishes its own here and writes nothing itself.
  toolPrompts: readonly string[];
}

// The retrieval an item anchors (docs/48). At most one item on a desk may carry
// it: the memory paragraph is about the reader, not about the material, and two
// copies of it in one prompt would be two copies of the same claims.
export interface DeskMemory {
  // What "still open" is scoped to. Empty when the item is not a book.
  bookId: string;
  // The topic this material is filed under: the topic a book is listed in, the
  // topic a conversation was filed under. It is what an observation written this
  // turn is filed under and where recall starts. Null for material under no
  // topic, and then the turn reads every topic and writes to none.
  topicId: string | null;
  // The topic's observations, whole — deciding what is still open reads bodies.
  observations: readonly Observation[];
  // The retrieved lines for this turn, tight when the ladder asked for less.
  snapshot(tight: boolean): string;
}

// The conversation this item carries. At most one item on a desk may carry it:
// a turn replays one history.
export interface DeskHistory {
  // The replayed messages, as a function of what the ladder gave up — the trim
  // itself is a rung, so the item does its own trimming rather than handing
  // over a list and a number.
  compose(dropped: ReadonlySet<string>): DeskMessage[];
}

export interface DeskItem {
  kind: string;
  // What this item is, for a line the reader might be shown. Not prompt text.
  label: string;
  tools: AgentTool[];
  // See DeskPromptView.toolPrompts.
  toolPrompts: readonly string[];
  // What this item can give up when the window is tight, cheapest first
  // (src/budget). Read from the item that carries the history, which is the one
  // whose material the turn is mostly made of.
  rungs: readonly Rung<string>[];
  // Rungs this turn has nothing to gain from pricing.
  skip?: ReadonlySet<string>;
  // This item's whole contribution to the system prompt. Empty for an item that
  // only brings tools.
  prompt(view: DeskPromptView): string;
  memory?: DeskMemory;
  history?: DeskHistory;
  // Handed back to the caller untouched: what the domain wants to know about
  // its own item after the turn was assembled.
  report?: Record<string, unknown>;
  // Called once the call has been fitted, with what the ladder gave up. For the
  // instrumentation an item can only write after the fact — whether the pictures
  // it planned actually went.
  afterFit?(dropped: ReadonlySet<string>): void;
  // Called when the reader confirms a topic for this conversation (docs/21).
  // Filing the conversation is memory's, not the soul's; what else follows from
  // the topic being settled is the item's own — the info article files its kept
  // copy under it. Not called on the turn that laid the desk: the proposal is a
  // card the reader confirms later, and the host hands the hooks to the Apply
  // (memory/filing/settle.ts).
  onTopicSettled?(topicId: string): Promise<void>;
}

// How a domain opens one of its own kinds. Registered at startup, keyed by the
// kind name (a palace kind wherever the material is something the app keeps).
export interface DeskItemKind<R = unknown> {
  kind: string;
  // Null when there is nothing to put on the desk after all: the material is
  // not there, the gate it sits behind is shut, or the turn was abandoned.
  open(ref: R, env: DeskEnv): Promise<DeskItem | null>;
}
