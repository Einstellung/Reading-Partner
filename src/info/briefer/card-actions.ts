// What a card gesture in the info conversation actually does (docs/16, docs/17).
//
// One click, several effects, in an order that matters: the confirm card's Add
// mutates the source list, marks the card, tells the AI and — when it was the
// first source — kicks the first briefing; the profile card's Apply writes the
// declared half of the profile and only then decides whether a re-triage can be
// offered; a lab card's Apply opens the room and hands it its sources. They are
// sequences over ports rather than over the live stores, so
// the rules ("already added is a no-op", "a failed write changes nothing on
// screen") are testable without React and without a filesystem.

import type { SourceDescriptor } from "../sources/descriptor";
import type { ProbeConfirmCardData } from "../sources/source-cards";
import type { LabArchiveCardData, LabProposalCardData } from "../boxes/cards";
import { newLabId } from "../labs/labs";
import type { Lab } from "../labs/types";
import { replaceDeclared } from "../../memory/profile/guess";
import { loadProfileForWrite, saveProfile } from "../../memory/profile/profile";

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

// --- open and close a research room -----------------------------------------

export interface LabProposalPorts {
  // Open the room. The Lab is minted here rather than by the tool, so the id and
  // the timestamp belong to the gesture that actually wrote it.
  addLab(lab: Lab): Promise<unknown>;
  // Hand the room its sources. Additive in the store, which is why it is a
  // second call rather than a field on the lab above: claiming a source is its
  // own act, and the room exists whether or not it lands (docs/63).
  claimSources(labId: string, sourceIds: string[]): Promise<unknown>;
  // The reader's sources as they are NOW. A card sits in the conversation for
  // the rest of the day, and a source removed since it was drafted must not be
  // claimed.
  listSources(): Promise<SourceDescriptor[]>;
  now(): number;
  // Pinned by a test so the minted id is an equality assertion rather than a
  // regex; production passes nothing.
  random?: () => number;
  // The host reloads whatever shows the roster.
  labsChanged(): void;
}

export interface LabApplied {
  // False when nothing was opened — the card was already applied, or the write
  // failed and the sequence stopped.
  ok: boolean;
  labId: string | null;
}

/**
 * The lab card's Apply: open the room, then hand it the sources its charter
 * claimed. Apply is the only write; the tool that drafted the card never saves.
 *
 * A second click on an applied card does nothing, for the reason every other
 * card here has the guard: it stays on screen for the rest of the conversation
 * and comes back on reopen, and without it a second click would open a second
 * room under a second id with the same name.
 *
 * A failed claim does NOT undo the room or fail the Apply. The room is what the
 * reader asked for and it is open; a source it did not manage to claim is a
 * source no room has claimed, and labsForSource offers those to every open room
 * anyway — so the failure costs nothing the next sentence cannot fix.
 */
export async function applyLabProposal(
  card: LabProposalCardData,
  ports: LabProposalPorts,
): Promise<LabApplied> {
  if (card.phase === "applied") return { ok: false, labId: null };
  const labId = newLabId(ports.random);
  const lab: Lab = {
    id: labId,
    name: card.name,
    // Only rooms are opened this release; a study comes later (docs/63 三档渐变).
    kind: "lab",
    status: "active",
    charter: {
      scope: card.scope,
      questions: card.questions,
      // Where this room's drafts would file. Unused this release.
      topicId: null,
    },
    sources: [],
    createdAt: ports.now(),
  };
  try {
    await ports.addLab(lab);
  } catch {
    return { ok: false, labId: null };
  }
  if (card.sources.length) {
    try {
      const live = new Set((await ports.listSources()).map((s) => s.id));
      const claimed = card.sources.filter((id) => live.has(id));
      if (claimed.length) await ports.claimSources(labId, claimed);
    } catch {
      // The room stands; see above.
    }
  }
  ports.labsChanged();
  return { ok: true, labId };
}

export interface LabArchivePorts {
  archiveLab(labId: string, now: number): Promise<unknown>;
  now(): number;
  labsChanged(): void;
}

/**
 * The archive card's Apply. The record stays on disk — its picture and the
 * cables it filed still name the id — so this only closes the room.
 */
export async function applyLabArchive(
  card: LabArchiveCardData,
  ports: LabArchivePorts,
): Promise<LabApplied> {
  if (card.phase === "applied") return { ok: false, labId: null };
  try {
    await ports.archiveLab(card.labId, ports.now());
  } catch {
    return { ok: false, labId: null };
  }
  ports.labsChanged();
  return { ok: true, labId: card.labId };
}

/**
 * The profile card's Apply. The card carries the declared half only — that is
 * all the drafting model was shown — so the write splices it in and leaves the
 * AI's guess section where it is (memory/profile/guess.ts). Apply is the only
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
