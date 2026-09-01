// What one info conversation is anchored to (docs/16, docs/17): which thread it
// writes to, the system prompt it opens with, and the corner position card that
// recalls what it is about.
//
// Four anchors, one per way in: the briefing, the briefing before there is one,
// an article, and the first-run add-source flow. They are assembled from things
// already read off disk — the profile, the source list, the language setting,
// the briefing itself — so nothing here awaits anything and every anchor is
// decidable from its inputs.

import type { AiLanguage } from "../../platform/app/settings";
import type { Briefing } from "../briefing/types";
import { addSourceSystemPrompt } from "../sources/source-skill";
import {
  articleChatSystemPrompt,
  briefingChatSystemPrompt,
  noBriefingChatSystemPrompt,
  type CompanionContext,
} from "./chat";

export interface InfoCallAnchor {
  // The thread this conversation writes to. Unique across every thread file, not
  // just inside the day's own one: an observation's message anchor is
  // "<threadId>:<ts>" and a distillation cursor is keyed by thread id alone, so
  // both treat it as a global key (docs/pitfall/209). The day is therefore part
  // of the briefing and article ids; "onboarding" is a constant because the
  // add-source flow happens once.
  threadId: string;
  // The chat window's empty-state heading and composer placeholder.
  emptyTitle: string;
  placeholder: string;
  systemPrompt: string;
  // The corner position card: the article/briefing shrunk to a title, an
  // optional source name tag, and a one-line reason/overview.
  position: { title: string; sourceName?: string; line: string | null };
  // The anchor kind. Every mode carries the same tools now; this only tags the
  // add-source flow for readers of the anchor.
  mode?: "chat" | "add-source";
  // First-run onboarding: the AI opens the conversation itself.
  onboarding?: boolean;
}

const BRIEFING_TITLE = "Today's briefing";
const BRIEFING_PLACEHOLDER = "Ask about today's briefing…";

/**
 * The day's briefing thread. One place because two anchors mint it — the
 * briefing and the no-briefing state are one conversation (see below) and would
 * split in two the moment the two spellings drifted apart.
 */
export function briefingThreadId(dateKey: string): string {
  return `briefing-${dateKey}`;
}

/**
 * One article's thread. The item id alone is not enough: the same article can be
 * in two days' briefings, and each day's conversation about it is its own.
 */
export function articleThreadId(dateKey: string, itemId: string): string {
  return `${dateKey}:${itemId}`;
}

/** The briefing-level thread, with the whole document as context. */
export function briefingAnchor(b: Briefing, ctx: CompanionContext): InfoCallAnchor {
  return {
    threadId: briefingThreadId(b.date),
    emptyTitle: BRIEFING_TITLE,
    placeholder: BRIEFING_PLACEHOLDER,
    systemPrompt: briefingChatSystemPrompt(b, ctx),
    position: { title: BRIEFING_TITLE, line: b.overview },
  };
}

/**
 * The same thread told there is no briefing yet (docs/35): the day's collection
 * has not landed, or it failed. It is the same thread id on purpose — the
 * conversation about today's briefing is one conversation whether or not one
 * exists at the moment it is opened. There is no briefing to read the day off,
 * so the caller passes it; it goes through briefingThreadId so the two spellings
 * cannot drift.
 */
export function noBriefingAnchor(
  ctx: CompanionContext,
  opts: { dateKey: string; error?: string | null; notices: string[] },
): InfoCallAnchor {
  return {
    threadId: briefingThreadId(opts.dateKey),
    emptyTitle: BRIEFING_TITLE,
    placeholder: BRIEFING_PLACEHOLDER,
    systemPrompt: noBriefingChatSystemPrompt(ctx, {
      error: opts.error ?? undefined,
      collecting: ctx.collecting,
      notices: opts.notices,
    }),
    position: {
      title: BRIEFING_TITLE,
      line: opts.error ?? opts.notices[0] ?? "Not collected yet",
    },
  };
}

/**
 * The item's one-line reason/overview from the briefing tiers, shown on the
 * position card so the chat window can recall what the article was about.
 *
 * The tiers are searched in the order they are read in: a must-read's reason
 * first, then the one-liner written for an item that got a line and nothing
 * else, then the out-of-lane reason. An item in none of them — a filtered one,
 * or one from another day — has no line, and the card shows none rather than
 * borrowing the briefing's.
 */
export function articleReason(b: Briefing, itemId: string): string | null {
  return (
    b.mustRead.find((r) => r.itemId === itemId)?.reason ??
    b.oneLiners.find((r) => r.itemId === itemId)?.line ??
    b.outOfLane.find((r) => r.itemId === itemId)?.reason ??
    null
  );
}

/**
 * One article's thread. The body text is the context, so the caller reads it
 * first — the article chat only exists where there is an article to talk about
 * (docs/36); with no body the prompt would carry a title and nothing else.
 */
export function articleAnchor(
  b: Briefing,
  itemId: string,
  bodyText: string,
  ctx: CompanionContext,
): InfoCallAnchor {
  const meta = b.items[itemId];
  const title = meta?.title ?? "Article";
  return {
    threadId: articleThreadId(b.date, itemId),
    emptyTitle: title,
    placeholder: "Ask about this article…",
    systemPrompt: articleChatSystemPrompt(b.overview, meta?.title ?? "", bodyText, ctx),
    position: { title, sourceName: meta?.sourceName, line: articleReason(b, itemId) },
  };
}

/** The first-run / add-source chat: the info call in add-source mode. */
export function onboardingAnchor(aiLanguage?: AiLanguage): InfoCallAnchor {
  return {
    threadId: "onboarding",
    mode: "add-source",
    onboarding: true,
    emptyTitle: "Let's set up your sources",
    placeholder: "Tell me what you follow, or paste a link…",
    systemPrompt: addSourceSystemPrompt({ aiLanguage, onboarding: true }),
    position: { title: "Subscriptions", line: "Set up your information sources" },
  };
}
