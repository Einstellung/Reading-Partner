// What a card gesture in the info conversation actually does (docs/16, docs/17).
//
// One click, several effects, in an order that matters: the confirm card's Add
// mutates the source list, marks the card, tells the AI and — when it was the
// first source — kicks the first briefing; the profile card's Apply writes the
// declared half of the profile and only then decides whether a re-triage can be
// offered; the topic card's Apply mints the topic, files the kept article under
// it and files this conversation with it. All three are sequences over ports
// rather than over the live stores, so
// the rules ("already added is a no-op", "a failed write changes nothing on
// screen") are testable without React and without a filesystem.

import type { SourceDescriptor } from "../sources/descriptor";
import type { ProbeConfirmCardData } from "../sources/source-cards";
import type { TopicProposalCardData } from "../boxes/cards";
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

// --- file what was kept, and this conversation with it ----------------------

export interface TopicProposalPorts {
  // Mint the topic the proposal named. Only reached where the proposal was for
  // a new one; an existing topic is already an id.
  createTopic(name: string): Promise<{ id: string }>;
  // File the kept article under the topic (reading/saved-articles.ts).
  fileArticle(articleId: string, topicId: string): Promise<void>;
  // File this conversation under it, so the next turn's desk and the
  // distillation of what was said both read the topic the reader chose.
  fileThread(threadId: string, topicId: string): void;
  // The shelf reloads: a new topic has to appear on it.
  topicsChanged(): void;
}

export interface TopicApplied {
  // False when nothing was filed — the card was already applied, or a write
  // failed and the sequence stopped.
  ok: boolean;
  // The topic everything went under, once there is one.
  topicId: string | null;
}

/**
 * The topic card's Apply: create the topic where it is new, file the kept
 * article, and file this conversation. Apply is the only write; the tool that
 * drafted the card never saves.
 *
 * A second click on an applied card does nothing — it stays on screen for the
 * rest of the conversation and comes back on reopen, so re-clicking is an
 * ordinary thing to do, and without the guard it would mint a second topic by
 * the same name.
 *
 * A failed write stops the sequence rather than pressing on: filing the
 * conversation under a topic the article did not reach would put the two halves
 * of one gesture in different places. What did land stays landed — a topic
 * created before the article write failed is a topic the reader now has — and
 * pressing Apply again finishes the rest.
 */
export async function applyTopicProposal(
  card: TopicProposalCardData,
  ports: TopicProposalPorts,
): Promise<TopicApplied> {
  if (card.phase === "applied") return { ok: false, topicId: null };
  let topicId: string;
  try {
    topicId = "id" in card.topic ? card.topic.id : (await ports.createTopic(card.topic.newName)).id;
  } catch {
    return { ok: false, topicId: null };
  }
  if (card.articleId) {
    try {
      await ports.fileArticle(card.articleId, topicId);
    } catch {
      return { ok: false, topicId: null };
    }
  }
  ports.fileThread(card.threadId, topicId);
  ports.topicsChanged();
  return { ok: true, topicId };
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
