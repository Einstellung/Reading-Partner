// The device's one voice call as the rest of the app sees it (docs/68, docs/info/671
// 时间线与语音). The corner holds the call (ui/components/companion/use-voice-call.ts);
// three things reach it from elsewhere through here, as a signal rather than
// props through two shells, the way voice-context.ts does:
//
// - a start asked for by a screen or a tool, with the call it wants built
//   (the meals prep call), or the corner's own when none is named;
// - what a screen lays on whatever call is open: lines for the front's place
//   and tools on top of its four, read at every turn. One at a time, the
//   latest wins, and its undo clears only itself;
// - the open call's program voice: a sentence the program built, spoken as it
//   is with no model in between (the front's `say`).

import type { AgentTool } from "../../../legion/durable/contract";
import type { VoiceCall } from "../voice-call";
import type { LiveCallHooks } from "./call";

/** Builds the call a start asks for, wired to the corner's hooks. Null where the device cannot hold one. */
export type CallBuilder = (hooks: LiveCallHooks) => Promise<VoiceCall | null>;

export interface CallHost {
  /** Start a call, built by `build` or the corner's own; nothing when one is already open. */
  start(build?: CallBuilder): void;
}

export interface CallExtra {
  /** Lines for the front's place section; null adds nothing this turn. */
  place(): string | null;
  tools(): readonly AgentTool[];
}

let host: CallHost | null = null;
let extra: CallExtra | null = null;
let speaker: ((text: string) => void) | null = null;
const listeners = new Set<() => void>();

const announce = () => {
  for (const fn of [...listeners]) fn();
};

/** The corner offers to hold calls. Returns the undo. */
export function registerCallHost(next: CallHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

/**
 * Ask for a call. True when a host took the request: a call is open now or on
 * its way (an open one is kept, not replaced). Called inside a tap, so the
 * start rides the gesture.
 */
export function requestCall(build?: CallBuilder): boolean {
  if (!host) return false;
  host.start(build);
  return true;
}

/** Lay `next` on every call while it is attached. Returns the undo. */
export function attachToCall(next: CallExtra): () => void {
  extra = next;
  return () => {
    if (extra === next) extra = null;
  };
}

export function callExtra(): CallExtra | null {
  return extra;
}

/** A live call says it is open and how to speak in it. Returns the undo, which says it closed. */
export function openCall(say: (text: string) => void): () => void {
  speaker = say;
  announce();
  return () => {
    if (speaker !== say) return;
    speaker = null;
    announce();
  };
}

export function callIsOpen(): boolean {
  return speaker !== null;
}

/** Speak the program's sentence in the open call. False when no call is open: the sentence is dropped. */
export function sayInCall(text: string): boolean {
  if (!speaker) return false;
  speaker(text);
  return true;
}

/** Hear a call open or close. Returns the undo. */
export function subscribeCall(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam: the module is a singleton and a test is not. */
export function resetCallHost(): void {
  host = null;
  extra = null;
  speaker = null;
  listeners.clear();
}
