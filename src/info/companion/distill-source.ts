// The info conversations, offered to distillation as raw material (docs/58,
// docs/61).
//
// Everything the reader says on the info page — the day's briefing conversation,
// a conversation about one article, a voice call about either — is written to
// threads-info-<date>.json and, until this, was never read back. The memory only
// ever heard about books.
//
// The unit is one thread, not the day's file: a briefing conversation and a
// conversation about one article are two conversations, and each carries its own
// cursor under its own id. Those two id shapes are already unique across files
// (anchors.ts); "onboarding" is not — it is the same literal in every day's file
// (docs/pitfall/209) — so it is left out rather than distilled under a key that
// would mean whichever day was read last.

import {
  registerDistillSource,
  type SourceUnit,
} from "../../memory";
import { resolvePalace } from "../../palace";
import { appData } from "../../platform/app/appdata";
import { peekThreads } from "../../platform/app/threads";
import { BRIEF_TOPIC_ID } from "../../platform/app/topics";
import { ONBOARDING_THREAD_ID } from "./anchors";
import { infoBookId } from "./call";

// What a day's conversations are called in the pass's prompt, in place of a
// book's name.
export function infoUnitLabel(dateKey: string): string {
  return `Info briefing ${dateKey}`;
}

/** Every info conversation on disk, oldest day first. */
export async function listInfoUnits(): Promise<SourceUnit[]> {
  const entries = await appData.readDir(".").catch(() => []);
  // Which files are info threads is the catalogue's answer, not a regex here:
  // the row owns the shape of the name and the date it captures.
  const dates: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile) continue;
    const hit = resolvePalace(entry.name);
    if (hit?.row.kind !== "info-thread" || !hit.id) continue;
    dates.push(hit.id);
  }
  dates.sort();

  const units: SourceUnit[] = [];
  for (const date of dates) {
    const threads = await peekThreads(infoBookId(date)).catch(() => []);
    for (const thread of threads) {
      if (thread.id === ONBOARDING_THREAD_ID) continue;
      if (thread.messages.length === 0) continue;
      units.push({
        id: thread.id,
        // The thread's own topic once it has one (P4 writes it); "brief" until
        // then, which is where every info conversation has been filed anyway.
        topicId: (thread as { topicId?: string }).topicId ?? BRIEF_TOPIC_ID,
        label: infoUnitLabel(date),
        messages: thread.messages.map(({ id, role, text, ts }) => ({
          ...(id ? { id } : {}),
          role,
          text,
          ts,
        })),
      });
    }
  }
  return units;
}

/**
 * Register the info conversations as a distillation source. Called by the shell
 * on the way up (useShellBootstrap.ts); the undo is for tests.
 */
export function registerInfoDistillSource(): () => void {
  return registerDistillSource({
    kind: "info-thread",
    listUnits: listInfoUnits,
    cursor: "distilledMessages",
    // The day files are kept: they are the reader's conversations, they sync,
    // and nothing yet decides when a day stops being worth having (docs/58).
    afterEnd: "keep",
  });
}
