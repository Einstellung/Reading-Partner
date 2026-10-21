// A voice call held at the door (docs/68): what the waveform button starts on
// every screen that has not published something to talk about
// (ui/components/companion/voice-context.ts). The call is the door conversation in
// another modality: the day's one conversation at the door is its thread, its
// lines are written there and nowhere else, and a run it hands off is answered
// at the door (soul/think kind.ts gives that run the door's read tools).
//
// With a brief open in the reader the call is about it, as the door's text
// conversation is (docs/info/88 「简报的对话」): the screen hands in a provider
// (door-material.ts), the front's place says which brief, where the reader is
// in it and what is in it, read again each turn, and a think run delivered to
// the door lays the brief on its desk (reading/turn/door-think.ts).
//
// The day is fixed when the call starts. A call that runs past midnight keeps
// writing to the day it started on.
//
// Hanging up starts nothing, the same as closing the door's text conversation
// (use-door-chat.ts): no distillation pass is tied to either.

import { aiLanguageName } from "../../../platform/app/settings";
import { doorKey, openDoorThread } from "../../door";
import type { VoiceCall } from "../voice-call";
import { createLiveCall, type LiveCallHooks, type LiveCallSpec } from "./call";
import type { CallThread } from "./call-transcript";
import { holdDoorMaterial, type DoorCallMaterial } from "./door-material";

export interface DoorCallOptions extends LiveCallHooks {
  /** The day at the door the call is held in (soul/door.ts doorDate). */
  date: string;
  /** Whether the reader has a book open behind the corner. */
  inReader?: boolean;
  /** What the reader has open beside the call: the brief in the reader. */
  material?: DoorCallMaterial;
}

const AT_DOOR = "At the door: today's conversation with the reader.";

/**
 * What the front is told about where the call is held. `material` is the
 * provider's lines for this turn; "" or absent when nothing is open.
 */
export function doorCallPlace(opts: { inReader?: boolean }, material = ""): string {
  if (material) return `${AT_DOOR}\n${material}`;
  const lines = [`${AT_DOOR} Nothing is laid out for this call.`];
  if (opts.inReader) lines.push("They have a book open in the reader.");
  return lines.join("\n");
}

// The opening line when the call starts with a brief open. The companion opened the
// brief in the text conversation already (info/issue/opening.ts), so the call
// greets and asks instead of summing it up again.
const BRIEF_OPENING =
  "(The user just opened the voice call with the brief open in the reader — you are speaking aloud, so keep it short. " +
  "Greet them and ask what in the brief they want to talk about. Do not sum the brief up and do not list its items.";

/** The opening note for a call started with a brief open, in the recogniser's language. */
export function doorBriefKickoff(locale: string): string {
  const language = aiLanguageName(locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en");
  return `${BRIEF_OPENING} Say it in ${language}.)`;
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
  const material = opts.material;
  return {
    contextualStrings: [],
    place: material ? async () => doorCallPlace(opts, await material.place()) : doorCallPlace(opts),
    ...(material?.opened() ? { kickoff: doorBriefKickoff } : {}),
    deliverTo: { place: "door", date: opts.date },
    threads: async () => doorCallThreads(opts.date, (await openThread(opts.date)).id),
    ...(opts.onShow ? { onShow: opts.onShow } : {}),
    ...(opts.onRunning ? { onRunning: opts.onRunning } : {}),
  };
}

/**
 * The call holding the slot a think run reads its material from
 * (door-material.ts): taken when the call starts, given up when it stops or
 * fails to start.
 */
export function holdingMaterial(call: VoiceCall, material: DoorCallMaterial | null): VoiceCall {
  let release: (() => void) | null = null;
  const give = () => {
    release?.();
    release = null;
  };
  return {
    ...call,
    async start(): Promise<void> {
      give();
      release = holdDoorMaterial(material);
      try {
        await call.start();
      } catch (e) {
        give();
        throw e;
      }
    },
    async stop(): Promise<void> {
      give();
      await call.stop();
    },
  };
}

/** The door's call, wired to the device. Null where there is no plugin to hold one. */
export async function createDoorVoiceCall(opts: DoorCallOptions): Promise<VoiceCall | null> {
  const call = await createLiveCall(doorCallSpec(opts));
  return call ? holdingMaterial(call, opts.material ?? null) : null;
}
