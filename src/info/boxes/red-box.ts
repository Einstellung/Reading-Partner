// The day's rooms, delivered into the reader's Red Box (docs/63 呈现, docs/68).
//
// A briefing file is the page; this is what the corner and the secretary see of
// it. One item per room that changed today, `source: "cable"`, the cover being
// the room's one line with the room's name in front of it. The body is a
// reference and never the text: the briefing file plus the room id, which is
// where that cover can be read in full.
//
// Two things make a second delivery of the same briefing a no-op rather than a
// second pile of cards. The box id carries `generatedAt`, so a regenerate on the
// same day is a different box while a re-save of the same one is not; and an
// item's id is derived from the box id and the room, so a second put of the same
// pair finds the file already there and hands it back untouched (box/store.ts).
// `createdAt` is the briefing's own `generatedAt` for the same reason: nothing
// here reads a clock, so the item two devices would write is byte-identical.
//
// Only the device that generated the briefing delivers it — this is called on
// the save path, which a reader device never walks (it pulls the published file
// instead). The items reach the other devices as box files, through sync.

import type { BoxItem, BoxStore, PutBoxItemInput } from "../../box";
import { contentHash } from "../../platform/app/content-hash";
import { briefingFile } from "../collect/store";
import type { Briefing } from "./types";

/** The delivery one briefing is. A regenerate on the same day is another box. */
export function briefingBoxId(briefing: Pick<Briefing, "date" | "generatedAt">): string {
  return `briefing-${briefing.date}-${briefing.generatedAt}`;
}

/**
 * The item's category: which room's change this is. It is what supersession
 * matches on — a new day's cover for a room closes the last one — so it holds
 * the room id and not only the fact that it is a room's change.
 */
export function labItemKind(labId: string): string {
  return `lab:${labId}`;
}

/** The room a `lab:` kind names, or null for any other kind. */
export function labIdOfKind(kind: string | undefined): string | null {
  return kind !== undefined && kind.startsWith("lab:") ? kind.slice("lab:".length) : null;
}

/** Where this cover can be read in full. A reference; the text stays out. */
export function labItemBody(date: string, labId: string): string {
  return `${briefingFile(date)}#${labId}`;
}

// A file name is 32 hex characters (box/store.ts), so the key is hashed rather
// than spelled out.
async function labItemId(boxId: string, labId: string): Promise<string> {
  return `b-${await contentHash(new TextEncoder().encode(`${boxId}\n${labId}`))}`;
}

/** One item per room that changed today, in the order the briefing cuts them. */
export async function briefingBoxItems(briefing: Briefing): Promise<PutBoxItemInput[]> {
  const boxId = briefingBoxId(briefing);
  return await Promise.all(
    briefing.labs.map(async (lab) => ({
      id: await labItemId(boxId, lab.labId),
      boxId,
      source: "cable" as const,
      cover: `${lab.name}: ${lab.cover}`,
      body: labItemBody(briefing.date, lab.labId),
      origin: { place: "briefing" as const, date: briefing.date },
      kind: labItemKind(lab.labId),
      needsDecision: false,
      at: briefing.generatedAt,
    })),
  );
}

/**
 * Put today's rooms in the box and close yesterday's.
 *
 * Supersession is by room and not by age (docs/63): a room the reader never got
 * to is `dismissed` once that same room has something newer to say, and a room
 * that was quiet today keeps the item it has. Only `in-box` items are closed —
 * one the reader has been to is `told` and already gone from the corner, and an
 * exit is final anyway.
 *
 * The new items go in first, so a failure halfway cannot leave the reader with
 * an emptier box than they started with.
 */
export async function deliverBriefing(
  briefing: Briefing,
  box: BoxStore,
): Promise<{ put: BoxItem[]; superseded: BoxItem[] }> {
  const boxId = briefingBoxId(briefing);
  const put: BoxItem[] = [];
  for (const input of await briefingBoxItems(briefing)) put.push(await box.put(input));

  const rooms = new Set(briefing.labs.map((lab) => labItemKind(lab.labId)));
  const superseded: BoxItem[] = [];
  for (const old of await box.list({ source: "cable", state: "in-box" })) {
    if (old.boxId === boxId || old.kind === undefined || !rooms.has(old.kind)) continue;
    const closed = await box.setState(old.id, "dismissed", briefing.generatedAt);
    if (closed) superseded.push(closed);
  }
  return { put, superseded };
}
