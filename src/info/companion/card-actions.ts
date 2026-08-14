// What a card gesture in the info conversation actually does (docs/16, docs/17).
//
// One click, several effects, in an order that matters: the confirm card's Add
// mutates the source list, marks the card, tells the AI and — when it was the
// first source — kicks the first briefing; the profile card's Apply writes the
// declared half of the profile and only then decides whether a re-triage can be
// offered. Both are sequences over ports rather than over the live stores, so
// the rules ("already added is a no-op", "a failed write changes nothing on
// screen") are testable without React and without a filesystem.

import type { SourceDescriptor } from "../sources/descriptor";
import type { ProbeConfirmCardData } from "../sources/source-cards";
import { replaceDeclared } from "../../observation/guess";
import { loadProfileForWrite, saveProfile } from "../../observation/profile";

// --- add a trialed source ---------------------------------------------------

export interface AddSourcePorts {
  // Whether any source is configured, asked BEFORE the add so the answer means
  // "was this the first one".
  hasSources(): Promise<boolean>;
  addSource(descriptor: SourceDescriptor): Promise<void>;
  // Flip `added` on the card, in the conversation and on disk.
  markAdded(): void;
  // The host reloads its source list.
  sourcesChanged(): void;
  // The synthetic turn that tells the AI what the user just did.
  note(): void;
  // The first source there has ever been starts the first briefing.
  startFirstBriefing(): void;
}

/**
 * The confirm card's Add.
 *
 * Re-confirming a card that already says `added` does nothing at all — not the
 * write, not the note, not the briefing kick. The card stays on screen for the
 * rest of the conversation and is restored on reopen, so a second click on it is
 * an ordinary thing for a reader to do; without this guard it would add the
 * source twice and tell the AI twice.
 *
 * A failed add stops the sequence: nothing is marked and nothing is announced,
 * because none of it happened.
 */
export async function addSourceFromCard(
  card: ProbeConfirmCardData,
  ports: AddSourcePorts,
): Promise<void> {
  if (card.added) return;
  let had = true;
  try {
    had = await ports.hasSources();
  } catch {
    // Assume some exist; worst case we skip the first-briefing kick.
  }
  try {
    await ports.addSource(card.descriptor);
  } catch {
    return;
  }
  ports.markAdded();
  ports.sourcesChanged();
  ports.note();
  if (!had) ports.startFirstBriefing();
}

// --- apply a drafted profile change -----------------------------------------

export interface ProfileStore {
  // Throws when the profile could not be read, rather than answering "" — Apply
  // splices the card's declared half into what load returns, so an empty answer
  // to a failed read would write a document with the guess section, and any
  // declared text the card did not carry, gone.
  load(): Promise<string>;
  save(text: string): Promise<void>;
}

export const liveProfileStore: ProfileStore = { load: loadProfileForWrite, save: saveProfile };

/**
 * Whether the applied card may offer a re-triage.
 *
 * A re-triage runs over the day's item snapshot — 683 KB that stays on the
 * collector — so the offer only appears where it can be taken up (docs/36): on
 * the machine that collects, and only once there is a briefing to re-sort. On a
 * reader the way to a new sort is asking for one.
 */
export function canRetriage(ctx: { collecting: boolean; hasBriefing: boolean }): boolean {
  return ctx.collecting && ctx.hasBriefing;
}

export interface ProfileApplied {
  // False when the write failed; the card stays drafted and nothing is said.
  ok: boolean;
  canRetriage: boolean;
}

/**
 * The profile card's Apply. The card carries the declared half only — that is
 * all the drafting model was shown — so the write splices it in and leaves the
 * AI's guess section where it is (observation/guess.ts). Apply is the only
 * write; the tool that drafted the card never saves.
 *
 * A read that failed is a failed Apply, not an Apply onto an empty document: the
 * card stays drafted with the text still in it, and pressing it again once the
 * file reads writes the same thing. Nothing is lost by waiting.
 */
export async function applyProfileUpdate(
  declared: string,
  ctx: { collecting: boolean; hasBriefing: boolean },
  store: ProfileStore = liveProfileStore,
): Promise<ProfileApplied> {
  try {
    await store.save(replaceDeclared(await store.load(), declared));
  } catch {
    return { ok: false, canRetriage: false };
  }
  return { ok: true, canRetriage: canRetriage(ctx) };
}
