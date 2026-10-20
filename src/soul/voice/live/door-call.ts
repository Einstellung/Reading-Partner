// A voice call held at the door (docs/68): what the waveform button starts on
// every screen that has not published something to talk about
// (ui/components/lumen/voice-context.ts). The call is the door conversation in
// another modality: the day's one conversation at the door is its thread, its
// lines are written there and nowhere else, and a run it hands off is answered
// at the door (soul/think kind.ts gives that run the door's read tools).
//
// The day is fixed when the call starts. A call that runs past midnight keeps
// writing to the day it started on.
//
// Hanging up starts nothing, the same as closing the door's text conversation
// (use-door-chat.ts): no distillation pass is tied to either.

import { doorKey, openDoorThread } from "../../door";
import type { VoiceCall } from "../voice-call";
import { createLiveCall, type LiveCallHooks, type LiveCallSpec } from "./call";
import type { CallThread } from "./call-transcript";

export interface DoorCallOptions extends LiveCallHooks {
  /** The day at the door the call is held in (soul/door.ts doorDate). */
  date: string;
  /** Whether the reader has a book open behind the corner. */
  inReader?: boolean;
}

/** What the front is told about where the call is held. */
export function doorCallPlace(opts: { inReader?: boolean }): string {
  const lines = ["At the door: today's conversation with the reader. Nothing is laid out for this call."];
  if (opts.inReader) lines.push("They have a book open in the reader.");
  return lines.join("\n");
}

/** The one thread a door call writes to: the day's conversation at the door. */
export function doorCallThreads(date: string, threadId: string): CallThread[] {
  return [{ key: doorKey(date), threadId }];
}

/** Everything a door call is, given how to open the day's conversation. */
export function doorCallSpec(
  opts: DoorCallOptions,
  openThread: (date: string) => Promise<{ id: string }> = openDoorThread,
): LiveCallSpec {
  return {
    contextualStrings: [],
    place: doorCallPlace(opts),
    deliverTo: { place: "door", date: opts.date },
    threads: async () => doorCallThreads(opts.date, (await openThread(opts.date)).id),
    ...(opts.onShow ? { onShow: opts.onShow } : {}),
    ...(opts.onRunning ? { onRunning: opts.onRunning } : {}),
  };
}

/** The door's call, wired to the device. Null where there is no plugin to hold one. */
export function createDoorVoiceCall(opts: DoorCallOptions): Promise<VoiceCall | null> {
  return createLiveCall(doorCallSpec(opts));
}
