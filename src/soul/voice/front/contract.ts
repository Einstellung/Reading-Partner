// The front of a voice call (docs/companion/136 "前台接口"): the layer that
// hears the reader, answers in a sentence or two, and hands anything heavier to
// the back through `delegate`. The shapes are 136's; a cascade front
// (cascade.ts) and, later, a hosted full-duplex one both implement VoiceFront.

import type { AgentTool } from "../../../legion/durable/contract";
import type { ConversationEvent } from "../conversation";

/** A result came back or failed; the front says one sentence about it in the next gap. */
export interface FrontNote {
  /** The run's number in the call's list. */
  number: number;
  /** The task in one sentence. */
  task: string;
  outcome: "done" | "failed";
  /** The cover when done, the reason when failed. */
  cover: string;
}

/** How far the reader heard the front before talking over it. */
export interface HeardUpTo {
  turn: number;
  /** Index of the last sentence played, or null when the player could not say. */
  sentence: number | null;
}

/** The audio front's frames and events, past the gate. The cascade front reads only the events. */
export interface GatedAudio {
  subscribe(cb: (event: ConversationEvent) => void): () => void;
}

/** One line of the call as the conversation keeps it. */
export interface CallLine {
  role: "user" | "ai";
  text: string;
  /** Set on a line that is a back result read out word for word. */
  readOut?: string;
  interrupted?: boolean;
}

/** One row of the numbered list (136 "前台的上下文与模型" 3). */
export interface FrontListRow {
  number: number;
  task: string;
  status: "running" | "done" | "failed" | "cancelled";
  progress?: string;
  cover?: string;
}

/** What each turn is assembled from, read fresh every turn. */
export interface FrontContext {
  /** Where the call is held: today's lab headlines, or a book and its chapter. */
  place: string;
  list: FrontListRow[];
  /** The call's own lines, oldest first. */
  lines: CallLine[];
}

export interface FrontCall {
  /** The fixed prefix: duty and place. Kept first for the prompt cache. */
  prompt: string;
  context(): FrontContext;
  tools: AgentTool[];
  audio: GatedAudio;
  record(line: CallLine): void;
}

export interface VoiceFront {
  readonly id: string;
  readonly turnTaking: "local" | "remote";
  readonly speech: "tts" | "native";
  open(call: FrontCall): Promise<void>;
  notify(note: FrontNote): void;
  interrupt(heard: HeardUpTo): void;
  hold(on: boolean): void;
  close(): Promise<void>;
}
