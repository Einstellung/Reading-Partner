// One picture file per lab, in sync range so the reader's phone can show what
// the room thinks. Merged opaque: the collector device is the only writer, and
// two devices that both ran a day would not have two halves of a picture to
// reconcile anyway — they would have two whole ones.
//
// Read through readGuardedJson. A picture is the one thing on the info side
// that cannot be rebuilt: every judgment in it was made against cables that are
// pruned after thirty days. So an unreadable file raises rather than answering
// with an empty picture, which the next run would save straight over the top of.

import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../platform/app/guarded-file";
import { emptyPicture, parsePicture } from "./picture";
import type { Picture } from "./types";

export function pictureFile(labId: string): string {
  return `info-picture-${labId}.json`;
}

export type PictureIo = GuardedFileIo<Picture>;

export const pictureIo: PictureIo = appGuardedFileIo();

/**
 * The room's picture. A room that has never run has no file and gets an empty
 * one, which is also what the cold start reads: baseline "" and no observables
 * is the analyst's cue to draft them.
 */
export async function loadPicture(labId: string, io: PictureIo = pictureIo): Promise<Picture> {
  // Bad bytes are aside by then; the room starts over rather than staying stuck.
  return (await readGuardedFile(io, pictureFile(labId), (raw) => parsePicture(raw))) ?? emptyPicture(labId);
}

export async function savePicture(picture: Picture, io: PictureIo = pictureIo): Promise<void> {
  await io.write(pictureFile(picture.labId), JSON.stringify(picture, null, 2));
}
