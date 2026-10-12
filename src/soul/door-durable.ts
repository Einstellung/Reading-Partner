// The door's place on the device's durable runtime (docs/soul/87, 第二阶段;
// docs/61): a conversation typed to Lumen at the door is a thread in the day's
// file (door.ts), and its turns run, land and recover the way a book's do
// (legion/durable/device.ts).
//
// The turn this process assembled for a thread — its history and its desk's
// tools, the door's own card-raising tools among them — is used while it is
// there. A turn resumed after a restart reads the day's file and lays the
// door's desk again, without the surface's tools: nobody is there to draw
// their cards.

import type { Context } from "@earendil-works/chord";
import { appBox } from "../box";
import { toPiMessages } from "../ai/providers";
import type { DeskMessage } from "../desk";
import type { ThreadOrigin } from "../legion/durable/extension";
import type { Place, PlaceFactory, PlaceShared } from "../legion/durable/device";
import { threadLander } from "../legion/durable/thread-files";
import type { AgentTool } from "../legion/durable/contract";
import { loadSettings } from "../platform/app/settings";
import { coverOf } from "./bell";
import { doorKey, openDoorTurn } from "./door";

export type DoorOrigin = { place: "door"; date: string; threadId: string };

export function doorOrigin(date: string, threadId: string): DoorOrigin {
  return { place: "door", date, threadId };
}

export function asDoorOrigin(origin: ThreadOrigin): DoorOrigin {
  const o = origin as unknown as DoorOrigin;
  if (o.place !== "door" || typeof o.date !== "string" || typeof o.threadId !== "string") {
    throw new Error("not a door thread origin");
  }
  return o;
}

/** The thread's key in `rp.conversations`. */
export function doorThreadKey(origin: Pick<DoorOrigin, "date" | "threadId">): string {
  return `door:${origin.date}:${origin.threadId}`;
}

/** What a turn assembled in this process for a door thread: the history before the reader's line, and the desk's tools. */
export interface AssembledDoorTurn {
  history: readonly DeskMessage[];
  tools: readonly AgentTool[];
}

/** The door turns assembled in this process, by thread key. */
export const doorAssemblies = new Map<string, AssembledDoorTurn>();

export interface DoorPlaceDeps {
  assembled?: Map<string, AssembledDoorTurn>;
  /** The door's desk after a restart: the soul's own tools. */
  openDesk?: (origin: DoorOrigin, context: Context) => Promise<readonly AgentTool[]>;
  /** Whether the reader has this conversation open as the turn lands. */
  watching?: (origin: DoorOrigin) => boolean;
  /** The box card for a reply nobody saw. */
  card?: (origin: DoorOrigin, ts: number, text: string) => Promise<void>;
}

const watchingProbes = new Set<(origin: DoorOrigin) => boolean>();

/** The door chat says which conversation it has open; the returned function takes it back. */
export function setDoorWatching(probe: (origin: DoorOrigin) => boolean): () => void {
  watchingProbes.add(probe);
  return () => watchingProbes.delete(probe);
}

/** Whether a door chat has this conversation open now. */
export function doorWatchingNow(origin: DoorOrigin): boolean {
  return [...watchingProbes].some((probe) => probe(origin));
}

async function openDoorDesk(origin: DoorOrigin): Promise<readonly AgentTool[]> {
  const turn = await openDoorTurn({ settings: await loadSettings(), threadId: origin.threadId, date: origin.date });
  return turn?.tools ?? [];
}

/** The same card an answer that landed unseen always gets: named by the thread and the moment. */
async function putDoorCard(origin: DoorOrigin, ts: number, text: string): Promise<void> {
  await appBox()
    .put({
      boxId: `${origin.threadId}:${ts}`,
      source: "turn",
      cover: coverOf(text),
      origin: { place: "door", date: origin.date },
      needsDecision: false,
      at: ts,
    })
    .catch((e: unknown) => console.warn("a reply landed but its box item would not write", e));
}

export function doorPlace(deps: DoorPlaceDeps = {}): PlaceFactory {
  const assembled = deps.assembled ?? doorAssemblies;
  const openDesk = deps.openDesk ?? openDoorDesk;
  const watching = deps.watching ?? doorWatchingNow;
  const card = deps.card ?? putDoorCard;
  return (shared: PlaceShared): Place => ({
    key: (origin) => doorThreadKey(asDoorOrigin(origin)),
    address: (origin) => {
      const door = asDoorOrigin(origin);
      return { key: doorKey(door.date), threadId: door.threadId };
    },
    resolve: async (origin, context) => {
      const door = asDoorOrigin(origin);
      return assembled.get(doorThreadKey(door))?.tools ?? openDesk(door, context);
    },
    land: threadLander({
      threads: shared.threads,
      describe: shared.describe,
      origin: asDoorOrigin,
      address: (door) => ({ key: doorKey(door.date), threadId: door.threadId }),
      watching,
      card,
    }),
    readHistory: async (origin, options) => {
      const door = asDoorOrigin(origin);
      const live = assembled.get(doorThreadKey(door));
      if (live) return toPiMessages([...live.history]);
      const key = doorKey(door.date);
      await shared.threads.load(key);
      const said = (shared.threads.messages(key, door.threadId) ?? [])
        .filter((m) => !(m.role === "user" && m.ts === options.excludeTs) && m.text.trim() !== "")
        .map((m): DeskMessage => ({ role: m.role, text: m.text }));
      return toPiMessages(said);
    },
    telemetry: (origin) => ({ surface: "door", thread: asDoorOrigin(origin).threadId }),
  });
}
