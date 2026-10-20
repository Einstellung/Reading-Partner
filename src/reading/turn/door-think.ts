// The tools a think run handed off from a call at the door gets
// (docs/companion/136, docs/68): the door conversation's own desk, reads only.
// The soul's set as a door turn lays it — its past conversations, the
// catalogue, the observations it recalls — plus the reads the door mounts
// beside it (ui/components/lumen/door-tools.ts): web_search with read_page,
// and background_status. The door's card-raising tools need a conversation on
// screen and are writes; soul/think kind.ts drops every write anyway.

import type { BoxOrigin } from "../../box";
import type { AgentTool } from "../../legion/durable/contract";
import { liveBackgroundStatusTool } from "../../legion/status/live";
import { loadSettings, type Settings } from "../../platform/app/settings";
import { openDoorThread, openDoorTurn, type AssembledTurn, type DoorTurnInput } from "../../soul";
import { registerThinkDesk, type ThinkDesk } from "../../soul/think";
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
}

const appDeps: DoorThinkDeskDeps = {
  settings: loadSettings,
  openThread: (date) => openDoorThread(date),
  openTurn: openDoorTurn,
  surfaceTools: doorReadTools,
};

/** The desk of the day at the door, laid the way a door turn lays it. */
export async function doorThinkDesk(origin: BoxOrigin, deps: DoorThinkDeskDeps = appDeps): Promise<AgentTool[]> {
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
  return turn?.tools ?? surface;
}

/** Say that a think run delivered to the door gets the door's reads. Returns the undo. */
export function registerDoorThinkDesk(desk: ThinkDesk = (origin) => doorThinkDesk(origin)): () => void {
  return registerThinkDesk("door", desk);
}
