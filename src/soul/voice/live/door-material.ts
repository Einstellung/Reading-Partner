// What the reader has open beside a call at the door (docs/info/88 「简报的对话」):
// today the brief in the reader. The screen that starts the call knows what is
// open and hands a provider in; the call reads it for the front's place each
// turn (door-call.ts), and a think run delivered to the door reads it when it
// starts (reading/turn/door-think.ts). Neither of those may import the screen,
// so the provider of the call that is live sits here, set when the call starts
// and cleared when it stops.

import type { DeskRef } from "../../../desk";

/** What a think run lays on its desk for the material: the items, and a note on where the reader is. */
export interface DoorDeskMaterial {
  desk: DeskRef[];
  note: string;
}

export interface DoorCallMaterial {
  /** Whether something is open now. */
  opened(): boolean;
  /** The front's lines about what is open, read each turn; "" when nothing is. */
  place(): Promise<string>;
  /** What a think run starting now lays on its desk; null when nothing is open. */
  desk(): Promise<DoorDeskMaterial | null>;
}

let live: { material: DoorCallMaterial | null } | null = null;

/**
 * Say that a door call is live with this provider (null: none). A call that
 * starts replaces whatever an earlier one left. Returns the undo, which clears
 * the slot only while it still holds this call's.
 */
export function holdDoorMaterial(material: DoorCallMaterial | null): () => void {
  const held = { material };
  live = held;
  return () => {
    if (live === held) live = null;
  };
}

/** The provider of the door call that is live; null with no call, or a call that has none. */
export function liveDoorMaterial(): DoorCallMaterial | null {
  return live?.material ?? null;
}
