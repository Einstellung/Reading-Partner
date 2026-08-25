// Starting a retell from a topic (docs/31): what the topic offers as material,
// and the act of starting one.
//
// Both halves used to sit in the two screens that offer "New retell" (the topic's
// Retells section and a material's card), which put a domain operation in a .tsx
// and let the two copies drift — one of them could stop logging the start and
// nothing would say so. The screens now supply the topic and the picked
// materials and get back a retell.
//
// The display title is passed in rather than imported: what a file is called on
// screen is the library's naming rule (ui/components/shelf/file-title.ts), and
// a domain module does not reach up into ui.
//
// The store's startRetell is module-internal on purpose and is not on the retells
// barrel: reaching it from a screen gets a retell on disk without the start event,
// which is the drift createRetell exists to close. Callers outside this directory
// start a retell through createRetell.

import { loadAnnotations } from "../../platform/app/annotations";
import { logEvent, type EventPayload, type EventType } from "../../platform/app/events";
import { sortedFiles, type Topic } from "../../platform/app/topics";
import type { MaterialCandidate } from "./list";
import { startRetell } from "./store";
import type { Retell, RetellMaterial } from "./types";

// The topic's materials a retell can be started from: everything with a book id,
// with its mark count so the picker can tick the ones worth retelling
// (defaultMaterialSelection, list.ts). A file with no book id has nothing on
// disk to retell from and is skipped rather than offered and then failing.
//
// A book whose marks cannot be read counts as zero rather than taking the whole
// picker down with it: the count decides what starts ticked, and being offered
// an unticked book beats being offered no dialog.
export async function retellCandidates(
  topic: Topic,
  displayTitle: (fileName: string) => string,
): Promise<MaterialCandidate[]> {
  const files = sortedFiles(topic).filter((f) => !!f.hash);
  return Promise.all(
    files.map(async (f) => {
      const bookId = f.hash as string;
      const marks = await loadAnnotations(bookId).catch(() => []);
      return { bookId, title: displayTitle(f.name), marks: marks.length };
    }),
  );
}

// Start a retell under a topic and record that it happened. The event is the
// start's other half (docs/31 counts retells per topic), so it lives here and not
// at whichever screen pressed the button.
//
// `log` is a parameter for the same reason the event logger takes its append
// (events.ts): the log itself only writes under Tauri, so the one thing worth
// asserting — that a start is recorded exactly once, with how much material went
// in — is only observable through a seam.
export async function createRetell(
  topicId: string,
  materials: RetellMaterial[],
  log: (topicId: string, type: EventType, payload?: EventPayload) => void = logEvent,
): Promise<Retell> {
  const retell = await startRetell({ topicId, materials });
  log(topicId, "talk-start", { retellId: retell.id, materials: materials.length });
  return retell;
}
