// Buy and Restore on the lock screen (docs/platform/713). Placeholders until the
// in-app purchase plugin exists; both report the store as unavailable.

import type { PurchaseHandlers } from "./gate";

export const purchaseHandlers: PurchaseHandlers = {
  // wired to platform/app/purchases once it lands
  buy: async () => ({ ok: false, error: "unavailable" }),
  restore: async () => ({ ok: false, error: "unavailable" }),
};
