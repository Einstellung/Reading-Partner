// The tools a think run handed off from a call at the door gets
// (docs/companion/136, docs/68): the door conversation's own desk, reads only.
// The soul's set as a door turn lays it — its past conversations, the
// catalogue, the observations it recalls — plus the reads the door mounts
// beside it (ui/components/lumen/door-tools.ts): web_search with read_page,
// and background_status. The door's card-raising tools need a conversation on
// screen and are writes; soul/think kind.ts drops every write anyway.
//
// While the door call that handed the run off has a brief open beside it
// (docs/info/88 「简报的对话」), the run lays the brief on its desk the way the
// door's text turn does: the issue item's reads (read_pages, search_topic,
// read_supplement), its prompt, and the note on where the reader is. The brief
// is the one open when the run starts (soul/voice/live/door-material.ts).

import type { BoxOrigin } from "../../box";
import { openDesk, type DeskEnv, type DeskItem, type DeskRef } from "../../desk";
import type { AgentTool } from "../../legion/durable/contract";
import { liveBackgroundStatusTool } from "../../legion/status/live";
import { loadSettings, type Settings } from "../../platform/app/settings";
import { doorKey, openDoorThread, openDoorTurn, type AssembledTurn, type DoorTurnInput } from "../../soul";
import { registerThinkDesk, type ThinkDesk, type ThinkDeskLaid } from "../../soul/think";
import { liveDoorMaterial, type DoorCallMaterial } from "../../soul/voice/live/door-material";
import { buildReadPageTool } from "../../info/sources/read-page-tool";
import { liveWebSearchTools } from "../../websearch/tool";
import { infoFetch } from "../../workshop/extract/http";

/** The reads the door mounts beside the soul's set, built the way door-tools.ts builds them. */
export function doorReadTools(settings: Settings, threadId: string): AgentTool[] {
  const search = liveWebSearchTools(settings, { caller: "door", sessionId: threadId });
  return [
    ...search,
    ...(search.length ? [buildReadPageTool({ fetchFn: infoFetch })] : []),
    liveBackgroundStatusTool(),
  ];
}

export interface DoorThinkDeskDeps {
  settings(): Promise<Settings>;
  /** The day's conversation at the door (soul/door.ts openDoorThread). */
  openThread(date: string): Promise<{ id: string }>;
  openTurn(input: DoorTurnInput): Promise<AssembledTurn | null>;
  surfaceTools(settings: Settings, threadId: string): AgentTool[];
  /** What the door call that is live has open beside it (soul/voice/live/door-material.ts). */
  material(): DoorCallMaterial | null;
  /** Open the material's desk items. */
  openItems(refs: readonly DeskRef[], env: DeskEnv): Promise<DeskItem[]>;
}

const appDeps: DoorThinkDeskDeps = {
  settings: loadSettings,
  openThread: (date) => openDoorThread(date),
  openTurn: openDoorTurn,
  surfaceTools: doorReadTools,
  material: liveDoorMaterial,
  openItems: async (refs, env) => (await openDesk(refs, env)).items,
};

/** The desk of the day at the door, laid the way a door turn lays it, with the brief beside it when one is open. */
export async function doorThinkDesk(
  origin: BoxOrigin,
  deps: DoorThinkDeskDeps = appDeps,
): Promise<AgentTool[] | ThinkDeskLaid> {
  if (origin.place !== "door") return [];
  const settings = await deps.settings();
  const thread = await deps.openThread(origin.date);
  const surface = deps.surfaceTools(settings, thread.id);
  const turn = await deps.openTurn({
    settings,
    threadId: thread.id,
    date: origin.date,
    messages: [{ role: "user", text: "" }],
    tools: surface,
  });
  const tools = turn?.tools ?? surface;
  const laid = await deps.material()?.desk();
  if (!laid || laid.desk.length === 0) return tools;
  const items = await deps.openItems(laid.desk, { settings, thread: { key: doorKey(origin.date), id: thread.id } });
  const all = [...tools, ...items.flatMap((item) => item.tools)];
  const view = { dropped: new Set<string>(), memory: "", toolNames: all.map((t) => t.name), toolPrompts: [] };
  const prompt = [...items.flatMap((item) => [item.prompt(view), ...item.toolPrompts]), laid.note.trim()];
  return { tools: all, prompt: prompt.filter((part) => part !== "").join("\n\n") };
}

/** Say that a think run delivered to the door gets the door's reads. Returns the undo. */
export function registerDoorThinkDesk(desk: ThinkDesk = (origin) => doorThinkDesk(origin)): () => void {
  return registerThinkDesk("door", desk);
}
