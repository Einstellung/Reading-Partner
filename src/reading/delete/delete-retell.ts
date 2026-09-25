// Deleting a retell: the talk outline it produced, the rehearsals of that talk,
// and the retell itself (docs/50).
//
// One function, used by the retell's own menu, by a deleted book and by a
// deleted topic, so the three cannot drift: the palace says the outline and the
// talk's conversation die with the retell (palace/kinds.ts, deleteWith), and
// this is the one place that makes it so. The stores each log their own
// deletion and remove their own files; what is here is the order.
//
// The outline goes first, because the retell is how it is found. Its rehearsals
// go before it, because the outline's store cannot reach them without a cycle
// (talk/store.ts); the rehearsals that name the retell go with the retell.

import { deleteRetell } from "../retell/store";
import { deleteRehearsalsForOutline } from "../rehearsal/store";
import { deleteTalkOutline, talkOutlineOfRetell } from "../talk/store";

/** Drop an outline, the rehearsals against it first. */
export async function deleteOutlineWithRehearsals(outlineId: string): Promise<void> {
  await deleteRehearsalsForOutline(outlineId);
  await deleteTalkOutline(outlineId);
}

export interface DeleteRetellDeps {
  outlineIdOfRetell: (retellId: string) => Promise<string | null>;
  deleteTalkOutline: (outlineId: string) => Promise<void>;
  deleteRetell: (retellId: string) => Promise<void>;
}

export const liveDeleteRetellDeps: DeleteRetellDeps = {
  outlineIdOfRetell: async (retellId) => (await talkOutlineOfRetell(retellId))?.id ?? null,
  deleteTalkOutline: deleteOutlineWithRehearsals,
  deleteRetell,
};

/** Delete a retell with the talk it produced. Idempotent: a second call finds nothing. */
export async function deleteRetellWithTalk(
  retellId: string,
  deps: DeleteRetellDeps = liveDeleteRetellDeps,
): Promise<void> {
  const outlineId = await deps.outlineIdOfRetell(retellId);
  if (outlineId) await deps.deleteTalkOutline(outlineId);
  await deps.deleteRetell(retellId);
}
