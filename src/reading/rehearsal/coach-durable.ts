// The talk's coaching conversation as a place on the device's durable runtime
// (docs/soul/87, 第二阶段; docs/44): one thread per outline, in the talk's own
// thread file (reading/talk/store.ts), its id the outline's.
//
// A turn resumed after a restart lays the talk's desk again from the outline
// on disk. The outline tools still write; the cards they raise have nobody to
// draw them, and the row's receipts say what was written.

import type { Context } from "@earendil-works/chord";
import type { AgentTool } from "../../legion/durable/contract";
import { loadSettings, toReasoning, type Settings } from "../../platform/app/settings";
import { editTalkOutline, loadTalkOutline, talkThreadKey } from "../talk";
import {
  oneThreadKey,
  oneThreadOrigin,
  oneThreadPlace,
  oneThreadTurn,
  putOneThreadCard,
  type AssembledThreadTurn,
  type OneThreadOrigin,
} from "../turn/one-thread-place";
import type { PlaceAssembled } from "../turn/place-session";
import type { PlaceFactory } from "../../legion/durable/device";
import { buildCoachTurn, type CoachTurnInput } from "./coach-turn";

export const COACH_PLACE = "talk";

export function coachOrigin(outlineId: string): OneThreadOrigin {
  return oneThreadOrigin(COACH_PLACE, outlineId);
}

/** The coaching conversation's key in `rp.conversations`. */
export function coachConversationKey(outlineId: string): string {
  return oneThreadKey(COACH_PLACE, outlineId);
}

/** The coaching turns assembled in this process, by conversation key. */
export const coachAssemblies = new Map<string, AssembledThreadTurn>();

export interface CoachPlaceDeps {
  assembled?: Map<string, AssembledThreadTurn>;
  openDesk?: (outlineId: string, context: Context) => Promise<readonly AgentTool[]>;
  watching?: (outlineId: string) => boolean;
  card?: (outlineId: string, ts: number, text: string) => Promise<void>;
}

/** The card for a coaching reply nobody saw: it opens the talk's conversation in its topic. */
async function putCoachCard(outlineId: string, ts: number, text: string): Promise<void> {
  await putOneThreadCard({ id: outlineId, ts, text, origin: { place: "talk", outlineId } });
}

async function openCoachDesk(outlineId: string): Promise<readonly AgentTool[]> {
  const [settings, outline] = await Promise.all([loadSettings(), loadTalkOutline(outlineId)]);
  if (!outline) return [];
  const turn = await buildCoachTurn({
    outline,
    settings,
    history: [],
    talk: { read: () => loadTalkOutline(outlineId), edit: (change) => editTalkOutline(outlineId, change) },
  });
  return turn.tools;
}

export function coachPlace(deps: CoachPlaceDeps = {}): PlaceFactory {
  return oneThreadPlace({
    place: COACH_PLACE,
    fileKey: talkThreadKey,
    surface: "talk",
    assembled: deps.assembled ?? coachAssemblies,
    openDesk: deps.openDesk ?? openCoachDesk,
    ...(deps.watching ? { watching: deps.watching } : {}),
    card: deps.card ?? putCoachCard,
  });
}

/**
 * Assemble a coaching turn for the place session. The conversation's last line
 * is the reader's — a pass handed in or a line typed — and it is in the file
 * at `lineTs`.
 */
export async function prepareCoachTurn(
  input: CoachTurnInput & { settings: Settings & { defaultProviderId: string; defaultModelId: string }; lineTs: number },
  deps: { assembled?: Map<string, AssembledThreadTurn>; build?: typeof buildCoachTurn } = {},
): Promise<PlaceAssembled> {
  const { lineTs, ...turnInput } = input;
  const turn = await (deps.build ?? buildCoachTurn)(turnInput);
  const thinkingLevel = toReasoning(input.settings.chatThinking);
  return oneThreadTurn({
    place: COACH_PLACE,
    id: input.outline.id,
    surface: "talk",
    assembled: deps.assembled ?? coachAssemblies,
    turn,
    lineTs,
    model: { provider: input.settings.defaultProviderId, modelId: input.settings.defaultModelId },
    ...(thinkingLevel ? { thinkingLevel } : {}),
  });
}
