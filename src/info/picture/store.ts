// One picture file per lab, in sync range so the reader's phone can show what
// the room thinks. Merged opaque: the collector device is the only writer, and
// two devices that both ran a day would not have two halves of a picture to
// reconcile anyway — they would have two whole ones.
//
// Read through readGuardedJson. A picture is the one thing on the info side
// that cannot be rebuilt: every judgment in it was made against cables that are
// pruned after thirty days. So an unreadable file raises rather than answering
// with an empty picture, which the next run would save straight over the top of.

import {
  quarantineFile,
  readGuardedJson,
  writeTextAtomic,
  type CorruptFileReport,
  type GuardedRead,
} from "../../platform/app/atomic-fs";
import { reportStoreError } from "../../platform/app/store-errors";
import { emptyPicture, parsePicture } from "./picture";
import type { Picture } from "./types";

export function pictureFile(labId: string): string {
  return `info-picture-${labId}.json`;
}

export interface PictureIo {
  read(file: string, validate: (raw: unknown) => Picture | null): Promise<GuardedRead<Picture>>;
  write(file: string, contents: string): Promise<void>;
  quarantine(file: string): Promise<string | null>;
  reportCorrupt(report: CorruptFileReport): void;
}

export const pictureIo: PictureIo = {
  read: readGuardedJson,
  write: writeTextAtomic,
  quarantine: quarantineFile,
  reportCorrupt: (report) => reportStoreError("corrupt-file", report),
};

/**
 * The room's picture. A room that has never run has no file and gets an empty
 * one, which is also what the cold start reads: baseline "" and no observables
 * is the analyst's cue to draft them.
 */
export async function loadPicture(labId: string, io: PictureIo = pictureIo): Promise<Picture> {
  const file = pictureFile(labId);
  const read = await io.read(file, (raw) => parsePicture(raw));
  if (read.status === "ok") return read.value;
  if (read.status === "missing") return emptyPicture(labId);
  if (read.savedAs === null) throw new Error(`${file} could not be read`);
  // The bad bytes are aside; the room starts over rather than staying stuck.
  return emptyPicture(labId);
}

export async function savePicture(picture: Picture, io: PictureIo = pictureIo): Promise<void> {
  await io.write(pictureFile(picture.labId), JSON.stringify(picture, null, 2));
}
