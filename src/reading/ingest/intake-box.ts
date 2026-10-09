// The Red Box item a link intake keeps in Lumen's case while its topic is not
// picked (docs/68 「收链接」). Documents filed by an intake are attached nowhere
// until the reader picks a topic, so nothing on the shelf leads to them; this
// item is the one thing that does.
//
// Born when the run is handed over, one per intake, under the run's box id: it
// and anything the run's own bell puts in the box later are one delivery. It
// leaves the box `saved` when a topic is picked, whether or not the fetch has
// finished (the documents attach on filing), and `dismissed` when the intake
// failed, because there is nothing left to pick for and the run's own bell says
// why. Tapping it does not move it (lumen/box-jump.ts).
//
// The id is derived from the intake id, so the pick finds the item without the
// intake record having to remember it.

import { t } from "../../i18n";
import type { BoxItem, BoxItemState, BoxOrigin, BoxStore, PutBoxItemInput } from "../../box";
import { hostOf } from "../../platform/std/url";

/** The `kind` an intake's box item carries. Its `body` is the intake id. */
export const INTAKE_BOX_KIND = "link-intake";

// Four FNV-1a passes with different seeds: 128 bits of a stable digest for an
// intake id that is not already a UUID (the tests' ids are not).
function digest128(text: string): string {
  let out = "";
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** The box item id for an intake: the UUID's own hex when it is one, a digest otherwise. */
export function intakeBoxItemId(intakeId: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return `b-${uuid.test(intakeId) ? intakeId.replace(/-/g, "").toLowerCase() : digest128(intakeId)}`;
}

/** The item put in the box when an intake's run has been handed over. */
export function intakeBoxItem(
  intake: { id: string; url: string },
  runId: string,
  origin: BoxOrigin,
  at: number,
): PutBoxItemInput {
  return {
    id: intakeBoxItemId(intake.id),
    boxId: runId,
    source: "run",
    cover: t("reader.intake.boxCover", { host: hostOf(intake.url) }),
    body: intake.id,
    origin,
    kind: INTAKE_BOX_KIND,
    runId,
    needsDecision: true,
    at,
  };
}

/** The intake an item stands for, or null for any other item. */
export function intakeIdOfItem(item: Pick<BoxItem, "kind" | "body">): string | null {
  return item.kind === INTAKE_BOX_KIND && item.body ? item.body : null;
}

/**
 * Take the intake's item out of the box. On a pick, anything else of the same
 * delivery still open (the run's bell, landed while nobody was looking) is
 * about the same link and folds with it; on a failure it stays, because it is
 * what says why. Nothing to do when this device never put one.
 */
export async function exitIntakeItem(
  box: BoxStore,
  intakeId: string,
  state: Extract<BoxItemState, "saved" | "dismissed">,
  at?: number,
): Promise<void> {
  const item = await box.get(intakeBoxItemId(intakeId));
  if (!item) return;
  await box.setState(item.id, state, at);
  if (state !== "saved") return;
  for (const other of await box.open({ boxId: item.boxId })) {
    if (other.id !== item.id) await box.setState(other.id, "folded", at);
  }
}
