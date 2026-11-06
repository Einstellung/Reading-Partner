// The confirmation card a gated write waits on (docs/platform/687 确认). The
// payload is what the chat stores; the pending record on disk is what the card
// confirms, so a card read back off a thread file still confirms the same write.
// Drawn by ui/components/chat/HousekeeperConfirmCard.tsx.

import type { Gate } from "./registry";
import type { PendingRecord } from "./store";

export const HOUSEKEEPER_CONFIRM_KIND = "housekeeper-confirm";

export interface HousekeeperConfirmCard {
  kind: typeof HOUSEKEEPER_CONFIRM_KIND;
  pendingId: string;
  /** The palace kind the write is to. */
  dataKind: string;
  gate: Gate;
  /** What the write changes, one line each in the user's terms. */
  lines: string[];
}

export function confirmCard(record: PendingRecord): HousekeeperConfirmCard {
  return {
    kind: HOUSEKEEPER_CONFIRM_KIND,
    pendingId: record.pendingId,
    dataKind: record.kind,
    gate: record.gate,
    lines: [...record.lines],
  };
}

/** Where a card is raised: the conversation the write was asked for in. */
export type RaiseConfirmCard = (card: HousekeeperConfirmCard) => void;
