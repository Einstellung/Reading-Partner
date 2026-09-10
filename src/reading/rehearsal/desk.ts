// The talk on the desk (docs/44, docs/61): the outline being rehearsed, and the
// five tools that write it.
//
// Much smaller than the retell's item because the material is smaller — a retell
// is assembled out of whole books, and this out of the outline and what the
// reader just said to it. There is no figure catalog, no chapter notes and no
// marks: the pass is the evidence, and it arrives in the conversation.
//
// The conversation is anchored on the outline and not on a rehearsal or a pass
// (docs/43, "对话锚在 PPT 上"): one thread spans every pass over this talk, so
// the second time the reader gives it the coach has the first pass and
// everything said about it still in front of it.

import {
  registerDeskItemKind,
  type DeskEnv,
  type DeskItem,
  type DeskItemKind,
} from "../../desk";
import type { Rung } from "../../budget";
import { languageInstruction } from "../../platform/app/settings";
import { HISTORY_KEEP, HISTORY_KEEP_TIGHT } from "../desk";
import { buildArrangeTools, type TalkArrangementCardData, type TalkOutline } from "../talk";
import { buildCoachSystemPrompt } from "./coach";

// The kind name is the palace row's (src/palace/kinds.ts): outline-<id>.json is
// the material, and this is how it is opened.
export const OUTLINE_KIND = "outline";

// What a coach turn gives up when it does not fit the model's context window.
// One rung, and it is the last resort on every other ladder: a pass is tens of
// KB of transcript and several of them add up, but the outline is what every
// reply is about and the instructions are what stop the reply being a rubric,
// so neither can go.
export type CoachReductionId = "history-trim";

export const COACH_LADDER: readonly Rung<CoachReductionId>[] = [
  {
    id: "history-trim",
    price: "messages",
    notice: "earlier passes over this talk were left out to make room",
  },
];

export interface CoachTurnMessage {
  role: "user" | "ai";
  text: string;
}

// How a turn reaches the outline: two calls rather than the outline itself, for
// the same reason the retell's access is (reading/retell/desk.ts) — the tools
// write during the turn, so what they work on has to be the file as it stands.
export interface CoachTalkAccess {
  read(): Promise<TalkOutline | null>;
  edit(change: (outline: TalkOutline) => TalkOutline): Promise<TalkOutline | null>;
}

// What has to be handed over to put a talk on the desk. The settings are the
// turn's rather than this item's and ride in the DeskEnv (src/desk).
export interface OutlineDeskRef {
  // The talk as it was when the turn was assembled, for the prompt. The tools
  // read it again themselves.
  outline: TalkOutline;
  topicName?: string;
  // The conversation so far, oldest first, with the passes in it as the reader's
  // own messages (handoff.ts).
  history: CoachTurnMessage[];
  talk: CoachTalkAccess;
  // Raised when the coach writes to the outline, so the shell can put the card
  // in the conversation. Absent = the write still happens, it just is not shown.
  onCard?(card: TalkArrangementCardData): void;
  now?(): number;
}

const outlineKind: DeskItemKind<OutlineDeskRef> = { kind: OUTLINE_KIND, open: openOutline };

/**
 * Register what a rehearsed talk can put on the desk. Called once at startup by
 * the shell (useShellBootstrap), and by the tests that lay a desk of their own.
 */
export function registerRehearsalDesk(): () => void {
  return registerDeskItemKind(outlineKind);
}

async function openOutline(ref: OutlineDeskRef, env: DeskEnv): Promise<DeskItem | null> {
  const { outline, topicName, history, talk, onCard, now } = ref;
  const s = env.settings;

  // The five that write a talk (reading/talk/tools.ts), the same five the
  // retell arranges with. What comes out of a pass is a change to the outline
  // (docs/44), so the coach has to be able to make one.
  const tools = buildArrangeTools({
    readOutline: () => talk.read(),
    editOutline: (change) => talk.edit(change),
    onCard,
    now,
  });

  function composePrompt(): string {
    let prompt = buildCoachSystemPrompt({ outline, topicName });
    const lang = languageInstruction(s.aiLanguage);
    if (lang) prompt += "\n\n" + lang;
    return prompt;
  }

  function composeMessages(dropped: ReadonlySet<string>): CoachTurnMessage[] {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    return history.length > keep ? history.slice(history.length - keep) : history;
  }

  return {
    kind: OUTLINE_KIND,
    label: outline.name || "The talk",
    tools,
    toolPrompts: [],
    rungs: COACH_LADDER,
    prompt: composePrompt,
    // No anchor: a talk is not a book and has no observations scoped to it. What
    // is known about the reader rides the turn all the same — the soul prints it
    // itself where nothing on the desk anchors it (soul/turn.ts).
    history: { compose: composeMessages },
  };
}
