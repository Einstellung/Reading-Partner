// A retell's conversation as a place on the device's durable runtime
// (docs/soul/87, 第二阶段; docs/31): one thread per retell, in the retell's own
// thread file (retell/store.ts), its id the retell's.
//
// Every retell turn is sent after the kickoff line (desk.ts), which is never a
// row of the file; the retell's opening turn sends the kickoff itself as its
// line. A turn resumed after a restart reads the file the same way, and lays
// the retell's desk again from disk: the decisions and the talk outline still
// write, and the cards they raise have nobody to draw them.

import type { Context } from "@earendil-works/chord";
import type { PlaceFactory } from "../../legion/durable/device";
import type { AgentTool } from "../../legion/execute/contract";
import { loadSettings, toReasoning, type Settings } from "../../platform/app/settings";
import { editTalkOutline, talkOutlineForRetell, talkOutlineOfRetell } from "../talk";
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
import { loadMaterials } from "./material";
import { RETELL_KICKOFF } from "./prompt";
import { loadRetell, recordRetellDecision, retellThreadKey } from "./store";
import { buildRetellTurn, type RetellTurnInput } from "./turn";

export const RETELL_PLACE = "retell";

export function retellOrigin(retellId: string): OneThreadOrigin {
  return oneThreadOrigin(RETELL_PLACE, retellId);
}

/** The retell conversation's key in `rp.conversations`. */
export function retellConversationKey(retellId: string): string {
  return oneThreadKey(RETELL_PLACE, retellId);
}

/** The retell turns assembled in this process, by conversation key. */
export const retellAssemblies = new Map<string, AssembledThreadTurn>();

export interface RetellPlaceDeps {
  assembled?: Map<string, AssembledThreadTurn>;
  openDesk?: (retellId: string, context: Context) => Promise<readonly AgentTool[]>;
  watching?: (retellId: string) => boolean;
  card?: (retellId: string, ts: number, text: string) => Promise<void>;
}

/** The card for a retell reply nobody saw: it opens the retell in its topic. */
async function putRetellCard(retellId: string, ts: number, text: string): Promise<void> {
  await putOneThreadCard({ id: retellId, ts, text, origin: { place: "retell", retellId } });
}

async function openRetellDesk(retellId: string): Promise<readonly AgentTool[]> {
  const [settings, loaded] = await Promise.all([loadSettings(), loadRetell(retellId)]);
  if (!loaded) return [];
  let current = loaded;
  const turn = await buildRetellTurn({
    retell: loaded,
    materials: await loadMaterials(loaded.materials),
    topicName: "",
    settings,
    history: [],
    record: async (decision) => {
      const next = await recordRetellDecision(retellId, decision);
      if (next) current = next;
    },
    readRetell: () => current,
    talk: {
      read: () => talkOutlineOfRetell(retellId),
      edit: async (change) => {
        const outline = await talkOutlineForRetell({ topicId: current.topicId, retellId, name: current.name });
        return editTalkOutline(outline.id, change);
      },
    },
  });
  return turn.tools;
}

export function retellPlace(deps: RetellPlaceDeps = {}): PlaceFactory {
  return oneThreadPlace({
    place: RETELL_PLACE,
    fileKey: retellThreadKey,
    surface: "talk",
    assembled: deps.assembled ?? retellAssemblies,
    openDesk: deps.openDesk ?? openRetellDesk,
    // The opening turn's line is the kickoff; every later one is sent after it.
    history: (said, lineInFile) => (lineInFile ? [{ role: "user", text: RETELL_KICKOFF }, ...said] : said),
    ...(deps.watching ? { watching: deps.watching } : {}),
    card: deps.card ?? putRetellCard,
  });
}

/**
 * Assemble a retell turn for the place session. `lineTs` is the reader's line
 * in the file; absent for the opening turn, whose line is the kickoff.
 */
export async function prepareRetellTurn(
  input: RetellTurnInput & { settings: Settings & { defaultProviderId: string; defaultModelId: string }; lineTs?: number },
  deps: { assembled?: Map<string, AssembledThreadTurn>; build?: typeof buildRetellTurn } = {},
): Promise<PlaceAssembled> {
  const { lineTs, ...turnInput } = input;
  const turn = await (deps.build ?? buildRetellTurn)(turnInput);
  const thinkingLevel = toReasoning(input.settings.chatThinking);
  return oneThreadTurn({
    place: RETELL_PLACE,
    id: input.retell.id,
    surface: "talk",
    assembled: deps.assembled ?? retellAssemblies,
    turn,
    ...(lineTs !== undefined ? { lineTs } : {}),
    model: { provider: input.settings.defaultProviderId, modelId: input.settings.defaultModelId },
    ...(thinkingLevel ? { thinkingLevel } : {}),
  });
}
